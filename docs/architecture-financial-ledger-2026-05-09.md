# ActiveAcq — Financial Architecture Direction
*Decided: 2026-05-09*

---

## What This Document Is

A record of the architectural decisions made in the May 2026 design session. Covers the data model direction, the budget grid column definitions, the allocation ledger model, the budget snapshot feature, and the sequence of implementation work. This document is the reference point before any of the architecture work begins.

---

## The Core Principle

There is an important distinction between *calculating accurately on page load* and *persisting a reliable financial state that the system can audit and reason about over time*.

The system must maintain financial state explicitly and persistently — not infer it dynamically at runtime through layered query logic.

**Every dollar in the system must have:**
- A source document (invoice, contract, change order)
- A GL code (always required, no exceptions)
- A project and phase
- A task (explicit, or flagged as unallocated — never silently inferred)
- A contract/invoice/payment relationship
- An audit history
- A clear current state

The budget grid is a **reporting view** on top of the ledger. It is not the computation engine.

---

## What the System Should Behave Like

- A project accounting ledger
- A job cost control system
- A lender requisition support system
- A transparent financial workbook

Core operational metrics must be stable, traceable, and drillable back to underlying allocations and source records. Every number in the grid should be clickable. Excel users trust *"show me the rows."* If users cannot drill through to the source, they will eventually stop trusting the totals.

---

## Budget Grid — Column Definitions

The following definitions come directly from Seth's reference diagram (2026-05-09). These are authoritative.

| Column | Formula / Source |
|---|---|
| **Budget** | PM input. The planned amount for this task. Stored on `phase_budget_lines.budgeted_amount`. Described as "a guess" — the starting estimate. |
| **Initial Contracts** | Sum of signed contract amounts allocated to this task. From the Contract Entry form. Each contract can be divided into one or more GL code + Task combinations. |
| **COs** | Change orders. Sum of approved change order amounts allocated to this task. |
| **Total Contract Commitments** | Initial Contracts + COs. Everything legally promised to vendors. |
| **Remaining Budget** | Budget − Total Contract Commitments. How much budget is still available to commit. Negative = over-committed. |
| **Rem Budget %** | Remaining Budget ÷ Budget. |
| **Fixed** | Invoice charges against fixed-fee line items. From billing type `fixed` in the Import View (invoices or contracts). |
| **T&M** | Invoice charges against T&M line items. From billing type `tm` in the Import View. |
| **Expense** | Invoice charges against expense line items. From billing type `expense` in the Import View. |
| **Total Invoiced** | Fixed + T&M + Expense. Currently: all invoices in the system. Future intent: approved invoices only. |
| **$ Remaining on Commitment** | Total Contract Commitments − Total Invoiced. Dollar value of contracted work not yet invoiced. |
| **% Used of Committed** | Total Invoiced ÷ Total Contract Commitments. |
| **Amt Paid** | Paid to date. Invoices with status = paid. |
| **Amount Due** | Total Invoiced − Amt Paid. |

**Column order (left to right):**
Budget → Initial Contracts → COs → Total Contract Commitments → Remaining Budget → Rem % → Fixed → T&M → Expense → Total Invoiced → $ Remaining on Commitment → % Used of Committed → Amt Paid → Amount Due

**Rule (from Ari):** Never show a percentage without its corresponding dollar amount immediately preceding it.

**Rule:** Every financial column must be drillable — clicking a number opens the source documents and allocation records behind it.

---

## What Is Wrong With the Current Architecture

The current system computes actuals through a 4-path allocation cascade in SQL, inferred fresh on every page load:

- Path 1: Invoice line has explicit `phase_budget_line_id` → credit that task
- Path 2: Invoice line has `qb_account_id` matching a unique task's GL code → infer the task
- Path 3: Invoice line has neither → fall back to invoice header's `phase_budget_line_id`
- Path 4: Invoice has no line items → use invoice header amount and its task

**Paths 3 and 4 are the problem.** Attribution is inferred, not stored. Historical totals can silently shift if any of the following change: an invoice is edited, a contract allocation changes, a GL mapping changes, a task mapping changes, fallback logic changes, shared GL logic changes, or someone edits historical records.

Paths 3 and 4 must be removed. They exist only to support legacy data entered before the current model was in place.

---

## The New Architecture — Allocation Ledger

### Philosophy

Every confirmed dollar writes an explicit allocation record at the time of entry. The budget grid queries the allocation table directly with a simple GROUP BY. No inference. No fallback paths. No ambiguity.

### New Table: `budget_allocations`

