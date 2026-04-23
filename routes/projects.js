const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Helper: is the current user a member of the project?
async function userInProject(userId, projectId) {
  const r = await pool.query(
    'SELECT 1 FROM project_members WHERE user_id = $1 AND project_id = $2 LIMIT 1',
    [userId, projectId]
  );
  return r.rows.length > 0;
}

async function userIsAdmin(userId) {
  const r = await pool.query(`SELECT role FROM users WHERE id = $1`, [userId]);
  return r.rows[0]?.role === 'admin';
}

// Expose helper for other routers.
router.userCanAccess = async function (userId, projectId) {
  if (await userInProject(userId, projectId)) return true;
  return await userIsAdmin(userId);
};

// GET /api/projects/health — all projects with financial health summary
// Must be declared before /:id to avoid "health" being captured as an id.
router.get('/health', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const isAdmin = await userIsAdmin(userId);
    const accessClause = isAdmin
      ? '1=1'
      : `p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})`;

    const result = await pool.query(`
      SELECT
        p.id, p.name, p.description, p.status, p.updated_at, p.created_at,
        COALESCE(c_stats.active_contracts, 0)    AS active_contracts,
        COALESCE(c_stats.total_earmarked, 0)     AS total_earmarked,
        COALESCE(c_stats.total_contract_value, 0) AS total_contract_value,
        COALESCE(co_stats.co_approved, 0)        AS co_approved,
        COALESCE(co_stats.co_pending_count, 0)   AS pending_cos,
        COALESCE(inv_stats.tm_approved, 0)       AS tm_approved,
        COALESCE(inv_stats.exp_approved, 0)      AS exp_approved,
        COALESCE(inv_stats.invoiced, 0)          AS invoiced,
        COALESCE(inv_stats.invoiced_fixed, 0)    AS invoiced_fixed,
        COALESCE(inv_stats.paid, 0)              AS paid,
        COALESCE(inv_stats.pending_count, 0)     AS pending_invoices
      FROM projects p

      LEFT JOIN (
        SELECT project_id,
          COUNT(*) FILTER (WHERE status != 'closed')          AS active_contracts,
          SUM(earmarked_amount) FILTER (WHERE status != 'closed') AS total_earmarked,
          SUM(total_value) FILTER (WHERE status != 'closed')  AS total_contract_value
        FROM contracts GROUP BY project_id
      ) c_stats ON c_stats.project_id = p.id

      LEFT JOIN (
        SELECT c.project_id,
          COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'approved'), 0) AS co_approved,
          COUNT(*) FILTER (WHERE co.status = 'pending') AS co_pending_count
        FROM change_orders co JOIN contracts c ON c.id = co.contract_id
        GROUP BY c.project_id
      ) co_stats ON co_stats.project_id = p.id

      LEFT JOIN (
        SELECT c.project_id,
          COALESCE(SUM(i.amount) FILTER (WHERE i.status IN ('approved','pushed','paid') AND COALESCE(i.invoice_type,'fixed') = 'fixed'), 0) AS invoiced_fixed,
          COALESCE(SUM(i.amount) FILTER (WHERE i.status IN ('approved','pushed','paid') AND i.invoice_type = 'tm'), 0)      AS tm_approved,
          COALESCE(SUM(i.amount) FILTER (WHERE i.status IN ('approved','pushed','paid') AND i.invoice_type = 'expense'), 0) AS exp_approved,
          COALESCE(SUM(i.amount) FILTER (WHERE i.status IN ('approved','pushed','paid')), 0) AS invoiced,
          COALESCE(SUM(i.amount) FILTER (WHERE i.status = 'paid'), 0) AS paid,
          COUNT(*) FILTER (WHERE i.status = 'pending') AS pending_count
        FROM invoices i JOIN contracts c ON c.id = i.contract_id
        GROUP BY c.project_id
      ) inv_stats ON inv_stats.project_id = p.id

      WHERE ${accessClause}
      ORDER BY p.updated_at DESC
    `);

    // Compute derived fields server-side so the client doesn't need to
    const rows = result.rows.map(r => {
      const commitment   = Number(r.total_contract_value) + Number(r.co_approved);
      const totalExposure = commitment + Number(r.tm_approved) + Number(r.exp_approved);
      const earmarked    = Number(r.total_earmarked) || 0;
      const budgetUsedPct = earmarked > 0 ? (totalExposure / earmarked) * 100 : null;
      const buffer       = earmarked > 0 ? earmarked - totalExposure : null;
      let health = 'none'; // no earmark set
      if (budgetUsedPct !== null) {
        if (budgetUsedPct >= 100) health = 'danger';
        else if (budgetUsedPct >= 90) health = 'warning';
        else if (budgetUsedPct >= 75) health = 'caution';
        else health = 'ok';
      }
      return { ...r, commitment, total_exposure: totalExposure, budget_used_pct: budgetUsedPct, buffer, health };
    });

    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/projects — projects current user is a member of (or all if admin)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const isAdmin = await userIsAdmin(req.session.userId);
    const query = isAdmin
      ? `SELECT p.* FROM projects p ORDER BY p.updated_at DESC`
      : `SELECT p.* FROM projects p
         JOIN project_members m ON m.project_id = p.id
         WHERE m.user_id = $1
         ORDER BY p.updated_at DESC`;
    const params = isAdmin ? [] : [req.session.userId];
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/projects — creator becomes PM member
router.post('/', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO projects (name, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, description || null, req.session.userId]
    );
    const project = result.rows[0];
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'pm')`,
      [project.id, req.session.userId]
    );
    await client.query('COMMIT');
    res.status(201).json(project);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/projects/:id — includes members
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await router.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const project = await pool.query('SELECT * FROM projects WHERE id = $1', [projectId]);
    if (!project.rows[0]) return res.status(404).json({ error: 'Not found' });
    const members = await pool.query(
      `SELECT m.id, m.role, m.added_at, u.id AS user_id, u.name, u.email
       FROM project_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.project_id = $1
       ORDER BY m.added_at ASC`,
      [projectId]
    );
    res.json({ ...project.rows[0], members: members.rows });
  } catch (err) { next(err); }
});

// PUT /api/projects/:id
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await router.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { name, description, status } = req.body || {};
    const result = await pool.query(
      `UPDATE projects SET
         name        = COALESCE($2, name),
         description = COALESCE($3, description),
         status      = COALESCE($4, status),
         updated_at  = NOW()
       WHERE id = $1
       RETURNING *`,
      [projectId, name ?? null, description ?? null, status ?? null]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/members
router.post('/:id/members', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await router.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { user_id, role } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const result = await pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [projectId, user_id, role || 'pm']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id/dashboard
// The core aggregation — returns the full QB code hierarchy with:
//   budget_original, budget_current, contracted, approved, paid
//
// "Approved" and "paid" invoice totals are allocated across a contract's
// qb_code_ids in proportion to each contract_line's share of the contract
// total. Parent rows do NOT carry their own budget/contract — they roll up
// from children in the client (or we can return only leaf data and compute
// rollups server-side; we do both: per-code values + precomputed rollups).
// ---------------------------------------------------------------------------
router.get('/:id/dashboard', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await router.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [codesRes, budgetRes, contractedRes, invoicedRes] = await Promise.all([
      pool.query(
        'SELECT id, code, name, parent_id, level FROM qb_codes ORDER BY code ASC'
      ),
      pool.query(
        `SELECT qb_code_id, original_amount, current_amount
         FROM budget_lines WHERE project_id = $1`,
        [projectId]
      ),
      pool.query(
        `SELECT cl.qb_code_id, SUM(cl.amount)::numeric AS total
         FROM contract_lines cl
         JOIN contracts c ON c.id = cl.contract_id
         WHERE c.project_id = $1
         GROUP BY cl.qb_code_id`,
        [projectId]
      ),
      // Pro-rate invoice amount across contract_lines by their share of the contract total.
      pool.query(
        `WITH invs AS (
           SELECT i.id, i.contract_id, i.amount, i.status, i.paid_date
           FROM invoices i
           JOIN contracts c ON c.id = i.contract_id
           WHERE c.project_id = $1
         ),
         contract_totals AS (
           SELECT contract_id, SUM(amount)::numeric AS total
           FROM contract_lines GROUP BY contract_id
         )
         SELECT cl.qb_code_id,
                SUM(
                  CASE WHEN i.status IN ('approved','pushed','paid')
                       THEN i.amount * cl.amount / NULLIF(ct.total, 0)
                       ELSE 0 END
                )::numeric AS approved,
                SUM(
                  CASE WHEN i.status = 'paid'
                       THEN i.amount * cl.amount / NULLIF(ct.total, 0)
                       ELSE 0 END
                )::numeric AS paid
         FROM invs i
         JOIN contract_lines cl  ON cl.contract_id = i.contract_id
         JOIN contract_totals ct ON ct.contract_id = i.contract_id
         GROUP BY cl.qb_code_id`,
        [projectId]
      ),
    ]);

    const budgetByCode = new Map();
    for (const r of budgetRes.rows) {
      budgetByCode.set(r.qb_code_id, {
        original: Number(r.original_amount),
        current: Number(r.current_amount),
      });
    }
    const contractedByCode = new Map();
    for (const r of contractedRes.rows) {
      contractedByCode.set(r.qb_code_id, Number(r.total));
    }
    const invoicedByCode = new Map();
    for (const r of invoicedRes.rows) {
      invoicedByCode.set(r.qb_code_id, {
        approved: Number(r.approved) || 0,
        paid: Number(r.paid) || 0,
      });
    }

    // Build tree with direct values.
    const nodes = new Map();
    for (const c of codesRes.rows) {
      const b = budgetByCode.get(c.id) || { original: 0, current: 0 };
      const i = invoicedByCode.get(c.id) || { approved: 0, paid: 0 };
      nodes.set(c.id, {
        id: c.id,
        code: c.code,
        name: c.name,
        parent_id: c.parent_id,
        level: c.level,
        direct: {
          budget_original: b.original,
          budget_current: b.current,
          contracted: contractedByCode.get(c.id) || 0,
          approved: i.approved,
          paid: i.paid,
        },
        rollup: null,
        children: [],
      });
    }
    const roots = [];
    for (const node of nodes.values()) {
      if (node.parent_id == null) roots.push(node);
      else nodes.get(node.parent_id)?.children.push(node);
    }

    // Compute rollups (sum self + descendants).
    function compute(node) {
      const r = { budget_original: 0, budget_current: 0, contracted: 0, approved: 0, paid: 0 };
      for (const k of Object.keys(r)) r[k] += node.direct[k];
      for (const child of node.children) {
        const cr = compute(child);
        for (const k of Object.keys(r)) r[k] += cr[k];
      }
      node.rollup = r;
      return r;
    }
    for (const root of roots) compute(root);

    res.json({ project_id: projectId, roots });
  } catch (err) { next(err); }
});

module.exports = router;
