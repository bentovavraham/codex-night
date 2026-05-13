# ActiveAcq Production Readiness Plan

This plan is for the new working repo only:

- Working folder: `/Users/avrahambentov/Documents/active-main-clone`
- GitHub origin: `https://github.com/bentovavraham/codex-night.git`
- The older local folder/repo is out of scope and must not be touched.

## Product Summary

ActiveAcq is a project financial control app for acquisition, construction, and real estate operations. Its core job is to track money from budget to contract to invoice to approval to QuickBooks/payment, then show that truth clearly on a budget grid.

The intended accounting flow is:

1. Budget is created by phase and task.
2. Contracts commit money against those budget lines.
3. Invoices bill against contracts or directly against a phase budget line.
4. Approvals move invoices through PM, partner/admin, pushed to QuickBooks, and paid.
5. The grid shows budget, committed, billed, paid, remaining, and variance with accounting-grade accuracy.
6. QuickBooks imports/reconciliation prove that the internal numbers match the accounting system.

The product has strong potential because it is more focused than QuickBooks for project cost control. QuickBooks is the accounting system of record, but ActiveAcq can become the project-facing financial cockpit for owners, PMs, partners, and bookkeepers.

## Production Goal

The priority is not more features. The priority is trust.

For this app to be production-ready, a user must be able to enter or edit contract and invoice data and know:

- Money values are stored exactly and consistently.
- Dates are valid and not silently changed.
- Every line is tied to the correct project, phase, GL account, and budget task.
- Invoice totals match invoice line totals.
- Contract totals match contract task totals.
- Status changes follow the approval workflow and cannot be bypassed.
- The budget grid is generated from the ledger, not from scattered calculations.
- Changes are auditable.
- QuickBooks reconciliation can explain differences instead of hiding them.

## Current Status

The new repo has been cloned and configured.

Important current repo state:

- `origin` points to `bentovavraham/codex-night`.
- `upstream` points to the original `bentovavraham/active`.
- Dependencies have been installed locally.
- Several backend and frontend hardening changes are already started in the new folder.
- The client build currently has TypeScript errors that need to be fixed before this can be considered stable.

Started hardening work:

- Added stricter money/date validation in the financial save path.
- Added stricter contract and invoice allocation rules.
- Stopped raw invoice status changes through the generic invoice update endpoint.
- Added explicit invoice workflow actions in the frontend API.
- Replaced the invoice status dropdown with workflow buttons.
- Added project access checks to several financial routes.
- Added missing schema definitions needed for a clean database boot.
- Added frontend validation pressure around budget task selection.

This work is not finished until the build passes, tests are added, and the database migration path is verified.

## Main Findings

### 1. The app has the right product idea

The app is aimed at a real operational problem: project teams need to know what is budgeted, committed, billed, paid, and still available. QuickBooks can store accounting transactions, but it does not naturally give project managers a clean acquisition/construction control grid.

The budget grid should become the main source of operational truth.

### 2. The allocation ledger is the right backbone

The `financial_allocations` table is the correct direction. Contract lines, invoice lines, change orders, and QuickBooks transactions should all resolve into ledger-style allocation records tied to budget lines.

That ledger should drive the grid.

The risk today is that some older paths still calculate totals from separate tables, old QuickBooks line tables, or partial fallback logic. That creates a chance that two screens show two different answers.

### 3. Contract and invoice saves need stricter accounting rules

The most important risk is silent bad data.

Examples of bad data the app must reject:

- Invoice header total does not equal invoice line total.
- Contract total does not equal contract task total.
- A line has a GL account but no budget task.
- A line has a budget task from the wrong phase.
- A line has a GL account that does not match the selected budget task.
- A user edits a financial document and the old allocation records are not properly replaced.
- A status is changed directly without going through approval.

These are not small UI bugs. They are accounting integrity problems.

### 4. The approval workflow was bypassable

