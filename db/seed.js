#!/usr/bin/env node
// Seeds the database with:
//   1. Placeholder QB codes (WAITING ON real chart of accounts from Calev/Seth)
//   2. A demo admin user
//   3. Optional sample project with budget/contracts/invoices for demoing
//
// Safe to re-run: uses ON CONFLICT DO NOTHING on the static data.
//
// When the real QB chart of accounts arrives, replace PLACEHOLDER_QB_CODES
// below with the real hierarchy and re-run `npm run seed`.

const bcrypt = require('bcryptjs');
const pool = require('./pool');

// -----------------------------------------------------------------------------
// PLACEHOLDER QB CODES
// Replace with real chart of accounts from Seth/Calev when available.
// Each node may have children; level is computed automatically.
// -----------------------------------------------------------------------------
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

async function seedQbCodes(client) {
  const existing = await client.query('SELECT COUNT(*)::int AS n FROM qb_codes');
  if (existing.rows[0].n > 0) {
    console.log(`QB codes already present (${existing.rows[0].n}). Skipping.`);
    return;
  }

  async function insert(node, parentId, level) {
    const res = await client.query(
      `INSERT INTO qb_codes (code, name, parent_id, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [node.code, node.name, parentId, level]
    );
    const id = res.rows[0].id;
    if (node.children) {
      for (const child of node.children) await insert(child, id, level + 1);
    }
  }

  for (const top of PLACEHOLDER_QB_CODES) await insert(top, null, 0);
  console.log('Seeded placeholder QB codes.');
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

async function seedDemoPm(client) {
  const email = 'pm@activeacq.local';
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const hash = await bcrypt.hash('password', 10);
  const res = await client.query(
    `INSERT INTO users (name, email, role, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Demo PM', email, 'pm', hash]
  );
  console.log(`Created demo PM: ${email} / password`);
  return res.rows[0].id;
}

async function seedDemoProject(client, pmUserId) {
  const existing = await client.query(
    `SELECT id FROM projects WHERE name = 'Demo Acquisition' AND created_by = $1`, [pmUserId]
  );
  if (existing.rows.length > 0) {
    console.log('Demo project already present. Skipping demo data.');
    return;
  }

  const project = await client.query(
    `INSERT INTO projects (name, description, status, created_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Demo Acquisition', 'Sample project for demoing the app', 'active', pmUserId]
  );
  const projectId = project.rows[0].id;

  await client.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'pm')`,
    [projectId, pmUserId]
  );

  // Create budget lines on leaf codes.
  const leaves = await client.query(
    `SELECT c.id, c.code FROM qb_codes c
     WHERE NOT EXISTS (SELECT 1 FROM qb_codes k WHERE k.parent_id = c.id)`
  );
  for (const row of leaves.rows) {
    const amount = 10_000 + Math.floor(Math.random() * 90_000);
    await client.query(
      `INSERT INTO budget_lines (project_id, qb_code_id, original_amount, current_amount)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT DO NOTHING`,
      [projectId, row.id, amount]
    );
  }
  console.log(`Seeded ${leaves.rows.length} demo budget lines for "Demo Acquisition".`);

  // One sample contract on code 6110 + 6210.
  const laborCode = await client.query(`SELECT id FROM qb_codes WHERE code = '6110'`);
  const materialsCode = await client.query(`SELECT id FROM qb_codes WHERE code = '6210'`);
  if (laborCode.rows[0] && materialsCode.rows[0]) {
    const contract = await client.query(
      `INSERT INTO contracts
          (project_id, vendor_name, description, total_value, contract_date, status, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'active', $5) RETURNING id`,
      [projectId, 'Acme Construction', 'Framing subcontract', 50_000, pmUserId]
    );
    const cid = contract.rows[0].id;
    await client.query(
      `INSERT INTO contract_lines (contract_id, qb_code_id, amount) VALUES ($1, $2, $3)`,
      [cid, laborCode.rows[0].id, 30_000]
    );
    await client.query(
      `INSERT INTO contract_lines (contract_id, qb_code_id, amount) VALUES ($1, $2, $3)`,
      [cid, materialsCode.rows[0].id, 20_000]
    );

    await client.query(
      `INSERT INTO invoices
         (contract_id, invoice_number, vendor_name, amount, invoice_date,
          description, status, created_by, approved_by, approved_at)
       VALUES ($1, 'INV-001', 'Acme Construction', 15000, CURRENT_DATE,
               'First progress invoice', 'approved', $2, $2, NOW())`,
      [cid, pmUserId]
    );
    console.log('Seeded sample contract + invoice.');
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedQbCodes(client);
    await seedAdminUser(client);
    const pmId = await seedDemoPm(client);
    await seedDemoProject(client, pmId);
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
