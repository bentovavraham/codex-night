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
        pbl.source,
        pbl.amount_modified,
        pbl.qb_account_id,

        -- QB account hierarchy fields
        qa.account_number                       AS qb_account_number,
        qa.short_name                           AS qb_short_name,
        qa.sort_order                           AS qb_sort_order,
        qp.id                                   AS qb_parent_id,
        qp.account_number                       AS qb_parent_number,
        qp.short_name                           AS qb_parent_name,
        qp.sort_order                           AS qb_parent_sort,
        COALESCE(qa.category, qp.category)      AS qb_category,

        -- Committed: sum contributions to this budget line from active contracts.
        -- Line items with their own phase_budget_line_id override the contract-level line.
        -- Contracts with no line items contribute total_value at the contract level.
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT cli.budgeted_amount AS contribution
            FROM contracts c
            JOIN contract_line_items cli ON cli.contract_id = c.id
            WHERE COALESCE(cli.phase_budget_line_id, c.phase_budget_line_id) = pbl.id
              AND c.status NOT IN ('voided','draft')

            UNION ALL

            SELECT c.total_value AS contribution
            FROM contracts c
            WHERE c.phase_budget_line_id = pbl.id
              AND c.status NOT IN ('voided','draft')
              AND NOT EXISTS (SELECT 1 FROM contract_line_items x WHERE x.contract_id = c.id)
          ) sub
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
        -- For invoices with per-line budget assignments (import tab), sum matching line items.
        -- For simple invoices without per-line assignments, use the invoice-level amount.
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id = pbl.id
              AND ili.billing_type = 'tm'
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'tm'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
              AND (
                inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided')))
              )
          ) sub
        ), 0) AS tm_charges,

        -- Expense invoice charges
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id = pbl.id
              AND ili.billing_type = 'expense'
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'expense'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
              AND (
                inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided')))
              )
          ) sub
        ), 0) AS expense_charges,

        -- Fixed invoice charges
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id = pbl.id
              AND ili.billing_type = 'fixed'
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'fixed'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
              AND (
                inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided')))
              )
          ) sub
        ), 0) AS fixed_charges,

        -- Billed to date (all types)
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
              AND (
                inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided')))
              )
          ) sub
        ), 0) AS billed,

        -- Paid to date
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status = 'paid'
              AND ili.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.status = 'paid'
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
              AND (
                inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided')))
              )
          ) sub
        ), 0) AS paid,

        -- QB codes used (per line item when available, else invoice-level)
        COALESCE((
          SELECT string_agg(DISTINCT qa.account_number, ', ' ORDER BY qa.account_number)
          FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN qb_accounts qa ON qa.id = ili.qb_account_id
          WHERE inv.status NOT IN ('voided','draft','rejected')
            AND qa.account_number IS NOT NULL
            AND (
              ili.phase_budget_line_id = pbl.id
              OR (
                ili.phase_budget_line_id IS NULL
                AND (
                  inv.phase_budget_line_id = pbl.id
                  OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided')))
                )
              )
            )
        ), '') AS qb_codes_used,

        -- Flag: any direct invoices against this line
        EXISTS (
          SELECT 1 FROM invoices inv
          WHERE inv.phase_budget_line_id = pbl.id
            AND inv.status NOT IN ('voided','draft','rejected')
        ) AS has_direct_invoices

      FROM phase_budget_lines pbl
      LEFT JOIN qb_accounts qa ON qa.id = pbl.qb_account_id
      LEFT JOIN qb_accounts qp ON qp.id = qa.parent_id
      WHERE pbl.phase_id = $1
      ORDER BY
        COALESCE(qp.sort_order, qa.sort_order, 9999),
        COALESCE(qa.sort_order, 9999),
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
        has_direct_invoices: r.has_direct_invoices === true || r.has_direct_invoices === 't',
        qb_account_id:      r.qb_account_id ?? null,
        qb_account_number:  r.qb_account_number ?? null,
        qb_short_name:      r.qb_short_name ?? null,
        qb_sort_order:      r.qb_sort_order != null ? Number(r.qb_sort_order) : 9999,
        qb_parent_id:       r.qb_parent_id ?? null,
        qb_parent_number:   r.qb_parent_number ?? null,
        qb_parent_name:     r.qb_parent_name ?? null,
        qb_parent_sort:     r.qb_parent_sort != null ? Number(r.qb_parent_sort) : 9999,
        qb_category:        r.qb_category ?? null,
      };
    });

    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId/budget-lines/:lineId/drill — cell drill-down