```sql
CREATE TABLE budget_allocations (
  id                    SERIAL PRIMARY KEY,
  phase_id              INTEGER NOT NULL REFERENCES phases(id),

  -- Source document (exactly one will be set)
  invoice_line_item_id  INTEGER REFERENCES invoice_line_items(id),
  contract_line_item_id INTEGER REFERENCES contract_line_items(id),
  co_line_item_id       INTEGER REFERENCES change_order_line_items(id),

  -- Attribution (written explicitly at time of entry, never inferred)
  qb_account_id         INTEGER NOT NULL REFERENCES qb_accounts(id),  -- GL code, always required
  phase_budget_line_id  INTEGER REFERENCES phase_budget_lines(id),     -- task; NULL = needs_review

  -- Financial detail
  amount                NUMERIC(12,2) NOT NULL,
  billing_type          VARCHAR(20),           -- 'fixed', 'tm', 'expense', 'contract', 'co'
  status                VARCHAR(20) NOT NULL,  -- mirrors source document status

  -- Allocation state
  allocation_status     VARCHAR(20) NOT NULL DEFAULT 'allocated',
  -- 'allocated'       → GL code + task both explicitly set
  -- 'gl_only'         → GL code set, no task (shared GL situation, needs review)
  -- 'needs_review'    → ambiguous, requires human resolution

  -- Provenance
  allocated_at          TIMESTAMPTZ DEFAULT NOW(),
  allocated_by          INTEGER REFERENCES users(id),
  allocation_source     VARCHAR(30) NOT NULL
  -- 'explicit'         → user set it in the import/edit flow
  -- 'gl_inferred'      → system inferred from unique GL mapping (acceptable shortcut)
  -- 'migrated'         → backfilled from legacy data
);
```

### New Table: `allocation_audit_log`

```sql
CREATE TABLE allocation_audit_log (
  id                       SERIAL PRIMARY KEY,
  allocation_id            INTEGER NOT NULL REFERENCES budget_allocations(id),
  changed_at               TIMESTAMPTZ DEFAULT NOW(),
  changed_by               INTEGER REFERENCES users(id),
  old_qb_account_id        INTEGER,
  old_phase_budget_line_id INTEGER,
  old_status               VARCHAR(20),
  new_qb_account_id        INTEGER,
  new_phase_budget_line_id INTEGER,
  new_status               VARCHAR(20),
  reason                   TEXT
);
```

### Budget Grid Query (post-migration)

```sql
SELECT
  phase_budget_line_id,
  SUM(amount) FILTER (WHERE billing_type = 'fixed')    AS fixed_charges,
  SUM(amount) FILTER (WHERE billing_type = 'tm')       AS tm_charges,
  SUM(amount) FILTER (WHERE billing_type = 'expense')  AS expense_charges,
  SUM(amount)                                          AS billed
FROM budget_allocations
WHERE phase_id = $1
  AND status NOT IN ('voided', 'rejected')
  AND invoice_line_item_id IS NOT NULL
GROUP BY phase_budget_line_id
```

No cascades. No inference. No shared-GL edge cases.

### Allocation Rules

| Situation | Behavior |
|---|---|
| Invoice line has GL code + task | Write allocation row, `status = allocated`, `source = explicit` |
| Invoice line has GL only, unique task match | Write allocation row, `source = gl_inferred`, acceptable |
| Invoice line has GL only, shared GL | Write `allocation_status = gl_only`, surface in Unallocated tray, block confirmation until resolved |
| Invoice line has no GL code | Block confirmation — GL code is required, no exceptions |
| Allocation reassigned | Update allocation row, write to audit log |
| Legacy invoice (old paths 3/4) | Migrate to explicit allocation rows tagged `source = migrated`, surface in Unallocated tray |

---

## Budget Snapshots

### Concept

A snapshot functions like **Save As** in Excel. It captures the complete state of the budget grid at a point in time — every column, every row, exactly as it appeared on screen — so you can print both and compare. This is the feature that makes the system behave like a financial tool rather than a live dashboard.

Analogous to Apple Time Machine: the system saves states periodically and on demand, and you can roll back to view any prior state.

### What a Snapshot Captures

Everything. Not just budgeted amounts — the full computed state:
- Budgeted amount per task
- Contracted, COs, Total Commitment
- Remaining Budget
- Fixed, T&M, Expense, Total Invoiced
- Remaining Commitment, % Used
- Amt Paid, Amount Due
- All group and grand totals

This is a denormalized copy of the entire grid state, immune to future changes in allocation logic, invoice edits, or contract amendments.

