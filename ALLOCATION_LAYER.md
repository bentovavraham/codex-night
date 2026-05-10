# Allocation Layer

The Allocation Layer is the financial data architecture introduced in May 2026. It replaces the previous approach of reading dollar amounts directly from source records (contracts, invoices, change orders) via correlated subqueries.

## Core idea

Every dollar in the system flows through a single table — `financial_allocations` — before it appears anywhere in the budget grid. Source records (contracts, invoices) are the authoritative documents. The allocation table is the routing layer that says: *this amount, from this source line, belongs to this GL code and this budget task*.

```
Source record (invoice, contract, CO)
    └── financial_allocations rows   ← one row per GL/task slice
            └── Budget grid query    ← aggregates from fa, never reads source directly
```

## The table

`financial_allocations` has one row per *slice* of a source line. A single invoice line can produce multiple allocation rows if it's split across GL codes or budget tasks.

Key fields:

| Field | Meaning |
|---|---|
| `source_type` | `invoice_line`, `contract_line`, `co_line`, `payment` |
| `source_document_id` | The invoice/contract/CO id |
| `source_line_id` | The specific line item id within that document |
| `phase_id` | Which phase this dollar belongs to |
| `qb_account_id` | GL code — **always required**, NOT NULL enforced |
| `phase_budget_line_id` | Which budget task — null lands in needs_review |
| `billing_type` | `fixed`, `tm`, `expense` |
| `amount` | The explicit dollar amount of this slice |
| `allocation_status` | `confirmed`, `needs_review`, `approved`, `migrated`, `voided` |
| `allocation_source` | `explicit` (human-set) or `migrated` (backfilled from legacy data) |

## Status lifecycle

- **`confirmed`** — GL code and budget task both set; row counts in the grid
- **`needs_review`** — GL set but no budget task (or task mismatch); visible in Unassigned
- **`migrated`** — backfilled from pre-Allocation Layer data; treated as confirmed but flagged
- **`voided`** / **`rejected`** — excluded from all grid queries

The budget grid query only aggregates rows where `allocation_status IN ('confirmed', 'approved')`.

## What writes allocation rows

| Flow | When rows are written |
|---|---|
| Import queue → Confirm | `POST /api/import-queue/:id/confirm` writes one fa row per invoice or contract line |
| Backfill migration | One-time SQL run May 2026 — created `migrated` rows for all pre-existing Richwood data |
| Future: CO confirm | Not yet implemented — CO amounts not yet in the allocation table |

## What reads from allocation rows

| Consumer | What it reads |
|---|---|
| Budget grid (`GET /api/phases/:phaseId/budget`) | Single LEFT JOIN aggregation — committed, co_value, fixed, tm, expense, billed, paid |
| Drillthrough (`GET /api/phases/:phaseId/budget-lines/:lineId/drill`) | Filters by source_type and billing_type for the clicked cell |
| Snapshots (`POST /api/phases/:phaseId/snapshots`) | INSERT...SELECT freeze of current fa aggregation |
| Cross-check bar | Separate `cross-check` endpoint aggregates directly from fa and compares to raw source totals |
| Unassigned panel | Reads fa rows where `phase_budget_line_id IS NULL` |

## What does NOT yet write allocation rows

- Change order confirmation (CO amounts show $0 in the grid until this is wired)
- Manual payment recording

## Files

| File | Role |
|---|---|
| `db/schema.sql` | `financial_allocations` table definition (~line 610) |
| `routes/import.js` | Writes fa rows on import confirm |
| `routes/phaseBudget.js` | All grid queries, drillthrough, snapshots — read from fa |
| `client/src/screens/BudgetGrid.tsx` | Grid UI, drillthrough panel, snapshot UI |
