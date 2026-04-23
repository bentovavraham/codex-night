const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth, hasMinRole } = require('../middleware/auth');
const projects = require('./projects');
const storage = require('../lib/storage');
const { extractInvoice } = require('../lib/extract');

const router = express.Router();
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Vendor knowledge helpers --------------------------------------------------

async function getVendorContext(vendorName, limit = 5) {
  if (!vendorName) return { examples: [], vendorNotes: null };
  const [examplesResult, profileResult] = await Promise.all([
    pool.query(
      `SELECT fields_json FROM extraction_examples
       WHERE LOWER(vendor_name) = LOWER($1) AND document_type = 'invoice'
       ORDER BY created_at DESC LIMIT $2`,
      [vendorName, limit]
    ),
    pool.query(
      `SELECT notes FROM vendor_profiles WHERE LOWER(vendor_name) = LOWER($1)`,
      [vendorName]
    ),
  ]);
  return {
    examples: examplesResult.rows,
    vendorNotes: profileResult.rows[0]?.notes || null,
  };
}

async function saveExtractionExample(client, vendorName, fields, userId) {
  if (!vendorName) return;
  await client.query(
    `INSERT INTO extraction_examples (vendor_name, document_type, fields_json, confirmed_by)
     VALUES ($1, 'invoice', $2, $3)`,
    [vendorName, JSON.stringify(fields), userId]
  );
}

// Helpers -------------------------------------------------------------------

async function getInvoiceWithProject(invoiceId) {
  const r = await pool.query(
    `SELECT i.*, COALESCE(i.project_id, c.project_id) AS project_id
     FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id
     WHERE i.id = $1`, [invoiceId]);
  return r.rows[0] || null;
}

async function logInvoice(client, invoiceId, action, detail, userId) {
  await client.query(
    `INSERT INTO invoice_logs (invoice_id, action, detail, changed_by)
     VALUES ($1,$2,$3,$4)`, [invoiceId, action, detail, userId]);
}

