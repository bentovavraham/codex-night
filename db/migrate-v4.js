// node db/migrate-v4.js
// Wire qb_account_id onto existing phase_budget_lines based on task_name.
// Also adds account_number to the budget template for future inits.
// Safe to run multiple times (ON CONFLICT DO NOTHING / already-set rows skipped).

const pool = require('./pool');

// task_name → QB leaf account_number
// Where multiple tasks map to the same leaf, they share the code —
// that's intentional: QB rollup is at leaf level, budgets stay per-task.
const TASK_ACCOUNT = {
  // ── Initial Design / Due Diligence ──────────────────────────────────────────
  'Concept Plans':                                                  '1720.01',
  'Site Plans':                                                     '1720.01',
  'Survey – ALTA & Topographical':                                  '1710.01',
  'Wetlands LOI':                                                   '1710.05',
  'Traffic Impact Report':                                          '1720.10',
  'Geotechnical Field Testing + Report (Stormwater)':               '1720.03',
  'Environmental – Phase I Report':                                 '1720.07',
  'Environmental – Phase II Report (if required by Phase I)':       '1720.07',
  'Sound Study':                                                    '1730.07',
  'Fire-Water DD Report (Fire Tank Sizing)':                        '1720.08',
  'Gas & Electric Load Study':                                      '1740.01',

  // ── Traffic Extras ───────────────────────────────────────────────────────────
  'SCD Submission, Coordination & Revisions':                       '1720.01',
  'County Submission & Coordination – Site Plan Approval':          '1720.10',
  'NJDOT Submission & Coordination':                                '1760.10',
  'Offsite Traffic Plans & Coordination':                           '1710.03',
  'Traffic Intersection Design incl. Signal Design/Re-timing':      '1720.10',

  // ── Water & Sewer ────────────────────────────────────────────────────────────
  'Bridge Design/Specs':                                            '1720.01',
  'On-Site WWTP Design & Approval':                                 '1720.05',
  "Engineer's Water and Sewer Reports":                             '1720.01',
  'Offsite Public Sewer Design':                                    '1740.03',
  'Pump Station and Force Main Design (small / E-One)':             '1740.03',
  'Pump Station and FM Design (large / regional)':                  '1740.03',
  'Local MUA Coordination & Revisions':                             '1740.03',
  'Township Site Plan Application / MUA Fees (misc.)':              '1760.03',
  'Regional Sewerage Authority Applications & Coordination':        '1760.15',
  'BWSE (Water) Application':                                       '1760.14',
  'NJDEP TWA Application':                                          '1760.08',
  'NJPDES DGW Application':                                         '1760.08',
  'NJDEP FHA Submission and Review Comments/Revisions':             '1710.06',
  'NJDEP FWW Permitting and LOI + Revisions':                       '1710.05',

  // ── Environmental Permitting ─────────────────────────────────────────────────
  'Cultural Resources Study & Respond to SHPO':                     '1730.06',
  'Intensive Level Architectural Survey':                           '1730.06',
  'Archaeological Survey (Phase 1A)':                               '1730.06',
  'Archaeological Survey (Phase 1B)':                               '1730.06',
  'Additional Archaeological / Cultural Studies (TBD)':             '1730.06',

  // ── Township Hearings / Review ───────────────────────────────────────────────
  'Continued Hearing Exhibits':                                     '1720.01',
  'Continued Hearings and Meetings / Testimony':                    '1720.01',
  'Misc. Coordination/Meetings':                                    '1720.01',
  'Township Site Plan Resolution Compliance':                       '1720.01',
  'All Site Plan and Report Revisions per Outside Agency Reviews':  '1720.01',
  'RAO / Environmental Remediation':                                '1720.07',

  // ── Legal ────────────────────────────────────────────────────────────────────
  'Legal Fees (Land Use)':                                          '1750.01',
  'Legal Fees (Transactional/Recording Attorney)':                  '1860.04',
  'Legal Fees (Litigation)':                                        '1860.02',
  'Gas Application and Coordination':                               '1740.07',
  'Pinelands Submission':                                           '1760.19',

  // ── Application & Other Fees ─────────────────────────────────────────────────
  'Local MUA Application Fees (Prelim, Tent, Final)':               '1760.02',
  'Escrow Fees (Township Professionals)':                           '1760.03',
  'Pinelands Development Credits':                                  '1760.19',
  'CAFRA Submission':                                               '1760.05',
  'Water Connection Fees':                                          '1760.14',
  'Sewer Connection Fees':                                          '1760.15',

  // ── Estimated Extraordinary Construction Costs ────────────────────────────────
  'Geotechnical Structural Evaluation':                             '1720.04',
  'ROW Dedication':                                                 '1810',
  'Dam Class/Breach Analysis':                                      '1720.02',
  'Dam/Berm Seepage / Design of Dams':                              '1720.02',
  "JCP&L – Reconductoring 3,000' of Wire (refundable)":            '1740.01',
  "JCP&L – Rearranging Circuits in Area (refundable)":             '1740.01',
  "JCP&L – Transformer, Primary Cable, Switches (refundable)":     '1740.01',
  'Structural Geotechnical Analysis and Report':                    '1720.04',
  'One Line Diagram for Electric Company':                          '1740.01',
  'Sewer Allocation Purchase':                                      '1760.15',
  'Vapor Barrier Determination':                                    '1720.02',
};

async function run() {
  // Build account_number → qb_account_id lookup
  const { rows: accts } = await pool.query(
    `SELECT id, account_number FROM qb_accounts`
  );
  const numToId = {};
  for (const a of accts) numToId[a.account_number] = a.id;

  let updated = 0, skipped = 0, unmapped = 0;

  for (const [taskName, accountNumber] of Object.entries(TASK_ACCOUNT)) {
    const qbId = numToId[accountNumber];
    if (!qbId) {
      console.warn(`  ⚠ Account ${accountNumber} not found in qb_accounts (for task: ${taskName})`);
      continue;
    }
    const result = await pool.query(
      `UPDATE phase_budget_lines
       SET qb_account_id = $1
       WHERE task_name = $2
         AND qb_account_id IS NULL`,
      [qbId, taskName]
    );
    updated += result.rowCount;
  }

  // Report any rows that still have no mapping
  const { rows: unmappedRows } = await pool.query(
    `SELECT id, task_name, phase_id FROM phase_budget_lines WHERE qb_account_id IS NULL`
  );
  unmapped = unmappedRows.length;
  if (unmappedRows.length > 0) {
    console.log(`\n  ⚠ ${unmappedRows.length} rows have no qb_account mapping:`);
    unmappedRows.forEach(r => console.log(`    id=${r.id} phase=${r.phase_id} task="${r.task_name}"`));
  }

  console.log(`\n✓ Updated ${updated} rows, ${unmapped} unmapped`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