The frontend had a raw invoice status dropdown. The backend generic invoice update route also accepted status changes.

That means someone could potentially move an invoice to approved, pushed, or paid without going through the proper workflow endpoint.

Production rule:

- The generic edit route may edit invoice fields.
- Only workflow routes may change invoice status.

### 5. Access control needed tightening

Some audit and financial routes were missing authentication or project membership checks. A production financial app must enforce access at the route level, not only in the UI.

Production rule:

- Every financial route requires authentication.
- Every phase, invoice, contract, import, and audit action checks project access.
- Admin access is explicit.
- Partner/bookkeeper/PM behavior is consistent across backend and frontend.

### 6. The database migration path was fragile

The schema file referenced some tables before reliably creating them. Some important objects were only in older migration scripts, not the clean startup schema.

Production rule:

- A clean database can be created from zero without manual steps.
- Existing databases can migrate forward safely.
- Startup must fail loudly if required migrations fail.

### 7. Secrets need cleanup

`.env.example` contained a real-looking hosted database URL/password.

Production rule:

- Rotate any exposed credential if it was real.
- Keep `.env.example` as placeholders only.
- Store secrets in Render/GitHub environment settings, not in source.

### 8. Frontend is useful but not production-complete

The frontend has meaningful screens for budget, commitments, invoices, import, and audit. It also has placeholder routes for features that are not complete.

Production rule:

- Hide unfinished routes or mark them clearly as unavailable.
- Make the contract/invoice forms strict and hard to misuse.
- Show validation errors before save.
- Show server errors clearly.
- Use explicit workflow buttons for approval/pushed/paid/hold/reject/revert.
- Do browser QA on desktop and mobile widths.

### 9. Build and tests are not yet production-ready

There are no meaningful automated tests yet, and the current client build has TypeScript errors.

Current known build blockers:

- Budget cross-check API type is missing `invoice_header_total` and `invoice_lines_total`.
- Commitments drilldown call is missing the grid cell argument.
- Import drawer has unused state variables.
- Import drawer discard callback type does not match the expected async callback.

Production rule:

- Build must pass.
- Server syntax checks must pass.
- Financial API tests must prove totals and ledger rows.
- Frontend smoke tests must prove the main forms and grid render.

## Accounting-Grade Requirements

### Money

- Store money in database numeric columns, not floats.
- Validate all user-entered money before save.
- Reject negative values except where explicitly allowed, such as credits or adjustments.
- Enforce no more than two decimal places unless a specific field needs more precision.
- Compare totals using normalized decimal math.

### Dates

- Accept only valid dates.
- Store dates consistently.
- Reject impossible or ambiguous dates.
- Preserve intended invoice date, due date, contract date, paid date, and import date.

### Contract Saves

Contract save must:

- Require vendor, project, phase, and at least one line/task.
- Require each line to have a description.
- Require each line to have an amount.
- Require each line to resolve to a valid phase budget line.
- Reject a selected budget task if it belongs to another phase.
- Reject mismatched GL/task combinations.
- Save the contract and all allocation rows in one transaction.
- Rebuild financial allocation rows consistently when edited.
- Leave an audit event for create and edit.

### Invoice Saves

Invoice save must:

- Require project and phase.
- Require vendor or contract relationship where applicable.
- Require invoice number/date when applicable.
- Require header total and line totals to agree.
- Require each invoice line to resolve to a valid phase budget line.
- Reject direct status changes.
- Start as pending unless created through an approved import/workflow.
- Save invoice, line items, and allocation rows in one transaction.
- Rebuild financial allocation rows consistently when edited.
- Leave an audit event for create and edit.

### Invoice Workflow

Allowed status movement should be explicit:

- `pending` to PM approved.
- PM approved to partner/admin approved.
- Approved to pushed to QuickBooks.
- Pushed to paid.
- Any appropriate status to hold.
- Rejection requires a reason.
- Revert requires a reason and should be audit logged.

