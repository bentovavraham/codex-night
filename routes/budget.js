const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');

const router = express.Router();

// GET /api/projects/:id/budget — all budget lines joined with qb_codes
router.get('/:id/budget', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await pool.query(
      `SELECT bl.id, bl.project_id, bl.qb_code_id, bl.original_amount, bl.current_amount,
              bl.created_at, bl.updated_at,
              q.code, q.name, q.parent_id, q.level
       FROM budget_lines bl
       JOIN qb_codes q ON q.id = bl.qb_code_id
       WHERE bl.project_id = $1
       ORDER BY q.code ASC`,
      [projectId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/budget/initialize
// Body: { lines: [{ qb_code_id, amount }, ...] }
// Creates (or upserts) budget_lines, setting original_amount on creation
// and current_amount on each call. Existing original amounts are preserved.
router.post('/:id/budget/initialize', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (lines.length === 0) return res.status(400).json({ error: 'lines array required' });

    await client.query('BEGIN');
    for (const line of lines) {
      const codeId = Number(line.qb_code_id);
      const amount = Number(line.amount);
      if (!codeId || !Number.isFinite(amount)) continue;
      await client.query(
        `INSERT INTO budget_lines (project_id, qb_code_id, original_amount, current_amount)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (project_id, qb_code_id)
         DO UPDATE SET current_amount = EXCLUDED.current_amount, updated_at = NOW()`,
        [projectId, codeId, amount]
      );
    }
    await client.query('COMMIT');

    const result = await pool.query(
      `SELECT bl.*, q.code, q.name, q.parent_id, q.level
       FROM budget_lines bl JOIN qb_codes q ON q.id = bl.qb_code_id
       WHERE bl.project_id = $1 ORDER BY q.code ASC`,
      [projectId]
    );
    res.status(201).json(result.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/projects/:id/budget-lines/:lineId
// Body: { current_amount, note } — note required; writes budget_line_logs.
router.put('/:id/budget-lines/:lineId', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { current_amount, note } = req.body || {};
    if (current_amount == null) return res.status(400).json({ error: 'current_amount required' });
    if (!note || !String(note).trim()) return res.status(400).json({ error: 'note required on budget edits' });
    const newAmount = Number(current_amount);
    if (!Number.isFinite(newAmount)) return res.status(400).json({ error: 'invalid amount' });

    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM budget_lines WHERE id = $1 AND project_id = $2 FOR UPDATE`,
      [lineId, projectId]
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Budget line not found' });
    }
    const oldAmount = Number(existing.rows[0].current_amount);

    const updated = await client.query(
      `UPDATE budget_lines SET current_amount = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [newAmount, lineId]
    );
    await client.query(
      `INSERT INTO budget_line_logs (budget_line_id, old_amount, new_amount, changed_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [lineId, oldAmount, newAmount, req.session.userId, note]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/projects/:id/budget-lines/:lineId/uncommitted
// Body: { uncommitted_estimate } — PM estimate field, not audited
router.put('/:id/budget-lines/:lineId/uncommitted', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const lineId    = Number(req.params.lineId);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const val = Number(req.body?.uncommitted_estimate);
    if (!Number.isFinite(val)) return res.status(400).json({ error: 'uncommitted_estimate required' });
    const r = await pool.query(
      `UPDATE budget_lines SET uncommitted_estimate = $1, updated_at = NOW()
       WHERE id = $2 AND project_id = $3 RETURNING *`,
      [val, lineId, projectId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/budget/tree — hierarchical budget view
router.get('/:id/budget/tree', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(`
      WITH contract_data AS (
        -- All contract_lines on non-closed contracts for this project, with financials
        SELECT
          cl.qb_code_id,
          cl.amount           AS cl_amount,
          c.id                AS contract_id,
          c.vendor_name,
          c.description,
          c.earmarked_amount,
          c.total_value,
          COALESCE(co.co_total,       0) AS co_total,
          COALESCE(inv_fixed.invoiced, 0) AS invoiced_fixed,
          COALESCE(inv_tm.tm_total,   0) AS tm_total,
          COALESCE(inv_exp.exp_total, 0) AS exp_total
        FROM contract_lines cl
        JOIN contracts c ON c.id = cl.contract_id
          AND c.project_id = $1
          AND c.status != 'closed'
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
      ),
      -- Union of QB codes with budget lines AND QB codes touched by contracts.
      -- This ensures contracts always flow into the tree even with no budget set.
      project_codes AS (
        SELECT qb_code_id FROM budget_lines WHERE project_id = $1
        UNION
        SELECT DISTINCT qb_code_id FROM contract_data
      )
      SELECT
        bl.id                              AS budget_line_id,
        pc.qb_code_id,
        COALESCE(bl.current_amount, 0)     AS budget,
        COALESCE(bl.uncommitted_estimate, 0) AS uncommitted_estimate,
        bl.current_amount IS NULL          AS budget_not_set,
        q.code, q.name, q.parent_id, q.level,
        COALESCE(SUM(cd.cl_amount), 0)     AS contracted,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'contract_id',      cd.contract_id,
            'vendor_name',      cd.vendor_name,
            'description',      cd.description,
            'earmarked_amount', cd.earmarked_amount,
            'total_value',      cd.total_value,
            'cl_amount',        cd.cl_amount,
            'co_total',         cd.co_total,
            'invoiced_fixed',   cd.invoiced_fixed,
            'tm_total',         cd.tm_total,
            'exp_total',        cd.exp_total
          ) ORDER BY cd.vendor_name
        ) FILTER (WHERE cd.contract_id IS NOT NULL) AS contracts
      FROM project_codes pc
      JOIN qb_codes q ON q.id = pc.qb_code_id
      LEFT JOIN budget_lines bl ON bl.qb_code_id = pc.qb_code_id AND bl.project_id = $1
      LEFT JOIN contract_data cd ON cd.qb_code_id = pc.qb_code_id
      GROUP BY bl.id, pc.qb_code_id, bl.current_amount, bl.uncommitted_estimate,
               q.code, q.name, q.parent_id, q.level
      ORDER BY q.code ASC
    `, [projectId]);

    const rows = result.rows.map(r => {
      const budget      = Number(r.budget) || 0;
      const contracted  = Number(r.contracted) || 0;
      const uncommitted = Number(r.uncommitted_estimate) || 0;
      const contracts   = (r.contracts || []).map(c => {
        const tv         = Number(c.total_value) || 0;
        const co         = Number(c.co_total) || 0;
        const tm         = Number(c.tm_total) || 0;
        const exp        = Number(c.exp_total) || 0;
        const earmarked  = Number(c.earmarked_amount) || 0;
        const commitment = tv + co;
        const exposure   = commitment + tm + exp;
        return {
          ...c,
          total_value:      tv,
          co_total:         co,
          tm_total:         tm,
          exp_total:        exp,
          earmarked_amount: earmarked,
          commitment,
          total_exposure:   exposure,
          expected_overage: tv - earmarked,
        };
      });
      const totalExposure = contracted + uncommitted;
      return {
        budget_line_id:       r.budget_line_id,
        qb_code_id:           r.qb_code_id,
        code:                 r.code,
        name:                 r.name,
        parent_id:            r.parent_id,
        level:                Number(r.level) || 0,
        budget,
        budget_not_set:       r.budget_not_set === true,
        contracted,
        uncommitted_estimate: uncommitted,
        expected_overage:     contracted - budget,
        total_exposure:       totalExposure,
        contracts,
      };
    });

    const totals = rows.reduce((acc, r) => ({
      budget:           acc.budget           + r.budget,
      contracted:       acc.contracted       + r.contracted,
      uncommitted:      acc.uncommitted      + r.uncommitted_estimate,
      expected_overage: acc.expected_overage + r.expected_overage,
      total_exposure:   acc.total_exposure   + r.total_exposure,
    }), { budget: 0, contracted: 0, uncommitted: 0, expected_overage: 0, total_exposure: 0 });

    res.json({ codes: rows, totals });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/budget-lines/:lineId/history
router.get('/:id/budget-lines/:lineId/history', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await pool.query(
      `SELECT l.*, u.name AS changed_by_name, u.email AS changed_by_email
       FROM budget_line_logs l
       JOIN users u ON u.id = l.changed_by
       WHERE l.budget_line_id = $1
       ORDER BY l.changed_at DESC`,
      [lineId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
