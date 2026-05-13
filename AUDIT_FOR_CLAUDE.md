# ActiveAcq / Codex 2 Audit

This audit is for the new separated Codex 2 app only.

Do not apply this to the original Render project named `My project`. That original Claude app is off-limits. The Codex 2 app uses its own local repo, GitHub repo, Render web service, and Render database.

## Current Project Separation

- Original app: `My project`
  - Do not touch locally.
  - Do not touch on Render.
  - Do not reuse its database.
  - Do not reuse its web service.

- New Codex app repo:
  - Local folder: `/Users/avrahambentov/Documents/active-main-clone`
  - GitHub origin: `https://github.com/bentovavraham/codex-night.git`

- New Render targets:
  - Web service: `Codex 2 the webserver`
  - Database: `Codex2 The Database`

The correct deployment relationship is:

```text
Codex 2 the webserver -> Codex2 The Database
```

## What The App Is

ActiveAcq is a project financial control app for acquisition, construction, and real estate operations.

Its job is to track money through this lifecycle:

```text
Budget -> Contract -> Invoice -> Approval -> Pushed to QuickBooks -> Paid
```

The app is not trying to replace QuickBooks as the accounting system of record. Its strongest purpose is to become the project-facing financial cockpit for owners, PMs, partners, and bookkeepers.

QuickBooks stores accounting transactions. ActiveAcq should explain project cost control:

- What was budgeted?
- What was committed by contract?
- What has been billed by invoice?
- What has been approved?
- What has been pushed to QuickBooks?
- What has been paid?
- What remains?
- What does not reconcile?

## Product Potential

The product has strong potential because it solves a real gap between project management and accounting.

QuickBooks is good at accounting transactions, but it is not naturally built as a construction/acquisition budget control grid. ActiveAcq can become the operational layer over QuickBooks.

The most valuable workflow is:

1. Create project and phase.
2. Initialize budget by GL/task.
3. Upload contract or invoice PDF.
4. AI extracts draft fields and line items.
5. User reviews and assigns GL/budget task.
6. Backend validates every dollar.
7. Budget grid updates from ledger rows.
8. QuickBooks import/reconciliation confirms paid/pushed reality.

## Critical User Concern

The core concern is accounting-grade reliability.

When a user enters or edits invoices/contracts, the app must store data accurately and reliably. The budget grid must be trustworthy enough for accounting/project control use, closer to QuickBooks-level discipline than a casual spreadsheet.

This means:

- Money must be validated.
- Dates must be validated.
- Invoice totals must match invoice line totals.
- Contract totals must match contract task totals.
- Every financial line must resolve to the correct project, phase, GL account, and budget task.
- Status changes must follow the approval workflow.
- The grid must be ledger-backed.
- Edits must rebuild allocations correctly.
- Important changes must be auditable.

## Architecture Assessment

The strongest architectural idea in the app is the `financial_allocations` table.

That table should be the single financial ledger that drives the budget grid.

Desired data flow:

```text
contracts / invoices / change orders
        -> line items
        -> financial_allocations
        -> budget grid / drilldown / reconciliation
```

This is the correct direction because it prevents different screens from calculating different totals from different tables.

## Major Findings

### 1. The app concept is strong

The product is solving the right problem: project teams need a reliable view of budget, committed, billed, paid, remaining, and variance.

The budget grid should be the main source of operational truth.

### 2. Ledger-backed totals are essential

The app already has a `financial_allocations` model, which is the right backbone.

The risk is that some older code paths still use legacy tables or direct calculations. Those should be reduced or isolated so the grid has one source of truth.

### 3. Contract and invoice saves needed stricter validation

The app previously allowed too much ambiguity:

- Invoice line could be missing an exact budget task.
- GL could be ambiguous.
- Budget task could belong to a different phase.
- Invoice status could be edited too freely.
- Header and line totals needed stronger consistency checks.

The Codex pass began hardening this.

### 4. Approval workflow was bypassable

The frontend had a raw invoice status dropdown, and the backend generic invoice update route accepted status changes.

That is dangerous for accounting workflow.

Production rule:

```text
Generic invoice edit may edit fields.
Only workflow endpoints may change invoice status.
```

### 5. Access control needed tightening

Some audit/financial routes were missing auth or project access checks.

Production rule:

- Every financial route requires authentication.
- Every financial route checks project access.
- Admin/partner/PM/bookkeeper role behavior must be consistent.

### 6. Schema/migration path had real bugs

The local app exposed schema upgrade issues:

- `invoice_line_items.contract_line_item_id` index expected a column that did not exist on older databases.
- `phases.sort_order` and related phase columns were missing on older local tables.
- `CREATE TABLE IF NOT EXISTS` alone does not upgrade existing tables.

Fixes were added so existing DBs receive missing columns through explicit `ALTER TABLE ... ADD COLUMN IF MISSING` blocks.

### 7. Reference GL data was incomplete

The frontend and budget forms depend on `qb_accounts`, not only legacy `qb_codes`.

The repo now has an idempotent seed path for `qb_accounts` using the real chart of accounts.

### 8. AI extraction depends on Anthropic

AI extraction is currently built around Claude/Anthropic.