The exact status names can be adjusted, but the rule is fixed: no hidden dropdown bypass.

### Budget Grid

The budget grid must:

- Read from the ledger/allocation model.
- Show budget, committed, billed, pushed/paid, remaining, and variance consistently.
- Explain every total through drilldown.
- Surface unassigned or invalid items instead of hiding them.
- Cross-check header totals, line totals, and ledger totals.
- Fail loudly when totals do not reconcile.

## Critical Accounting Policy Decision

One decision needs to be made clearly before finalizing the grid:

Should the grid's "Billed" column include every saved vendor invoice, or only invoices after a specific approval status?

Recommended approach:

- Track every entered invoice as an internal invoice record.
- Show "Entered/In Review" separately from "Approved Billed" if needed.
- Only count invoices in the main billed/actual column once they pass the selected approval threshold.
- Still show pending invoices in drilldown so nothing disappears.

This matters because the current ledger direction can record invoice allocations early, while the product language sometimes implies invoices count after approval or push.

## Implementation Plan

### Phase 1: Stop Bad Data

Goal: prevent corrupt financial records from being created.

Tasks:

- Finish strict contract save validation.
- Finish strict invoice save validation.
- Require GL and budget task on every financial line.
- Reject mismatched project/phase/task combinations.
- Reject invoice header/line mismatches.
- Reject contract header/line mismatches.
- Remove all raw invoice status update paths.
- Ensure every save happens inside a database transaction.
- Ensure allocation rebuilds are deterministic on edit.

Acceptance:

- A bad invoice cannot be saved.
- A bad contract cannot be saved.
- A user cannot change invoice status through a generic edit.
- Every saved line maps to exactly one budget line.

### Phase 2: Lock Down Access and Audit

Goal: make financial data private, traceable, and controlled.

Tasks:

- Enforce authentication on every financial route.
- Enforce project access checks on phase, budget, invoice, contract, import, and audit routes.
- Normalize roles across backend and frontend.
- Decide whether `partner` and `bookkeeper` are official roles.
- Add audit logs for create, edit, approve, reject, hold, revert, push, paid, import, and correction.
- Prefer void/reversal behavior over hard delete for financial records.

Acceptance:

- Unauthenticated requests cannot read or mutate financial records.
- Users cannot access projects they do not belong to.
- All important financial mutations leave an audit trail.

### Phase 3: Make the Grid Accounting-Grade

Goal: make the budget grid match the ledger and explain every number.

Tasks:

- Make `financial_allocations` the single source for committed/billed/paid totals.
- Remove or isolate older calculation paths.
- Add cross-checks between invoice header, invoice lines, allocation rows, and QuickBooks rows.
- Add drilldown for every grid total.
- Add an exception panel for unmatched or invalid records.
- Decide how pending invoices affect grid totals.
- Add exact fixtures for budget to contract to invoice to paid scenarios.

Acceptance:

- Grid totals equal ledger totals.
- Drilldown explains every displayed number.
- Cross-checks catch mismatches.
- Pending, approved, pushed, and paid amounts are represented according to the chosen accounting policy.

### Phase 4: QuickBooks Reconciliation

Goal: make QuickBooks imports useful and trustworthy.

Tasks:

- Validate import batches before they affect financial totals.
- Detect duplicate QuickBooks transactions.
- Detect GL mismatches.
- Detect project/phase mismatch.
- Keep imported transactions traceable to source batch and source row.
- Provide correction workflow for unmatched or wrong-coded items.
- Show reconciliation status on the audit screen and grid drilldowns.

Acceptance:

- Imported QuickBooks data can be traced back to source rows.
- Duplicate imports do not double-count.
- Mismatches are visible and correctable.
- Internal paid/pushed numbers reconcile to QuickBooks.

### Phase 5: Frontend Production Pass

Goal: make the app hard to misuse.

