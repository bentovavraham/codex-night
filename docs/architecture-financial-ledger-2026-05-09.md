# ActiveAcq — Financial Architecture Direction
*Decided: 2026-05-09 — Last updated: 2026-05-10*

---

## What This Document Is

A record of the architectural decisions made in the May 2026 design session. This is the reference point before any architecture work begins. Do not start building until this document is agreed upon.

---

## The Core Principle — KISS

Do not build smart logic that figures out where money belongs at runtime. That is the root cause of the current system's unreliability.

The model is three layers, and only three:

```
Source record holds the official total
       ↓
Allocation rows split that total (human decision, explicit, stored)
       ↓
Budget grid sums confirmed allocations (reporting only)
```

The database enforces that the math ties out. Humans decide where money goes. The system records and enforces — it does not infer.

---

## What the System Must Behave Like

- A project accounting ledger
- A job cost control system
- A lender requisition support system
- A transparent financial workbook

Every number in the grid must be drillable back to its source documents and allocation records. If a user cannot click a number and see the rows behind it, they will eventually stop trusting the totals. Excel users trust *"show me the rows."*

---

## What Every Dollar Must Have

- A source document (invoice, contract, or change order)
- A GL code — always required, no exceptions, enforced at the DB level
- A project and phase
- A task (explicit) — or flagged as Needs Review if not yet assigned
- An allocation amount that is part of a balanced split
- An audit history
- A current status

---

## Layer 1 — Source Tables (Official Totals)

These hold the legal record. The number on a source document is the law. It is never overridden — only voided and replaced.

| Table | What it holds |
|---|---|
| `invoices` | Invoice header, vendor, date, total amount, status |
| `invoice_line_items` | Each line on the invoice — description, amount, billing type |
| `contracts` | Contract header, vendor, total value, status |
| `contract_line_items` | Each line on the contract — description, amount, billing type |
| `change_orders` | CO header, amount, status |
| `change_order_line_items` | Each line on the CO |
| `payments` | Payment records tied to invoices |

No amount is ever computed in these tables. They hold typed-in facts from source documents.

---

## Layer 2 — Allocation Table (Controlled Distribution)

One allocation row per slice of a source line. A single source line can have many allocation rows — one per GL code / task / billing type combination it is split across.

**The reconciliation rule, enforced by the database:**
> SUM of allocation amounts for a source line = source line amount
> If this does not balance, the record cannot be confirmed.

### Every Allocation Row Carries

| Field | Rule |
|---|---|
| `source_type` | `invoice_line` / `contract_line` / `co_line` / `payment` |
| `source_document_id` | Which invoice, contract, or CO |
| `source_line_id` | Which specific line item |
| `phase_id` | Required |
| `qb_account_id` (GL code) | Required — DB `NOT NULL` constraint, no exceptions |
| `phase_budget_line_id` (task) | Required for confirmed status — null = Needs Review |
| `billing_type` | `fixed` / `tm` / `expense` / `contract` / `co` |
| `amount` | The slice amount — stored explicitly, never inferred |
| `allocation_status` | See status model below |
| `allocation_source` | `explicit` / `migrated` |
| `created_by`, `updated_by` | Always recorded |
| `created_at`, `updated_at` | Always recorded |

### Schema

```sql
CREATE TABLE financial_allocations (
  id                    SERIAL PRIMARY KEY,

  -- Source reference
  source_type           VARCHAR(20) NOT NULL,
  -- 'invoice_line' | 'contract_line' | 'co_line' | 'payment'
  source_document_id    INTEGER NOT NULL,
  source_line_id        INTEGER,

  -- Routing (set explicitly by a human, never inferred at query time)
  phase_id              INTEGER NOT NULL REFERENCES phases(id),
  qb_account_id         INTEGER NOT NULL REFERENCES qb_accounts(id),
  phase_budget_line_id  INTEGER REFERENCES phase_budget_lines(id),
  billing_type          VARCHAR(20),

  -- Amount (this is the allocated slice — must sum to source line total)
  amount                NUMERIC(12,2) NOT NULL,

  -- Status
  allocation_status     VARCHAR(20) NOT NULL DEFAULT 'draft',

  -- Provenance
  allocation_source     VARCHAR(20) NOT NULL DEFAULT 'explicit',
  -- 'explicit'  → human set it in the import/edit flow
  -- 'migrated'  → backfilled from legacy data, flagged for review

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            INTEGER REFERENCES users(id),
  updated_at            TIMESTAMPTZ,
  updated_by            INTEGER REFERENCES users(id)
);
```

### Allocation Audit Log

Every change to an allocation is a permanent record.

```sql
CREATE TABLE allocation_audit_log (
  id                       SERIAL PRIMARY KEY,
  allocation_id            INTEGER NOT NULL REFERENCES financial_allocations(id),
  changed_at               TIMESTAMPTZ DEFAULT NOW(),
  changed_by               INTEGER REFERENCES users(id),
  field_changed            VARCHAR(50),
  old_value                TEXT,
  new_value                TEXT,
  reason                   TEXT
);
```

