-- ============================================================
-- DATA MODEL INTEGRITY TEST QUERIES
-- Replace :phase_id with your test phase's ID each time
-- ============================================================

-- ── PHASE 0: Confirm budget lines exist ──────────────────────
SELECT
  pbl.id,
  qa.account_number,
  qa.short_name,
  pbl.task_name,
  pbl.budgeted_amount
FROM phase_budget_lines pbl
LEFT JOIN qb_accounts qa ON qa.id = pbl.qb_account_id
WHERE pbl.phase_id = :phase_id
ORDER BY qa.sort_order, pbl.sort_order;


-- ── PHASE 1: Unassigned contracts (should appear in budget as 0) ─
SELECT
  c.id,
  c.reference_number,
  c.total_value,
  c.status,
  c.phase_budget_line_id          AS direct_task,
  COUNT(cli.id)                   AS line_items,
  COUNT(cli.phase_budget_line_id) AS assigned_lines
FROM contracts c
LEFT JOIN contract_line_items cli ON cli.contract_id = c.id
WHERE c.phase_id = :phase_id
GROUP BY c.id
HAVING c.phase_budget_line_id IS NULL
   AND COUNT(cli.phase_budget_line_id) = 0
ORDER BY c.id;


-- ── PHASE 1: Unassigned invoices ─────────────────────────────
SELECT
  i.id,
  i.invoice_number,
  i.invoice_type,
  i.amount,
  i.status,
  i.phase_budget_line_id          AS direct_task,
  COUNT(ili.id)                   AS line_items,
  COUNT(ili.phase_budget_line_id) AS assigned_lines
FROM invoices i
LEFT JOIN invoice_line_items ili ON ili.invoice_id = i.id
WHERE i.phase_id = :phase_id
GROUP BY i.id
HAVING i.phase_budget_line_id IS NULL
   AND COUNT(ili.phase_budget_line_id) = 0
ORDER BY i.id;


-- ── PHASE 3: Full budget integrity check (UI vs raw DB) ──────
-- For each budget line: what the grid should show
WITH
committed AS (
  SELECT
    COALESCE(cli.phase_budget_line_id, c.phase_budget_line_id) AS pbl_id,
    SUM(COALESCE(cli.budgeted_amount, c.total_value))          AS amount
  FROM contracts c
  LEFT JOIN contract_line_items cli ON cli.contract_id = c.id
  WHERE c.phase_id = :phase_id
    AND c.status NOT IN ('voided','draft')
  GROUP BY 1
),
co_value AS (
  SELECT c.phase_budget_line_id AS pbl_id, SUM(co.amount) AS amount
  FROM change_orders co
  JOIN contracts c ON c.id = co.contract_id
  WHERE c.phase_id = :phase_id AND co.status = 'approved'
  GROUP BY 1
),
invoiced AS (
  SELECT
    COALESCE(ili.phase_budget_line_id, i.phase_budget_line_id) AS pbl_id,
    SUM(ili.amount)                                             AS amount
  FROM invoice_line_items ili
  JOIN invoices i ON i.id = ili.invoice_id
  WHERE i.phase_id = :phase_id
    AND i.status NOT IN ('voided','draft','rejected')
  GROUP BY 1
)
SELECT
  qa.account_number                              AS gl_code,
  pbl.task_name,
  pbl.budgeted_amount                            AS budgeted,
  COALESCE(c.amount,  0)                         AS contracted,
  COALESCE(cv.amount, 0)                         AS co_value,
  COALESCE(c.amount,0) + COALESCE(cv.amount,0)   AS total_commit,
  COALESCE(inv.amount, 0)                        AS invoiced,
  pbl.budgeted_amount - COALESCE(inv.amount, 0)  AS remaining,
  CASE WHEN pbl.budgeted_amount > 0
    THEN ROUND(COALESCE(inv.amount,0) / pbl.budgeted_amount * 100, 1)
    ELSE NULL END                                AS pct_used
FROM phase_budget_lines pbl
LEFT JOIN qb_accounts qa  ON qa.id  = pbl.qb_account_id
LEFT JOIN committed   c   ON c.pbl_id  = pbl.id
LEFT JOIN co_value    cv  ON cv.pbl_id = pbl.id
LEFT JOIN invoiced    inv ON inv.pbl_id = pbl.id
WHERE pbl.phase_id = :phase_id
ORDER BY qa.sort_order, pbl.sort_order;


-- ── PHASE 4: Reflow check — pick a specific invoice ──────────
-- Replace :invoice_id with the invoice you reassigned
SELECT
  ili.id                    AS line_item_id,
  ili.billing_type,
  ili.amount,
  ili.qb_account_id,
  qa.account_number         AS gl_code,
  ili.phase_budget_line_id  AS assigned_task,
  pbl.task_name
FROM invoice_line_items ili
LEFT JOIN qb_accounts qa  ON qa.id  = ili.qb_account_id
LEFT JOIN phase_budget_lines pbl ON pbl.id = ili.phase_budget_line_id
WHERE ili.invoice_id = :invoice_id
ORDER BY ili.id;


-- ── PHASE 5: Change order check ──────────────────────────────
SELECT
  co.id,
  co.amount,
  co.status,
  c.reference_number        AS contract_ref,
  c.phase_budget_line_id    AS task_id,
  pbl.task_name
FROM change_orders co
JOIN contracts c ON c.id = co.contract_id
LEFT JOIN phase_budget_lines pbl ON pbl.id = c.phase_budget_line_id
WHERE c.phase_id = :phase_id
ORDER BY co.id;