Tasks:

- Fix current TypeScript build errors.
- Tighten invoice and contract form validation.
- Make required accounting fields visually clear.
- Replace status dropdowns with explicit workflow buttons.
- Show clear save errors from the backend.
- Add loading, empty, error, and success states.
- Hide or complete unfinished placeholder routes.
- Verify desktop and mobile layouts.
- Keep the UI operational and direct, more like a financial tool than a marketing site.

Acceptance:

- `npm run build` passes in the client.
- Main screens render without broken controls.
- Forms prevent incomplete financial saves before hitting the backend where possible.
- Server validation still protects the data if the frontend is bypassed.

### Phase 6: Database and Deployment Readiness

Goal: make the app deployable and recoverable.

Tasks:

- Consolidate schema and migrations.
- Verify clean database creation.
- Verify migration from existing data.
- Make startup fail loudly on migration failure.
- Rotate exposed credentials if needed.
- Replace `.env.example` secrets with placeholders.
- Add seed data for development.
- Add backup expectations for production Postgres.
- Configure Render staging and production environments.

Acceptance:

- A new database can boot cleanly.
- A migration failure does not get ignored.
- No real secrets are committed.
- Staging can deploy and run against a real database.

### Phase 7: Automated Tests

Goal: prove the accounting logic repeatedly.

Tasks:

- Add backend tests for contract save.
- Add backend tests for invoice save.
- Add backend tests for approval workflow.
- Add backend tests for allocation rebuild on edit.
- Add backend tests for budget grid totals.
- Add backend tests for QuickBooks import duplicate handling.
- Add frontend smoke tests for invoice form, contract form, budget grid, and approval buttons.
- Add build/test checks to CI.

Acceptance:

- Tests cover the normal financial path.
- Tests cover bad input rejection.
- Tests cover edit/rebuild behavior.
- CI fails if the app cannot build or if accounting totals drift.

## Immediate Next Steps

1. Fix the current client TypeScript build errors.
2. Finish the strict invoice and contract save path.
3. Add the first backend financial integrity tests.
4. Verify the schema against a clean throwaway database.
5. Decide the accounting policy for pending invoices on the budget grid.
6. Clean `.env.example` and rotate any exposed real credential.
7. Run the app locally and do browser QA on invoice, contract, import, and budget grid flows.

## Production Acceptance Checklist

- Clean database can migrate from zero.
- Existing database can migrate forward.
- No unauthenticated financial routes.
- Project access is enforced on financial data.
- Contract save rejects invalid totals and missing budget task/GL assignment.
- Invoice save rejects invalid totals and missing budget task/GL assignment.
- Invoice status cannot be changed through generic edit.
- Approval, hold, reject, revert, pushed, and paid actions are explicit and audit logged.
- Allocation ledger is rebuilt correctly after edits.
- Budget grid totals match ledger totals.
- Grid drilldowns explain every number.
- QuickBooks imports do not duplicate totals.
- Reconciliation mismatches are visible.
- Frontend build passes.
- Backend checks pass.
- Core financial tests pass.
- Placeholder routes are hidden or completed.
- Secrets are not committed.
- Production database has backups.

## Open Decisions

- Should pending invoices appear in the main billed column, or in a separate pending/review column?
- Should header-only invoices and contracts remain allowed, or should every record require explicit line items?
- Which roles are final: `pm`, `partner`, `bookkeeper`, `admin`, or a smaller set?
- Should PM approval and partner approval be separate statuses or separate timestamps on one approved state?
- How much historical data needs to be migrated/backfilled into the allocation ledger?
- Should QuickBooks remain the accounting system of record, with ActiveAcq as the project control system, or should ActiveAcq eventually become authoritative for some accounting states?

## Guiding Rule

For production, the app should prefer rejecting incomplete data over guessing.

If the app cannot prove where a dollar belongs, it should not quietly put that dollar on the grid.