Logged on every change: amount, GL code, task, billing type, status. Old value, new value, who, when, why.

---

## Layer 3 — Budget Grid (Reporting View)

A simple aggregation over confirmed allocations. No inference. No fallback paths. No runtime logic.

```sql
SELECT
  fa.phase_budget_line_id,
  SUM(fa.amount) FILTER (WHERE fa.billing_type = 'fixed')    AS fixed_charges,
  SUM(fa.amount) FILTER (WHERE fa.billing_type = 'tm')       AS tm_charges,
  SUM(fa.amount) FILTER (WHERE fa.billing_type = 'expense')  AS expense_charges,
  SUM(fa.amount)                                             AS billed
FROM financial_allocations fa
WHERE fa.phase_id = $1
  AND fa.allocation_status = 'confirmed'
GROUP BY fa.phase_budget_line_id
```

The grid trusts the allocation table completely because the database has already guaranteed it balances.

---

## Status Model

Every source document and every allocation row has a status. The budget grid includes only records whose status is on the allowed list.

```
draft          → entered but not yet balanced or confirmed
confirmed      → allocations balance, human has confirmed
approved       → Seth has signed off
out_of_balance → allocations do not sum to source total (DB sets this automatically)
needs_review   → GL code or task missing, or manually flagged
voided         → soft-deleted, record retained permanently
rejected       → soft-deleted, record retained permanently
```

**Budget grid includes:** `confirmed` and `approved` only.

**Budget grid excludes:** `draft`, `out_of_balance`, `needs_review`, `voided`, `rejected`.

No hard deletes. Ever. A voided invoice is still in the database with all its allocation rows. It simply does not flow into the grid.

---

## Reconciliation Controls (Database-Enforced)

These rules are enforced by the database — not by frontend logic, not by application code that can be bypassed.

| Rule | Mechanism |
|---|---|
| GL code required on every allocation row | `NOT NULL` constraint |
| Valid source reference | Foreign key |
| Valid phase reference | Foreign key |
| No orphan allocations | FK with `RESTRICT` on source record changes |
| Allocation total must equal source line total | DB trigger after every allocation insert / update / delete |
| Cannot confirm if out of balance | Trigger blocks status transition |
| No hard delete of financial records | Trigger blocks `DELETE` on financial tables |
| Every allocation change is logged | Trigger writes to `allocation_audit_log` |

**The reconciliation trigger in plain terms:**
After any allocation is inserted, updated, or deleted, the database immediately checks: do the allocation rows for this source line sum to the source line amount? If not, the source document status is set to `out_of_balance` and it cannot be confirmed. The discrepancy is visible immediately — not discovered weeks later.

---

## What This Prevents

The problem in the previous system — phases mixed, projects mixed, numbers that stopped meaning anything after edits — happened because there was no reconciliation lock. A record could be edited, an allocation could drift, and the grid silently showed the wrong number.

With this model:
- Every allocation change triggers an immediate balance check
- An imbalanced source line cannot be confirmed
- An unconfirmed record cannot enter the budget grid
- Nothing is deleted — only voided
- Everything is logged

Money cannot disappear. Money cannot duplicate. Money cannot drift. If it does not balance, it is visible in Needs Review immediately.

---

## Budget Grid — Column Definitions

From Seth's reference diagram (2026-05-09). These are authoritative.

| Column | Formula / Source |
|---|---|
| **Budget** | PM input — planned amount per task. The starting estimate. |
| **Initial Contracts** | Sum of confirmed contract allocation amounts for this task. |
| **COs** | Sum of confirmed change order allocation amounts for this task. |
| **Total Contract Commitments** | Initial Contracts + COs. Everything legally promised. |
| **Remaining Budget** | Budget − Total Contract Commitments. Negative = over-committed. |
| **Rem Budget %** | Remaining Budget ÷ Budget. |
| **Fixed** | Sum of confirmed allocations with billing type `fixed`. |
| **T&M** | Sum of confirmed allocations with billing type `tm`. |
| **Expense** | Sum of confirmed allocations with billing type `expense`. |
| **Total Invoiced** | Fixed + T&M + Expense. Future intent: approved invoices only. |
| **$ Remaining on Commitment** | Total Contract Commitments − Total Invoiced. |
| **% Used of Committed** | Total Invoiced ÷ Total Contract Commitments. |
| **Amt Paid** | Sum of confirmed payment allocations. |
| **Amount Due** | Total Invoiced − Amt Paid. |

**Column order:** Budget → Initial Contracts → COs → Total Contract Commitments → Remaining Budget → Rem % → Fixed → T&M → Expense → Total Invoiced → $ Remaining on Commitment → % Used of Committed → Amt Paid → Amount Due

**Rule (Ari):** Never show a percentage without its corresponding dollar amount immediately before it.

**Rule:** Every financial column is drillable — clicking opens the allocation rows and source documents behind that number.

---

