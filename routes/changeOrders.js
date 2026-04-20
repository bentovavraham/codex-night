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

async function userCanAccessCO(userId, coId) {
  const r = await pool.query(
    'SELECT co.id, co.contract_id, c.project_id FROM change_orders co JOIN contracts c ON c.id = co.contract_id WHERE co.id = $1',
    [coId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, row: r.rows[0] };
}

function logCO(client, coId, action, detail, userId) {
  return client.query(
    'INSERT INTO change_order_logs (change_order_id, action, detail, changed_by) VALUES ($1,$2,$3,$4)',
    [coId, action, detail, userId]);
}

// GET /api/contracts/:id/change-orders
router.get('/contracts/:id/change-orders', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT co.*, u.name AS created_by_name, ua.name AS approved_by_name
       FROM change_orders co
       LEFT JOIN users u ON u.id = co.created_by
       LEFT JOIN users ua ON ua.id = co.approved_by
       WHERE co.contract_id = $1 ORDER BY co.created_at ASC`, [contractId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/contracts/:id/change-orders
router.post('/contracts/:id/change-orders', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { co_number, description, amount, file_reference } = req.body || {};
    if (!description || amount == null) return res.status(400).json({ error: 'description and amount required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return res.status(400).json({ error: 'invalid amount' });
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO change_orders (contract_id, co_number, description, amount, file_reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [contractId, co_number || null, description, amt, file_reference || null, req.session.userId]);
    await logCO(client, result.rows[0].id, 'created',
      `Created CO${co_number ? ' ' + co_number : ''}: ${description} for $${amt.toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// PUT /api/change-orders/:id
router.put('/change-orders/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { co_number, description, amount, file_reference } = req.body || {};
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE change_orders SET
         co_number = COALESCE($2, co_number),
         description = COALESCE($3, description),
         amount = COALESCE($4, amount),
         file_reference = COALESCE($5, file_reference),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [coId, co_number ?? null, description ?? null, amount ?? null, file_reference ?? null]);
    await logCO(client, coId, 'edited', 'Updated change order', req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/change-orders/:id/approve
router.post('/change-orders/:id/approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE change_orders SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`, [coId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Change order is not pending' });
    await logCO(client, coId, 'approved', `Approved $${Number(result.rows[0].amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/change-orders/:id/reject
router.post('/change-orders/:id/reject', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const coId = Number(req.params.id);
    const note = (req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Rejection reason required' });
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE change_orders SET status = 'rejected', rejection_note = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`, [coId, note]);
    await logCO(client, coId, 'rejected', `Rejected: ${note}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// DELETE /api/change-orders/:id  (only if pending)
router.delete('/change-orders/:id', requireAuth, async (req, res, next) => {
  try {
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `DELETE FROM change_orders WHERE id = $1 AND status = 'pending' RETURNING id`, [coId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Can only delete pending change orders' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