router.get('/phases/:phaseId/budget-lines/:lineId/drill', requireAuth, async (req, res, next) => {
  try {
    const phaseId = Number(req.params.phaseId);
    const lineId  = Number(req.params.lineId);
    // Contracts: primary (phase_budget_line_id = lineId) or partial (cli line items)
    const contractsQ = await pool.query(`
      SELECT
        c.id, c.vendor_name, c.reference_number, c.status,
        c.total_value, c.contract_date,
        -- amount attributed to this budget line
        COALESCE(
          (SELECT SUM(cli.budgeted_amount) FROM contract_line_items cli
           WHERE cli.contract_id = c.id AND COALESCE(cli.phase_budget_line_id, c.phase_budget_line_id) = $1),
          CASE WHEN c.phase_budget_line_id = $1 AND NOT EXISTS (SELECT 1 FROM contract_line_items x WHERE x.contract_id = c.id)
               THEN c.total_value ELSE 0 END
        ) AS allocated_amount,
        c.phase_budget_line_id = $1 AS is_primary
      FROM contracts c
      WHERE c.status NOT IN ('voided','draft')
        AND (
          c.phase_budget_line_id = $1
          OR EXISTS (
            SELECT 1 FROM contract_line_items cli
            WHERE cli.contract_id = c.id AND cli.phase_budget_line_id = $1
          )
        )
      ORDER BY c.contract_date DESC NULLS LAST, c.id
    `, [lineId]);

    // Invoices against this budget line.
    // For invoices with per-line-item budget assignments (import tab), return the
    // apportioned amount (sum of matching line items). For simple invoices, return
    // the full invoice amount as before.
    const invoicesQ = await pool.query(`
      SELECT
        i.id, i.vendor_name, i.invoice_number, i.invoice_date,
        i.status, i.invoice_type, i.contract_id, i.file_reference,
        i.amount AS total_amount,
        c.reference_number AS contract_ref,
        c.vendor_name AS contract_vendor,
        CASE
          WHEN EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = i.id AND x.phase_budget_line_id IS NOT NULL)
          THEN COALESCE((SELECT SUM(ili.amount) FROM invoice_line_items ili WHERE ili.invoice_id = i.id AND ili.phase_budget_line_id = $1), 0)
          ELSE i.amount
        END AS amount
      FROM invoices i
      LEFT JOIN contracts c ON c.id = i.contract_id
      WHERE i.status NOT IN ('voided','draft','rejected')
        AND (
          -- Path 1: invoice has per-line-item budget assignments pointing here
          EXISTS (
            SELECT 1 FROM invoice_line_items ili
            WHERE ili.invoice_id = i.id AND ili.phase_budget_line_id = $1
          )
          OR (
            -- Path 2: invoice has no per-line-item assignments — use invoice-level
            NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = i.id AND x.phase_budget_line_id IS NOT NULL)
            AND (
              i.phase_budget_line_id = $1
              OR (
                i.phase_budget_line_id IS NULL
                AND i.contract_id IN (
                  SELECT id FROM contracts
                  WHERE phase_budget_line_id = $1 AND status NOT IN ('voided')
                )
              )
            )
          )
        )
      ORDER BY i.invoice_date DESC NULLS LAST, i.id
    `, [lineId]);

    res.json({
      contracts: contractsQ.rows,
      invoices:  invoicesQ.rows,
    });
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

    // Build account_number → qb_account_id lookup
    const { rows: accts } = await pool.query('SELECT id, account_number FROM qb_accounts');
    const numToId = {};
    for (const a of accts) numToId[a.account_number] = a.id;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < TEMPLATE.length; i++) {
        const t = TEMPLATE[i];
        const qbId = t.account_number ? numToId[t.account_number] ?? null : null;
        await client.query(
          `INSERT INTO phase_budget_lines
             (phase_id, task_name, discipline, section, sub_group, budgeted_amount, sort_order, source, qb_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'template', $8)`,
          [phaseId, t.task_name, t.discipline, t.section, t.sub_group || null, t.default_amount || 0, i + 1, qbId]
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
         (phase_id, task_name, discipline, section, sub_group, budgeted_amount, consultant, notes, sort_order, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'user')
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
    if (req.body.budgeted_amount !== undefined) { updates.push(`amount_modified = TRUE`); }
    values.push(lineId);

    // Fetch old values for audit log before update
    const before = await pool.query('SELECT * FROM phase_budget_lines WHERE id = $1', [lineId]);
    if (!before.rows.length) return res.status(404).json({ error: 'Line not found' });
    const old = before.rows[0];

    const result = await pool.query(
      `UPDATE phase_budget_lines SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Line not found' });

    // Log each changed field
    const loggable = ['task_name','discipline','budgeted_amount','consultant','notes'];
    for (const f of loggable) {
      if (req.body[f] !== undefined && String(req.body[f]) !== String(old[f] ?? '')) {
        pool.query(
          `INSERT INTO phase_budget_line_logs (line_id, changed_by, field, old_value, new_value)
           VALUES ($1,$2,$3,$4,$5)`,
          [lineId, req.session.userId, f, old[f] ?? null, req.body[f] ?? null]
        ).catch(() => {});
      }
    }

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

// GET /api/phases/:phaseId/contracts
// Returns all contracts in a phase, keyed by phase_budget_line_id, with COs nested.
router.get('/phases/:phaseId/contracts', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;

    const phaseCheck = await pool.query('SELECT id FROM phases WHERE id = $1', [phaseId]);
    if (!phaseCheck.rows.length) return res.status(404).json({ error: 'Phase not found' });

    // All contracts for this phase (via their budget line)
    const contractsResult = await pool.query(`
      SELECT
        c.id,
        c.phase_budget_line_id,
        c.vendor_name,
        c.reference_number,
        c.total_value,
        c.status,
        c.contract_date,
        c.created_at,
        pbl.task_name AS budget_line_name,

        -- Approved COs
        COALESCE((
          SELECT SUM(co.amount)
          FROM change_orders co
          WHERE co.contract_id = c.id AND co.status = 'approved'
        ), 0) AS co_value,

        COALESCE((
          SELECT COUNT(co.id)
          FROM change_orders co
          WHERE co.contract_id = c.id AND co.status = 'approved'
        ), 0) AS co_count,

        -- Fixed invoiced (against contract commitment)
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          WHERE inv.contract_id = c.id
            AND inv.invoice_type = 'fixed'
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS invoiced_fixed,

        -- T&M invoiced
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          WHERE inv.contract_id = c.id
            AND inv.invoice_type = 'tm'
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS invoiced_tm,

        -- Expense invoiced
        COALESCE((
          SELECT SUM(inv.amount)
          FROM invoices inv
          WHERE inv.contract_id = c.id
            AND inv.invoice_type = 'expense'
            AND inv.status NOT IN ('voided','draft')
        ), 0) AS invoiced_expense

      FROM contracts c
      LEFT JOIN phase_budget_lines pbl ON pbl.id = c.phase_budget_line_id
      WHERE c.status NOT IN ('voided')
        AND (
          pbl.phase_id = $1
          OR EXISTS (
            SELECT 1 FROM contract_line_items cli
            JOIN phase_budget_lines pbl2 ON pbl2.id = cli.phase_budget_line_id
            WHERE cli.contract_id = c.id AND pbl2.phase_id = $1
          )
        )
      ORDER BY c.contract_date ASC NULLS LAST, c.created_at ASC
    `, [phaseId]);

    // All change orders for those contracts
    const contractIds = contractsResult.rows.map(r => r.id);
    let cosByContract = {};
    if (contractIds.length > 0) {
      const cosResult = await pool.query(
        `SELECT id, contract_id, co_number, description, amount, status
         FROM change_orders
         WHERE contract_id = ANY($1)
         ORDER BY created_at ASC`,
        [contractIds]
      );
      for (const co of cosResult.rows) {
        if (!cosByContract[co.contract_id]) cosByContract[co.contract_id] = [];
        cosByContract[co.contract_id].push(co);
      }
    }

    const contracts = contractsResult.rows.map(r => {
      const total_value      = parseFloat(r.total_value)      || 0;
      const co_value         = parseFloat(r.co_value)         || 0;
      const co_count         = parseInt(r.co_count)           || 0;
      const invoiced_fixed   = parseFloat(r.invoiced_fixed)   || 0;
      const invoiced_tm      = parseFloat(r.invoiced_tm)      || 0;
      const invoiced_expense = parseFloat(r.invoiced_expense) || 0;
      const total_commitment = total_value + co_value;
      const total_invoiced   = invoiced_fixed + invoiced_tm + invoiced_expense;
      return {
        id:                    r.id,
        phase_budget_line_id:  r.phase_budget_line_id,
        vendor_name:           r.vendor_name,
        reference_number:      r.reference_number,
        total_value,
        status:                r.status,
        contract_date:         r.contract_date,
        budget_line_name:      r.budget_line_name ?? null,
        co_count,
        co_value,
        total_commitment,
        invoiced_fixed,
        invoiced_tm,
        invoiced_expense,
        total_invoiced,
        remaining_commitment:  total_commitment - invoiced_fixed,
        change_orders:         cosByContract[r.id] || [],
      };
    });

    res.json(contracts);
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId/budget-lines — lightweight list for pickers
router.get('/phases/:phaseId/budget-lines', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const phaseCheck = await pool.query('SELECT id FROM phases WHERE id = $1', [phaseId]);
    if (!phaseCheck.rows.length) return res.status(404).json({ error: 'Phase not found' });
    const result = await pool.query(
      `SELECT id, task_name, discipline, section, sub_group, budgeted_amount, sort_order
       FROM phase_budget_lines WHERE phase_id = $1
       ORDER BY CASE section WHEN 'professional_fees' THEN 1 WHEN 'application_fees' THEN 2 WHEN 'construction' THEN 3 ELSE 4 END, sort_order, id`,
      [phaseId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId/invoices
// All invoices for this phase — via contract → budget line, direct budget line link,
// OR import-tab per-line invoice_line_items.phase_budget_line_id.
router.get('/phases/:phaseId/invoices', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const phaseCheck = await pool.query('SELECT id FROM phases WHERE id = $1', [phaseId]);
    if (!phaseCheck.rows.length) return res.status(404).json({ error: 'Phase not found' });

    const result = await pool.query(`
      SELECT
        i.id, i.invoice_number, i.vendor_name, i.amount, i.invoice_date,
        i.status, i.invoice_type, i.description, i.file_reference,
        i.created_at, i.paid_date,
        i.pm_approved_at, i.partner_approved_at, i.approved_at,
        i.rejection_note,
        c.id               AS contract_id,
        c.vendor_name      AS contract_vendor,
        c.reference_number AS contract_ref,
        COALESCE(pbl_direct.id,  pbl_contract.id)         AS budget_line_id,
        COALESCE(pbl_direct.task_name, pbl_contract.task_name) AS budget_line_name
      FROM invoices i
      LEFT JOIN contracts c          ON c.id  = i.contract_id
      LEFT JOIN phase_budget_lines pbl_contract ON pbl_contract.id = c.phase_budget_line_id
      LEFT JOIN phase_budget_lines pbl_direct   ON pbl_direct.id  = i.phase_budget_line_id
      WHERE i.status != 'voided'
        AND (
          pbl_contract.phase_id = $1
          OR pbl_direct.phase_id = $1
          OR EXISTS (
            SELECT 1 FROM invoice_line_items ili
            JOIN phase_budget_lines pbl_ili ON pbl_ili.id = ili.phase_budget_line_id
            WHERE ili.invoice_id = i.id AND pbl_ili.phase_id = $1
          )
        )
      ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC
    `, [phaseId]);

    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/budget-lines/:lineId/activity — contracts + invoices for a single budget line
router.get('/budget-lines/:lineId/activity', requireAuth, async (req, res, next) => {
  try {
    const lineId = Number(req.params.lineId);
    const lineCheck = await pool.query(
      'SELECT id FROM phase_budget_lines WHERE id = $1',
      [lineId]
    );
    if (!lineCheck.rows.length) return res.status(404).json({ error: 'Not found' });

    const [contracts, invoices] = await Promise.all([
      pool.query(
        `SELECT id, vendor_name, reference_number, status, total_value,
                contract_date, file_reference, description
         FROM contracts
         WHERE phase_budget_line_id = $1
         ORDER BY contract_date ASC NULLS LAST, id ASC`,
        [lineId]
      ),
      pool.query(
        `SELECT i.id, i.invoice_number, i.invoice_date, i.amount, i.status,
                i.file_reference, i.description, i.vendor_name, i.invoice_type,
                c.vendor_name AS contract_vendor, c.reference_number AS contract_ref, c.id AS contract_id
         FROM invoices i
         LEFT JOIN contracts c ON c.id = i.contract_id
         WHERE i.status != 'voided'
           AND (i.phase_budget_line_id = $1
                OR i.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = $1))
         ORDER BY i.invoice_date DESC NULLS LAST, i.id DESC`,
        [lineId]
      ),
    ]);

    res.json({ contracts: contracts.rows, invoices: invoices.rows });
  } catch (err) { next(err); }
});

// GET /api/qb-accounts
router.get('/qb-accounts', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, account_number, full_name, short_name, parent_id, category, sort_order, is_leaf
       FROM qb_accounts ORDER BY sort_order`
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