Local extraction was not working because `ANTHROPIC_API_KEY` was not set.

Recommended architecture:

```text
Claude reads PDF -> user reviews/corrects -> backend validates -> ledger stores accounting truth
```

Claude should reduce typing, not become the accounting authority.

## Work Already Completed In Codex 2

### Repo/process

- Created `plan.md` with production-readiness roadmap.
- Created `AGENTS.md` with strict separation rules.
- Recorded Render boundaries:
  - Never touch `My project`.
  - Use only `Codex 2 the webserver`.
  - Use only `Codex2 The Database`.

### Backend financial hardening

- Added strict money validation.
- Added strict date validation.
- Added exact allocation target validation.
- Prevented ambiguous GL auto-resolution when one GL maps to multiple tasks.
- Required invoice/contract lines to map to the correct phase budget line.
- Rejected GL/task mismatches.
- Rejected budget tasks from the wrong phase.
- Rejected invoice header total vs line total mismatch.
- Changed invoice creation to start as `pending`.
- Prevented raw invoice status changes through generic update route.
- Added workflow API calls for approval/pushed/paid/hold/reject/revert.

### Frontend hardening

- Replaced raw invoice status dropdown with explicit workflow actions.
- Added budget task requirements in contract/invoice review flows.
- Added GL + budget task requirements for header-only invoice cases.
- Fixed TypeScript build errors.

### Access control

- Added auth/project access checks to phase routes.
- Added auth/project access checks to audit routes.
- Added auth/project access checks to phase budget routes.
- Added auth/project access checks to import routes.

### Schema/deploy readiness

- Removed a real-looking hosted DB URL from `.env.example`.
- Added missing clean schema pieces for phases, `qb_accounts`, and `phase_budget_lines`.
- Added `qb_accounts` seeding from the real chart.
- Made startup fail if migrations/reference setup fail.
- Added `partner` as an accepted admin-created role.

### Tests/checks

- Added `npm test`.
- Added initial financial validation tests.
- Confirmed client build passes.
- Confirmed migration applies locally.
- Confirmed local login works.
- Confirmed phase creation works after schema patch.

## Current Known Issue

AI extraction will not work until `ANTHROPIC_API_KEY` is configured.

For local:

```bash
ANTHROPIC_API_KEY=...
```

must be added to:

```text
/Users/avrahambentov/Documents/active-main-clone/.env
```

For Render:

Add `ANTHROPIC_API_KEY` to:

```text
Codex 2 the webserver -> Environment
```

Do not add it to `My project`.

## What Still Needs Work

### 1. Finish accounting integrity

- Verify contract edit/update path as strictly as invoice creation.
- Verify invoice edit rebuilds allocation rows correctly.
- Ensure no other route can bypass invoice workflow.
- Add audit logs for all meaningful financial edits.

### 2. Expand tests

Add integration tests for:

- Create project.
- Create phase.
- Seed budget line.
- Create contract.
- Create invoice.
- Edit invoice.
- Verify ledger rows.
- Verify budget grid totals.
- Reject invalid GL/task/phase combinations.
- Reject total mismatches.

### 3. Finalize budget grid policy

Critical policy decision:

Should pending invoices count in the main billed column?

Recommended approach:

- Track pending invoices.
- Show pending/in-review separately.
- Only count approved/pushed/paid invoices in the main billed/actual column, depending on the accounting policy chosen.
- Keep pending invoices visible in drilldown.

### 4. QuickBooks reconciliation

Need to verify:

- Duplicate imports do not double-count.
- GL mismatches are visible.
- Missing QuickBooks rows are visible.
- Corrections are audit logged.
- Imported transactions can be traced to source batch/source row.

### 5. Render production setup

Correct setup:

```text
Codex 2 the webserver:
  DATABASE_URL = internal URL from Codex2 The Database
  NODE_ENV = production
  SESSION_SECRET = long generated secret
  SEED_TOKEN = long generated secret
  ANTHROPIC_API_KEY = Anthropic key
```

Then:

1. Deploy latest `main` from `codex-night`.
2. Server auto-runs schema.
3. Server auto-seeds `qb_accounts`.
4. Use `SEED_TOKEN` to create admin user.
5. Log in through the Render URL.

## Recommended Next Instructions For Claude

Ask Claude to review the current Codex 2 repo with these priorities:

1. Confirm no code path writes contracts/invoices/allocations outside `lib/financials.js`.
2. Confirm invoice status cannot be changed except through workflow endpoints.
3. Confirm budget grid totals are exclusively ledger-backed.
4. Confirm schema.sql can upgrade an older database, not only create a clean one.
5. Confirm `qb_accounts` and `phase_budget_lines` are correctly seeded/initialized.
6. Review the invoice/contract edit flows for allocation rebuild bugs.
7. Add integration tests for accounting-grade scenarios.
8. Verify Render env separation from original `My project`.

## Bottom Line

The app has the right product direction and a promising architecture, but the production bar is accounting trust.

The next phase should focus less on adding features and more on making sure every dollar entered through contracts/invoices lands on the correct ledger row and that every grid number can be explained.

The guiding rule should be:

```text
If the app cannot prove where a dollar belongs, it should not quietly put that dollar on the grid.
```
