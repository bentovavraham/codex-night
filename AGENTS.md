# Agent Instructions

These instructions apply to this repository only:

`/Users/avrahambentov/Documents/active-main-clone`

Do not work in, edit, commit from, or otherwise touch the older local repo/folder. This repo is intentionally separate.

Do not touch the original Render project named `My project`. That is the Claude/original app and is off-limits for Render changes, local work, deploys, database changes, environment variables, or debugging.

## Repository Identity

- Current working repo: `/Users/avrahambentov/Documents/active-main-clone`
- GitHub origin: `https://github.com/bentovavraham/codex-night.git`
- Upstream reference only: `https://github.com/bentovavraham/active.git`

Treat `origin` as the active repo for this work. Treat `upstream` as read-only context unless the user explicitly says otherwise.

## Render Boundaries

There are separate Render projects/services:

- `My project`: original Claude app. Never touch.
- `Codex 2 the webserver`: Codex app web service. This is the Render web target for this repo.
- `Codex2 The Database`: Codex app database. This is the Render database target for this repo.

Keep the Codex app fully separate from the original Claude app:

- Do not reuse the original app's Render service.
- Do not reuse the original app's Render database.
- Do not change the original app's Render environment variables.
- Do not deploy this repo to the original app's Render service.
- The Codex web service should use only the Codex database internal URL.

## Primary Mission

Keep working to execute `plan.md` until the app is production-ready, with minimal interruptions to the user.

The main objective is to make ActiveAcq reliable enough for accounting-grade contract, invoice, budget grid, and QuickBooks reconciliation workflows.

Prioritize:

1. Correct financial data storage.
2. Reliable contract and invoice editing.
3. Ledger-backed budget grid accuracy.
4. Strict approval workflow.
5. Route-level security and project access control.
6. Clean migrations and deploy readiness.
7. Frontend usability and build stability.
8. Automated tests for financial integrity.

## Required Workflow

Before starting substantive work:

1. Read `plan.md`.
2. Check `git status`.
3. Confirm work is happening in `/Users/avrahambentov/Documents/active-main-clone`.
4. Continue from the current state instead of restarting from scratch.

While working:

- Execute the next useful item from `plan.md`.
- Prefer making progress over asking questions.
- Ask the user only when a decision materially affects accounting policy, data ownership, production risk, or destructive action.
- Keep interruptions minimal.
- Do not pause after analysis if the next implementation step is clear.
- Do not touch unrelated files or unrelated repos.
- Do not revert user changes unless explicitly requested.
- Update `plan.md` when major items are completed, blocked, or changed.

## Accounting-Grade Rules

The app must reject incomplete or ambiguous financial data.

Contract and invoice saves must:

- Validate money and dates strictly.
- Require every financial line to resolve to the correct project, phase, GL account, and budget task.
- Reject mismatched GL/task combinations.
- Reject budget tasks from the wrong phase.
- Reject header/line total mismatches.
- Save document records and allocation ledger rows transactionally.
- Rebuild ledger rows predictably after edits.
- Preserve an audit trail for meaningful financial changes.

The budget grid must:

- Be driven by the financial allocation ledger.
- Explain every displayed total through drilldown or reconciliation detail.
- Surface unassigned, mismatched, or unreconciled data instead of hiding it.
- Match QuickBooks-imported data according to the chosen reconciliation policy.

Invoice statuses must:

- Move only through explicit workflow endpoints.
- Never be changed through a generic edit endpoint or raw frontend dropdown.
- Record approval, rejection, hold, pushed, paid, and revert actions clearly.

## Frontend Expectations

The frontend should behave like a serious financial operations tool.

- Make required accounting fields clear.
- Prevent incomplete saves before submission where possible.
- Still rely on backend validation as the final authority.
- Use explicit action buttons for invoice workflow.
- Hide or complete unfinished placeholder routes.
- Show useful error states.
- Maintain responsive, readable layouts.
- Run the client build after frontend changes.

## Verification Expectations

Use the strongest practical verification for each change.

Expected checks include:

- Backend syntax checks for edited server files.
- Client TypeScript build after frontend edits.
- Database migration verification when schema changes.
- Financial integrity tests as they are added.
- Browser QA for important frontend flows when the app is running.

Do not claim production readiness until builds, migrations, and core accounting tests pass.

## Communication Style

Keep the user informed, but do not over-interrupt.

- Provide concise progress updates during longer work.
- Report blockers clearly.
- Ask focused questions only when needed.
- Prefer completing the next concrete step over presenting options.

## Current Priority

Continue from `plan.md`.

The immediate priorities are:

1. Fix current client TypeScript build errors.
2. Finish strict invoice and contract save behavior.
3. Add backend financial integrity tests.
4. Verify the database schema against a clean database.
5. Resolve the accounting policy for pending invoices on the budget grid.
6. Clean secrets from example environment files.
7. Run local app/browser QA for invoice, contract, import, and budget grid flows.

If no newer user instruction exists, proceed with these priorities in order.
