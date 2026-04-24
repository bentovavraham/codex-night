const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const TEMPLATE = require('../db/budget-template');

const router = express.Router();

const SECTION_ORDER = ['professional_fees', 'application_fees', 'construction'];

// GET /api/phases/:phaseId/budget
router.get('/phases/:phaseId/budget', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;

    const phaseResult = await pool.query('SELECT project_id FROM phases WHERE id = $1', [phaseId]);
    if (!phaseResult.rows.length) return res.status(404).json({ error: 'Phase not found' });
    const projectId = phaseResult.rows[0].project_id;

    const result = await pool.query(`
      SELECT
        pbl.id,
        pbl.phase_id,
        pbl.task_name,
        pbl.discipline,
        pbl.section,
        pbl.sub_group,
        pbl.calculation_method,
        pbl.calc_hint,
        pbl.budgeted_amount,
        pbl.consultant,
        pbl.notes,
        pbl.qb_account_id,
        pbl.sort_order,
        qa.account_number  AS qb_account_number,
        qa.short_name      AS qb_account_short_name,
        -- Committed: sum of active contract values
        COALESCE((
          SELECT SUM(c.total_value)
          FROM contracts c
          WHERE c.project_id = $2
            AND c.phase_id = $1::integer
            AND (c.qb_account_id = pbl.qb_account_id OR pbl.qb_account_id IS NULL AND c.id IS NULL)
            AND c.status NOT IN ('voided','draft')
        ), 0) AS committed,
        -- CO total
        COALESCE((
          SELECT SUM(co.amount)
          FROM change_orders co
          JOIN contracts c ON c.id = co.contract_id
          WHERE c.project_id = $2
            AND c.phase_id = $1::integer
            AND c.qb_account_id = pbl.qb_account_id
            AND co.status = 'approved'
        ), 0) AS co_total,
        -- Billed to date
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          JOIN contracts c ON c.id = inv.contract_id
          WHERE c.project_id = $2
            AND c.phase_id = $1::integer
            AND c.qb_account_id = pbl.qb_account_id
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS invoiced,
        -- Paid to date
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          JOIN contracts c ON c.id = inv.contract_id
          WHERE c.project_id = $2
            AND c.phase_id = $1::integer
            AND c.qb_account_id = pbl.qb_account_id
            AND inv.status = 'paid'
        ), 0) AS paid
      FROM phase_budget_lines pbl
      LEFT JOIN qb_accounts qa ON qa.id = pbl.qb_account_id
      WHERE pbl.phase_id = $1
      ORDER BY
        CASE pbl.section
          WHEN 'professional_fees' THEN 1
          WHEN 'application_fees'  THEN 2
          WHEN 'construction'      THEN 3
          ELSE 4
        END,
        pbl.sort_order,
        pbl.id
    `, [phaseId, projectId]);

    const rows = result.rows.map(r => {
      const budgeted   = parseFloat(r.budgeted_amount) || 0;
      const committed  = parseFloat(r.committed) || 0;
      const co_total   = parseFloat(r.co_total) || 0;
      const amount_due = committed + co_total;
      const invoiced   = parseFloat(r.invoiced) || 0;
      const paid       = parseFloat(r.paid) || 0;
      const remaining  = budgeted - invoiced;
      const pct_used   = budgeted > 0 ? invoiced / budgeted : null;
      return { ...r, budgeted_amount: budgeted, committed, co_total, amount_due, invoiced, paid, remaining, pct_used };
    });

    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/phases/:phaseId/budget/init — seed from template
router.post('/phases/:phaseId/budget/init', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;

    const existing = await pool.query(
      'SELECT COUNT(*) AS cnt FROM phase_budget_lines WHERE phase_id = $1',
      [phaseId]
    );
    if (parseInt(existing.rows[0].cnt) > 0) {
      return res.status(409).json({ error: 'Budget already initialized' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < TEMPLATE.length; i++) {
        const t = TEMPLATE[i];
        await client.query(
          `INSERT INTO phase_budget_lines
             (phase_id, task_name, discipline, section, sub_group, budgeted_amount, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [phaseId, t.task_name, t.discipline, t.section, t.sub_group || null, t.default_amount || 0, i + 1]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, count: TEMPLATE.length });
  } catch (err) { next(err); }
});

// POST /api/phases/:phaseId/budget — add a custom line
router.post('/phases/:phaseId/budget', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const { task_name, discipline, section = 'professional_fees', calc_hint, budgeted_amount = 0, consultant, notes, qb_account_id } = req.body;

    const sortResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort
       FROM phase_budget_lines WHERE phase_id = $1 AND section = $2`,
      [phaseId, section]
    );
    const sort_order = sortResult.rows[0].next_sort;

    const result = await pool.query(
      `INSERT INTO phase_budget_lines
         (phase_id, task_name, discipline, section, calc_hint, budgeted_amount, consultant, notes, qb_account_id, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [phaseId, task_name, discipline, section, calc_hint, budgeted_amount, consultant, notes, qb_account_id || null, sort_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/budget-lines/:lineId
router.patch('/budget-lines/:lineId', requireAuth, async (req, res, next) => {
  try {
    const { lineId } = req.params;
    const allowed = ['task_name','discipline','section','calculation_method','calc_hint','budgeted_amount','consultant','notes','qb_account_id','sort_order'];
    const updates = [];
    const values = [];
    let i = 1;
    for (const f of allowed) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(req.body[f] === '' && f === 'qb_account_id' ? null : req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(lineId);
    const result = await pool.query(
      `UPDATE phase_budget_lines SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Line not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/budget-lines/:lineId
router.delete('/budget-lines/:lineId', requireAuth, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM phase_budget_lines WHERE id = $1', [req.params.lineId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/qb-accounts
router.get('/qb-accounts', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, account_number, full_name, short_name, parent_id, category, sort_order, is_leaf
       FROM qb_accounts
       WHERE is_leaf = true
       ORDER BY sort_order`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
