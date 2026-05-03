const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const TEMPLATE = require('../db/budget-template');
const { suggestLineBudgets } = require('../lib/extract');

const router = express.Router();

// GET /api/phases/:phaseId/qb-transactions?gl_code=1720.01
// Lists QB transactions for a specific GL code in this phase. Used by the
// LineItemPanel drawer to surface "where the QB number actually came from"
// when a leaf task is on a shared GL code.
router.get('/phases/:phaseId/qb-transactions', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const glCode = String(req.query.gl_code || '').trim();
    if (!glCode) return res.status(400).json({ error: 'gl_code query param required' });

    const result = await pool.query(
      `SELECT id, txn_date, vendor_name, ref_number, memo,
              qb_gl_code, qb_gl_name, qb_project,
              amount::float       AS amount,
              paid_amount::float  AS paid_amount,
              open_balance::float AS open_balance,
              is_paid
         FROM qb_transactions
        WHERE phase_id = $1 AND TRIM(qb_gl_code) = $2
        ORDER BY txn_date DESC NULLS LAST, id DESC`,
      [phaseId, glCode],
    );

    const totals = result.rows.reduce((t, r) => ({
      total:        t.total        + (r.amount || 0),
      paid:         t.paid         + (r.paid_amount || 0),
      open_balance: t.open_balance + (r.open_balance || 0),
    }), { total: 0, paid: 0, open_balance: 0 });

    res.json({ transactions: result.rows, totals, gl_code: glCode });
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId/budget
// Optional ?source=pm | qb | compare (default: pm)
//   pm      → today's behavior — actuals from invoices/contracts/etc.
//   qb      → same row shape, but FIXED/T&M/EXPENSE are 0 and BILLED/PAID/AMT DUE
//             come from qb_transactions (matched by qb_account_number).
//   compare → PM fields populated as default, plus extra qb_* fields per row
//             (qb_billed, qb_paid, qb_amount_due) so the frontend can render Δs.
// BUDGETED / CONTRACTED / COS always come from PM-side data (the plan is one fact).
router.get('/phases/:phaseId/budget', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const source = ['qb', 'compare'].includes(String(req.query.source))
      ? String(req.query.source)
      : 'pm';

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

        -- Allocation cascade for invoice line items (used by all 5 aggregations below):
        --   Path 1: ili.phase_budget_line_id = pbl.id   (Option C — explicit per-line, primary)
        --   Path 2: ili.qb_account_id = pbl.qb_account_id   (GL-driven, when ili pbl is null)
        --   Path 3: line items with NEITHER pbl_id NOR qb_account_id — legacy invoices that
        --          predate the new model. Fall back to inv.phase_budget_line_id so the data
        --          still appears in the grid until Richard migrates each invoice.
        --   Path 4: invoices with NO line items at all — same legacy fallback via invoice level.
        -- Paths 3 & 4 are TRANSITIONAL. As invoices are re-saved through the new flow,
        -- they migrate naturally to Path 1 or 2.

        -- T&M invoice charges
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'tm'
              AND ili.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'tm'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NOT NULL
              AND ili.qb_account_id = pbl.qb_account_id
              -- Only credit this leaf when it's the unique pbl for the GL code.
              -- Shared-GL pbls don't get Path-2 credit at the leaf level — the
              -- amount appears as a separate "General [GL]" row instead, so it
              -- visibly burns down as Richard assigns items to specific tasks.
              AND NOT EXISTS (
                SELECT 1 FROM phase_budget_lines pbl_other
                WHERE pbl_other.phase_id = pbl.phase_id
                  AND pbl_other.qb_account_id = pbl.qb_account_id
                  AND pbl_other.id <> pbl.id
              )
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'tm'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'tm'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id)
          ) sub
        ), 0) AS tm_charges,

        -- Expense invoice charges
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'expense'
              AND ili.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'expense'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NOT NULL
              AND ili.qb_account_id = pbl.qb_account_id
              -- Only credit this leaf when it's the unique pbl for the GL code.
              -- Shared-GL pbls don't get Path-2 credit at the leaf level — the
              -- amount appears as a separate "General [GL]" row instead, so it
              -- visibly burns down as Richard assigns items to specific tasks.
              AND NOT EXISTS (
                SELECT 1 FROM phase_budget_lines pbl_other
                WHERE pbl_other.phase_id = pbl.phase_id
                  AND pbl_other.qb_account_id = pbl.qb_account_id
                  AND pbl_other.id <> pbl.id
              )
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'expense'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'expense'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id)
          ) sub
        ), 0) AS expense_charges,

        -- Fixed invoice charges
        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'fixed'
              AND ili.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'fixed'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NOT NULL
              AND ili.qb_account_id = pbl.qb_account_id
              -- Only credit this leaf when it's the unique pbl for the GL code.
              -- Shared-GL pbls don't get Path-2 credit at the leaf level — the
              -- amount appears as a separate "General [GL]" row instead, so it
              -- visibly burns down as Richard assigns items to specific tasks.
              AND NOT EXISTS (
                SELECT 1 FROM phase_budget_lines pbl_other
                WHERE pbl_other.phase_id = pbl.phase_id
                  AND pbl_other.qb_account_id = pbl.qb_account_id
                  AND pbl_other.id <> pbl.id
              )
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'fixed'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'fixed'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id)
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
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NOT NULL
              AND ili.qb_account_id = pbl.qb_account_id
              -- Only credit this leaf when it's the unique pbl for the GL code.
              -- Shared-GL pbls don't get Path-2 credit at the leaf level — the
              -- amount appears as a separate "General [GL]" row instead, so it
              -- visibly burns down as Richard assigns items to specific tasks.
              AND NOT EXISTS (
                SELECT 1 FROM phase_budget_lines pbl_other
                WHERE pbl_other.phase_id = pbl.phase_id
                  AND pbl_other.qb_account_id = pbl.qb_account_id
                  AND pbl_other.id <> pbl.id
              )
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id)
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
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status = 'paid'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NOT NULL
              AND ili.qb_account_id = pbl.qb_account_id
              -- Only credit this leaf when it's the unique pbl for the GL code.
              -- Shared-GL pbls don't get Path-2 credit at the leaf level — the
              -- amount appears as a separate "General [GL]" row instead, so it
              -- visibly burns down as Richard assigns items to specific tasks.
              AND NOT EXISTS (
                SELECT 1 FROM phase_budget_lines pbl_other
                WHERE pbl_other.phase_id = pbl.phase_id
                  AND pbl_other.qb_account_id = pbl.qb_account_id
                  AND pbl_other.id <> pbl.id
              )
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status = 'paid'
              AND ili.phase_budget_line_id IS NULL
              AND ili.qb_account_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.status = 'paid'
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id)
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
              OR (ili.phase_budget_line_id IS NULL AND ili.qb_account_id = pbl.qb_account_id)
            )
        ), '') AS qb_codes_used,

        -- Flag: any direct invoices against this line — kept for legacy display
        -- but does not drive aggregation anymore.
        EXISTS (
          SELECT 1 FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          WHERE inv.status NOT IN ('voided','draft','rejected')
            AND (
              ili.phase_budget_line_id = pbl.id
              OR (ili.phase_budget_line_id IS NULL AND ili.qb_account_id = pbl.qb_account_id)
            )
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

    // For source=qb or source=compare we additionally roll up qb_transactions
    // by qb_gl_code so we can graft the QB-derived actuals onto the rows.
    let qbByCode = new Map();
    let qbGlNameByCode = new Map();
    if (source === 'qb' || source === 'compare') {
      const qbAgg = await pool.query(`
        SELECT
          qb_gl_code,
          MAX(qb_gl_name)              AS qb_gl_name,
          COALESCE(SUM(amount),       0) AS qb_billed,
          COALESCE(SUM(paid_amount),  0) AS qb_paid,
          COALESCE(SUM(open_balance), 0) AS qb_amount_due
        FROM qb_transactions
        WHERE phase_id = $1
        GROUP BY qb_gl_code
      `, [phaseId]);
      qbByCode = new Map(
        qbAgg.rows.map(r => [String(r.qb_gl_code || '').trim(), {
          qb_billed:     parseFloat(r.qb_billed)     || 0,
          qb_paid:       parseFloat(r.qb_paid)       || 0,
          qb_amount_due: parseFloat(r.qb_amount_due) || 0,
        }]),
      );
      qbGlNameByCode = new Map(
        qbAgg.rows.map(r => [String(r.qb_gl_code || '').trim(), String(r.qb_gl_name || '').trim()]),
      );
    }

    const rows = result.rows.map(r => {
      const budgeted          = parseFloat(r.budgeted_amount)   || 0;
      const committed         = parseFloat(r.committed)         || 0;
      const co_value          = parseFloat(r.co_value)          || 0;
      const co_count          = parseInt(r.co_count)            || 0;
      const total_commitment  = committed + co_value;
      const pm_fixed          = parseFloat(r.fixed_charges)     || 0;
      const pm_tm             = parseFloat(r.tm_charges)        || 0;
      const pm_expense        = parseFloat(r.expense_charges)   || 0;
      const pm_billed         = parseFloat(r.billed)            || 0;
      const pm_paid           = parseFloat(r.paid)              || 0;
      const remaining_commit  = budgeted - total_commitment;

      const acctNumber = r.qb_account_number ? String(r.qb_account_number).trim() : '';
      const qb = qbByCode.get(acctNumber) || { qb_billed: 0, qb_paid: 0, qb_amount_due: 0 };

      // Pick which actuals fill the canonical fields based on source.
      let fixed_charges, tm_charges, expense_charges, billed, paid, amount_due;
      if (source === 'qb') {
        // QB has no Fixed/T&M/Expense breakdown
        fixed_charges = 0;
        tm_charges = 0;
        expense_charges = 0;
        billed     = qb.qb_billed;
        paid       = qb.qb_paid;
        amount_due = qb.qb_amount_due;
      } else {
        // pm and compare: canonical fields = PM-side (compare also returns qb_* below)
        fixed_charges   = pm_fixed;
        tm_charges      = pm_tm;
        expense_charges = pm_expense;
        billed          = pm_billed;
        paid            = pm_paid;
        amount_due      = pm_billed - pm_paid;
      }
      const remaining_budget = budgeted - billed;
      const pct_billed       = budgeted > 0 ? billed / budgeted : null;

      const base = {
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
        source_view:        source,
      };

      if (source === 'compare') {
        // Surface BOTH sides so the frontend can render Δ columns.
        return {
          ...base,
          pm_fixed_charges:   pm_fixed,
          pm_tm_charges:      pm_tm,
          pm_expense_charges: pm_expense,
          pm_billed,
          pm_paid,
          pm_amount_due:      pm_billed - pm_paid,
          qb_fixed_charges:   0,        // structurally unavailable
          qb_tm_charges:      0,
          qb_expense_charges: 0,
          qb_billed:          qb.qb_billed,
          qb_paid:            qb.qb_paid,
          qb_amount_due:      qb.qb_amount_due,
        };
      }
      return base;
    });

    // ── "General [GL]" rows for shared GL codes (PM Source / Compare) ────
    // For each GL code that has 2+ pbls in this phase, sum the line items
    // that are GL-coded but not yet assigned to a specific PM task. Append
    // these as synthetic "General — Unassigned" rows above the specific
    // task rows. As Richard assigns line items to specific tasks via the
    // Edit modal, the General row burns down toward zero.
    if (source !== 'qb') {
      const sharedGl = await pool.query(`
        SELECT
          qa.id              AS qb_account_id,
          qa.account_number  AS qb_account_number,
          qa.short_name      AS qb_short_name,
          qa.sort_order      AS qb_sort_order,
          qp.id              AS qb_parent_id,
          qp.account_number  AS qb_parent_number,
          qp.short_name      AS qb_parent_name,
          qp.sort_order      AS qb_parent_sort,
          COALESCE(SUM(CASE WHEN ili.billing_type = 'fixed'   THEN ili.amount ELSE 0 END), 0) AS fixed,
          COALESCE(SUM(CASE WHEN ili.billing_type = 'tm'      THEN ili.amount ELSE 0 END), 0) AS tm,
          COALESCE(SUM(CASE WHEN ili.billing_type = 'expense' THEN ili.amount ELSE 0 END), 0) AS expense,
          COALESCE(SUM(ili.amount), 0)                                                        AS billed,
          COALESCE(SUM(CASE WHEN inv.status = 'paid' THEN ili.amount ELSE 0 END), 0)          AS paid
        FROM invoice_line_items ili
        JOIN invoices inv      ON inv.id = ili.invoice_id
        JOIN qb_accounts qa    ON qa.id = ili.qb_account_id
        LEFT JOIN qb_accounts qp ON qp.id = qa.parent_id
        WHERE inv.status NOT IN ('voided','draft','rejected')
          AND ili.phase_budget_line_id IS NULL
          AND ili.qb_account_id IN (
            SELECT qb_account_id
              FROM phase_budget_lines
             WHERE phase_id = $1
               AND qb_account_id IS NOT NULL
             GROUP BY qb_account_id
            HAVING COUNT(*) > 1
          )
        GROUP BY qa.id, qa.account_number, qa.short_name, qa.sort_order,
                 qp.id, qp.account_number, qp.short_name, qp.sort_order
      `, [phaseId]);

      for (const r of sharedGl.rows) {
        const billed   = parseFloat(r.billed)  || 0;
        const paid     = parseFloat(r.paid)    || 0;
        if (billed === 0) continue;
        const general = {
          id: -1_000_000 - Number(r.qb_account_id), // distinct negative id range for general rows
          phase_id: Number(phaseId),
          task_name: `General — Unassigned`,
          discipline: null,
          section: 'general',
          sub_group: null,
          calculation_method: null,
          calc_hint: null,
          budgeted_amount: 0,
          consultant: null,
          notes: null,
          sort_order: -1, // sorts before the assigned tasks within the same GL group
          source: 'general',
          amount_modified: false,
          qb_account_id:      r.qb_account_id,
          qb_account_number:  r.qb_account_number,
          qb_short_name:      r.qb_short_name,
          qb_sort_order:      Number(r.qb_sort_order ?? 9999),
          qb_parent_id:       r.qb_parent_id,
          qb_parent_number:   r.qb_parent_number,
          qb_parent_name:     r.qb_parent_name,
          qb_parent_sort:     Number(r.qb_parent_sort ?? 9999),
          qb_category:        null,
          committed: 0,
          co_count: 0,
          co_value: 0,
          total_commitment: 0,
          fixed_charges:    parseFloat(r.fixed)   || 0,
          tm_charges:       parseFloat(r.tm)      || 0,
          expense_charges:  parseFloat(r.expense) || 0,
          billed,
          paid,
          amount_due:       billed - paid,
          remaining_budget: -billed,
          remaining_commit: 0,
          pct_billed: null,
          qb_codes_used: r.qb_account_number || '',
          has_direct_invoices: false,
          source_view: source,
          general_unassigned: true,  // frontend marker
        };
        if (source === 'compare') {
          Object.assign(general, {
            pm_fixed_charges:   parseFloat(r.fixed)   || 0,
            pm_tm_charges:      parseFloat(r.tm)      || 0,
            pm_expense_charges: parseFloat(r.expense) || 0,
            pm_billed:          billed,
            pm_paid:            paid,
            pm_amount_due:      billed - paid,
            qb_fixed_charges:   0,
            qb_tm_charges:      0,
            qb_expense_charges: 0,
            qb_billed:          0,
            qb_paid:            0,
            qb_amount_due:      0,
          });
        }
        rows.push(general);
      }
    }

    // For QB Source / Compare: append "phantom" rows for QB GL codes that
    // don't match any phase_budget_line. These represent QB activity on GL
    // accounts the PM never put in the budget template. Without these rows
    // the QB Source totals silently undercount vs the Audit tab.
    if (source === 'qb' || source === 'compare') {
      const knownAccountNumbers = new Set(
        rows
          .map(r => (r.qb_account_number ? String(r.qb_account_number).trim() : ''))
          .filter(Boolean)
      );
      const phantomEntries = [...qbByCode.entries()]
        .filter(([code]) => code && !knownAccountNumbers.has(code))
        .sort(([a], [b]) => a.localeCompare(b));

      for (const [code, qb] of phantomEntries) {
        const glName = qbGlNameByCode.get(code) || `GL ${code}`;
        const phantom = {
          id: -Math.abs([...code].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)), // negative pseudo-id
          phase_id: Number(phaseId),
          task_name: glName,
          discipline: null,
          section: 'QB-only',
          sub_group: null,
          calculation_method: null,
          calc_hint: null,
          budgeted_amount: 0,
          consultant: null,
          notes: null,
          sort_order: 99999,
          source: 'qb',
          amount_modified: false,
          qb_account_id: null,
          qb_account_number: code,
          qb_short_name: glName,
          qb_sort_order: 99999,
          qb_parent_id: null,
          qb_parent_number: null,
          qb_parent_name: 'Auto-added from QB',
          qb_parent_sort: 99999,
          qb_category: null,
          committed: 0,
          co_count: 0,
          co_value: 0,
          total_commitment: 0,
          fixed_charges:   0,
          tm_charges:      0,
          expense_charges: 0,
          billed:          source === 'qb' ? qb.qb_billed     : 0,
          paid:            source === 'qb' ? qb.qb_paid       : 0,
          amount_due:      source === 'qb' ? qb.qb_amount_due : 0,
          remaining_budget: -(source === 'qb' ? qb.qb_billed : 0),
          remaining_commit: 0,
          pct_billed: null,
          qb_codes_used: '',
          has_direct_invoices: false,
          source_view: source,
          phantom_from_qb: true,   // frontend marker
        };
        if (source === 'compare') {
          Object.assign(phantom, {
            pm_fixed_charges:   0,
            pm_tm_charges:      0,
            pm_expense_charges: 0,
            pm_billed:          0,
            pm_paid:            0,
            pm_amount_due:      0,
            qb_fixed_charges:   0,
            qb_tm_charges:      0,
            qb_expense_charges: 0,
            qb_billed:          qb.qb_billed,
            qb_paid:            qb.qb_paid,
            qb_amount_due:      qb.qb_amount_due,
          });
        }
        rows.push(phantom);
      }
    }

    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId/budget-lines/:lineId/drill — cell drill-down
