// GET /api/alerts — three alert types:
//   1. "Change Order Creep" — COs have significantly grown the contract beyond initial scope
//   2. "Overbilled"      — vendor has invoiced more than the initial contract amount
//   3. "Budget Pressure" — total exposure approaching or exceeding internal budget

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Severity tiers — shared by scope creep and overbilled (both measured as % above initial)
function overageSeverity(pct) {
  if (pct <= 0)  return null;
  if (pct < 10)  return 'low';       // 1–10%
  if (pct < 25)  return 'moderate';  // 10–25%
  if (pct < 50)  return 'high';      // 25–50%
  return 'critical';                  // 50%+
}

// Severity tiers for budget pressure (total exposure vs earmarked)
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
          AND COALESCE(invoice_type, 'fixed') = 'fixed'
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
      const invoiced      = parseFloat(row.invoiced_amount) || 0;
      const initial       = parseFloat(row.total_value) || 0;
      const earmarked     = parseFloat(row.earmarked_amount) || 0;
      const coTotal       = parseFloat(row.co_total) || 0;
      // Commitment = initial + approved COs (legal obligation)
      const commitment    = initial + coTotal;
      // Total Exposure = commitment + approved T&M + approved expenses
      const totalExposure = commitment
        + (parseFloat(row.tm_total)  || 0)
        + (parseFloat(row.exp_total) || 0);

      // ── 1. Change Order Creep: COs have inflated the commitment beyond initial scope ──
      const scopeCreepAmt = initial > 0 ? coTotal : 0;
      const scopeCreepPct = initial > 0 ? (scopeCreepAmt / initial) * 100 : 0;
      const scopeSev      = overageSeverity(scopeCreepPct);

      // ── 2. Overbilled: vendor invoiced more than the initial contract ──
      const overbilledAmt = initial > 0 ? invoiced - initial : 0;
      const overbilledPct = initial > 0 ? (overbilledAmt / initial) * 100 : 0;
      const overbilledSev = overageSeverity(overbilledPct);

      // ── 3. Budget Pressure: total exposure vs internal budget ──
      const budgetUsedPct = earmarked > 0 ? (totalExposure / earmarked) * 100 : 0;
      const budgetSev     = earmarked > 0 ? budgetSeverity(budgetUsedPct) : null;

      if (scopeSev || overbilledSev || budgetSev) {
        flags.push({
          contract_id:      row.id,
          vendor_name:      row.vendor_name,
          description:      row.description,
          project_id:       row.project_id,
          project_name:     row.project_name,
          total_value:      initial,
          earmarked_amount: earmarked,
          invoiced_amount:  invoiced,
          commitment,
          total_exposure:   totalExposure,
          // change order creep (COs inflating commitment)
          scope_creep_amt:  scopeCreepAmt,
          scope_creep_pct:  Math.round(scopeCreepPct * 10) / 10,
          scope_creep_sev:  scopeSev,
          // overbilled (invoiced > initial)
          overbilled_amt:   overbilledAmt,
          overbilled_pct:   Math.round(overbilledPct * 10) / 10,
          overbilled_sev:   overbilledSev,
          // budget pressure
          budget_used_pct:  Math.round(budgetUsedPct * 10) / 10,
          budget_sev:       budgetSev,
        });
      }
    }

    // Roll up worst severity per project across all alert types
    const projectMap = {};
    const sevOrder = ['low','moderate','high','critical'];
    for (const f of flags) {
      const pid = f.project_id;
      if (!projectMap[pid]) {
        projectMap[pid] = { project_id: pid, project_name: f.project_name, flagged_count: 0, worst_sev: null };
      }
      projectMap[pid].flagged_count++;
      const worstOfFlag = [f.scope_creep_sev, f.overbilled_sev, f.budget_sev]
        .filter(Boolean)
        .sort((a, b) => sevOrder.indexOf(b) - sevOrder.indexOf(a))[0] || null;
      const cur  = sevOrder.indexOf(projectMap[pid].worst_sev);
      const next = sevOrder.indexOf(worstOfFlag);
      if (next > cur) projectMap[pid].worst_sev = worstOfFlag;
    }

    res.json({
      contract_flags:  flags,
      project_summary: Object.values(projectMap),
    });
  } catch (err) { next(err); }
});

module.exports = router;
