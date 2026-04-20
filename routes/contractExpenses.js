const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');

const router = express.Router();

const VALID_CATEGORIES = ['travel', 'tolls', 'food', 'hotel', 'copies', 'other'];

async function userCanAccessContract(userId, contractId) {
  const r = await pool.query('SELECT project_id FROM contracts WHERE id = $1', [contractId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, projectId: r.rows[0].project_id };
}

async function userCanAccessExpense(userId, expenseId) {
  const r = await pool.query(
    'SELECT e.id, e.contract_id, c.project_id FROM contract_expenses e JOIN contracts c ON c.id = e.contract_id WHERE e.id = $1',
    [expenseId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, row: r.rows[0] };
}

function logContract(client, contractId, action, detail, userId) {
  return client.query(
    'INSERT INTO contract_logs (contract_id, action, detail, changed_by) VALUES ($1,$2,$3,$4)',
    [contractId, action, detail, userId]);
}

// GET /api/contracts/:id/expenses
router.get('/contracts/:id/expenses', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT e.*, u.name AS created_by_name, q.code AS qb_code, q.name AS qb_name
       FROM contract_expenses e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN qb_codes q ON q.id = e.qb_code_id
       WHERE e.contract_id = $1 ORDER BY e.expense_date DESC NULLS LAST, e.created_at DESC`,
      [contractId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/contracts/:id/expenses
router.post('/contracts/:id/expenses', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { category, description, amount, expense_date, qb_code_id, file_reference, notes } = req.body || {};
    if (amount == null) return res.status(400).json({ error: 'amount required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return res.status(400).json({ error: 'invalid amount' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'other';
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO contract_expenses (contract_id, category, description, amount, expense_date, qb_code_id, file_reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [contractId, cat, description || null, amt,
       expense_date || null, qb_code_id || null, file_reference || null, notes || null, req.session.userId]);
    const desc = description ? `${description} (${cat})` : cat;
    await logContract(client, contractId, 'expense_added',
      `Expense added: ${desc} — $${amt.toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// PUT /api/expenses/:id
router.put('/expenses/:id', requireAuth, async (req, res, next) => {
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { category, description, amount, expense_date, qb_code_id, file_reference } = req.body || {};
    const cat = category ? (VALID_CATEGORIES.includes(category) ? category : 'other') : null;
    const result = await pool.query(
      `UPDATE contract_expenses SET
         category      = COALESCE($2, category),
         description   = COALESCE($3, description),
         amount        = COALESCE($4, amount),
         expense_date  = COALESCE($5, expense_date),
         qb_code_id    = COALESCE($6, qb_code_id),
         file_reference= COALESCE($7, file_reference)
       WHERE id = $1 RETURNING *`,
      [expenseId, cat, description ?? null, amount ?? null,
       expense_date ?? null, qb_code_id ?? null, file_reference ?? null]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/expenses/:id/approve
router.post('/expenses/:id/approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contract_expenses SET status = 'approved' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [expenseId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Expense is not pending' });
    const exp = result.rows[0];
    await logContract(client, exp.contract_id, 'expense_approved',
      `Expense approved: ${exp.description || exp.category} — $${Number(exp.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(exp);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/expenses/:id/reject
router.post('/expenses/:id/reject', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { rejection_note } = req.body;
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contract_expenses SET status = 'rejected', rejection_note = $2 WHERE id = $1 RETURNING *`,
      [expenseId, rejection_note || null]);
    const exp = result.rows[0];
    await logContract(client, exp.contract_id, 'expense_rejected',
      `Expense rejected: ${exp.description || exp.category}${rejection_note ? ' — ' + rejection_note : ''}`, req.session.userId);
    await client.query('COMMIT');
    res.json(exp);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// DELETE /api/expenses/:id (pending only)
router.delete('/expenses/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const exp = await client.query('SELECT * FROM contract_expenses WHERE id = $1', [expenseId]);
    const result = await client.query(
      `DELETE FROM contract_expenses WHERE id = $1 AND status = 'pending' RETURNING id`, [expenseId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Can only delete pending expenses' });
    if (exp.rows[0]) {
      await logContract(client, exp.rows[0].contract_id, 'expense_deleted',
        `Expense deleted: ${exp.rows[0].description || exp.rows[0].category} — $${Number(exp.rows[0].amount).toFixed(2)}`, req.session.userId);
    }
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

module.exports = router;
