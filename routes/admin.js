// Token-gated admin endpoints for one-shot operations you'd otherwise
// run from a shell. Protected by the SEED_TOKEN env var — if unset, these
// endpoints are disabled entirely.

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

const router = express.Router();

function requireToken(req, res, next) {
  const expected = process.env.SEED_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Admin endpoints disabled (SEED_TOKEN unset)' });
  }
  const got = req.header('x-seed-token') || req.query.token || req.body?.token;
  if (got !== expected) return res.status(401).json({ error: 'Invalid seed token' });
  next();
}

// Placeholder codes — replace when real chart of accounts arrives. Kept in
// sync with db/seed.js so either path seeds the same data.
const PLACEHOLDER_QB_CODES = [
  { code: '5000', name: 'Pre-Development', children: [
    { code: '5100', name: 'Due Diligence' },
    { code: '5200', name: 'Legal / Closing Costs' },
    { code: '5300', name: 'Surveys & Inspections' },
  ]},
  { code: '6000', name: 'Direct Construction Costs', children: [
    { code: '6100', name: 'Labor', children: [
      { code: '6110', name: 'General Labor' },
      { code: '6120', name: 'Subcontracted Labor' },
    ]},
    { code: '6200', name: 'Materials', children: [
      { code: '6210', name: 'Lumber & Framing' },
      { code: '6220', name: 'Finishes' },
      { code: '6230', name: 'Fixtures' },
    ]},
    { code: '6300', name: 'Equipment Rental' },
    { code: '6400', name: 'Site Work' },
  ]},
  { code: '7000', name: 'Soft Costs', children: [
    { code: '7100', name: 'Architecture & Engineering' },
    { code: '7200', name: 'Permits & Fees' },
    { code: '7300', name: 'Insurance' },
  ]},
  { code: '8000', name: 'Financing', children: [
    { code: '8100', name: 'Loan Fees' },
    { code: '8200', name: 'Interest Reserve' },
  ]},
  { code: '9000', name: 'Contingency' },
];

// GET /api/admin/status — quick visibility into what's in the DB.
router.get('/status', requireToken, async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM qb_codes)::int AS qb_codes,
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM projects)::int AS projects,
        (SELECT COUNT(*) FROM budget_lines)::int AS budget_lines,
        (SELECT COUNT(*) FROM contracts)::int AS contracts,
        (SELECT COUNT(*) FROM invoices)::int AS invoices
    `);
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/admin/seed-qb-codes — seed placeholder codes if table is empty.
router.post('/seed-qb-codes', requireToken, async (_req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT COUNT(*)::int AS n FROM qb_codes');
    if (existing.rows[0].n > 0) {
      await client.query('ROLLBACK');
      return res.json({ seeded: false, message: `Already ${existing.rows[0].n} codes present.` });
    }
    async function insert(node, parentId, level) {
      const r = await client.query(
        `INSERT INTO qb_codes (code, name, parent_id, level)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [node.code, node.name, parentId, level]
      );
      const id = r.rows[0].id;
      for (const c of node.children || []) await insert(c, id, level + 1);
    }
    for (const top of PLACEHOLDER_QB_CODES) await insert(top, null, 0);
    await client.query('COMMIT');
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM qb_codes');
    res.json({ seeded: true, count: count.rows[0].n });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/admin/create-user — create or reset a user account.
// Body: { name, email, password, role? }
router.post('/create-user', requireToken, async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, password required' });
    }
    const validRoles = ['pm', 'admin', 'bookkeeper'];
    const resolvedRole = validRoles.includes(role) ? role : 'pm';
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, role, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name,
             role = EXCLUDED.role,
             password_hash = EXCLUDED.password_hash
       RETURNING id, name, email, role, created_at`,
      [name, String(email).toLowerCase(), resolvedRole, hash]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/admin/reset-password — convenience for when you forget the admin pw.
// Body: { email, new_password }
router.post('/reset-password', requireToken, async (req, res, next) => {
  try {
    const { email, new_password } = req.body || {};
    if (!email || !new_password) return res.status(400).json({ error: 'email and new_password required' });
    const hash = await bcrypt.hash(new_password, 10);
    const result = await pool.query(
      `UPDATE users SET password_hash = $2 WHERE email = $1
       RETURNING id, name, email, role`,
      [String(email).toLowerCase(), hash]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, user: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
