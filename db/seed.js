#!/usr/bin/env node
// Seeds the database with:
//   1. Real QB chart of accounts (db/qb-codes.js)
//   2. A demo admin user and PM user — only if they don't already exist
//
// Safe to re-run: upserts users, and the code inserter uses ON CONFLICT. It
// WON'T re-seed codes if any codes are already present; use the admin
// endpoint /api/admin/replace-qb-codes with {force:true} if you need to
// overwrite an existing chart.

const bcrypt = require('bcryptjs');
const pool = require('./pool');
const { insertRealCodes } = require('./qb-codes');

async function seedQbCodes(client) {
  const existing = await client.query('SELECT COUNT(*)::int AS n FROM qb_codes');
  if (existing.rows[0].n > 0) {
    console.log(`QB codes already present (${existing.rows[0].n}). Skipping — use /api/admin/replace-qb-codes to overwrite.`);
    return;
  }
  const n = await insertRealCodes(client);
  console.log(`Seeded ${n} QB codes from the real chart of accounts.`);
}

async function seedAdminUser(client) {
  const email = 'admin@activeacq.local';
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log(`Admin user ${email} already exists (id=${existing.rows[0].id}).`);
    return existing.rows[0].id;
  }
  const hash = await bcrypt.hash('admin', 10);
  const res = await client.query(
    `INSERT INTO users (name, email, role, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Admin', email, 'admin', hash]
  );
  console.log(`Created admin user: ${email} / admin   (change password ASAP)`);
  return res.rows[0].id;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedQbCodes(client);
    await seedAdminUser(client);
    await client.query('COMMIT');
    console.log('Seed complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
