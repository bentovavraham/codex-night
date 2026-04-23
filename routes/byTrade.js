const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/by-trade?status=active,closed
// Returns all contract lines grouped by QB code → project → contract, across all accessible projects.
router.get('/by-trade', requireAuth, async (req, res, next) => {
  try {
    const userId  = req.session.userId;
    const roleRes = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    const isAdmin = roleRes.rows[0]?.role === 'admin';

    // Optional project status filter — comma-separated e.g. "active,closed"
    const rawStatus = req.query.status;
    const statuses  = rawStatus
      ? rawStatus.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Build WHERE clauses
    const accessClause = isAdmin
      ? '1=1'
      : `p.id IN (SELECT project_id FROM project_members WHERE user_id = ${Number(userId)})`;

    const statusClause = statuses.length > 0
      ? `AND p.status = ANY(ARRAY[${statuses.map((_, i) => `$${i + 1}`).join(',')}])`
      : '';

    const params = statuses;

    const result = await pool.query(`
      WITH accessible AS (
        SELECT p.id AS project_id, p.name AS project_name, p.status AS project_status
        FROM projects p
        WHERE ${accessClause} ${statusClause}
      ),
      contract_data AS (
        SELECT
          cl.qb_code_id,
          c.project_id,
          a.project_name,
          a.project_status,
          c.id                AS contract_id,
          c.vendor_name,
          c.description       AS contract_description,
          c.earmarked_amount,
          c.total_value,
          c.contract_date,
          c.reference_number,
          c.status            AS contract_status,
          cl.amount           AS cl_amount,
          COALESCE(co.co_total,       0) AS co_total,
          COALESCE(inv_fixed.invoiced, 0) AS invoiced_fixed,
          COALESCE(inv_tm.tm_total,   0) AS tm_total,
          COALESCE(inv_exp.exp_total, 0) AS exp_total
        FROM contract_lines cl
        JOIN contracts c ON c.id = cl.contract_id
        JOIN accessible a ON a.project_id = c.project_id
        LEFT JOIN (
          SELECT contract_id, SUM(amount) AS co_total
          FROM change_orders WHERE status = 'approved'
          GROUP BY contract_id
        ) co ON co.contract_id = c.id
        LEFT JOIN (
          SELECT contract_id, SUM(amount) AS invoiced
          FROM invoices
          WHERE status IN ('approved','pushed','paid')
            AND COALESCE(invoice_type,'fixed') = 'fixed'
          GROUP BY contract_id
        ) inv_fixed ON inv_fixed.contract_id = c.id
        LEFT JOIN (
          SELECT contract_id, SUM(amount) AS tm_total
          FROM invoices
          WHERE status IN ('approved','pushed','paid') AND invoice_type = 'tm'
          GROUP BY contract_id
        ) inv_tm ON inv_tm.contract_id = c.id
        LEFT JOIN (
          SELECT contract_id, SUM(amount) AS exp_total
          FROM invoices
          WHERE status IN ('approved','pushed','paid') AND invoice_type = 'expense'
          GROUP BY contract_id
        ) inv_exp ON inv_exp.contract_id = c.id
      )
      SELECT
        cd.qb_code_id,
        cd.project_id,
        cd.project_name,
        cd.project_status,
        q.code,
        q.name,
        q.parent_id,
        q.level,
        q2.code  AS parent_code,
        q2.name  AS parent_name,
        SUM(cd.cl_amount)                               AS contracted,
        SUM(cd.co_total)                                AS co_total,
        SUM(cd.invoiced_fixed)                          AS invoiced_fixed,
        SUM(cd.tm_total)                                AS tm_total,
        SUM(cd.exp_total)                               AS exp_total,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'contract_id',        cd.contract_id,
            'vendor_name',        cd.vendor_name,
            'description',        cd.contract_description,
            'earmarked_amount',   cd.earmarked_amount,
            'total_value',        cd.total_value,
            'contract_date',      cd.contract_date,
            'reference_number',   cd.reference_number,
            'contract_status',    cd.contract_status,
            'cl_amount',          cd.cl_amount,
            'co_total',           cd.co_total,
            'invoiced_fixed',     cd.invoiced_fixed,
            'tm_total',           cd.tm_total,
            'exp_total',          cd.exp_total
          ) ORDER BY cd.vendor_name
        ) AS contracts
      FROM contract_data cd
      JOIN qb_codes q  ON q.id  = cd.qb_code_id
      LEFT JOIN qb_codes q2 ON q2.id = q.parent_id
      GROUP BY cd.qb_code_id, cd.project_id, cd.project_name, cd.project_status,
               q.code, q.name, q.parent_id, q.level, q2.code, q2.name
      ORDER BY q.code ASC, cd.project_name ASC
    `, params);

    // Reshape flat rows into: qb_code → projects[] → contracts[]
    const tradeMap = new Map();

    for (const row of result.rows) {
      const qbId = row.qb_code_id;

      if (!tradeMap.has(qbId)) {
        tradeMap.set(qbId, {
          qb_code_id:  qbId,
          code:        row.code,
          name:        row.name,
          parent_id:   row.parent_id,
          parent_code: row.parent_code || null,
          parent_name: row.parent_name || null,
          level:       Number(row.level) || 0,
          projects:    [],
          // rolled-up totals populated below
          contracted:    0,
          co_total:      0,
          invoiced_fixed:0,
          tm_total:      0,
          exp_total:     0,
        });
      }

      const trade = tradeMap.get(qbId);

      const contracted    = Number(row.contracted)     || 0;
      const coTotal       = Number(row.co_total)       || 0;
      const invoicedFixed = Number(row.invoiced_fixed) || 0;
      const tmTotal       = Number(row.tm_total)       || 0;
      const expTotal      = Number(row.exp_total)      || 0;
      const commitment    = contracted + coTotal;
      const totalSpent    = invoicedFixed + tmTotal + expTotal;
      const tmExpTotal    = tmTotal + expTotal;

      const contracts = (row.contracts || []).map(c => {
        const tv    = Number(c.total_value)      || 0;
        const co    = Number(c.co_total)         || 0;
        const tm    = Number(c.tm_total)         || 0;
        const exp   = Number(c.exp_total)        || 0;
        const inv   = Number(c.invoiced_fixed)   || 0;
        const earn  = Number(c.earmarked_amount) || 0;
        return {
          ...c,
          total_value:      tv,
          co_total:         co,
          tm_total:         tm,
          exp_total:        exp,
          invoiced_fixed:   inv,
          earmarked_amount: earn,
          commitment:       tv + co,
          total_exposure:   tv + co + tm + exp,
          total_spent:      inv + tm + exp,
          cos:              [],
        };
      });

      trade.projects.push({
        project_id:     row.project_id,
        project_name:   row.project_name,
        project_status: row.project_status,
        contracted,
        co_total:       coTotal,
        invoiced_fixed: invoicedFixed,
        tm_total:       tmTotal,
        exp_total:      expTotal,
        commitment,
        tm_exp_total:   tmExpTotal,
        total_spent:    totalSpent,
        contracts,
      });

      trade.contracted     += contracted;
      trade.co_total       += coTotal;
      trade.invoiced_fixed += invoicedFixed;
      trade.tm_total       += tmTotal;
      trade.exp_total      += expTotal;
    }

    const codes = [...tradeMap.values()].map(t => ({
      ...t,
      commitment:   t.contracted + t.co_total,
      tm_exp_total: t.tm_total + t.exp_total,
      total_spent:  t.invoiced_fixed + t.tm_total + t.exp_total,
    }));

    // Project-level totals (deduplicated by project_id to avoid double-counting projects
    // that appear under multiple QB codes)
    const projectTotals = new Map();
    for (const trade of codes) {
      for (const proj of trade.projects) {
        if (!projectTotals.has(proj.project_id)) {
          projectTotals.set(proj.project_id, { contracted: 0, tm_exp: 0, total_spent: 0 });
        }
        // Don't accumulate here — contract-level dedup below handles this
      }
    }

    const contractTotals = new Map();
    for (const trade of codes) {
      for (const proj of trade.projects) {
        for (const c of proj.contracts) {
          if (!contractTotals.has(c.contract_id)) {
            contractTotals.set(c.contract_id, c);
          }
        }
      }
    }

    const totals = {
      contracted:  0,
      tm_exp_total: 0,
      total_spent:  0,
    };
    for (const c of contractTotals.values()) {
      totals.contracted   += c.commitment;
      totals.tm_exp_total += c.tm_total + c.exp_total;
      totals.total_spent  += c.total_spent;
    }

    // Collect distinct project statuses for filter UI
    const projectStatuses = [...new Set(
      codes.flatMap(t => t.projects.map(p => p.project_status)).filter(Boolean)
    )].sort();

    res.json({ codes, totals, projectStatuses });
  } catch (err) { next(err); }
});

module.exports = router;