// POST /api/invoices/extract ------------------------------------------------
router.post('/invoices/extract', requireAuth, pdfUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await storage.save(req.file.buffer, {
      filename: req.file.originalname || 'invoice.pdf',
      mimeType: req.file.mimetype || 'application/pdf',
    });
    let extracted = null, extract_error = null;
    try {
      // Pass 1: quick extraction to get vendor name.
      const pass1 = await extractInvoice(req.file.buffer);
      // Pass 2: re-extract with vendor context if we know this vendor.
      const ctx = await getVendorContext(pass1.vendor_name);
      if (ctx.examples.length > 0 || ctx.vendorNotes) {
        extracted = await extractInvoice(req.file.buffer, ctx);
      } else {
        extracted = pass1;
      }
    }
    catch (err) { console.error('Invoice extraction failed:', err.message); extract_error = err.message; }
    res.status(201).json({
      file_reference: saved.reference,
      download_url: `/api/files/${encodeURIComponent(saved.reference)}`,
      filename: saved.filename, size: saved.size, extracted, extract_error,
    });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/invoices --------------------------------------------
router.get('/projects/:id/invoices', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const filters = ['(i.project_id = $1 OR c.project_id = $1)'];
    const params = [projectId];
    if (req.query.status) { params.push(req.query.status); filters.push(`i.status = $${params.length}`); }
    if (req.query.contract_id === 'none') { filters.push('i.contract_id IS NULL'); }
    else if (req.query.contract_id) { params.push(Number(req.query.contract_id)); filters.push(`i.contract_id = $${params.length}`); }
    if (req.query.vendor) { params.push(`%${req.query.vendor}%`); filters.push(`i.vendor_name ILIKE $${params.length}`); }
    if (req.query.qb_code_id) { params.push(Number(req.query.qb_code_id)); filters.push(`i.qb_code_id = $${params.length}`); }
    if (req.query.invoice_type) { params.push(req.query.invoice_type); filters.push(`COALESCE(i.invoice_type,'fixed') = $${params.length}`); }
    const sortMap = { vendor: 'i.vendor_name ASC', amount: 'i.amount DESC', status: 'i.status ASC, i.created_at DESC' };
    const order = sortMap[req.query.sort] || 'i.invoice_date DESC NULLS LAST, i.created_at DESC';
    const result = await pool.query(
      `SELECT i.*, c.vendor_name AS contract_vendor, c.total_value AS contract_total,
              u_created.name AS created_by_name, u_approved.name AS approved_by_name,
              (SELECT COUNT(*) FROM invoice_contracts ic WHERE ic.invoice_id = i.id)::int AS alloc_count
       FROM invoices i
       LEFT JOIN contracts c ON c.id = i.contract_id
       LEFT JOIN users u_created ON u_created.id = i.created_by
       LEFT JOIN users u_approved ON u_approved.id = i.approved_by
       WHERE ${filters.join(' AND ')} ORDER BY ${order}`, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/invoices/export (CSV) --------------------------------
router.get('/projects/:id/invoices/export', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) return res.status(403).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT i.invoice_number, i.vendor_name, i.amount, i.invoice_date, i.status,
              i.description, i.created_at, i.approved_at, i.paid_date, i.rejection_note,
              c.vendor_name AS contract_vendor, c.reference_number AS contract_ref
       FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id
       WHERE (i.project_id = $1 OR c.project_id = $1)
       ORDER BY i.invoice_date DESC NULLS LAST`, [projectId]);
    const header = 'Invoice #,Vendor,Amount,Date,Status,Description,Contract Vendor,Contract Ref,Approved At,Paid Date,Rejection Note,Created At\n';
    const rows = result.rows.map(r =>
      [r.invoice_number, r.vendor_name, r.amount, r.invoice_date || '', r.status,
       `"${(r.description || '').replace(/"/g, '""')}"`, r.contract_vendor || '',
       r.contract_ref || '', r.approved_at || '', r.paid_date || '',
       `"${(r.rejection_note || '').replace(/"/g, '""')}"`, r.created_at].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="invoices-project-${projectId}.csv"`);
    res.send(header + rows);
  } catch (err) { next(err); }
});

// POST /api/invoices --------------------------------------------------------
// Supports single contract (contract_id) or multi-contract (contracts: [{contract_id, amount}]).
router.post('/invoices', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { contract_id, contracts: contractAllocs, project_id, invoice_number, vendor_name, amount,
            invoice_date, description, file_reference, qb_code_id, invoice_type: invoiceTypeRaw } = req.body || {};
    if (!invoice_number || amount == null) return res.status(400).json({ error: 'invoice_number and amount required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });
    const invoiceType = ['fixed', 'tm', 'expense'].includes(invoiceTypeRaw) ? invoiceTypeRaw : 'fixed';

    // Build allocation list: either from contracts array or single contract_id.
    let allocs = [];
    if (Array.isArray(contractAllocs) && contractAllocs.length > 0) {
      allocs = contractAllocs.map(a => ({ contract_id: Number(a.contract_id), amount: Number(a.amount) }));
      const allocSum = allocs.reduce((s, a) => s + a.amount, 0);
      if (Math.abs(allocSum - amt) > 0.01) {
        return res.status(400).json({ error: `Contract allocations ($${allocSum.toFixed(2)}) must sum to invoice amount ($${amt.toFixed(2)}).` });
      }
    } else if (contract_id) {
      allocs = [{ contract_id: Number(contract_id), amount: amt }];
    }

    let resolvedProjectId = project_id ? Number(project_id) : null;
    let resolvedVendor = vendor_name || '';
    // Primary contract_id stored on invoice = first allocation (for backward compat).
    const primaryContractId = allocs.length > 0 ? allocs[0].contract_id : null;

    const force = req.body?.force === true;

    // Validate each contract allocation.
    for (const alloc of allocs) {
      const c = await pool.query('SELECT project_id, vendor_name, total_value FROM contracts WHERE id = $1', [alloc.contract_id]);
      if (!c.rows[0]) return res.status(404).json({ error: `Contract ${alloc.contract_id} not found` });
      resolvedProjectId = resolvedProjectId || c.rows[0].project_id;
      if (!resolvedVendor) resolvedVendor = c.rows[0].vendor_name;

      // Hard duplicate: same vendor + invoice_number + contract, not rejected.
      if (invoice_number) {
        const hardDup = await pool.query(
          `SELECT id, invoice_number, amount, status, invoice_date FROM invoices
           WHERE LOWER(vendor_name) = LOWER($1) AND LOWER(invoice_number) = LOWER($2)
             AND contract_id = $3 AND status != 'rejected'`,
          [resolvedVendor, invoice_number, alloc.contract_id]);
        if (hardDup.rows.length > 0) {
          const d = hardDup.rows[0];
          return res.status(409).json({
            error: `Invoice #${invoice_number} from ${resolvedVendor} already exists for this contract (status: ${d.status}, amount: $${Number(d.amount).toFixed(2)}).`,
            hard_duplicate: true,
            existing_id: d.id,
          });
        }
      }

      // Overspend check per contract.
      const invoiced = await pool.query(
        `SELECT COALESCE(SUM(ic.amount),0)::numeric AS total
         FROM invoice_contracts ic JOIN invoices i ON i.id = ic.invoice_id
         WHERE ic.contract_id = $1 AND i.status NOT IN ('rejected')
         AND COALESCE(i.invoice_type,'fixed') = 'fixed'`, [alloc.contract_id]);
      // Also count legacy invoices that only use contract_id directly.
      const legacyInvoiced = await pool.query(
        `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM invoices
         WHERE contract_id = $1 AND status NOT IN ('rejected')
         AND COALESCE(invoice_type,'fixed') = 'fixed'
         AND id NOT IN (SELECT invoice_id FROM invoice_contracts)`, [alloc.contract_id]);
      if (invoiceType === 'fixed') {
        // Only fixed-scope invoices count against the contract's committed value.
        const totalInvoiced = Number(invoiced.rows[0].total) + Number(legacyInvoiced.rows[0].total);
        const remaining = Number(c.rows[0].total_value) - totalInvoiced;
        if (alloc.amount > remaining + 0.01) {
          return res.status(400).json({
            error: `Allocation of $${alloc.amount.toFixed(2)} to contract "${c.rows[0].vendor_name}" exceeds remaining balance ($${remaining.toFixed(2)}).`,
          });
        }
      }
    }

    if (!resolvedProjectId) return res.status(400).json({ error: 'contract_id or project_id required' });
    if (!(await projects.userCanAccess(req.session.userId, resolvedProjectId)))
      return res.status(403).json({ error: 'Forbidden' });

    // Soft duplicate: same vendor + contract + amount within 90 days, unless force=true.
    if (!force && allocs.length > 0) {
      const refDate = req.body?.invoice_date || null;
      const softDupRows = [];
      for (const alloc of allocs) {
        const sd = await pool.query(
          `SELECT id, invoice_number, amount, status, invoice_date FROM invoices
           WHERE LOWER(vendor_name) = LOWER($1)
             AND contract_id = $2
             AND amount = $3
             AND status != 'rejected'
             AND ABS(COALESCE(invoice_date, created_at::date) - COALESCE($4::date, CURRENT_DATE)) < 90`,
          [resolvedVendor, alloc.contract_id, amt, refDate]);
        softDupRows.push(...sd.rows);
      }
      if (softDupRows.length > 0) {
        return res.status(409).json({
          soft_duplicate: true,
          message: `Found ${softDupRows.length} existing invoice${softDupRows.length > 1 ? 's' : ''} from ${resolvedVendor} for the same amount ($${amt.toFixed(2)}) within 90 days. Possible duplicate.`,
          duplicates: softDupRows,
        });
      }
    }

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO invoices (contract_id, project_id, invoice_number, vendor_name, amount,
          invoice_date, description, file_reference, qb_code_id, invoice_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [primaryContractId, resolvedProjectId, invoice_number, resolvedVendor, amt,
       invoice_date || null, description || null, file_reference || null,
       qb_code_id || null, invoiceType, req.session.userId]);
    const invoiceId = result.rows[0].id;
    // Insert allocation rows.
    for (const alloc of allocs) {
      await client.query(
        'INSERT INTO invoice_contracts (invoice_id, contract_id, amount) VALUES ($1, $2, $3)',
        [invoiceId, alloc.contract_id, alloc.amount]);
    }
    const contractNames = allocs.map(a => `contract #${a.contract_id}: $${a.amount.toFixed(2)}`).join(', ');
    await logInvoice(client, invoiceId, 'created',
      `Created: ${invoice_number} for $${amt.toFixed(2)} from ${resolvedVendor}${allocs.length > 1 ? ` (split: ${contractNames})` : ''}`,
      req.session.userId);
    // Save confirmed fields as a future few-shot example for this vendor.
    if (file_reference && resolvedVendor) {
      await saveExtractionExample(client, resolvedVendor, {
        invoice_number, vendor_name: resolvedVendor,
        amount: amt, invoice_date: invoice_date || null,
        description: description || null,
      }, req.session.userId);
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// GET /api/invoices/:id -----------------------------------------------------
router.get('/invoices/:id', requireAuth, async (req, res, next) => {
  try {
    const inv = await getInvoiceWithProject(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    // Fetch multi-contract allocations.
    const allocs = await pool.query(
      `SELECT ic.contract_id, ic.amount, c.vendor_name
       FROM invoice_contracts ic JOIN contracts c ON c.id = ic.contract_id
       WHERE ic.invoice_id = $1 ORDER BY ic.id`, [inv.id]);
    res.json({ ...inv, contract_allocations: allocs.rows });
  } catch (err) { next(err); }
});

// GET /api/invoices/:id/history ---------------------------------------------
router.get('/invoices/:id/history', requireAuth, async (req, res, next) => {
  try {
    const inv = await getInvoiceWithProject(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT l.*, u.name AS changed_by_name FROM invoice_logs l
       JOIN users u ON u.id = l.changed_by
       WHERE l.invoice_id = $1 ORDER BY l.changed_at DESC`, [inv.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// PUT /api/invoices/:id -----------------------------------------------------
router.put('/invoices/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    // Warn but allow edits — users can revert status if needed.
    const { invoice_number, vendor_name, amount, invoice_date, description, status, file_reference } = req.body || {};
    const changes = [];
    if (invoice_number && invoice_number !== inv.invoice_number) changes.push(`number: ${inv.invoice_number} → ${invoice_number}`);
    if (amount != null && Number(amount) !== Number(inv.amount)) changes.push(`amount: $${Number(inv.amount).toFixed(2)} → $${Number(amount).toFixed(2)}`);
    if (status && status !== inv.status) changes.push(`status: ${inv.status} → ${status}`);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET
         invoice_number = COALESCE($2, invoice_number), vendor_name = COALESCE($3, vendor_name),
         amount = COALESCE($4, amount), invoice_date = COALESCE($5, invoice_date),
         description = COALESCE($6, description), status = COALESCE($7, status),
         file_reference = COALESCE($8, file_reference), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [invId, invoice_number ?? null, vendor_name ?? null, amount ?? null,
       invoice_date ?? null, description ?? null, status ?? null, file_reference ?? null]);
    if (changes.length > 0) {
      await logInvoice(client, invId, 'edited', changes.join('; '), req.session.userId);
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/pm-approve  (any role)
router.post('/invoices/:id/pm-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'pending') return res.status(400).json({ error: 'Invoice must be pending for PM approval' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'pm_approved', pm_approved_by = $2, pm_approved_at = NOW(),
         rejection_note = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [invId, req.session.userId]);
    await logInvoice(client, invId, 'pm_approved', `PM approved $${Number(inv.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/partner-approve  (partner or admin)
router.post('/invoices/:id/partner-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'partner')) return res.status(403).json({ error: 'Requires partner role or above' });
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'pm_approved') return res.status(400).json({ error: 'Invoice must be PM-approved first' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'partner_approved', partner_approved_by = $2, partner_approved_at = NOW(),
         updated_at = NOW() WHERE id = $1 RETURNING *`,
      [invId, req.session.userId]);
    await logInvoice(client, invId, 'partner_approved', `Partner approved $${Number(inv.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/approve  (admin/Seth only — final approval)
router.post('/invoices/:id/approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'admin')) return res.status(403).json({ error: 'Requires admin role' });
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'partner_approved') return res.status(400).json({ error: 'Invoice must be partner-approved first' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'approved', approved_by = $2, approved_at = NOW(),
         rejection_note = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [invId, req.session.userId]);
    await logInvoice(client, invId, 'approved', `Final approval $${Number(inv.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/reject — requires a note ---------------------------
router.post('/invoices/:id/reject', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const note = (req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'A rejection reason is required.' });
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'rejected', rejection_note = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`, [invId, note]);
    await logInvoice(client, invId, 'rejected', `Rejected: ${note}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/revert — revert approved/rejected/on_hold back to pending
router.post('/invoices/:id/revert', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status === 'pending')
      return res.status(400).json({ error: 'Invoice is already pending.' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'pending',
         pm_approved_by = NULL, pm_approved_at = NULL,
         partner_approved_by = NULL, partner_approved_at = NULL,
         approved_by = NULL, approved_at = NULL,
         rejection_note = NULL, paid_date = NULL, qb_reference_id = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`, [invId]);
    await logInvoice(client, invId, 'reverted', `Reverted from ${inv.status} to pending`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/hold — put invoice on hold -------------------------
router.post('/invoices/:id/hold', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const note = (req.body?.note || '').trim();
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (!['pending', 'approved'].includes(inv.status))
      return res.status(400).json({ error: `Cannot hold an invoice in status '${inv.status}'` });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'on_hold', rejection_note = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`, [invId, note || null]);
    await logInvoice(client, invId, 'on_hold', note ? `Put on hold: ${note}` : 'Put on hold', req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/bulk-approve -------------------------------------------
router.post('/invoices/bulk-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    await client.query('BEGIN');
    let approved = 0;
    for (const id of ids) {
      const inv = await getInvoiceWithProject(id);
      if (!inv || inv.status !== 'pending') continue;
      if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) continue;
      await client.query(
        `UPDATE invoices SET status = 'pm_approved', pm_approved_by = $2, pm_approved_at = NOW(),
           rejection_note = NULL, updated_at = NOW() WHERE id = $1`, [id, req.session.userId]);
      await logInvoice(client, id, 'pm_approved', `Bulk PM-approved $${Number(inv.amount).toFixed(2)}`, req.session.userId);
      approved++;
    }
    await client.query('COMMIT');
    res.json({ approved, total: ids.length });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/mark-pushed ----------------------------------------
router.post('/invoices/:id/mark-pushed', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'approved')
      return res.status(400).json({ error: 'Invoice must be approved before it can be pushed' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'pushed', qb_reference_id = COALESCE(qb_reference_id, 'DRY-' || id::text),
         updated_at = NOW() WHERE id = $1 RETURNING *`, [invId]);
    await logInvoice(client, invId, 'pushed', 'Marked as pushed to QB', req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/mark-paid ------------------------------------------
router.post('/invoices/:id/mark-paid', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (!['approved', 'pushed'].includes(inv.status))
      return res.status(400).json({ error: 'Invoice must be approved/pushed before it can be marked paid' });
    const paidDate = req.body?.paid_date || null;
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'paid', paid_date = COALESCE($2::date, CURRENT_DATE),
         updated_at = NOW() WHERE id = $1 RETURNING *`, [invId, paidDate]);
    await logInvoice(client, invId, 'paid', `Marked paid on ${result.rows[0].paid_date}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

module.exports = router;
