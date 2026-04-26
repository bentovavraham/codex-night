const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const TEMPLATE = require('../db/budget-template');

const router = express.Router();

// GET /api/phases/:phaseId/budget
router.get('/phases/:phaseId/budget', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;

    const phaseCheck = await pool.query('SELECT id FROM phases WHERE id = $1', [phaseId]);
    if (!phaseCheck.rows.length) return res.status(404).json({ error: 'Phase not found' });

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
        pbl.sort_order,

        -- Committed: sum of active contract values against this budget line
        COALESCE((
          SELECT SUM(c.total_value)
          FROM contracts c
          WHERE c.phase_budget_line_id = pbl.id
            AND c.status NOT IN ('voided','draft')
        ), 0) AS committed,

        -- Change order count
        COALESCE((
          SELECT COUNT(co.id)
          FROM change_orders co
          JOIN contracts c ON c.id = co.contract_id
          WHERE c.phase_budget_line_id = pbl.id
            AND co.status = 'approved'
        ), 0) AS co_count,

        -- Change order total value
        COALESCE((
          SELECT SUM(co.amount)
          FROM change_orders co
          JOIN contracts c ON c.id = co.contract_id
          WHERE c.phase_budget_line_id = pbl.id
            AND co.status = 'approved'
        ), 0) AS co_value,

        -- T&M invoice charges
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          JOIN contracts c ON c.id = inv.contract_id
          WHERE c.phase_budget_line_id = pbl.id
            AND inv.invoice_type = 'tm'
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS tm_charges,

        -- Expense invoice charges
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          JOIN contracts c ON c.id = inv.contract_id
          WHERE c.phase_budget_line_id = pbl.id
            AND inv.invoice_type = 'expense'
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS expense_charges,

        -- Fixed invoice charges
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          JOIN contracts c ON c.id = inv.contract_id
          WHERE c.phase_budget_line_id = pbl.id
            AND inv.invoice_type = 'fixed'
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS fixed_charges,

        -- Billed to date (all non-voided invoice types)
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          JOIN contracts c ON c.id = inv.contract_id
          WHERE c.phase_budget_line_id = pbl.id
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS billed,

        -- Paid to date
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          JOIN contracts c ON c.id = inv.contract_id
          WHERE c.phase_budget_line_id = pbl.id
            AND inv.status = 'paid'
        ), 0) AS paid,

        -- QB codes used (rolled up from invoice_qb_lines, distinct account numbers)
        COALESCE((
          SELECT string_agg(DISTINCT qa.account_number, ', ' ORDER BY qa.account_number)
          FROM invoice_qb_lines iql
          JOIN invoices inv ON inv.id = iql.invoice_id
          JOIN contracts c  ON c.id  = inv.contract_id
          JOIN qb_accounts qa ON qa.id = iql.qb_account_id
          WHERE c.phase_budget_line_id = pbl.id
        ), '') AS qb_codes_used

      FROM phase_budget_lines pbl
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
    `, [phaseId]);

    const rows = result.rows.map(r => {
      const budgeted          = parseFloat(r.budgeted_amount)   || 0;
      const committed         = parseFloat(r.committed)         || 0;
      const co_value          = parseFloat(r.co_value)          || 0;
      const co_count          = parseInt(r.co_count)            || 0;
      const total_commitment  = committed + co_value;
      const fixed_charges     = parseFloat(r.fixed_charges)     || 0;
      const tm_charges        = parseFloat(r.tm_charges)        || 0;
      const expense_charges   = parseFloat(r.expense_charges)   || 0;
      const billed            = parseFloat(r.billed)            || 0;
      const paid              = parseFloat(r.paid)              || 0;
      const amount_due        = billed - paid;
      const remaining_budget  = budgeted - billed;
      const remaining_commit  = budgeted - total_commitment;
      const pct_billed        = budgeted > 0 ? billed / budgeted : null;

      return {
        ...r,
        budgeted_amount: budgeted,
        committed,
        co_count,
        co_value,
        total_commitment,
        fixed_charges,
        tm_charges,
        expense_charges,
        billed,
        paid,
        amount_due,
        remaining_budget,
        remaining_commit,
        pct_billed,
      };
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
    const { task_name, discipline, section = 'professional_fees', sub_group, budgeted_amount = 0, consultant, notes } = req.body;

    const sortResult = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort
       FROM phase_budget_lines WHERE phase_id = $1 AND section = $2`,
      [phaseId, section]
    );

    const result = await pool.query(
      `INSERT INTO phase_budget_lines
         (phase_id, task_name, discipline, section, sub_group, budgeted_amount, consultant, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [phaseId, task_name, discipline, section, sub_group || null, budgeted_amount, consultant, notes, sortResult.rows[0].next_sort]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/budget-lines/:lineId
router.patch('/budget-lines/:lineId', requireAuth, async (req, res, next) => {
  try {
    const { lineId } = req.params;
    const allowed = ['task_name','discipline','section','sub_group','calculation_method','budgeted_amount','consultant','notes','sort_order'];
    const updates = []; const values = []; let i = 1;
    for (const f of allowed) {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${i++}`); values.push(req.body[f]); }
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
       FROM qb_accounts WHERE is_leaf = true ORDER BY sort_order`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/invoice-qb-lines/:invoiceId
router.get('/invoice-qb-lines/:invoiceId', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT iql.*, qa.account_number, qa.full_name, qa.short_name
       FROM invoice_qb_lines iql
       JOIN qb_accounts qa ON qa.id = iql.qb_account_id
       WHERE iql.invoice_id = $1
       ORDER BY iql.id`,
      [req.params.invoiceId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// PUT /api/invoice-qb-lines/:invoiceId — replace all QB lines for an invoice
router.put('/invoice-qb-lines/:invoiceId', requireAuth, async (req, res, next) => {
  try {
    const { invoiceId } = req.params;
    const { lines } = req.body; // [{ qb_account_id, amount, notes }]
    if (!Array.isArray(lines)) return res.status(400).json({ error: 'lines must be an array' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM invoice_qb_lines WHERE invoice_id = $1', [invoiceId]);
      for (const l of lines) {
        await client.query(
          `INSERT INTO invoice_qb_lines (invoice_id, qb_account_id, amount, notes)
           VALUES ($1, $2, $3, $4)`,
          [invoiceId, l.qb_account_id, l.amount, l.notes || null]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
