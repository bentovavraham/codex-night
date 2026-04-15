const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');

const router = express.Router();

const APPROX = 0.01; // Allow 1-cent rounding tolerance when validating allocations.

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
    const result = await pool.query(
      `SELECT c.*,
              (SELECT COALESCE(SUM(amount),0) FROM invoices
                 WHERE contract_id = c.id AND status IN ('approved','pushed','paid')) AS invoiced_amount
       FROM contracts c
       WHERE c.project_id = $1
       ORDER BY c.contract_date DESC NULLS LAST, c.created_at DESC`,
      [projectId]
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
      vendor_name, description, total_value, contract_date,
      reference_number, status, file_reference, lines,
    } = req.body || {};
    if (!vendor_name || total_value == null) {
      return res.status(400).json({ error: 'vendor_name and total_value required' });
    }
    const total = Number(total_value);
    if (!Number.isFinite(total) || total < 0) {
      return res.status(400).json({ error: 'total_value must be >= 0' });
    }
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
         (project_id, vendor_name, description, total_value, contract_date,
          reference_number, status, file_reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'draft'),$8,$9)
       RETURNING *`,
      [projectId, vendor_name, description || null, total,
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

// Update contract (NOT the lines — those are separate).
router.put('/contracts/:id', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const {
      vendor_name, description, total_value, contract_date,
      reference_number, status, file_reference,
    } = req.body || {};
    const result = await pool.query(
      `UPDATE contracts SET
         vendor_name      = COALESCE($2, vendor_name),
         description      = COALESCE($3, description),
         total_value      = COALESCE($4, total_value),
         contract_date    = COALESCE($5, contract_date),
         reference_number = COALESCE($6, reference_number),
         status           = COALESCE($7, status),
         file_reference   = COALESCE($8, file_reference),
         updated_at       = NOW()
       WHERE id = $1 RETURNING *`,
      [contractId, vendor_name ?? null, description ?? null, total_value ?? null,
       contract_date ?? null, reference_number ?? null, status ?? null, file_reference ?? null]
    );
    res.json(result.rows[0]);
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