## Budget Snapshots

### Concept

A snapshot functions like **Save As** in Excel — analogous to Apple Time Machine. It captures the complete state of the budget grid at a point in time, every column and every row, exactly as it appeared on screen. You can view any past snapshot alongside the current grid and compare them.

### What a Snapshot Captures

Everything — the full computed state, not just planned amounts:
- Budgeted amount per task
- Contracted, COs, Total Commitment
- Remaining Budget
- Fixed, T&M, Expense, Total Invoiced
- Remaining Commitment, % Used of Committed
- Amt Paid, Amount Due
- All group and grand totals

This is a denormalized freeze. It is immune to any future changes — invoice edits, allocation changes, logic changes. It reflects what the system showed at that moment.

### When Snapshots Are Taken

- **Automatic:** periodically (cadence TBD)
- **Manual:** Seth names and triggers a snapshot (e.g., "Pre-Construction Sign-Off — May 2026")

### Rules

- Snapshots cannot be edited after creation
- Snapshots can be renamed
- Snapshots do not lock editing — Seth can continue changing the budget after a snapshot is taken
- Snapshots are only meaningful once the allocation ledger is clean and balanced

### Comparison Mode

A mode toggle in the budget grid. Snapshot view shows the frozen column values alongside current values, with a delta column per number.

### Schema

```sql
CREATE TABLE budget_snapshots (
  id             SERIAL PRIMARY KEY,
  phase_id       INTEGER NOT NULL REFERENCES phases(id),
  name           TEXT NOT NULL,
  note           TEXT,
  snapshot_type  VARCHAR(10) NOT NULL DEFAULT 'manual', -- 'manual' | 'auto'
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  created_by     INTEGER REFERENCES users(id)
);

CREATE TABLE budget_snapshot_lines (
  id                    SERIAL PRIMARY KEY,
  snapshot_id           INTEGER NOT NULL REFERENCES budget_snapshots(id),
  phase_budget_line_id  INTEGER,
  task_name             TEXT,
  qb_account_number     TEXT,
  qb_short_name         TEXT,
  budgeted_amount       NUMERIC(12,2),
  contracted            NUMERIC(12,2),
  co_value              NUMERIC(12,2),
  total_commitment      NUMERIC(12,2),
  remaining_budget      NUMERIC(12,2),
  fixed_charges         NUMERIC(12,2),
  tm_charges            NUMERIC(12,2),
  expense_charges       NUMERIC(12,2),
  billed                NUMERIC(12,2),
  remaining_commitment  NUMERIC(12,2),
  pct_used_of_committed NUMERIC(8,4),
  paid                  NUMERIC(12,2),
  amount_due            NUMERIC(12,2)
);
```

---

## Budget Row Creation — Who and Where

**Adding a budget row** is a planning decision (Seth). It defines what the project expects to spend on a given task under a given GL code. This is the work breakdown structure.

**Allocating a dollar** is a recording decision (Richard). It assigns an invoice or contract line to an existing budget row.

These are different decisions with different owners and must not be collapsed into the same action.

### Where Rows Are Created

**Budget grid — always.** Seth adds rows: GL code → task name → budgeted amount. Tab through, hit enter, next row appears. GL code required. Amount can be TBD. This applies both to building a budget from scratch and to adding rows mid-project when scope expands.

**Import flow — surfaces gaps only.** If Richard is allocating a line and no matching budget task exists for the GL code, the system surfaces a clear message and blocks: *"No budget task exists for this GL code. Create one in the budget first."* Richard flags it. Seth adds the row. Richard returns.

The import flow never creates budget rows. That decision belongs to Seth.

---

## Clean Boot Plan

1. Wipe all project data except Richwood Phase One. QB accounts, GL hierarchy, and user accounts (configuration) stay.
2. Audit Richwood Phase One — run a query showing every invoice line and which allocation path it currently uses. Resolve any lines on legacy Paths 3 or 4 before they become the foundation.
3. Only then begin the architecture migration.

---

## Implementation Sequence

| Step | Work |
|---|---|
| 1 | Clean boot — wipe non-Richwood data, audit Richwood Phase One |
| 2 | Build `financial_allocations` table with DB constraints and reconciliation trigger |
| 3 | Build `allocation_audit_log`, wire to all allocation changes |
| 4 | Update import/confirm flow — write allocation rows on confirm, enforce GL required, enforce balance |
| 5 | Rewrite budget grid query — GROUP BY on confirmed allocations, remove 4-path cascade entirely |
| 6 | Full drillthrough — every financial column clickable |
| 7 | Budget snapshots |
| 8 | Column reorder per Seth's reference diagram |

---

## What Does Not Change

- Source records (`invoice_line_items`, `contract_line_items`, `change_order_line_items`) remain the books of record. The allocation table points to them and distributes their totals.
- Soft deletes only. No financial record is ever hard-deleted.
- GL code is the accounting spine. Every allocation row requires one.
- The budget grid is a reporting view. It does not compute — it reads.
