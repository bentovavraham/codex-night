// Token-gated admin endpoints for one-shot operations you'd otherwise
// run from a shell. Protected by the SEED_TOKEN env var — if unset, these
// endpoints are disabled entirely.

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { insertRealCodes, insertQbAccounts } = require('../db/qb-codes');

const router = express.Router();

// Accept either a valid SEED_TOKEN or a logged-in admin session.
// SEED_TOKEN is still needed for the initial bootstrap (before any admin user
// exists), but once you're logged in as an admin, the same endpoints are
// reachable from the app UI with no token at all.
function requireToken(req, res, next) {
  // Session-admin path (preferred).
  if (req.session?.userId && req.session?.role === 'admin') return next();

  // Token path.
  const expected = process.env.SEED_TOKEN;
  if (expected) {
    const got = req.header('x-seed-token') || req.query.token || req.body?.token;
    if (got === expected) return next();
  }
  if (req.session?.userId) return res.status(403).json({ error: 'Admin role required' });
  return res.status(401).json({ error: 'Authentication required (log in as admin, or provide x-seed-token)' });
}

// GET /api/admin/status — quick visibility into what's in the DB.
router.get('/status', requireToken, async (_req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM qb_codes)::int   AS qb_codes,
        (SELECT COUNT(*) FROM qb_accounts)::int AS qb_accounts,
        (SELECT COUNT(*) FROM users)::int      AS users,
        (SELECT COUNT(*) FROM projects)::int   AS projects,
        (SELECT COUNT(*) FROM budget_lines)::int AS budget_lines,
        (SELECT COUNT(*) FROM contracts)::int  AS contracts,
        (SELECT COUNT(*) FROM invoices)::int   AS invoices,
        (SELECT COUNT(*) FROM vendors)::int    AS vendors,
        (SELECT COUNT(*) FROM customers)::int  AS customers
    `);
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/admin/replace-qb-codes
// Body: { force: true } — required. Wipes ALL projects + all QB codes and
// re-seeds from the real chart in db/qb-codes.js.
//
// Use this to swap from placeholder codes (or from an older snapshot) to the
// real chart. It cascades: projects → budgets, contracts, invoices all go.
// Users and vendors/customers are preserved.
router.post('/replace-qb-codes', requireToken, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (req.body?.force !== true) {
      return res.status(400).json({
        error: 'This wipes all projects, budgets, contracts, and invoices. Send { "force": true } to confirm.',
      });
    }
    await client.query('BEGIN');

    // Projects cascade to members, budget_lines (and their logs), contracts
    // (and their lines), invoices — see schema.sql FK ON DELETE CASCADE.
    const delProjects = await client.query('DELETE FROM projects RETURNING id');
    // Budget logs cascade via budget_lines; the only remaining direct FK
    // into qb_codes is through budget_lines and contract_lines which are
    // already gone. Safe to drop codes.
    const delCodes = await client.query('DELETE FROM qb_codes RETURNING id');

    const inserted = await insertRealCodes(client);

    await client.query('COMMIT');
    res.json({
      replaced: true,
      projects_deleted: delProjects.rows.length,
      codes_deleted: delCodes.rows.length,
      codes_inserted: inserted,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/admin/import-vendors
// Body: { vendors: [{ name, qb_id? }, ...], replace?: boolean }
// Upserts by name. If replace=true, deletes all vendors first.
router.post('/import-vendors', requireToken, async (req, res, next) => {
  return bulkImport(req, res, next, 'vendors');
});

// POST /api/admin/import-customers — same shape as import-vendors.
router.post('/import-customers', requireToken, async (req, res, next) => {
  return bulkImport(req, res, next, 'customers');
});

async function bulkImport(req, res, next, table) {
  const bodyKey = table; // { vendors: [...] } or { customers: [...] }
  const rows = Array.isArray(req.body?.[bodyKey]) ? req.body[bodyKey] : null;
  if (!rows) return res.status(400).json({ error: `${bodyKey} array required in body` });
  const replace = req.body?.replace === true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (replace) await client.query(`DELETE FROM ${table}`);
    let inserted = 0;
    for (const row of rows) {
      const name = (row?.name || '').trim();
      if (!name) continue;
      await client.query(
        `INSERT INTO ${table} (name, qb_id) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET qb_id = COALESCE(EXCLUDED.qb_id, ${table}.qb_id)`,
        [name, row.qb_id || null]
      );
      inserted++;
    }
    await client.query('COMMIT');
    const count = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    res.json({ imported: inserted, total: count.rows[0].n, replaced: replace });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/admin/create-user — create or reset a user account.
// Body: { name, email, password, role? }
router.post('/create-user', requireToken, async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, password required' });
    }
    const validRoles = ['pm', 'partner', 'admin', 'bookkeeper'];
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

// (Old /seed-qb-codes endpoint kept for backwards compat: it now seeds both
// legacy qb_codes and the newer qb_accounts table used by phase budgets.)
router.post('/seed-qb-codes', requireToken, async (_req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT COUNT(*)::int AS n FROM qb_codes');
    const existingAccounts = await client.query('SELECT COUNT(*)::int AS n FROM qb_accounts');
    if (existing.rows[0].n > 0) {
      const accountsInserted = await insertQbAccounts(client);
      await client.query('COMMIT');
      return res.json({
        seeded: false,
        qb_codes: existing.rows[0].n,
        qb_accounts_before: existingAccounts.rows[0].n,
        qb_accounts_upserted: accountsInserted,
        message: `Already ${existing.rows[0].n} legacy codes present. Refreshed qb_accounts.`,
      });
    }
    const inserted = await insertRealCodes(client);
    const accountsInserted = await insertQbAccounts(client);
    await client.query('COMMIT');
    res.json({ seeded: true, qb_codes_inserted: inserted, qb_accounts_upserted: accountsInserted });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
