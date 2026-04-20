// GET /api/alerts — contracts being over-invoiced vs initial and/or approaching budget limits.

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Severity tiers for "banging us out" (invoiced > initial contract)
function overInitialSeverity(pct) {
  if (pct <= 0)   return null;
  if (pct < 10)   return 'low';       // 1–10%
  if (pct < 25)   return 'moderate';  // 10–25%
  if (pct < 50)   return 'high';      // 25–50%
  return 'critical';                   // 50%+
}

// Severity tiers for budget pressure (commitment vs earmarked / internal budget)
function budgetSeverity(pct) {
  if (pct < 75)  return null;
  if (pct < 90)  return 'low';
  if (pct < 100) return 'moderate';
  if (pct < 110) return 'high';
  return 'critical';
}

router.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;

    // Check admin
    const adminCheck = await pool.query(`SELECT role FROM users WHERE id = $1`, [userId]);
    const isAdmin = adminCheck.rows[0]?.role === 'admin';

    const accessClause = isAdmin
      ? '1=1'
      : `p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})`;

    const result = await pool.query(`
      SELECT
        c.id,
        c.vendor_name,
        c.description,
        c.total_value,
        c.earmarked_amount,
        c.status,
        p.id   AS project_id,
        p.name AS project_name,
        COALESCE(inv.invoiced_amount, 0) AS invoiced_amount,
        COALESCE(co.co_total,  0) AS co_total,
        COALESCE(tm.tm_total,  0) AS tm_total,
        COALESCE(ex.exp_total, 0) AS exp_total
      FROM contracts c
      JOIN projects p ON p.id = c.project_id
      LEFT JOIN (
        SELECT contract_id, SUM(amount) AS invoiced_amount
        FROM invoices
        WHERE status IN ('approved','pushed','paid')
        GROUP BY contract_id
      ) inv ON inv.contract_id = c.id
      LEFT JOIN (
        SELECT contract_id, SUM(amount) AS co_total
        FROM change_orders
        WHERE status = 'approved'
        GROUP BY contract_id
      ) co ON co.contract_id = c.id
      LEFT JOIN (
        SELECT contract_id, SUM(amount) AS tm_total
        FROM tm_charges
        WHERE status = 'approved'
        GROUP BY contract_id
      ) tm ON tm.contract_id = c.id
      LEFT JOIN (
        SELECT contract_id, SUM(amount) AS exp_total
        FROM contract_expenses
        WHERE status = 'approved'
        GROUP BY contract_id
      ) ex ON ex.contract_id = c.id
      WHERE ${accessClause}
        AND c.status != 'closed'
      ORDER BY p.name, c.vendor_name
    `);

    const flags = [];

    for (const row of result.rows) {
      const invoiced    = parseFloat(row.invoiced_amount) || 0;
      const initial     = parseFloat(row.total_value) || 0;
      const earmarked   = parseFloat(row.earmarked_amount) || 0;
      const commitment  = invoiced
        + (parseFloat(row.co_total)  || 0)
        + (parseFloat(row.tm_total)  || 0)
        + (parseFloat(row.exp_total) || 0);

      // Over-invoiced vs initial contract ("banging us out")
      const overInitialAmt = initial > 0 ? invoiced - initial : 0;
      const overInitialPct = initial > 0 ? (overInitialAmt / initial) * 100 : 0;
      const oisev = overInitialSeverity(overInitialPct);

      // Commitment vs internal budget
      const budgetUsedPct = earmarked > 0 ? (commitment / earmarked) * 100 : 0;
      const bsev = earmarked > 0 ? budgetSeverity(budgetUsedPct) : null;

      if (oisev || bsev) {
        flags.push({
          contract_id:       row.id,
          vendor_name:       row.vendor_name,
          description:       row.description,
          project_id:        row.project_id,
          project_name:      row.project_name,
          total_value:       initial,
          earmarked_amount:  earmarked,
          invoiced_amount:   invoiced,
          commitment:        commitment,
          // over-initial
          over_initial_amt:  overInitialAmt,
          over_initial_pct:  Math.round(overInitialPct * 10) / 10,
          over_initial_sev:  oisev,
          // budget
          budget_used_pct:   Math.round(budgetUsedPct * 10) / 10,
          budget_sev:        bsev,
        });
      }
    }

    // Roll up project-level budget danger
    const projectMap = {};
    for (const f of flags) {
      const pid = f.project_id;
      if (!projectMap[pid]) {
        projectMap[pid] = {
          project_id:   pid,
          project_name: f.project_name,
          flagged_count: 0,
          worst_sev:    null,
        };
      }
      projectMap[pid].flagged_count++;
      const sevOrder = ['low','moderate','high','critical'];
      const cur  = sevOrder.indexOf(projectMap[pid].worst_sev);
      const next = sevOrder.indexOf(f.over_initial_sev || f.budget_sev);
      if (next > cur) projectMap[pid].worst_sev = f.over_initial_sev || f.budget_sev;
    }

    res.json({
      contract_flags:  flags,
      project_summary: Object.values(projectMap),
    });
  } catch (err) { next(err); }
});

module.exports = router;
