// Run once: node db/migrate-v3.js
const pool = require('./pool');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Extend projects ───────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS project_type TEXT DEFAULT 'industrial',
        ADD COLUMN IF NOT EXISTS address      TEXT,
        ADD COLUMN IF NOT EXISTS notes        TEXT
    `);

    // ── Phases ────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS phases (
        id           SERIAL PRIMARY KEY,
        project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name         TEXT    NOT NULL,
        phase_number INTEGER,
        status       TEXT    NOT NULL DEFAULT 'active',
        start_date   DATE,
        end_date     DATE,
        notes        TEXT,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_phases_project ON phases(project_id)`);

    // ── QB Accounts (full COA hierarchy) ──────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS qb_accounts (
        id             SERIAL PRIMARY KEY,
        account_number TEXT    NOT NULL UNIQUE,
        full_name      TEXT    NOT NULL,
        short_name     TEXT    NOT NULL,
        parent_id      INTEGER REFERENCES qb_accounts(id),
        category       TEXT    NOT NULL,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        is_leaf        BOOLEAN NOT NULL DEFAULT true,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Phase Budget Lines ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS phase_budget_lines (
        id                  SERIAL PRIMARY KEY,
        phase_id            INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
        qb_account_id       INTEGER NOT NULL REFERENCES qb_accounts(id),
        budgeted_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        notes               TEXT,
        calculation_method  TEXT,
        consultant          TEXT,
        sort_order          INTEGER NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (phase_id, qb_account_id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_phase_budget_phase ON phase_budget_lines(phase_id)`);

    await client.query('COMMIT');
    console.log('✓ Schema migrations complete');

    // ── Seed QB Accounts ──────────────────────────────────────────────────
    await seedQbAccounts(pool);
    console.log('✓ QB accounts seeded');

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function seedQbAccounts(pool) {
  // Only seed if empty
  const { rows } = await pool.query('SELECT COUNT(*) FROM qb_accounts');
  if (Number(rows[0].count) > 0) {
    console.log('  (qb_accounts already seeded, skipping)');
    return;
  }

  // Insert in order so parent_id references work
  // Format: [account_number, full_name, short_name, parent_number | null, category, sort_order, is_leaf]
  const accounts = [
    // ── LAND ──────────────────────────────────────────────────────────────
    ['1600', 'Capitalized Land Cost:Land', 'Land', null, 'land', 10, false],
    ['1610', 'Capitalized Land Cost:Land:Com Land', 'Com Land', '1600', 'land', 11, false],
    ['1612', 'Capitalized Land Cost:Land:Com Land:Com Land Deposits', 'Com Land Deposits', '1610', 'land', 12, true],
    ['1614', 'Capitalized Land Cost:Land:Com Land:Com Contract Payments Applicable', 'Com Contract Payments Applicable', '1610', 'land', 13, true],
    ['1616', 'Capitalized Land Cost:Land:Com Land:Com Contract Payments Non Applicable', 'Com Contract Payments Non Applicable', '1610', 'land', 14, true],
    ['1618', 'Capitalized Land Cost:Land:Com Land:Com Land Purchase', 'Com Land Purchase', '1610', 'land', 15, true],
    ['1619', 'Capitalized Land Cost:Land:Com Land:Com Easements/Row/Offsite', 'Com Easements/Row/Offsite', '1610', 'land', 16, true],
    ['1620', 'Capitalized Land Cost:Land:Com Land:Com Forman Farms Option', 'Com Forman Farms Option', '1610', 'land', 17, true],
    ['1630', 'Capitalized Land Cost:Land:Resi Land', 'Resi Land', '1600', 'land', 20, false],
    ['1632', 'Capitalized Land Cost:Land:Resi Land:Resi Land Deposits', 'Resi Land Deposits', '1630', 'land', 21, true],
    ['1634', 'Capitalized Land Cost:Land:Resi Land:Resi Contract Payments Applicable', 'Resi Contract Payments Applicable', '1630', 'land', 22, true],
    ['1636', 'Capitalized Land Cost:Land:Resi Land:Resi Contract Payments Non Applicable', 'Resi Contract Payments Non Applicable', '1630', 'land', 23, true],
    ['1638', 'Capitalized Land Cost:Land:Resi Land:Resi Land Purchase', 'Resi Land Purchase', '1630', 'land', 24, true],
    ['1639', 'Capitalized Land Cost:Land:Resi Land:Resi Easements/Row/Offsite', 'Resi Easements/Row/Offsite', '1630', 'land', 25, true],

    // ── ENTITLEMENT ────────────────────────────────────────────────────────
    ['1700', 'Capitalized Land Cost:Entitlement', 'Entitlement', null, 'entitlement', 30, false],
    ['1705', 'Capitalized Land Cost:Entitlement:Architecture', 'Architecture', '1700', 'entitlement', 31, false],
    ['1705.02', 'Capitalized Land Cost:Entitlement:Architecture:Architectural Design', 'Architectural Design', '1705', 'entitlement', 32, true],
    ['1705.04', 'Capitalized Land Cost:Entitlement:Architecture:Board Submissions', 'Board Submissions', '1705', 'entitlement', 33, true],

    ['1710', 'Capitalized Land Cost:Entitlement:Survey', 'Survey', '1700', 'entitlement', 40, false],
    ['1710.01', 'Capitalized Land Cost:Entitlement:Survey:Boundary/ALTA Survey', 'Boundary/ALTA Survey', '1710', 'entitlement', 41, true],
    ['1710.02', 'Capitalized Land Cost:Entitlement:Survey:Topographic', 'Topographic', '1710', 'entitlement', 42, true],
    ['1710.03', 'Capitalized Land Cost:Entitlement:Survey:Off-Site Roadway', 'Off-Site Roadway', '1710', 'entitlement', 43, true],
    ['1710.04', 'Capitalized Land Cost:Entitlement:Survey:Environmental Brownfields', 'Environmental Brownfields', '1710', 'entitlement', 44, true],
    ['1710.05', 'Capitalized Land Cost:Entitlement:Survey:Ecological/FWW', 'Ecological/FWW', '1710', 'entitlement', 45, true],
    ['1710.06', 'Capitalized Land Cost:Entitlement:Survey:Stream/FHA', 'Stream/FHA', '1710', 'entitlement', 46, true],

    ['1720', 'Capitalized Land Cost:Entitlement:Engineering', 'Engineering', '1700', 'entitlement', 50, false],
    ['1720.01', 'Capitalized Land Cost:Entitlement:Engineering:Civil & Landscape Engineering', 'Civil & Landscape Engineering', '1720', 'entitlement', 51, true],
    ['1720.02', 'Capitalized Land Cost:Entitlement:Engineering:Geotech', 'Geotech', '1720', 'entitlement', 52, true],
    ['1720.03', 'Capitalized Land Cost:Entitlement:Engineering:Geotech-Stormwater', 'Geotech-Stormwater', '1720', 'entitlement', 53, true],
    ['1720.04', 'Capitalized Land Cost:Entitlement:Engineering:Geotech-Structural', 'Geotech-Structural', '1720', 'entitlement', 54, true],
    ['1720.05', 'Capitalized Land Cost:Entitlement:Engineering:Geotech-WWTP', 'Geotech-WWTP', '1720', 'entitlement', 55, true],
    ['1720.07', 'Capitalized Land Cost:Entitlement:Engineering:Environmental & LSRP', 'Environmental & LSRP', '1720', 'entitlement', 56, true],
    ['1720.08', 'Capitalized Land Cost:Entitlement:Engineering:Fire Suppression', 'Fire Suppression', '1720', 'entitlement', 57, true],
    ['1720.09', 'Capitalized Land Cost:Entitlement:Engineering:Ecological', 'Ecological', '1720', 'entitlement', 58, true],
    ['1720.10', 'Capitalized Land Cost:Entitlement:Engineering:Traffic', 'Traffic', '1720', 'entitlement', 59, true],
    ['1720.11', 'Capitalized Land Cost:Entitlement:Engineering:Railroad', 'Railroad', '1720', 'entitlement', 60, true],

    ['1730', 'Capitalized Land Cost:Entitlement:Consulting Fees', 'Consulting Fees', '1700', 'entitlement', 70, false],
    ['1730.01', 'Capitalized Land Cost:Entitlement:Consulting Fees:Appraisal', 'Appraisal', '1730', 'entitlement', 71, true],
    ['1730.02', 'Capitalized Land Cost:Entitlement:Consulting Fees:Planning', 'Planning', '1730', 'entitlement', 72, true],
    ['1730.03', 'Capitalized Land Cost:Entitlement:Consulting Fees:Public Relations', 'Public Relations', '1730', 'entitlement', 73, true],
    ['1730.04', 'Capitalized Land Cost:Entitlement:Consulting Fees:Political Consulting', 'Political Consulting', '1730', 'entitlement', 74, true],
    ['1730.05', 'Capitalized Land Cost:Entitlement:Consulting Fees:Fiscal', 'Fiscal', '1730', 'entitlement', 75, true],
    ['1730.06', 'Capitalized Land Cost:Entitlement:Consulting Fees:Cultural Resources', 'Cultural Resources', '1730', 'entitlement', 76, true],
    ['1730.07', 'Capitalized Land Cost:Entitlement:Consulting Fees:Acoustical', 'Acoustical', '1730', 'entitlement', 77, true],

    ['1740', 'Capitalized Land Cost:Entitlement:Utility Design', 'Utility Design', '1700', 'entitlement', 80, false],
    ['1740.01', 'Capitalized Land Cost:Entitlement:Utility Design:Electrical-Design', 'Electrical-Design', '1740', 'entitlement', 81, true],
    ['1740.02', 'Capitalized Land Cost:Entitlement:Utility Design:Public Water-Design', 'Public Water-Design', '1740', 'entitlement', 82, true],
    ['1740.03', 'Capitalized Land Cost:Entitlement:Utility Design:Public Sewer-Design', 'Public Sewer-Design', '1740', 'entitlement', 83, true],
    ['1740.05', 'Capitalized Land Cost:Entitlement:Utility Design:Data-Design', 'Data-Design', '1740', 'entitlement', 84, true],
    ['1740.07', 'Capitalized Land Cost:Entitlement:Utility Design:Gas-Design', 'Gas-Design', '1740', 'entitlement', 85, true],

    ['1750', 'Capitalized Land Cost:Entitlement:Legal Entitlement', 'Legal Entitlement', '1700', 'entitlement', 90, false],
    ['1750.01', 'Capitalized Land Cost:Entitlement:Legal Entitlement:Land Use Legal', 'Land Use Legal', '1750', 'entitlement', 91, true],
    ['1750.04', 'Capitalized Land Cost:Entitlement:Legal Entitlement:Environmental Legal', 'Environmental Legal', '1750', 'entitlement', 92, true],
    ['1750.06', 'Capitalized Land Cost:Entitlement:Legal Entitlement:Ecological Legal', 'Ecological Legal', '1750', 'entitlement', 93, true],

    ['1760', 'Capitalized Land Cost:Entitlement:Permits & Fees', 'Permits & Fees', '1700', 'entitlement', 100, false],
    ['1760.01', 'Capitalized Land Cost:Entitlement:Permits & Fees:County', 'County', '1760', 'entitlement', 101, true],
    ['1760.02', 'Capitalized Land Cost:Entitlement:Permits & Fees:Municipal', 'Municipal', '1760', 'entitlement', 102, true],
    ['1760.03', 'Capitalized Land Cost:Entitlement:Permits & Fees:Township Planning Board and Escrow', 'Township Planning Board and Escrow', '1760', 'entitlement', 103, true],
    ['1760.05', 'Capitalized Land Cost:Entitlement:Permits & Fees:State', 'State', '1760', 'entitlement', 104, true],
    ['1760.06', 'Capitalized Land Cost:Entitlement:Permits & Fees:Bonding-Permits & Fees', 'Bonding', '1760', 'entitlement', 105, true],
    ['1760.08', 'Capitalized Land Cost:Entitlement:Permits & Fees:NJDEP', 'NJDEP', '1760', 'entitlement', 106, true],
    ['1760.10', 'Capitalized Land Cost:Entitlement:Permits & Fees:NJDOT', 'NJDOT', '1760', 'entitlement', 107, true],
    ['1760.12', 'Capitalized Land Cost:Entitlement:Permits & Fees:Electric-Permits & Fees', 'Electric Permits', '1760', 'entitlement', 108, true],
    ['1760.13', 'Capitalized Land Cost:Entitlement:Permits & Fees:Gas-Permits & Fees', 'Gas Permits', '1760', 'entitlement', 109, true],
    ['1760.14', 'Capitalized Land Cost:Entitlement:Permits & Fees:Water-Permits & Fees', 'Water Permits', '1760', 'entitlement', 110, true],
    ['1760.15', 'Capitalized Land Cost:Entitlement:Permits & Fees:Sewer-Permits & Fees', 'Sewer Permits', '1760', 'entitlement', 111, true],
    ['1760.17', 'Capitalized Land Cost:Entitlement:Permits & Fees:Soil Conservation Fees', 'Soil Conservation Fees', '1760', 'entitlement', 112, true],
    ['1760.18', 'Capitalized Land Cost:Entitlement:Permits & Fees:COAH', 'COAH', '1760', 'entitlement', 113, true],
    ['1760.19', 'Capitalized Land Cost:Entitlement:Permits & Fees:Pineland Credits', 'Pineland Credits', '1760', 'entitlement', 114, true],

    ['1770', 'Capitalized Land Cost:Entitlement:Project Management Entitlement', 'Project Management', '1700', 'entitlement', 120, true],

    // ── CONSTRUCTION ──────────────────────────────────────────────────────
    ['1800', 'Capitalized Land Cost:Construction and Land Development', 'Construction and Land Development', null, 'construction', 130, false],
    ['1810', 'Capitalized Land Cost:Construction and Land Development:Pre-Con Sitework and Land Improvement', 'Pre-Con Sitework & Land Improvement', '1800', 'construction', 131, true],
    ['1820', 'Capitalized Land Cost:Construction and Land Development:Building Development', 'Building Development', '1800', 'construction', 132, false],
    ['1820.02', 'Capitalized Land Cost:Construction and Land Development:Building Development:Construction Design', 'Construction Design', '1820', 'construction', 133, true],
    ['1820.04', 'Capitalized Land Cost:Construction and Land Development:Building Development:Construction Engineering', 'Construction Engineering', '1820', 'construction', 134, true],
    ['1820.06', 'Capitalized Land Cost:Construction and Land Development:Building Development:Construction Fees and Permits', 'Construction Fees and Permits', '1820', 'construction', 135, true],
    ['1820.08', 'Capitalized Land Cost:Construction and Land Development:Building Development:Construction Project Management', 'Construction Project Management', '1820', 'construction', 136, true],
    ['1820.10', 'Capitalized Land Cost:Construction and Land Development:Building Development:Construction Hard Costs', 'Construction Hard Costs', '1820', 'construction', 137, true],

    // ── PROFESSIONAL FEES ─────────────────────────────────────────────────
    ['1860', 'Capitalized Land Cost:Professional Fees', 'Professional Fees', null, 'professional_fees', 140, false],
    ['1860.01', 'Capitalized Land Cost:Professional Fees:AA Professional Fees', 'AA Professional Fees', '1860', 'professional_fees', 141, true],
    ['1860.02', 'Capitalized Land Cost:Professional Fees:Legal Litigation', 'Legal Litigation', '1860', 'professional_fees', 142, true],
    ['1860.03', 'Capitalized Land Cost:Professional Fees:Legal Settlement', 'Legal Settlement', '1860', 'professional_fees', 143, true],
    ['1860.04', 'Capitalized Land Cost:Professional Fees:Legal Transactional', 'Legal Transactional', '1860', 'professional_fees', 144, true],
    ['1860.06', 'Capitalized Land Cost:Professional Fees:Marketing', 'Marketing', '1860', 'professional_fees', 145, true],
    ['1860.08', 'Capitalized Land Cost:Professional Fees:Accounting', 'Accounting', '1860', 'professional_fees', 146, true],

    // ── G&A ───────────────────────────────────────────────────────────────
    ['1880', 'Capitalized Land Cost:General & Administrative', 'General & Administrative', null, 'g_and_a', 150, false],
    ['1880.02', 'Capitalized Land Cost:General & Administrative:Insurance', 'Insurance', '1880', 'g_and_a', 151, true],
    ['1880.04', 'Capitalized Land Cost:General & Administrative:Real Estate Taxes', 'Real Estate Taxes', '1880', 'g_and_a', 152, true],
    ['1880.06', 'Capitalized Land Cost:General & Administrative:Utilities Usage', 'Utilities Usage', '1880', 'g_and_a', 153, true],
    ['1880.08', 'Capitalized Land Cost:General & Administrative:Bank Fees', 'Bank Fees', '1880', 'g_and_a', 154, true],
    ['1880.10', 'Capitalized Land Cost:General & Administrative:Bonding Fees', 'Bonding Fees', '1880', 'g_and_a', 155, true],

    // ── CLOSING COSTS ─────────────────────────────────────────────────────
    ['1920', 'Capitalized Land Cost:Closing Costs', 'Closing Costs', null, 'closing', 160, false],
    ['1920.02', 'Capitalized Land Cost:Closing Costs:Broker', 'Broker', '1920', 'closing', 161, true],
    ['1920.06', 'Capitalized Land Cost:Closing Costs:Title', 'Title', '1920', 'closing', 162, true],

    // ── FINANCE ───────────────────────────────────────────────────────────
    ['1950', 'Capitalized Land Cost:Finance', 'Finance', null, 'finance', 170, false],
    ['1950.02', 'Capitalized Land Cost:Finance:Origination', 'Origination', '1950', 'finance', 171, true],
    ['1950.04', 'Capitalized Land Cost:Finance:Interest', 'Interest', '1950', 'finance', 172, true],
    ['1950.08', 'Capitalized Land Cost:Finance:Financing Cost Misc', 'Financing Cost Misc', '1950', 'finance', 173, true],

    // ── CAPITAL COST ──────────────────────────────────────────────────────
    ['1999', 'Capitalized Land Cost:Expenses Capital Cost', 'Expenses Capital Cost', null, 'capital', 180, true],
  ];

  // First pass: insert without parent_id
  const numberToId = {};
  for (const [num, full, short, , cat, sort, leaf] of accounts) {
    const { rows } = await pool.query(
      `INSERT INTO qb_accounts (account_number, full_name, short_name, category, sort_order, is_leaf)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_number) DO NOTHING
       RETURNING id`,
      [num, full, short, cat, sort, leaf]
    );
    if (rows[0]) numberToId[num] = rows[0].id;
    else {
      const r = await pool.query('SELECT id FROM qb_accounts WHERE account_number=$1', [num]);
      numberToId[num] = r.rows[0].id;
    }
  }

  // Second pass: set parent_id
  for (const [num, , , parentNum] of accounts) {
    if (!parentNum) continue;
    const parentId = numberToId[parentNum];
    if (!parentId) continue;
    await pool.query(
      'UPDATE qb_accounts SET parent_id=$1 WHERE account_number=$2',
      [parentId, num]
    );
  }
}

run()
  .then(() => { console.log('✓ Done'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
