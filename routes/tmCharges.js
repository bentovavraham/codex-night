const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');

const router = express.Router();

async function userCanAccessContract(userId, contractId) {
  const r = await pool.query('SELECT project_id FROM contracts WHERE id = $1', [contractId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, projectId: r.rows[0].project_id };
}

async function userCanAccessTM(userId, tmId) {
  const r = await pool.query(
    'SELECT t.id, t.contract_id, c.project_id FROM tm_charges t JOIN contracts c ON c.id = t.contract_id WHERE t.id = $1',
    [tmId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, row: r.rows[0] };
}

// GET /api/contracts/:id/tm-charges
router.get('/contracts/:id/tm-charges', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT t.*, u.name AS created_by_name, q.code AS qb_code, q.name AS qb_name
       FROM tm_charges t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN qb_codes q ON q.id = t.qb_code_id
       WHERE t.contract_id = $1 ORDER BY t.charge_date DESC NULLS LAST, t.created_at DESC`,
      [contractId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/contracts/:id/tm-charges
router.post('/contracts/:id/tm-charges', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { description, hours, rate, amount, charge_date, qb_code_id, file_reference, notes } = req.body || {};
    if (!description || amount == null) return res.status(400).json({ error: 'description and amount required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return res.status(400).json({ error: 'invalid amount' });
    const result = await pool.query(
      `INSERT INTO tm_charges (contract_id, description, hours, rate, amount, charge_date, qb_code_id, file_reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [contractId, description, hours ?? null, rate ?? null, amt,
       charge_date || null, qb_code_id || null, file_reference || null, notes || null, req.session.userId]);
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/tm-charges/:id
router.put('/tm-charges/:id', requireAuth, async (req, res, next) => {
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { description, hours, rate, amount, charge_date, qb_code_id, file_reference } = req.body || {};
    const result = await pool.query(
      `UPDATE tm_charges SET
         description   = COALESCE($2, description),
         hours         = COALESCE($3, hours),
         rate          = COALESCE($4, rate),
         amount        = COALESCE($5, amount),
         charge_date   = COALESCE($6, charge_date),
         qb_code_id    = COALESCE($7, qb_code_id),
         file_reference= COALESCE($8, file_reference)
       WHERE id = $1 RETURNING *`,
      [tmId, description ?? null, hours ?? null, rate ?? null, amount ?? null,
       charge_date ?? null, qb_code_id ?? null, file_reference ?? null]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/tm-charges/:id/approve
router.post('/tm-charges/:id/approve', requireAuth, async (req, res, next) => {
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `UPDATE tm_charges SET status = 'approved' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [tmId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'T&M charge is not pending' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/tm-charges/:id/reject
router.post('/tm-charges/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { rejection_note } = req.body;
    const result = await pool.query(
      `UPDATE tm_charges SET status = 'rejected', rejection_note = $2 WHERE id = $1 RETURNING *`,
      [tmId, rejection_note || null]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/tm-charges/:id (pending only)
router.delete('/tm-charges/:id', requireAuth, async (req, res, next) => {
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `DELETE FROM tm_charges WHERE id = $1 AND status = 'pending' RETURNING id`, [tmId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Can only delete pending T&M charges' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
