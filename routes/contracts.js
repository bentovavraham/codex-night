const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');
const storage = require('../lib/storage');
const { extractContract } = require('../lib/extract');

const router = express.Router();

const APPROX = 0.01; // Allow 1-cent rounding tolerance when validating allocations.

const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/contracts/extract — upload contract PDF → store + Claude extraction
router.post('/contracts/extract', requireAuth, pdfUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await storage.save(req.file.buffer, {
      filename: req.file.originalname || 'contract.pdf',
      mimeType: req.file.mimetype || 'application/pdf',
    });
    let extracted = null;
    let extract_error = null;
    try { extracted = await extractContract(req.file.buffer); }
    catch (err) { console.error('Contract extraction failed:', err.message); extract_error = err.message; }
    res.status(201).json({
      file_reference: saved.reference,
      download_url: `/api/files/${encodeURIComponent(saved.reference)}`,
      filename: saved.filename, size: saved.size,
      extracted, extract_error,
    });
  } catch (err) { next(err); }
});

async function userCanAccessContract(userId, contractId) {
  const r = await pool.query('SELECT project_id FROM contracts WHERE id = $1', [contractId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id))) {
    return { ok: false, status: 403 };
  }
  return { ok: true, projectId: r.rows[0].project_id };
}

// List contracts within a project.
router.get('/projects/:id/contracts', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const filters = ['c.project_id = $1'];
    const params = [projectId];
    if (req.query.vendor) {
      params.push(`%${req.query.vendor}%`);
      filters.push(`c.vendor_name ILIKE $${params.length}`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      filters.push(`c.status = $${params.length}`);
    }
    const sortMap = {
      vendor: 'c.vendor_name ASC',
      amount: 'c.total_value DESC',
      status: 'c.status ASC, c.created_at DESC',
    };
    const order = sortMap[req.query.sort] || 'c.contract_date DESC NULLS LAST, c.created_at DESC';
    const result = await pool.query(
      `SELECT c.*,
              (SELECT COALESCE(SUM(amount),0) FROM invoices
                 WHERE contract_id = c.id AND status IN ('approved','pushed','paid')) AS invoiced_amount
       FROM contracts c
       WHERE ${filters.join(' AND ')}
       ORDER BY ${order}`,
      params
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create contract with allocation lines.
router.post('/projects/:id/contracts', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const {
      vendor_name, description, total_value, earmarked_amount, contract_date,
      reference_number, status, file_reference, lines,
    } = req.body || {};
    if (!vendor_name || total_value == null) {
      return res.status(400).json({ error: 'vendor_name and total_value required' });
    }
    const total = Number(total_value);
    if (!Number.isFinite(total) || total < 0) {
      return res.status(400).json({ error: 'total_value must be >= 0' });
    }
    const earmarked = earmarked_amount != null ? Number(earmarked_amount) : null;
    const allocs = Array.isArray(lines) ? lines : [];
    if (allocs.length === 0) return res.status(400).json({ error: 'At least one line required' });
    const sum = allocs.reduce((s, l) => s + Number(l.amount || 0), 0);
    if (Math.abs(sum - total) > APPROX) {
      return res.status(400).json({
        error: `Contract lines must sum to total_value (${total}). Got ${sum}.`,
      });
    }

    await client.query('BEGIN');
    const contract = await client.query(
      `INSERT INTO contracts
         (project_id, vendor_name, description, total_value, earmarked_amount, contract_date,
          reference_number, status, file_reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'draft'),$9,$10)
       RETURNING *`,
      [projectId, vendor_name, description || null, total, earmarked,
       contract_date || null, reference_number || null,
       status || null, file_reference || null, req.session.userId]
    );
    const contractId = contract.rows[0].id;
    for (const l of allocs) {
      await client.query(
        `INSERT INTO contract_lines (contract_id, qb_code_id, amount)
         VALUES ($1, $2, $3)`,
        [contractId, Number(l.qb_code_id), Number(l.amount)]
      );
    }
    await client.query('COMMIT');
    // Log creation (outside transaction is fine — contract is committed).
    await pool.query(
      `INSERT INTO contract_logs (contract_id, action, detail, changed_by)
       VALUES ($1,'created',$2,$3)`,
      [contractId, `Created: ${vendor_name} for $${total}`, req.session.userId]);
    res.status(201).json(contract.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// Get contract with lines and invoices.
router.get('/contracts/:id', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });

    const [contract, lines, invoices] = await Promise.all([
      pool.query('SELECT * FROM contracts WHERE id = $1', [contractId]),
      pool.query(
        `SELECT cl.id, cl.contract_id, cl.qb_code_id, cl.amount,
                q.code, q.name
         FROM contract_lines cl JOIN qb_codes q ON q.id = cl.qb_code_id
         WHERE cl.contract_id = $1
         ORDER BY q.code ASC`, [contractId]
      ),
      pool.query(
        `SELECT * FROM invoices WHERE contract_id = $1 ORDER BY invoice_date DESC NULLS LAST, created_at DESC`,
        [contractId]
      ),
    ]);
    const c = contract.rows[0];
    const invoicedAgainst = invoices.rows
      .filter((i) => ['approved', 'pushed', 'paid'].includes(i.status))
      .reduce((s, i) => s + Number(i.amount), 0);
    res.json({
      ...c,
      lines: lines.rows,
      invoices: invoices.rows,
      invoiced_amount: invoicedAgainst,
      remaining_amount: Number(c.total_value) - invoicedAgainst,
    });
  } catch (err) { next(err); }
});

// Update contract with audit logging.
router.put('/contracts/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const old = await client.query('SELECT * FROM contracts WHERE id = $1', [contractId]);
    const {
      vendor_name, description, total_value, earmarked_amount, contract_date,
      reference_number, status, file_reference,
    } = req.body || {};
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contracts SET
         vendor_name      = COALESCE($2, vendor_name),
         description      = COALESCE($3, description),
         total_value      = COALESCE($4, total_value),
         earmarked_amount = COALESCE($5, earmarked_amount),
         contract_date    = COALESCE($6, contract_date),
         reference_number = COALESCE($7, reference_number),
         status           = COALESCE($8, status),
         file_reference   = COALESCE($9, file_reference),
         updated_at       = NOW()
       WHERE id = $1 RETURNING *`,
      [contractId, vendor_name ?? null, description ?? null, total_value ?? null,
       earmarked_amount ?? null, contract_date ?? null, reference_number ?? null,
       status ?? null, file_reference ?? null]);
    const changes = [];
    const o = old.rows[0];
    if (vendor_name && vendor_name !== o.vendor_name) changes.push(`vendor: ${o.vendor_name} → ${vendor_name}`);
    if (total_value != null && Number(total_value) !== Number(o.total_value)) changes.push(`total: $${Number(o.total_value).toFixed(2)} → $${Number(total_value).toFixed(2)}`);
    if (status && status !== o.status) changes.push(`status: ${o.status} → ${status}`);
    if (changes.length > 0) {
      await client.query(
        `INSERT INTO contract_logs (contract_id, action, detail, changed_by) VALUES ($1,'edited',$2,$3)`,
        [contractId, changes.join('; '), req.session.userId]);
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// GET /api/contracts/:id/history
router.get('/contracts/:id/history', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT l.*, u.name AS changed_by_name FROM contract_logs l
       JOIN users u ON u.id = l.changed_by WHERE l.contract_id = $1
       ORDER BY l.changed_at DESC`, [contractId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/contracts/export (CSV)
router.get('/projects/:id/contracts/export', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId)))
      return res.status(403).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT c.vendor_name, c.total_value, c.contract_date, c.reference_number,
              c.status, c.description, c.created_at,
              (SELECT COALESCE(SUM(amount),0) FROM invoices WHERE contract_id = c.id
                 AND status IN ('approved','pushed','paid')) AS invoiced
       FROM contracts c WHERE c.project_id = $1 ORDER BY c.contract_date DESC NULLS LAST`, [projectId]);
    const header = 'Vendor,Total,Date,Reference,Status,Description,Invoiced,Created\n';
    const rows = result.rows.map(r =>
      [r.vendor_name, r.total_value, r.contract_date || '', r.reference_number || '',
       r.status, `"${(r.description || '').replace(/"/g, '""')}"`,
       r.invoiced, r.created_at].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="contracts-project-${projectId}.csv"`);
    res.send(header + rows);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/cost-summary — project-level financial position
router.get('/projects/:id/cost-summary', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId)))
      return res.status(403).json({ error: 'Forbidden' });

    const [contractsR, cosR, tmR, expR, invoicedR, paidR, pendingInvR] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total_value),0) AS total, COALESCE(SUM(earmarked_amount),0) AS earmarked,
          COUNT(*) AS contract_count
        FROM contracts WHERE project_id = $1`, [projectId]),
      pool.query(`SELECT
          COALESCE(SUM(CASE WHEN co.status='approved' THEN co.amount ELSE 0 END),0) AS approved_total,
          COALESCE(SUM(CASE WHEN co.status='pending'  THEN co.amount ELSE 0 END),0) AS pending_total,
          COUNT(*) FILTER (WHERE co.status='pending') AS pending_count
        FROM change_orders co JOIN contracts c ON c.id = co.contract_id WHERE c.project_id = $1`, [projectId]),
      pool.query(`SELECT
          COALESCE(SUM(CASE WHEN t.status='approved' THEN t.amount ELSE 0 END),0) AS approved_total,
          COALESCE(SUM(CASE WHEN t.status='pending'  THEN t.amount ELSE 0 END),0) AS pending_total
        FROM tm_charges t JOIN contracts c ON c.id = t.contract_id WHERE c.project_id = $1`, [projectId]),
      pool.query(`SELECT
          COALESCE(SUM(CASE WHEN e.status='approved' THEN e.amount ELSE 0 END),0) AS approved_total,
          COALESCE(SUM(CASE WHEN e.status='pending'  THEN e.amount ELSE 0 END),0) AS pending_total
        FROM contract_expenses e JOIN contracts c ON c.id = e.contract_id WHERE c.project_id = $1`, [projectId]),
      pool.query(`SELECT COALESCE(SUM(i.amount),0) AS total FROM invoices i
        WHERE (i.project_id = $1 OR EXISTS (SELECT 1 FROM contracts c WHERE c.id = i.contract_id AND c.project_id = $1))
          AND i.status IN ('approved','pushed','paid')`, [projectId]),
      pool.query(`SELECT COALESCE(SUM(i.amount),0) AS total FROM invoices i
        WHERE (i.project_id = $1 OR EXISTS (SELECT 1 FROM contracts c WHERE c.id = i.contract_id AND c.project_id = $1))
          AND i.status = 'paid'`, [projectId]),
      pool.query(`SELECT COUNT(*) AS count, COALESCE(SUM(i.amount),0) AS amount FROM invoices i
        WHERE (i.project_id = $1 OR EXISTS (SELECT 1 FROM contracts c WHERE c.id = i.contract_id AND c.project_id = $1))
          AND i.status = 'pending'`, [projectId]),
    ]);

    const contractsTotal = Number(contractsR.rows[0].total);
    const earmarkedTotal = Number(contractsR.rows[0].earmarked);
    const approvedCOs    = Number(cosR.rows[0].approved_total);
    const pendingCOs     = Number(cosR.rows[0].pending_total);
    const pendingCOCount = Number(cosR.rows[0].pending_count);
    const tmApproved     = Number(tmR.rows[0].approved_total);
    const tmPending      = Number(tmR.rows[0].pending_total);
    const expApproved    = Number(expR.rows[0].approved_total);
    const expPending     = Number(expR.rows[0].pending_total);
    const invoiced       = Number(invoicedR.rows[0].total);
    const paid           = Number(paidR.rows[0].total);
    const pendingInvoiceCount  = Number(pendingInvR.rows[0].count);
    const pendingInvoiceAmount = Number(pendingInvR.rows[0].amount);

    const commitment       = contractsTotal + approvedCOs + tmApproved + expApproved;
    const earmarkRemaining = earmarkedTotal > 0 ? earmarkedTotal - commitment : null;
    const costCreep        = earmarkedTotal > 0 && commitment > earmarkedTotal;
    const overrun          = invoiced > commitment;

    res.json({
      contracts_total: contractsTotal,
      earmarked_total: earmarkedTotal,
      approved_cos: approvedCOs,
      pending_cos: pendingCOs,
      pending_co_count: pendingCOCount,
      tm_approved: tmApproved,
      tm_pending: tmPending,
      expense_approved: expApproved,
      expense_pending: expPending,
      commitment,
      invoiced,
      paid,
      earmark_remaining: earmarkRemaining,
      pending_invoice_count: pendingInvoiceCount,
      pending_invoice_amount: pendingInvoiceAmount,
      cost_creep: costCreep,
      overrun,
    });
  } catch (err) { next(err); }
});

