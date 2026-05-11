const express = require('express');
const pool = require('../db/pool');
const { requireAuth, hasMinRole } = require('../middleware/auth');
const projects = require('./projects');
const { syncChangeOrderFA } = require('../lib/financials');

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
// Accepts an optional line_items array — each line item has its own GL code
// and optional task assignment (Option C). When present, the CO's total amount
// can be derived from the lines (sum of budgeted_amount). Default status is
// 'active' since approval flow is deferred.
router.post('/contracts/:id/change-orders', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const {
      co_number, description, amount, file_reference, qb_code_id,
      line_items, status,
    } = req.body || {};
    const lines = Array.isArray(line_items) ? line_items : [];
    // Total amount: prefer explicit amount; otherwise sum line items
    let amt = amount != null ? Number(amount) : null;
    if (amt == null && lines.length > 0) {
      amt = lines.reduce((s, l) => s + (Number(l.budgeted_amount) || 0), 0);
    }
    if (!description || !Number.isFinite(amt)) {
      return res.status(400).json({ error: 'description and amount (or line_items) required' });
    }
    const qbId = qb_code_id ? Number(qb_code_id) : null;
    const coStatus = status || 'active';
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO change_orders
         (contract_id, co_number, description, amount, file_reference, created_by, qb_code_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [contractId, co_number || null, description, amt, file_reference || null,
       req.session.userId, qbId, coStatus]);
    const co = result.rows[0];
    // Insert line items if provided
    if (lines.length > 0) {
      for (let i = 0; i < lines.length; i++) {
        const li = lines[i];
        const liAmt = Number(li.budgeted_amount) || 0;
        if (liAmt === 0 && !li.description) continue;
        const liType = ['fixed','tm','expense'].includes(li.billing_type) ? li.billing_type : 'fixed';
        await client.query(
          `INSERT INTO change_order_line_items
             (change_order_id, billing_type, description, budgeted_amount,
              qb_account_id, phase_budget_line_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [co.id, liType, li.description || null, liAmt,
           li.qb_account_id != null ? Number(li.qb_account_id) : null,
           li.phase_budget_line_id != null ? Number(li.phase_budget_line_id) : null,
           i]);
      }
    }
    await syncChangeOrderFA(client, co.id, req.session.userId);
    await logCO(client, co.id, 'created',
      `Created CO${co_number ? ' ' + co_number : ''}: ${description} for $${amt.toFixed(2)} (${lines.length} line items)`,
      req.session.userId);
    await client.query('COMMIT');
    res.status(201).json(co);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// GET /api/change-orders/:id — single change order with line items
router.get('/change-orders/:id', requireAuth, async (req, res, next) => {
  try {
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const co = (await pool.query(
      `SELECT co.*, c.vendor_name AS contract_vendor_name, c.reference_number AS contract_ref
         FROM change_orders co
         JOIN contracts c ON c.id = co.contract_id
        WHERE co.id = $1`, [coId])).rows[0];
    if (!co) return res.status(404).json({ error: 'Not found' });
    const lines = (await pool.query(
      `SELECT col.*, qa.account_number AS qb_account_number, qa.full_name AS qb_account_name,
              pbl.task_name
         FROM change_order_line_items col
         LEFT JOIN qb_accounts qa  ON qa.id  = col.qb_account_id
         LEFT JOIN phase_budget_lines pbl ON pbl.id = col.phase_budget_line_id
        WHERE col.change_order_id = $1
        ORDER BY col.sort_order, col.id`, [coId])).rows;
    res.json({ ...co, line_items: lines });
  } catch (err) { next(err); }
});

// PUT /api/change-orders/:id
// Accepts an optional line_items array. If provided, REPLACES all existing
// line items (matching the invoices update strategy). Total amount is derived
// from the line sum unless explicitly provided.
router.put('/change-orders/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const {
      co_number, description, amount, file_reference, qb_code_id,
      line_items, status,
    } = req.body || {};
    const lines = Array.isArray(line_items) ? line_items : null;
    let amt = amount != null ? Number(amount) : null;
    if (amt == null && lines && lines.length > 0) {
      amt = lines.reduce((s, l) => s + (Number(l.budgeted_amount) || 0), 0);
    }
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE change_orders SET
         co_number = COALESCE($2, co_number),
         description = COALESCE($3, description),
         amount = COALESCE($4, amount),
         file_reference = COALESCE($5, file_reference),
         qb_code_id = CASE WHEN $6::integer IS NOT NULL THEN $6::integer ELSE qb_code_id END,
         status = COALESCE($7, status),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [coId, co_number ?? null, description ?? null, amt ?? null,
       file_reference ?? null, qb_code_id ?? null, status ?? null]);
    if (lines) {
      // CRITICAL: include qb_account_id + phase_budget_line_id (same lesson as invoices.js)
      await client.query('DELETE FROM change_order_line_items WHERE change_order_id = $1', [coId]);
      for (let i = 0; i < lines.length; i++) {
        const li = lines[i];
        const liAmt = Number(li.budgeted_amount) || 0;
        if (liAmt === 0 && !li.description) continue;
        const liType = ['fixed','tm','expense'].includes(li.billing_type) ? li.billing_type : 'fixed';
        await client.query(
          `INSERT INTO change_order_line_items
             (change_order_id, billing_type, description, budgeted_amount,
              qb_account_id, phase_budget_line_id, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [coId, liType, li.description || null, liAmt,
           li.qb_account_id != null ? Number(li.qb_account_id) : null,
           li.phase_budget_line_id != null ? Number(li.phase_budget_line_id) : null,
           i]);
      }
    }
    await syncChangeOrderFA(client, coId, req.session.userId);
    await logCO(client, coId, 'edited',
      lines ? `Updated CO + ${lines.length} line items` : 'Updated change order',
      req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/change-orders/:id/pm-approve  (any role)
router.post('/change-orders/:id/pm-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE change_orders SET status = 'pm_approved', pm_approved_by = $2, pm_approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`, [coId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Change order must be pending for PM approval' });
    await logCO(client, coId, 'pm_approved', `PM approved $${Number(result.rows[0].amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/change-orders/:id/partner-approve  (partner or admin)
router.post('/change-orders/:id/partner-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'partner')) return res.status(403).json({ error: 'Requires partner role or above' });
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE change_orders SET status = 'partner_approved', partner_approved_by = $2, partner_approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pm_approved' RETURNING *`, [coId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Change order must be PM-approved first' });
    await logCO(client, coId, 'partner_approved', `Partner approved $${Number(result.rows[0].amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/change-orders/:id/approve  (admin/Seth only — final approval)
router.post('/change-orders/:id/approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'admin')) return res.status(403).json({ error: 'Requires admin role' });
    const coId = Number(req.params.id);
    const access = await userCanAccessCO(req.session.userId, coId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE change_orders SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'partner_approved' RETURNING *`, [coId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Change order must be partner-approved first' });
    await logCO(client, coId, 'approved', `Final approval $${Number(result.rows[0].amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/change-orders/:id/reject  (any role, any approvable stage)
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
       WHERE id = $1 AND status NOT IN ('approved','rejected') RETURNING *`, [coId, note]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Change order cannot be rejected in its current state' });
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
