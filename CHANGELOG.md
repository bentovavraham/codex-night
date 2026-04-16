# Changelog

All notable changes to ActiveAcq are documented here.

---

## 2026-04-16 — Bug Fixes & Core Feature Buildout

Session with Avraham. Focus: make the app usable as a tracking/organization tool (Phase 1 MVP).

### Bug Fixes
- **Invoices not showing in invoice view** — Fixed NULL project_id query bug. Changed `COALESCE(i.project_id, c.project_id) = $1` to `(i.project_id = $1 OR c.project_id = $1)` so standalone invoices and older invoices with NULL project_id are no longer silently excluded.
- **"File not found" on contract/invoice PDFs** — Render wipes local disk on redeploy. Moved file storage from local filesystem to Postgres (`files` table with BYTEA column). SharePoint integration planned for later.

### New Features
- **Invoice hold status** ��� New "Hold" button on pending invoices. Puts invoice in `on_hold` status with optional note. "Release" button sends it back to pending. Yellow badge for on_hold.
- **Revert any invoice status** — "Revert" button on approved, rejected, pushed, and paid invoices. Sends them back to pending and clears paid_date/QB reference. No more "locked forever" invoices.
- **Split invoices across multiple contracts** — New "Split across contracts" tab when creating an invoice. Allocate portions of one invoice to different contracts. Backend validates each allocation against contract remaining balance. Invoice list shows purple "split (N)" badge. Detail view shows allocation breakdown table. New `invoice_contracts` junction table.
- **QB Code type-ahead picker** — Replaced the long scrollable `<select>` dropdown with a searchable type-ahead input. Just start typing the code or name to filter. Used in contract creation form.
- **Project inline editing** — Edit button next to project name. Inline edit for name, description, and status (active/on hold/completed/archived). Live updates without page reload.
- **on_hold badge styling** — Yellow badge for on_hold status. Also added completed and archived badge styles.

### Backend Changes
- `POST /api/invoices/:id/hold` — put invoice on hold with optional note
- `POST /api/invoices/:id/revert` — revert any non-pending invoice back to pending
- `POST /api/invoices` — now accepts `contracts` array for multi-contract allocation
- `GET /api/invoices/:id` — now returns `contract_allocations` array
- `GET /api/projects/:id/invoices` — now returns `alloc_count` for split badge
- Invoice edit lock removed — all invoices are now editable regardless of status
- New DB table: `files` (id, filename, mime_type, data, size, created_at)
- New DB table: `invoice_contracts` (invoice_id, contract_id, amount)

### Files Changed
- `lib/storage.js` — rewrote from local disk to Postgres
- `db/schema.sql` — added `files` and `invoice_contracts` tables
- `routes/invoices.js` — hold, revert, multi-contract, alloc_count, removed edit lock
- `public/js/api.js` — added holdInvoice, revertInvoice methods
- `public/js/app.js` — pass onProjectUpdate to Project component
- `public/js/components/Project.js` — inline edit mode
- `public/js/components/Contracts.js` — QbCodePicker component, approved status option
- `public/js/components/Invoices.js` — hold/revert buttons, multi-contract modal, split badge, allocation display
- `public/styles.css` — on_hold, completed, archived badge styles

---

## Pre-2026-04-16 — Initial Build (PRs #1–#7)

- Initial scaffold of project financial manager
- Shell-free DB bootstrapping with auto-migrate + token-gated admin API
- Real QB chart of accounts, file uploads, Claude AI invoice extraction, smart-search
- Idempotent session PK fix
- Admin page for pasted imports
- Invoice extract route path fix
- Contract extraction, standalone invoices, edit mode, sort/filter, approval queue
- Audit trail, rejection notes, bulk approve, CSV export, overspend block
- Frontend overhaul: toasts, bulk approve, rejection flow, activity logs, CSV export

---

## Remaining / Planned

### Phase 1 (MVP — tracking & organization)
- [ ] Change order workflow — design needed
- [ ] Project name/fields editing fix (built but needs debugging)
- [ ] Split invoice filtering improvements

### Phase 2 (approval workflows)
- [ ] Roles & permissions (viewer, PM, admin, bookkeeper)
- [ ] Formal approval chains for budget amendments and change orders

### Future
- [ ] SharePoint API integration for document storage
- [ ] QuickBooks API integration (push approved invoices as AP bills, pull payments)
- [ ] AI budget benchmarking from historical project data
- [ ] AI project management tracking & accountability
