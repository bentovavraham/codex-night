// Run once: node db/migrate-v5.js
// Fills every existing phase budget with a $0 line for each leaf QB account
// that has no representation yet. COA completeness — every account shows up.

const pool = require('./pool');

async function run() {
  // All leaf accounts
  const { rows: leaves } = await pool.query(
    'SELECT id, account_number, short_name FROM qb_accounts WHERE is_leaf = true ORDER BY sort_order'
  );
  console.log(`Found ${leaves.length} leaf QB accounts`);

  // All phases that have at least one budget line
  const { rows: phases } = await pool.query(`
    SELECT DISTINCT phase_id FROM phase_budget_lines ORDER BY phase_id
  `);
  console.log(`Found ${phases.length} phases with budgets`);

  let totalInserted = 0;

  for (const { phase_id } of phases) {
    // Which leaf accounts already have at least one line in this phase?
    const { rows: covered } = await pool.query(
      `SELECT DISTINCT qb_account_id FROM phase_budget_lines
       WHERE phase_id = $1 AND qb_account_id IS NOT NULL`,
      [phase_id]
    );
    const coveredIds = new Set(covered.map(r => r.qb_account_id));

    // Current max sort_order for this phase
    const { rows: maxSort } = await pool.query(
      `SELECT COALESCE(MAX(sort_order), 0) AS m FROM phase_budget_lines WHERE phase_id = $1`,
      [phase_id]
    );
    let sortIdx = Number(maxSort[0].m) + 1;

    for (const leaf of leaves) {
      if (coveredIds.has(leaf.id)) continue;
      await pool.query(
        `INSERT INTO phase_budget_lines
           (phase_id, task_name, budgeted_amount, sort_order, source, qb_account_id)
         VALUES ($1, $2, 0, $3, 'template', $4)`,
        [phase_id, leaf.short_name, sortIdx++, leaf.id]
      );
      totalInserted++;
    }

    console.log(`  Phase ${phase_id}: inserted ${sortIdx - Number(maxSort[0].m) - 1} missing lines`);
  }

  console.log(`\n✓ Done — ${totalInserted} lines inserted across ${phases.length} phases`);
}

run()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