// GET /api/contracts/:id/ledger — full cost breakdown for one contract
router.get('/contracts/:id/ledger', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Not found' : 'Forbidden' });

    const [contractR, cosR, tmR, expR, invoicedR, paidR] = await Promise.all([
      pool.query('SELECT total_value, earmarked_amount FROM contracts WHERE id = $1', [contractId]),
      // Approved change orders only count toward commitment
      pool.query(`SELECT
          COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END),0) AS approved_total,
          COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END),0) AS pending_total,
          COALESCE(SUM(CASE WHEN status='rejected' THEN amount ELSE 0 END),0) AS rejected_total,
          COUNT(*) FILTER (WHERE status='pending') AS pending_count
        FROM change_orders WHERE contract_id = $1`, [contractId]),
      pool.query(`SELECT
          COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END),0) AS approved_total,
          COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END),0) AS pending_total
        FROM tm_charges WHERE contract_id = $1`, [contractId]),
      pool.query(`SELECT
          COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END),0) AS approved_total,
          COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END),0) AS pending_total
        FROM contract_expenses WHERE contract_id = $1`, [contractId]),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS total
        FROM invoices WHERE contract_id = $1 AND status IN ('approved','pushed','paid')`, [contractId]),
      pool.query(`SELECT COALESCE(SUM(amount),0) AS total
        FROM invoices WHERE contract_id = $1 AND status = 'paid'`, [contractId]),
    ]);

    const original = Number(contractR.rows[0].total_value);
    const earmarked = contractR.rows[0].earmarked_amount != null ? Number(contractR.rows[0].earmarked_amount) : null;
    const approvedCOs = Number(cosR.rows[0].approved_total);
    const pendingCOs  = Number(cosR.rows[0].pending_total);
    const pendingCOCount = Number(cosR.rows[0].pending_count);
    const tmApproved  = Number(tmR.rows[0].approved_total);
    const tmPending   = Number(tmR.rows[0].pending_total);
    const expApproved = Number(expR.rows[0].approved_total);
    const expPending  = Number(expR.rows[0].pending_total);
    const invoiced    = Number(invoicedR.rows[0].total);
    const paid        = Number(paidR.rows[0].total);

    // Commitment = contract + approved COs only (legal obligation on signed scope).
    // T&M and expenses are real money but not contractual commitment — they are exposure.
    const commitment     = original + approvedCOs;
    const totalExposure  = commitment + tmApproved + expApproved;   // full spend risk
    const remaining      = totalExposure - invoiced;
    const earmarkRemaining = earmarked != null ? earmarked - totalExposure : null;
    // Cost creep: total expected spend exceeds internal budget
    const costCreep      = earmarked != null && totalExposure > earmarked;
    // Overrun: vendor has invoiced more than what was committed + approved extras
    const overrun        = invoiced > totalExposure;

    res.json({
      original_contract: original,
      earmarked_amount: earmarked,
      approved_cos: approvedCOs,
      pending_cos: pendingCOs,
      pending_co_count: pendingCOCount,
      tm_approved: tmApproved,
      tm_pending: tmPending,
      expense_approved: expApproved,
      expense_pending: expPending,
      commitment,        // contract + approved COs only
      total_exposure: totalExposure,  // commitment + T&M + expenses
      invoiced,
      paid,
      remaining,         // total_exposure - invoiced
      earmark_remaining: earmarkRemaining,  // earmarked - total_exposure
      cost_creep: costCreep,  // total_exposure > earmarked
      overrun,           // invoiced > total_exposure
    });
  } catch (err) { next(err); }
});

// List invoices for a contract.
router.get('/contracts/:id/invoices', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT * FROM invoices WHERE contract_id = $1 ORDER BY invoice_date DESC NULLS LAST, created_at DESC`,
      [contractId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