### When Snapshots Are Taken

- **Automatic:** periodically (e.g., weekly or monthly, TBD)
- **Manual:** Seth presses a button and names the snapshot (e.g., "Pre-Construction Sign-Off — May 2026")

### What a Snapshot Does Not Do

- It does not lock editing. Seth can still change budgeted amounts after a snapshot.
- It cannot be edited after creation.
- It can be renamed.

### Comparison Mode

The budget grid has a mode toggle: **Current** vs. **Compare to Snapshot**. In comparison mode, the grid shows the snapshot column values alongside current values, with a delta column for every number. Seth can answer "what changed since I signed off?" at a glance.

### Schema (conceptual)

```sql
-- Header
budget_snapshots (
  id, phase_id, name, note,
  created_at, created_by,
  snapshot_type  -- 'manual' | 'auto'
)

-- One row per task at time of snapshot
budget_snapshot_lines (
  id, snapshot_id, phase_budget_line_id,
  task_name, qb_account_number, qb_short_name,
  budgeted_amount,
  contracted, co_value, total_commitment,
  remaining_budget,
  fixed_charges, tm_charges, expense_charges,
  billed, remaining_commitment,
  pct_used_of_committed,
  paid, amount_due
)
```

**Important:** Snapshots are only meaningful once the allocation ledger is clean. A snapshot of an inferred system just freezes the inference.

---

## Budget Row Creation — Who and Where

### The Distinction

- **Adding a budget row** = a planning decision. Seth decides: "I expect to spend money on this task under this GL code." This is the work breakdown structure. It is deliberate and owned by Seth.
- **Allocating a dollar** = a recording decision. Richard assigns an invoice line to a task. This is data entry against the plan.

These are different actions with different owners and must live in different places.

### Where Rows Are Created

**Budget grid — planned upfront:**
Seth opens a blank budget and builds it manually before any contracts exist. Entry experience: GL picker → task name → budgeted amount → save → next row. Fast, tab-through, like Excel. GL code required. Budgeted amount can be left blank (TBD).

**Budget grid — added mid-project:**
Scope expands. Seth opens the grid, clicks Add Row. Same flow. This is a budget amendment — the snapshot history will show the row didn't exist in the prior snapshot.

**Import flow — surfaces the gap, does not create the row:**
Richard imports an invoice or contract. No matching task exists for the GL code. The system surfaces a clear message: *"No budget task exists for this GL code. Create one in the budget before allocating this line."* Richard flags it. Seth adds the row. Richard returns and completes the allocation.

The import flow must never silently create budget rows. Doing so collapses two separate decisions — "does this task belong in the budget?" (Seth's call) and "where does this invoice line go?" (Richard's call) — into one moment of data entry.

### The One Acceptable Shortcut

If a GL code maps to exactly one task (unique GL, no ambiguity), the system may auto-infer the task on allocation with `source = gl_inferred`. This is acceptable because there is no decision to make. The moment a GL code has multiple tasks, the shortcut no longer applies and explicit assignment is required.

---

## Clean Boot Plan

Before any architecture work begins:

1. **Wipe all project data except Richwood Phase One.** QB accounts, GL code hierarchy, and user accounts are configuration — they stay. All other projects, phases, invoices, contracts, change orders, and budget lines are deleted.

2. **Audit Richwood Phase One.** Run a query that shows every invoice line in that phase and exactly which allocation path it is currently on. Resolve any lines on Paths 3 or 4 before they become the foundation of the new ledger.

3. **Only then begin the architecture migration.**

---

## Implementation Sequence

| Step | Work | Dependency |
|---|---|---|
| 1 | Clean boot — wipe non-Richwood data, audit Richwood Phase One | None |
| 2 | Build `budget_allocations` table and write allocation records on confirm | Clean data |
| 3 | Build `allocation_audit_log`, wire to all allocation changes | Step 2 |
| 4 | Rewrite budget grid query — GROUP BY on allocation table, remove 4-path cascade | Step 2 |
| 5 | Full drillthrough — every financial column clickable, shows source docs + allocation records | Step 4 |
| 6 | Budget snapshots — full grid state freeze, mode toggle for comparison | Step 4 |
| 7 | Column reorder per Seth's reference diagram | Any time |

---

## What Does Not Change

- The source records (`invoice_line_items`, `contract_line_items`, `change_order_line_items`) remain the books of record. The allocation ledger points to them — it does not replace them.
- Soft deletes only. Financial records are voided, never deleted.
- GL code is and remains the accounting spine of the system. Every dollar must have one.