router.get('/phases/:phaseId/budget-lines/:lineId/drill', requireAuth, async (req, res, next) => {
  try {
    const phaseId = Number(req.params.phaseId);
    const lineId  = Number(req.params.lineId);

    // Synthetic "General — Unassigned" rows have negative IDs encoding the
    // qb_account_id: id = -1_000_000 - qb_account_id. Decode and return the
    // line items GL-coded to that account but not yet assigned to a task.
    if (lineId <= -1_000_000) {
      const qbAccountId = -1_000_000 - lineId;
      const invoicesQ = await pool.query(`
        SELECT
          i.id, i.vendor_name, i.invoice_number, i.invoice_date,
          i.status, i.invoice_type, i.contract_id, i.file_reference,
          i.amount AS total_amount,
          c.reference_number AS contract_ref,
          c.vendor_name      AS contract_vendor,
          COALESCE((
            SELECT SUM(ili.amount) FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id
               AND ili.phase_budget_line_id IS NULL
               AND ili.qb_account_id = $1
          ), 0) AS amount
        FROM invoices i
        LEFT JOIN contracts c ON c.id = i.contract_id
        WHERE i.status NOT IN ('voided','draft','rejected')
          AND EXISTS (
            SELECT 1 FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id
               AND ili.phase_budget_line_id IS NULL
               AND ili.qb_account_id = $1
          )
        ORDER BY i.invoice_date DESC NULLS LAST, i.id
      `, [qbAccountId]);
      return res.json({
        contracts: [],          // contracts don't apply to "general unassigned"
        invoices:  invoicesQ.rows,
        is_general_unassigned: true,
        qb_account_id: qbAccountId,
      });
    }
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

    // Invoices that contribute to this budget line — using the SAME 4 allocation
    // paths as the budget aggregation in the main GET /budget endpoint:
    //   1. ili.phase_budget_line_id = pbl.id                     (explicit per-line)
    //   2. ili.qb_account_id = pbl.qb_account_id (when unique-GL) (GL-driven)
    //   3. ili has neither pbl_id nor qb_account_id → inv.phase_budget_line_id
    //   4. invoice has no line items → inv.phase_budget_line_id
    // Allocated amount per invoice = sum of contributions across whichever paths apply.
    const invoicesQ = await pool.query(`
      WITH pbl AS (
        SELECT id, phase_id, qb_account_id FROM phase_budget_lines WHERE id = $1
      ),
      gl_sharing AS (
        SELECT
          (SELECT COUNT(*) FROM phase_budget_lines pbl2
            WHERE pbl2.phase_id = (SELECT phase_id FROM pbl)
              AND pbl2.qb_account_id = (SELECT qb_account_id FROM pbl)
          ) AS share_count
      )
      SELECT
        i.id, i.vendor_name, i.invoice_number, i.invoice_date,
        i.status, i.invoice_type, i.contract_id, i.file_reference,
        i.amount AS total_amount,
        c.reference_number AS contract_ref,
        c.vendor_name      AS contract_vendor,
        (
          -- Path 1: explicit per-line
          COALESCE((
            SELECT SUM(ili.amount) FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id AND ili.phase_budget_line_id = $1
          ), 0)
          -- Path 2: GL-driven (only when this pbl is the sole pbl with this GL)
          + CASE WHEN (SELECT share_count FROM gl_sharing) = 1
                 THEN COALESCE((
                   SELECT SUM(ili.amount) FROM invoice_line_items ili
                    WHERE ili.invoice_id = i.id
                      AND ili.phase_budget_line_id IS NULL
                      AND ili.qb_account_id IS NOT NULL
                      AND ili.qb_account_id = (SELECT qb_account_id FROM pbl)
                 ), 0)
                 ELSE 0 END
          -- Path 3: legacy line items with neither pbl_id nor qb_account_id
          + CASE WHEN i.phase_budget_line_id = $1
                 THEN COALESCE((
                   SELECT SUM(ili.amount) FROM invoice_line_items ili
                    WHERE ili.invoice_id = i.id
                      AND ili.phase_budget_line_id IS NULL
                      AND ili.qb_account_id IS NULL
                 ), 0)
                 ELSE 0 END
          -- Path 4: legacy invoice with no line items at all
          + CASE WHEN i.phase_budget_line_id = $1
                  AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = i.id)
                 THEN i.amount ELSE 0 END
        ) AS amount
      FROM invoices i
      LEFT JOIN contracts c ON c.id = i.contract_id
      WHERE i.status NOT IN ('voided','draft','rejected')
        AND (
          EXISTS (
            SELECT 1 FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id AND ili.phase_budget_line_id = $1
          )
          OR ((SELECT share_count FROM gl_sharing) = 1 AND EXISTS (
            SELECT 1 FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id
               AND ili.phase_budget_line_id IS NULL
               AND ili.qb_account_id IS NOT NULL
               AND ili.qb_account_id = (SELECT qb_account_id FROM pbl)
          ))
          OR (i.phase_budget_line_id = $1 AND EXISTS (
            SELECT 1 FROM invoice_line_items ili
             WHERE ili.invoice_id = i.id
               AND ili.phase_budget_line_id IS NULL
               AND ili.qb_account_id IS NULL
          ))
          OR (i.phase_budget_line_id = $1
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = i.id))
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

    // All leaf QB accounts — COA drives completeness
    const { rows: leaves } = await pool.query(
      'SELECT id, account_number, short_name FROM qb_accounts WHERE is_leaf = true ORDER BY sort_order'
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Step 1: insert template-defined tasks (with specific names/amounts)
      const coveredAcctIds = new Set();
      for (let i = 0; i < TEMPLATE.length; i++) {
        const t = TEMPLATE[i];
        const qbId = t.account_number ? numToId[t.account_number] ?? null : null;
        await client.query(
          `INSERT INTO phase_budget_lines
             (phase_id, task_name, discipline, section, sub_group, budgeted_amount, sort_order, source, qb_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'template', $8)`,
          [phaseId, t.task_name, t.discipline, t.section, t.sub_group || null, t.default_amount || 0, i + 1, qbId]
        );
        if (qbId) coveredAcctIds.add(qbId);
      }

      // Step 2: auto-fill any leaf account not yet represented
      let sortIdx = TEMPLATE.length + 1;
      for (const leaf of leaves) {
        if (coveredAcctIds.has(leaf.id)) continue;
        await client.query(
          `INSERT INTO phase_budget_lines
             (phase_id, task_name, budgeted_amount, sort_order, source, qb_account_id)
           VALUES ($1, $2, 0, $3, 'template', $4)`,
          [phaseId, leaf.short_name, sortIdx++, leaf.id]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const total = await pool.query('SELECT COUNT(*) FROM phase_budget_lines WHERE phase_id=$1', [phaseId]);
    res.json({ ok: true, count: Number(total.rows[0].count) });
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
        c.description,
        c.total_value,
        c.status,
        c.contract_date,
        c.created_at,
        pbl.task_name AS budget_line_name,

        -- Primary GL account from contract line items (most common code)
        (SELECT qa.account_number
         FROM contract_line_items cli
         JOIN qb_accounts qa ON qa.id = cli.qb_account_id
         WHERE cli.contract_id = c.id AND qa.account_number IS NOT NULL
         GROUP BY qa.account_number ORDER BY COUNT(*) DESC LIMIT 1
        ) AS gl_account_number,

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
        description:           r.description ?? null,
        total_value,
        status:                r.status,
        contract_date:         r.contract_date,
        budget_line_name:      r.budget_line_name ?? null,
        gl_account_number:     r.gl_account_number ?? null,
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

// POST /api/phases/:phaseId/suggest-line-tasks
// Body: { vendor_name, description, line_items: [{ description, billing_type, amount, qb_account_id }] }
// Returns AI suggestions for which PM task each invoice line item should be allocated to.
// Used by the Edit Invoice modal to pre-fill ili.phase_budget_line_id when GL code is shared.
//
// The AI's pick is validated to respect the line's qb_account_id — if it picks a task
// outside the GL group, we override with the first task within the correct group. This
// keeps allocation honest while preserving AI judgment for the within-group choice.
router.post('/phases/:phaseId/suggest-line-tasks', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const { vendor_name, description, line_items } = req.body || {};
    if (!Array.isArray(line_items) || line_items.length === 0) {
      return res.json({ suggestions: [] });
    }

    const blRes = await pool.query(
      `SELECT id, task_name, discipline, section, sub_group, qb_account_id
         FROM phase_budget_lines
        WHERE phase_id = $1
        ORDER BY sort_order, id`,
      [phaseId],
    );
    const budgetLines = blRes.rows;
    if (budgetLines.length === 0) return res.json({ suggestions: [] });

    // Pass to Claude as-is (prompt expects budgeted_amount; map invoice 'amount' to that field).
    const aiInput = line_items.map(li => ({
      description: li.description || '',
      billing_type: li.billing_type || 'fixed',
      budgeted_amount: Number(li.amount) || 0,
    }));

    let result = null;
    try {
      result = await suggestLineBudgets(aiInput, budgetLines, {
        vendor_name: vendor_name || '',
        description: description || '',
      });
    } catch (err) {
      console.warn('suggestLineBudgets endpoint error:', err.message);
      return res.json({ suggestions: [] });
    }
    if (!result || !Array.isArray(result.lines)) return res.json({ suggestions: [] });

    // Validate each suggestion respects the line's GL code constraint.
    const suggestions = result.lines.map(s => {
      const li = line_items[s.line_index];
      if (!li) return null;
      const lineGl = li.qb_account_id;
      const picked = budgetLines.find(b => b.id === s.budget_line_id);
      let final = s.budget_line_id;
      let reason = s.reason;
      let confidence = s.confidence;
      // If the AI's pick has a different GL than the line item's GL, override
      // with the first matching task. (Honors the user's explicit GL code.)
      if (lineGl != null && picked && picked.qb_account_id !== lineGl) {
        const fallback = budgetLines.find(b => b.qb_account_id === lineGl);
        if (fallback) {
          final = fallback.id;
          reason = `Constrained to GL ${lineGl} (AI suggested a different code: ${picked.qb_account_id ?? 'none'})`;
          confidence = 'low';
        } else {
          // No task in this phase has the line's GL code at all — leave AI's pick but flag
          confidence = 'low';
          reason = `${reason} — note: no task in this phase has GL ${lineGl}`;
        }
      }
      // If line had no GL code, just trust the AI
      return {
        line_index: s.line_index,
        budget_line_id: final,
        confidence,
        reason,
      };
    }).filter(Boolean);

    res.json({
      suggestions,
      primary_budget_line_id: result.primary_budget_line_id,
      primary_confidence: result.primary_confidence,
      primary_reason: result.primary_reason,
    });
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId/budget-lines — lightweight list for pickers
router.get('/phases/:phaseId/budget-lines', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const phaseCheck = await pool.query('SELECT id FROM phases WHERE id = $1', [phaseId]);
    if (!phaseCheck.rows.length) return res.status(404).json({ error: 'Phase not found' });
    const result = await pool.query(
      `SELECT id, task_name, discipline, section, sub_group, budgeted_amount, sort_order,
              qb_account_id
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

// GET /api/phases/:phaseId/budget/export-excel
// Downloads a .xlsx file: Variance Report sheet + full Budget Detail sheet with all columns.
router.get('/phases/:phaseId/budget/export-excel', requireAuth, async (req, res, next) => {
  try {
    const XLSX = require('xlsx');
    const phaseId = Number(req.params.phaseId);

    // ── Fetch phase + project name + site dimensions for the filename ──
    const phaseRow = (await pool.query(
      `SELECT ph.name AS phase_name, pr.name AS project_name,
              pr.gla_sf, pr.gla_ac
         FROM phases ph JOIN projects pr ON pr.id = ph.project_id
        WHERE ph.id = $1`, [phaseId]
    )).rows[0] || { phase_name: 'Phase', project_name: 'Project', gla_sf: null, gla_ac: null };

    // ── Full budget query (same as GET /budget endpoint) ──
    const rawRows = (await pool.query(`
      SELECT
        pbl.id,
        pbl.task_name,
        pbl.discipline,
        pbl.section,
        pbl.sub_group,
        pbl.calculation_method,
        pbl.budgeted_amount,
        pbl.consultant,
        pbl.notes,
        pbl.sort_order,
        pbl.qb_account_id,

        qa.account_number                       AS qb_account_number,
        qa.short_name                           AS qb_short_name,
        qa.full_name                            AS qb_full_name,
        qp.account_number                       AS qb_parent_number,
        qp.short_name                           AS qb_parent_name,
        qp.full_name                            AS qb_parent_full_name,

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

        COALESCE((
          SELECT SUM(co.amount)
          FROM change_orders co
          JOIN contracts c ON c.id = co.contract_id
          WHERE c.phase_budget_line_id = pbl.id AND co.status = 'approved'
        ), 0) AS co_value,

        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id = pbl.id AND ili.billing_type = 'tm'
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'tm' AND ili.phase_budget_line_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'tm'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.billing_type IS NOT NULL)
              AND (inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided'))))
          ) sub
        ), 0) AS tm_charges,

        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id = pbl.id AND ili.billing_type = 'expense'
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'expense' AND ili.phase_budget_line_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'expense'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.billing_type IS NOT NULL)
              AND (inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided'))))
          ) sub
        ), 0) AS expense_charges,

        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.phase_budget_line_id = pbl.id AND ili.billing_type = 'fixed'
            UNION ALL
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status NOT IN ('voided','draft','rejected')
              AND ili.billing_type = 'fixed' AND ili.phase_budget_line_id IS NULL
              AND inv.phase_budget_line_id = pbl.id
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.invoice_type = 'fixed'
              AND inv.status NOT IN ('voided','draft','rejected')
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.billing_type IS NOT NULL)
              AND (inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided'))))
          ) sub
        ), 0) AS fixed_charges,

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
              AND (inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided'))))
          ) sub
        ), 0) AS billed,

        COALESCE((
          SELECT SUM(contribution) FROM (
            SELECT ili.amount AS contribution
            FROM invoice_line_items ili
            JOIN invoices inv ON inv.id = ili.invoice_id
            WHERE inv.status = 'paid' AND ili.phase_budget_line_id = pbl.id
            UNION ALL
            SELECT inv.amount AS contribution
            FROM invoices inv
            WHERE inv.status = 'paid'
              AND NOT EXISTS (SELECT 1 FROM invoice_line_items x WHERE x.invoice_id = inv.id AND x.phase_budget_line_id IS NOT NULL)
              AND (inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided'))))
          ) sub
        ), 0) AS paid,

        COALESCE((
          SELECT string_agg(DISTINCT qa2.account_number, ', ' ORDER BY qa2.account_number)
          FROM invoice_line_items ili
          JOIN invoices inv ON inv.id = ili.invoice_id
          JOIN qb_accounts qa2 ON qa2.id = ili.qb_account_id
          WHERE inv.status NOT IN ('voided','draft','rejected')
            AND qa2.account_number IS NOT NULL
            AND (
              ili.phase_budget_line_id = pbl.id
              OR (ili.phase_budget_line_id IS NULL AND (
                inv.phase_budget_line_id = pbl.id
                OR (inv.phase_budget_line_id IS NULL AND inv.contract_id IN (SELECT id FROM contracts WHERE phase_budget_line_id = pbl.id AND status NOT IN ('voided')))
              ))
            )
        ), '') AS qb_codes_used

      FROM phase_budget_lines pbl
      LEFT JOIN qb_accounts qa ON qa.id = pbl.qb_account_id
      LEFT JOIN qb_accounts qp ON qp.id = qa.parent_id
      WHERE pbl.phase_id = $1
      ORDER BY
        COALESCE(qp.sort_order, qa.sort_order, 9999),
        COALESCE(qa.sort_order, 9999),
        pbl.sort_order,
        pbl.id
    `, [phaseId])).rows;

    // Apply same computed fields as the GET /budget endpoint
    const rows = rawRows.map(r => {
      const budgeted         = parseFloat(r.budgeted_amount)  || 0;
      const committed        = parseFloat(r.committed)        || 0;
      const co_value         = parseFloat(r.co_value)         || 0;
      const total_commitment = committed + co_value;
      const fixed_charges    = parseFloat(r.fixed_charges)    || 0;
      const tm_charges       = parseFloat(r.tm_charges)       || 0;
      const expense_charges  = parseFloat(r.expense_charges)  || 0;
      const billed           = parseFloat(r.billed)           || 0;
      const paid             = parseFloat(r.paid)             || 0;
      const amount_due       = billed - paid;
      const remaining_budget = budgeted - billed;
      const remaining_commit = budgeted - total_commitment;
      const pct_billed       = budgeted > 0 ? billed / budgeted : null;
      const rem_pct          = budgeted > 0 ? remaining_commit / budgeted : null;
      return { ...r, budgeted, committed, co_value, total_commitment, fixed_charges, tm_charges, expense_charges, billed, paid, amount_due, remaining_budget, remaining_commit, pct_billed, rem_pct };
    });

    const ExcelJS = require('exceljs');

    // ── Palette (black & white only) ─────────────────────────────────────────
    const C = {
      darkBg:  '1F2D3D',  // section headers, title, total row
      midBg:   '3D5166',  // group band headers
      leafAlt: 'F2F2F2',  // alternating data row tint
      white:   'FFFFFF',
      black:   '000000',
    };

    const USD0 = '"$"#,##0;("$"#,##0)';   // no red — parens for negatives
    const PCT  = '0%';

    function pctVal(num, den) { return (den && den > 0) ? num / den : null; }
    function v(n) { return (!n || n === 0) ? null : n; }  // null out zeros for cleaner cells

    function font(bold = false, color = C.black, sz = 10) {
      return { name: 'Calibri', size: sz, bold, color: { argb: 'FF' + color } };
    }
    function fill(hex) {
      return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } };
    }
    function border() {
      const t = { style: 'thin', color: { argb: 'FFD0D0D0' } };
      return { top: t, left: t, bottom: t, right: t };
    }

    // Columns matching the budget grid exactly (left-to-right)
    // Col indices (1-based):
    //  1  Acct #          2  Task / Description  3  Budgeted
    //  4  Rem. Budget      5  Rem. %              [REMAINING]
    //  6  Contracted       7  COs                 8  Total Commit   9  Rem. %   [CONTRACT COMMITMENT]
    // 10  Fixed           11  T&M                12  Expense        13 Billed   [INVOICED]
    // 14  Amt Due         15  Paid               [PAYMENTS]
    // 16  $/SF            17  $/AC               [UNIT COST]
    // 18  QB Codes Used   19  Calc Method        20  Consultant     21  Notes

    const NCOLS   = 21;
    const glaSF   = phaseRow.gla_sf ? Number(phaseRow.gla_sf) : null;
    const glaAC   = phaseRow.gla_ac ? Number(phaseRow.gla_ac) : null;
    const genDate = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    const MONEY_COLS = [3,4,6,7,8,10,11,12,13,14,15];
    const PCT_COLS   = [5,9];

    function styleDataCell(cell, col) {
      cell.border    = border();
      cell.alignment = { horizontal: col <= 2 ? 'left' : 'right', vertical: 'middle', wrapText: col === 2 };
      if (MONEY_COLS.includes(col)) { cell.numFmt = USD0; if (cell.value === 0) cell.value = null; }
      if (PCT_COLS.includes(col))   { cell.numFmt = PCT;  if (cell.value === 0) cell.value = null; }
      // $/SF and $/AC are pre-formatted strings, no numFmt needed
    }

    // ── Build workbook ───────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ActiveAcq';
    wb.created = new Date();

    const ws = wb.addWorksheet('Budget');
    ws.pageSetup = {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      paperSize: 1,
      margins: { left: 0.4, right: 0.4, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    };
    ws.headerFooter = {
      oddHeader: `&L&"Calibri,Bold"&12${phaseRow.project_name} — ${phaseRow.phase_name}&R&"Calibri"&9Generated ${genDate}`,
      oddFooter: `&C&"Calibri"&9Page &P of &N`,
    };
    ws.pageSetup.printTitlesRow = '1:4';

    // ── Row 1: Title ─────────────────────────────────────────────────────────
    ws.mergeCells(1, 1, 1, NCOLS);
    const titleCell = ws.getCell('A1');
    titleCell.value     = `${phaseRow.project_name}  ·  ${phaseRow.phase_name}`;
    titleCell.font      = font(true, C.white, 14);
    titleCell.fill      = fill(C.darkBg);
    titleCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws.getRow(1).height = 30;

    // ── Row 2: Subtitle ──────────────────────────────────────────────────────
    ws.mergeCells(2, 1, 2, NCOLS);
    const subCell = ws.getCell('A2');
    subCell.value     = `Project Budget  ·  ${genDate}`;
    subCell.font      = font(false, C.white, 9);
    subCell.fill      = fill(C.midBg);
    subCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws.getRow(2).height = 14;

    // ── Row 3: Group header bands (matching the grid exactly) ────────────────
    // Cols 1-3: blank  |  4-5: REMAINING  |  6-9: CONTRACT COMMITMENT
    //          10-13: INVOICED  |  14-15: PAYMENTS  |  16-17: UNIT COST
    //          18-21: (blank detail)
    const bands = [
      [1, 3, ''],
      [4, 5, 'REMAINING'],
      [6, 9, 'CONTRACT COMMITMENT'],
      [10, 13, 'INVOICED'],
      [14, 15, 'PAYMENTS'],
      [16, 17, 'UNIT COST'],
      [18, 21, ''],
    ];
    bands.forEach(([c1, c2, label], i) => {
      if (c1 < c2) ws.mergeCells(3, c1, 3, c2);
      const cell     = ws.getCell(3, c1);
      cell.value     = label;
      cell.font      = font(true, C.white, 9);
      cell.fill      = fill(i % 2 === 0 ? C.darkBg : C.midBg);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      // Fill remaining cells in merged range
      for (let c = c1; c <= c2; c++) {
        const bc = ws.getCell(3, c);
        bc.fill = fill(i % 2 === 0 ? C.darkBg : C.midBg);
      }
    });
    ws.getRow(3).height = 13;

    // ── Row 4: Column headers ─────────────────────────────────────────────────
    const HDR = [
      'Acct #', 'Task / Description', 'Budgeted',
      'Rem. Budget', 'Rem. %',
      'Contracted', 'COs', 'Total Commit', 'Rem. %',
      'Fixed', 'T&M', 'Expense', 'Billed',
      'Amt Due', 'Paid',
      '$/SF', '$/AC',
      'QB Codes Used', 'Calc Method', 'Consultant', 'Notes',
    ];
    const hdrRow = ws.addRow(HDR);  // row 4
    hdrRow.height = 28;
    hdrRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font      = font(true, C.white, 9);
      cell.fill      = fill(C.darkBg);
      cell.alignment = { horizontal: col <= 2 ? 'left' : 'right', vertical: 'middle', wrapText: true };
      cell.border    = border();
    });

    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

    // ── Data rows: section headers + leaf rows ────────────────────────────────
    const totBudget = rows.reduce((s, r) => s + r.budgeted, 0);
    const totCommit = rows.reduce((s, r) => s + r.total_commitment, 0);
    const totBilled = rows.reduce((s, r) => s + r.billed, 0);
    const totPaid   = rows.reduce((s, r) => s + r.paid, 0);

    // Build section totals keyed by parent GL
    const secMap = new Map();
    const leafRows = rows.filter(r => r.task_name || r.budgeted > 0 || r.total_commitment > 0 || r.billed > 0);
    for (const r of leafRows) {
      const key = r.qb_parent_number || r.qb_account_number || '—';
      if (!secMap.has(key)) secMap.set(key, {
        key,
        label: (r.qb_parent_full_name || r.qb_full_name || '').split(':').slice(1).join('').trim() || r.qb_parent_full_name || r.qb_full_name || '',
        budgeted: 0, remaining_budget: 0,
        committed: 0, co_value: 0, total_commitment: 0,
        fixed_charges: 0, tm_charges: 0, expense_charges: 0,
        billed: 0, amount_due: 0, paid: 0,
      });
      const s = secMap.get(key);
      s.budgeted         += r.budgeted;
      s.remaining_budget += r.remaining_budget;
      s.committed        += r.committed;
      s.co_value         += r.co_value;
      s.total_commitment += r.total_commitment;
      s.fixed_charges    += r.fixed_charges;
      s.tm_charges       += r.tm_charges;
      s.expense_charges  += r.expense_charges;
      s.billed           += r.billed;
      s.amount_due       += r.amount_due;
      s.paid             += r.paid;
    }

    function perSF(n) { return glaSF && glaSF > 0 && n > 0 ? `$${(n / glaSF).toFixed(2)}` : '—'; }
    function perAC(n) { return glaAC && glaAC > 0 && n > 0 ? `$${Math.round(n / glaAC).toLocaleString()}` : '—'; }

    let currentParent = null;
    let alt = false;

    for (const r of leafRows) {
      const parentKey = r.qb_parent_number || r.qb_account_number || '—';

      // Section header row when parent group changes
      if (parentKey !== currentParent) {
        currentParent = parentKey;
        alt = false;
        const s = secMap.get(parentKey);
        const secRow = ws.addRow([
          parentKey, s.label.toUpperCase(), v(s.budgeted),
          v(s.remaining_budget), pctVal(s.billed, s.budgeted),
          v(s.committed), v(s.co_value), v(s.total_commitment), pctVal(s.billed, s.total_commitment),
          v(s.fixed_charges), v(s.tm_charges), v(s.expense_charges), v(s.billed),
          v(s.amount_due), v(s.paid),
          perSF(s.billed), perAC(s.billed),
          '', '', '', '',
        ]);
        secRow.height = 17;
        secRow.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.font      = font(true, C.white, 9);
          cell.fill      = fill(C.darkBg);
          cell.alignment = { horizontal: col <= 2 ? 'left' : 'right', vertical: 'middle', indent: col <= 2 ? 1 : 0 };
          cell.border    = border();
          styleDataCell(cell, col);
          cell.font = font(true, C.white, 9); // re-apply after styleDataCell
        });
      }

      // Leaf row
      const rowBg = alt ? C.leafAlt : C.white;
      const dataRow = ws.addRow([
        r.qb_account_number || '—',
        r.task_name || '',
        v(r.budgeted),
        v(r.remaining_budget), pctVal(r.billed, r.budgeted),
        v(r.committed), v(r.co_value), v(r.total_commitment), pctVal(r.billed, r.total_commitment),
        v(r.fixed_charges), v(r.tm_charges), v(r.expense_charges), v(r.billed),
        v(r.amount_due), v(r.paid),
        perSF(r.billed), perAC(r.billed),
        r.qb_codes_used || '', r.calculation_method || '', r.consultant || '', r.notes || '',
      ]);
      dataRow.height = 15;
      dataRow.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = font(false, C.black, 9);
        cell.fill = fill(rowBg);
        cell.alignment = { horizontal: col <= 2 ? 'left' : 'right', vertical: 'middle', indent: col <= 2 ? 2 : 0, wrapText: col === 2 };
        styleDataCell(cell, col);
      });
      alt = !alt;
    }

    // ── Grand total row ───────────────────────────────────────────────────────
    const totRemBudget = rows.reduce((s,r) => s+r.remaining_budget, 0);
    const totFixed     = rows.reduce((s,r) => s+r.fixed_charges, 0);
    const totTM        = rows.reduce((s,r) => s+r.tm_charges, 0);
    const totExp       = rows.reduce((s,r) => s+r.expense_charges, 0);
    const totAmtDue    = totBilled - totPaid;
    const totCommitted = rows.reduce((s,r) => s+r.committed, 0);
    const totCO        = rows.reduce((s,r) => s+r.co_value, 0);

    const totRow = ws.addRow([
      '', 'TOTAL',
      v(totBudget), v(totRemBudget), pctVal(totBilled, totBudget),
      v(totCommitted), v(totCO), v(totCommit), pctVal(totBilled, totCommit),
      v(totFixed), v(totTM), v(totExp), v(totBilled),
      v(totAmtDue), v(totPaid),
      perSF(totBilled), perAC(totBilled),
      '', '', '', '',
    ]);
    totRow.height = 20;
    totRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font      = font(true, C.white, 10);
      cell.fill      = fill(C.darkBg);
      cell.alignment = { horizontal: col <= 2 ? 'left' : 'right', vertical: 'middle', indent: col <= 2 ? 1 : 0 };
      cell.border    = { top: { style: 'double', color: { argb: 'FF' + C.white } }, bottom: { style: 'medium', color: { argb: 'FF' + C.white } } };
      if (MONEY_COLS.includes(col)) { cell.numFmt = USD0; if (cell.value === 0) cell.value = null; }
      if (PCT_COLS.includes(col))   { cell.numFmt = PCT;  if (cell.value === 0) cell.value = null; }
    });

    // ── Column widths ─────────────────────────────────────────────────────────
    ws.columns = [
      { width: 10 },  // Acct #
      { width: 44 },  // Task / Description
      { width: 13 },  // Budgeted
      { width: 13 },  // Rem. Budget
      { width: 8  },  // Rem. %
      { width: 13 },  // Contracted
      { width: 9  },  // COs
      { width: 13 },  // Total Commit
      { width: 8  },  // Rem. %
      { width: 11 },  // Fixed
      { width: 11 },  // T&M
      { width: 11 },  // Expense
      { width: 13 },  // Billed
      { width: 11 },  // Amt Due
      { width: 11 },  // Paid
      { width: 9  },  // $/SF
      { width: 9  },  // $/AC
      { width: 22 },  // QB Codes Used
      { width: 14 },  // Calc Method
      { width: 18 },  // Consultant
      { width: 30 },  // Notes
    ];

    // ── Stream workbook to response ──────────────────────────────────────────
    const filename = `${phaseRow.project_name} - ${phaseRow.phase_name} Budget.xlsx`
      .replace(/[/\\?%*:|"<>]/g, '-');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
  } catch (err) { next(err); }
});

module.exports = router;
