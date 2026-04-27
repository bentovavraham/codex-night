# ActiveAcq — Product Requirements Document

**Version:** 2.0  
**Date:** April 27, 2026  
**Owner:** Active Acquisitions (Seth / Avraham Bentov)  
**Development:** Claude (Anthropic)

---

## 1. Product Overview

ActiveAcq is an internal financial operations platform for a real-estate acquisitions firm. It replaces spreadsheet-based tracking of construction and due-diligence costs across a portfolio of projects. The core workflow: upload vendor PDFs → AI extracts structured data → review and approve → financial dashboards update in real time.

**Competitors (for design/feature reference):** Buildertrend, Procore  
**Design philosophy:** Spreadsheet-like density (Google Sheets aesthetic), not Procore's heavy card-based UI. Clean, warm, business-grade. No clutter.

---

## 2. Users & Roles

| Role | Permissions |
|------|-------------|
| **admin** | Full access. Final approval authority. Manages users, QB codes, budget templates. Seth maps to this role. |
| **partner** | Second-tier approver. Can see all projects they are members of. |
| **pm** | First-tier approver. Manages day-to-day contracts and invoices for assigned projects. |

Authentication is session-based (email + password). Sessions persist 14 days in PostgreSQL.  
Admin users bypass `project_members` access checks — never require a members join to block admin.

---

## 3. Design System

### Visual Identity
- **Sidebar:** warm charcoal (`#1e1a17`) with subtle ridge texture
- **Primary accent:** terracotta `#c4522a`
- **Secondary accent:** amber `#e8921a` — used sparingly (notifications, warnings only — never on financial amounts)
- **Background:** warm off-white `#f5f2ed`
- **Surface (cards, headers):** `#faf8f5`
- **Text hierarchy:** 4 levels (`--text-1` through `--text-4`)
- **Borders:** `#e2ddd8`
- **Status colors:** green (approved/active), blue (pending), red (rejected/danger), grey (voided/discarded)

### Layout Rules
- Fixed left sidebar (160px) for global nav
- Main content: full-width, table/grid based — no cards
- Slide-in drawers (right side, 640px wide) for detail views, forms, and import queue
- All numbers in monospace font (`--font-mono`)
- Compact row heights (28–34px for data rows)
- No emojis in data UI
- Save/action buttons always in a sticky footer outside the scroll area (never scroll off-screen)

### CSS Approach
- CSS Modules per component file
- CSS custom properties (design tokens) defined in `styles/base.css`
- No Tailwind, no UI component libraries

---

## 4. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Backend | Node.js / Express | Node ≥18, Express 4 |
| Database | PostgreSQL | Any recent version |
| AI Extraction | Anthropic Claude Opus 4.7 | `@anthropic-ai/sdk ^0.89` |
| Frontend | React + TypeScript | React 19, TS ~6.0 |
| Build tool | Vite | ^8.0 |
| Routing | React Router | v7 |
| Server state | TanStack Query | v5 |
| Tables | TanStack Table | v8 |
| Client state | Zustand | v5 |
| Auth | bcryptjs + express-session | — |
| Session store | connect-pg-simple | — |
| File upload | Multer | v2 |
| File storage | PostgreSQL BYTEA | in `files` table |
| Deployment | Render.com | Starter plan |

**Build command (Render):**
```
npm install && npm install --prefix client && npm run build --prefix client
```
**Start command:** `node server.js`

> **Critical:** `vite`, `typescript`, `@types/*`, and `@vitejs/plugin-react` must be in `dependencies` (not `devDependencies`) in `client/package.json` because Render sets `NODE_ENV=production` during build, which causes npm to skip devDependencies.

---

## 5. Project Structure

```
/
├── server.js                  # Express app entry — middleware, routes, static, DB migration on boot
├── render.yaml                # Render deployment config
├── package.json               # Root dependencies (express, pg, multer, claude, bcrypt, etc.)
├── db/
│   ├── pool.js                # pg Pool singleton (DATABASE_URL)
│   └── schema.sql             # Full idempotent DDL (all CREATE TABLE IF NOT EXISTS)
├── lib/
│   └── extract.js             # All Claude AI extraction functions
├── middleware/
│   └── auth.js                # requireAuth middleware (checks session.userId)
├── routes/
│   ├── auth.js
│   ├── projects.js
│   ├── phases.js
│   ├── budget.js              # Project-level budget lines
│   ├── phaseBudget.js         # Phase budget lines + activity feed
│   ├── contracts.js
│   ├── invoices.js
│   ├── changeOrders.js
│   ├── tmCharges.js
│   ├── contractExpenses.js
│   ├── import.js              # Bulk PDF import queue
│   ├── uploads.js             # File upload/serve (BYTEA)
│   ├── qbCodes.js
│   ├── users.js
│   ├── vendors.js
│   ├── customers.js
│   ├── alerts.js
│   ├── byTrade.js
│   └── admin.js
├── uploads/                   # Multer temp dir (local dev only)
├── public/                    # Legacy static fallback (keep — used if Vite build missing)
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx
        ├── api/
        │   └── client.ts      # All API methods, typed
        ├── components/
        │   ├── AppShell.tsx   # Layout wrapper (sidebar + outlet)
        │   ├── Sidebar.tsx    # Nav: projects, phases, admin
        │   └── TopBar.tsx     # Breadcrumb + actions
        ├── screens/           # One file per route/view
        │   ├── TypeSelect.tsx / .module.css
        │   ├── ProjectList.tsx / .module.css
        │   ├── ProjectDetail.tsx / .module.css
        │   ├── PhaseHome.tsx / .module.css
        │   ├── BudgetGrid.tsx / .module.css
        │   ├── CommitmentsGrid.tsx / .module.css
        │   ├── ContractsTab.tsx / .module.css
        │   ├── InvoicesTab.tsx / .module.css
        │   ├── ContractPanel.tsx / .module.css
        │   ├── LineItemPanel.tsx / .module.css
        │   ├── ImportDrawer.tsx / .module.css
        │   └── PlaceholderTab.tsx
        └── styles/
            └── base.css       # CSS custom properties (design tokens)
```

---

## 6. Database Schema

### Users & Auth
```sql
users        (id, name, email UNIQUE, role, password_hash, created_at)
session      (sid PK, sess JSONB, expire TIMESTAMP)  -- connect-pg-simple
```

### Projects & Phases
```sql
projects        (id, name, description, status, project_type, created_by FK→users, created_at, updated_at)
project_members (id, project_id FK, user_id FK, role, added_at)  UNIQUE(project_id, user_id)
phases          (id, project_id FK, name, phase_number, status, start_date, end_date, notes, sort_order, created_at, updated_at)
```

### QB / Chart of Accounts
```sql
qb_codes    (id, code, name, parent_id FK→qb_codes, level, created_at)   -- hierarchical cost codes
qb_accounts (id, account_number, full_name, short_name, is_leaf, sort_order)  -- GL accounts for invoice lines
```

### Budget
```sql
budget_lines (
  id, project_id FK, qb_code_id FK,
  original_amount, current_amount, uncommitted_estimate,
  created_at, updated_at
)
budget_line_logs (
  id, budget_line_id FK, old_amount, new_amount,
  changed_by FK→users, note, changed_at
)

phase_budget_lines (
  id, phase_id FK,
  task_name, discipline, section, sub_group,
  calculation_method, budgeted_amount, consultant, notes,
  sort_order, source, amount_modified,
  created_at, updated_at
)
-- section values: 'professional_fees' | 'application_fees' | 'construction'
-- source values: 'template' | 'user'

phase_budget_line_logs (
  id, line_id FK, changed_by FK→users,
  field, old_value, new_value, note, changed_at
)
```

### Contracts
```sql
contracts (
  id, project_id FK, phase_budget_line_id FK,
  vendor_name, description, total_value,
  contract_date, reference_number,
  status,   -- 'draft'|'pending'|'active'|'completed'|'voided'
  file_reference, earmarked_amount,
  created_by FK→users, created_at, updated_at
)
contract_lines      (id, contract_id FK, qb_code_id FK, amount)
contract_line_items (id, contract_id FK, sort_order, billing_type, description, budgeted_amount)
-- billing_type: 'fixed'|'tm'|'expense'
contract_logs       (id, contract_id FK, action, detail, changed_by FK, changed_at)
```

### Change Orders
```sql
change_orders (
  id, contract_id FK, co_number, description, amount,
  status,   -- 'pending'|'approved'|'rejected'
  file_reference, qb_code_id FK,
  tm_authorized BOOLEAN, tm_not_to_exceed NUMERIC,
  pm_approved_by FK, pm_approved_at,
  partner_approved_by FK, partner_approved_at,
  approved_by FK, approved_at,
  rejection_note,
  created_by FK, created_at, updated_at
)
change_order_logs (id, change_order_id FK, action, detail, changed_by FK, changed_at)
```

### Invoices
```sql
invoices (
  id, contract_id FK (nullable), project_id FK, phase_budget_line_id FK,
  invoice_number, vendor_name, amount,
  invoice_date, description,
  status,         -- 'pending'|'pm_approved'|'partner_approved'|'approved'|'pushed'|'paid'|'rejected'|'on_hold'
  invoice_type,   -- 'fixed'|'tm'|'expense'
  qb_code_id FK, file_reference,
  pm_approved_by FK, pm_approved_at,
  partner_approved_by FK, partner_approved_at,
  approved_by FK, approved_at,
  paid_date, qb_reference_id, rejection_note,
  created_by FK, created_at, updated_at
)
invoice_lines      (id, invoice_id FK, qb_code_id FK, current_amount, created_at)
invoice_line_items (
  id, invoice_id FK, contract_line_item_id FK,
  billing_type, description, line_date,
  person, hours, rate, amount,
  qb_account_id FK, sort_order
)
invoice_contracts  (id, invoice_id FK, contract_id FK, amount)  -- multi-contract allocation
invoice_logs       (id, invoice_id FK, action, detail, changed_by FK, changed_at)
```

### T&M and Expenses
```sql
tm_charges (
  id, contract_id FK, change_order_id FK,
  description, hours, rate, amount, charge_date,
  qb_code_id FK, file_reference, status,
  pm_approved_by FK, partner_approved_by FK,
  created_by FK, rejection_note, notes, created_at
)
contract_expenses (
  id, contract_id FK,
  category,   -- 'travel'|'tolls'|'food'|'hotel'|'copies'|'other'
  description, amount, expense_date,
  qb_code_id FK, file_reference, status,
  pm_approved_by FK, partner_approved_by FK,
  created_by FK, rejection_note, notes, created_at
)
```

### Vendor Knowledge Base
```sql
vendors           (id, qb_id, name UNIQUE, created_at)
customers         (id, qb_id, name UNIQUE, created_at)
vendor_profiles   (id, vendor_name UNIQUE, notes TEXT, created_at, updated_at)
extraction_examples (
  id, vendor_name, document_type,
  fields_json JSONB, confirmed_by FK→users, created_at
)
```

### File Storage
```sql
files (id UUID PK, filename, mime_type, data BYTEA, size, created_at)
```
Files stored as BYTEA in Postgres. Referenced by `file_reference` (UUID string) in contracts/invoices.

### Bulk Import Queue
```sql
import_queue (
  id, phase_id FK,
  original_filename, file_reference,
  doc_type,             -- 'contract'|'invoice'
  doc_type_confidence,  -- 'high'|'medium'|'low'
  extracted_data JSONB,
  suggested_budget_line_id FK→phase_budget_lines,
  match_confidence,     -- 'high'|'medium'|'low'
  status,               -- 'queued'|'extracting'|'needs_review'|'confirmed'|'failed'|'discarded'
  confirmed_contract_id FK, confirmed_invoice_id FK,
  error_message,
  created_by FK→users, created_at, updated_at
)
```

---

## 7. API Endpoints

### Authentication
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login (email + password) |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/auth/me` | Current user info |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects (admin: all; others: members only) |
| POST | `/api/projects` | Create project |
| GET | `/api/projects/:id` | Project detail + members |
| PUT | `/api/projects/:id` | Update name/description/status |
| POST | `/api/projects/:id/members` | Add or update member role |
| GET | `/api/projects/:id/health` | Dashboard summary (contract stats, budget health) |

### Phases
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/:projectId/phases` | List phases |
| POST | `/api/projects/:projectId/phases` | Create phase |
| GET | `/api/phases/:phaseId` | Phase detail with project metadata |
| PATCH | `/api/phases/:phaseId` | Update phase fields |
| DELETE | `/api/phases/:phaseId` | Delete phase |

### Phase Budget
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/phases/:phaseId/budget` | Budget lines with rolled-up financials |
| PATCH | `/api/budget-lines/:id` | Update budget amount (with audit log) |
| POST | `/api/phases/:phaseId/budget/init` | Initialize from template |
| GET | `/api/budget-lines/:id/activity` | Audit + contracts + invoices for line |
| GET | `/api/qb-accounts` | QB GL accounts for invoice line allocation |

### Contracts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/phases/:phaseId/contracts` | List contracts for phase |
| POST | `/api/contracts` | Create contract + line items |
| GET | `/api/contracts/:id` | Contract detail with line items + invoices |
| PUT | `/api/contracts/:id` | Update contract |
| DELETE | `/api/contracts/:id` | Delete contract |
| POST | `/api/contracts/extract` | Upload PDF → Claude extraction |

### Invoices
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/phases/:id/invoices` | List invoices (filterable by status/vendor/type) |
| POST | `/api/invoices` | Create invoice |
| GET | `/api/invoices/:id` | Invoice detail |
| PUT | `/api/invoices/:id` | Update invoice |
| DELETE | `/api/invoices/:id` | Delete invoice |
| POST | `/api/invoices/extract` | Upload PDF → Claude extraction |
| POST | `/api/invoices/:id/approve` | Advance approval tier |
| POST | `/api/invoices/:id/reject` | Reject with note |

### Change Orders
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contracts/:id/change-orders` | List COs for contract |
| POST | `/api/contracts/:id/change-orders` | Create CO |
| PUT | `/api/change-orders/:id` | Update CO |
| DELETE | `/api/change-orders/:id` | Delete CO |
| POST | `/api/change-orders/:id/approve` | Approve (3-tier) |
| POST | `/api/change-orders/:id/reject` | Reject with note |

### T&M Charges
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contracts/:id/tm-charges` | List T&M charges |
| POST | `/api/contracts/:id/tm-charges` | Create T&M charge |
| GET | `/api/tm-charges/:id` | Detail |
| PUT | `/api/tm-charges/:id` | Update |
| DELETE | `/api/tm-charges/:id` | Delete |
| POST | `/api/tm-charges/:id/approve` | Approve (3-tier) |
| POST | `/api/tm-charges/:id/reject` | Reject |

### Contract Expenses
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contracts/:id/expenses` | List expenses |
| POST | `/api/contracts/:id/expenses` | Create expense |
| GET | `/api/expenses/:id` | Detail |
| PUT | `/api/expenses/:id` | Update |
| DELETE | `/api/expenses/:id` | Delete |
| POST | `/api/expenses/:id/approve` | Approve (3-tier) |
| POST | `/api/expenses/:id/reject` | Reject |

### Bulk Import
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/phases/:phaseId/import` | Upload multiple PDFs → queue for extraction |
| GET | `/api/phases/:phaseId/import-queue` | Queue status (with suggested_line_name join) |
| PATCH | `/api/import-queue/:id` | Update doc_type, budget line, extracted_data |
| POST | `/api/import-queue/:id/confirm` | Confirm → transactionally create contract or invoice |
| DELETE | `/api/import-queue/:id` | Discard (marks status=discarded) |

### Files
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/files` | Upload file (multipart → BYTEA) |
| GET | `/api/files/:reference` | Serve/stream file by UUID reference |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/status` | DB health (row counts) |
| POST | `/api/admin/create-user` | Create user (name, email, password, role) |
| POST | `/api/admin/reset-password` | Reset password by email |
| POST | `/api/admin/replace-qb-codes` | Wipe + reseed QB chart of accounts |
| POST | `/api/admin/seed-qb-codes` | Initial seed (refuses if codes already present) |
| POST | `/api/admin/import-vendors` | Bulk upsert vendors array |
| POST | `/api/admin/import-customers` | Bulk upsert customers array |

### Utility
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alerts` | Financial alerts (overbilled, CO creep, budget pressure) |
| GET | `/api/by-trade?status=` | Cross-project contracts grouped by QB code |
| GET | `/api/qb-codes` | QB code hierarchy (roots + flat) |
| GET | `/api/vendors?q=` | Vendor fuzzy search |
| GET | `/api/customers?q=` | Customer fuzzy search |
| GET | `/api/health` | DB connectivity ping |

---

## 8. AI Extraction (lib/extract.js)

**Model:** `claude-opus-4-7`  
**SDK:** `@anthropic-ai/sdk`  
**Method:** PDFs sent as native document blocks (not base64-in-text prompt)  
**Pattern:** Each function calls Claude with a strict JSON schema prompt, parses and returns structured data.

### classifyDocument(pdfBuffer)
Used in bulk import to decide which extractor to call.  
**Returns:** `{ type: 'contract' | 'invoice', confidence: 'high' | 'medium' | 'low' }`

### extractContract(pdfBuffer, context?)
**Returns:**
```json
{
  "vendor_name": "string",
  "total_value": 0,
  "contract_date": "YYYY-MM-DD or null",
  "reference_number": "string",
  "description": "1-3 sentence scope summary",
  "line_items": [
    { "billing_type": "fixed|tm|expense", "description": "string", "budgeted_amount": 0 }
  ],
  "confidence": { "vendor_name": "high|medium|low", "total_value": "...", "contract_date": "...", "reference_number": "..." }
}
```

### extractInvoice(pdfBuffer, context?)
**Returns:**
```json
{
  "invoice_number": "string",
  "vendor_name": "string",
  "amount": 0,
  "invoice_date": "YYYY-MM-DD or null",
  "services_thru_date": "YYYY-MM-DD or null",
  "summary": "1-2 sentence description",
  "line_items": [
    {
      "billing_type": "fixed|tm|expense",
      "description": "string",
      "person": "string or null",
      "line_date": "YYYY-MM-DD or null",
      "hours": null,
      "rate": null,
      "amount": 0
    }
  ],
  "confidence": { "invoice_number": "...", "vendor_name": "...", "amount": "...", "invoice_date": "..." }
}
```

### extractTMCharge(pdfBuffer, context?)
**Returns:** `{ description, hours, rate, amount, charge_date, confidence }`

### extractExpense(pdfBuffer, context?)
**Returns:** `{ amount, expense_date, category, description, confidence }`

### suggestContractLines(pdfBuffer, qbCodes[], totalValue)
Suggests QB code allocation for a contract's total value.  
**Returns:** `[ { qb_code_id, amount, confidence, reason } ]`

### suggestInvoiceLineCodes(pdfBuffer, lineItems[], qbAccounts[], vendorName)
Suggests GL account for each invoice line item.  
**Returns:** `[ { line_index, qb_account_id, account_number, confidence, reason } ]`

### Vendor Learning
- `extraction_examples` table stores confirmed JSON extractions per vendor + document type
- On next extraction for same vendor, prior examples are injected into the prompt
- `vendor_profiles.notes` also injected (rate cards, quirks, format notes)
- Accuracy improves automatically over time as more documents are confirmed

---

## 9. Screens & UI Behavior

### TypeSelect
Landing screen after login. Two cards: **Industrial** and **Residential**. Sets `project_type` in Zustand. Navigates to ProjectList.

### ProjectList
Spreadsheet table of all accessible projects.  
**Columns:** Project Name | Budget | Contracted | COS | T&M+Exp | Exposure | % Used | Invoiced | Paid | Buffer  
Aggregate totals row at top. Click row → ProjectDetail.

### ProjectDetail
Project metadata, status, and phase list. "Add Phase" button. Click phase → PhaseHome.

### PhaseHome
Tab container for a phase. Tabs: **Budget | Commitments | Contracts | Invoices | Alerts | History**  
"↑ Import" button in tab bar opens ImportDrawer.

### BudgetGrid
Primary financial view. Dense spreadsheet table.

**Columns:** Task Name | Discipline | Budget | Committed | CO | T&M | Exp | Billed | Paid | Remaining | % Used

**Row grouping:**
1. Section header rows (Professional Fees / Application Fees / Construction)
2. Sub-group header rows within each section
3. Data rows (individual budget lines)
4. Section subtotal rows
5. Grand total row at bottom

**Interaction:** Click any data row (not on a button/input) → opens LineItemPanel slide-in  
**Editable:** Budget amount is editable inline, with audit log on save  
**Colors:** Black text for all amounts. No orange/amber on financial figures.  
Red (`danger` class) only when billed ≥ 100% of budget.

### CommitmentsGrid
QB-code hierarchy tree. Shows budget allocation, contracted, invoiced (fixed/TM/expense), paid. Expand to see individual contracts per QB code.

### ContractsTab
- List of contracts for the phase with status badges and totals
- "New Contract" button → form slide-in
- PDF upload → Claude extract → pre-fills form
- Form fields: Vendor, Description, Total Value, Date, Reference #, Status, Budget Line, Line Items (add/remove rows with billing_type + amount)
- Sticky footer with "Save" and "Save & Close" buttons (never inside scroll area)
- Click contract row → ContractPanel slide-in

### InvoicesTab
- Filterable list: status, vendor, type, QB code
- "New Invoice" button → form slide-in
- PDF upload → Claude extract → pre-fills form
- Form fields: Vendor, Invoice #, Amount, Date, Invoice Type, Status, Budget Line, Contract (optional), Line Items
- Three-tier approval UI (PM → Partner → Admin)
- Sticky footer (not in scroll area)

### ContractPanel (slide-in, 640px)
- Contract meta: status, task, date, fixed value, total invoiced
- Scope of Work section (line items list)
- Invoices section (all associated invoices)
- Edit / Delete in header bar
- "View Contract PDF" → modal iframe
- Shows error message if load fails (never shows infinite spinner on error)

### LineItemPanel (slide-in, 640px)
- Budget line: name, budget amount, committed, remaining
- List of contracts for this line
- List of invoices for this line
- Activity/audit feed at bottom
- Shows error message if load fails (never infinite spinner on error)

### ImportDrawer (slide-in, 640px)
- Drag-and-drop or file picker (multiple PDFs)
- **PDF detection:** checks `file.name.endsWith('.pdf')` as fallback since macOS drag-and-drop sends empty MIME type
- Sections: Extracting | Needs Review | Done (collapsed by default)
- Queue cards: filename, type chip (Contract/Invoice, clickable to flip), vendor, amount, budget line, status badge
- Polling every 4 seconds while any item is `queued` or `extracting`
- Click a Needs Review card → Review Form with all editable fields
- Review Form footer: "Discard" and "Confirm & Save" buttons (sticky, never scrollable)
- Concurrency: 10 parallel Claude extractions per batch

---

## 10. Approval Workflow

Three-tier sequential approval applied to invoices, change orders, T&M charges, and contract expenses:

| Step | Action | Status After | Fields Set |
|------|--------|-------------|------------|
| 1 | PM approves | `pm_approved` | `pm_approved_by`, `pm_approved_at` |
| 2 | Partner approves | `partner_approved` | `partner_approved_by`, `partner_approved_at` |
| 3 | Admin approves | `approved` | `approved_by`, `approved_at` |
| — | Any tier rejects | `rejected` | `rejection_note` |

Rejection returns to originator. Originator corrects and resubmits (resets to `pending`).

---

## 11. Financial Logic

### Core Calculations (per budget line)
```
contracted    = sum of contract total_value where status != 'voided'
co_total      = sum of approved change_order amounts on those contracts
tm_total      = sum of approved tm_charges on those contracts
exp_total     = sum of approved contract_expenses on those contracts
exposure      = contracted + co_total + tm_total + exp_total
billed        = sum of non-voided invoice amounts
remaining     = budgeted_amount - exposure
pct_used      = exposure / budgeted_amount * 100
```

### Alert Thresholds
- **CO Creep:** CO total > 10% of contract → warning; > 25% → critical
- **Overbilled:** Invoice total > contract total_value
- **Budget Pressure:** Exposure > 90% of budgeted_amount

### Budget Line Matching (import queue)
Keyword overlap scoring in `matchBudgetLine()`:
- Score = matched_words / line_words
- < 0.2 → no match (lineId: null, confidence: 'low')
- 0.2–0.6 → medium confidence
- > 0.6 → high confidence

---

## 12. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SESSION_SECRET` | Yes | express-session secret (use Render auto-generate) |
| `SEED_TOKEN` | No | Protects `/api/admin/*` endpoints |
| `NODE_ENV` | No | Set to `production` on Render |
| `PORT` | No | Server port (default: 3000) |
| `SKIP_MIGRATIONS` | No | Set `1` to skip auto-schema apply on boot |

---

## 13. Server Startup Behavior

1. Connect to PostgreSQL pool
2. If `SKIP_MIGRATIONS` not set: apply `db/schema.sql` (idempotent — all `CREATE TABLE IF NOT EXISTS`)
3. Mount all routes under `/api`
4. Static serving: check if `client/dist/index.html` exists
   - If yes → serve Vite build, all non-API routes → `index.html` (SPA)
   - If no → serve legacy `public/` folder (emergency fallback — keep this directory)
5. Global error handler: logs request, returns `{ error: message }` JSON

---

## 14. Key Implementation Notes

1. **macOS PDF drag-and-drop:** macOS sends PDFs with empty MIME type during drag-and-drop. Always check `file.name.toLowerCase().endsWith('.pdf')` as fallback — do not rely solely on `file.type === 'application/pdf'`.

2. **Admin access:** Admin users are blocked by `project_members` join if used for access checks. The correct pattern: query the resource directly (e.g., `SELECT id FROM phase_budget_lines WHERE id=$1`) — admins don't need to be project members to access data.

3. **Sticky form footer:** Save/action buttons and approval checkboxes must be in a `flex-shrink: 0` footer div *outside* the scrollable form body. Never put them inside the scroll container or they scroll off-screen with long forms.

4. **Error states in panels:** Always add `isError` check before the loading spinner in slide-in panels. Without it, a failed fetch shows an infinite spinner with no feedback.

5. **TypeScript on Render:** `vite`, `typescript`, and all `@types/*` packages must be in `dependencies`, not `devDependencies`, in `client/package.json`. Render's `NODE_ENV=production` causes npm to skip devDependencies.

6. **Concurrency in bulk import:** Background Promise pool pattern in `routes/import.js`. Configurable `limit` variable (currently 10). Do not block the HTTP response — respond immediately after queueing, process in background.

7. **Query key patterns:** TanStack Query keys follow: `['contractDetail', id]`, `['phaseContracts', phaseId]`, `['budget', phaseId]`, `['invoices', phaseId]`. Invalidate all affected keys on mutation.

8. **CSS color rule:** Never use `--accent` (terracotta) or `--warn` (amber) on financial amount cells in grids. Use neutral text colors only. Red only for genuine danger (≥100% billed).

---

## 15. Phase 2 Roadmap (Not Yet Built)

- Full approval workflow UI screens (DB + backend ready; UI stubs present)
- QuickBooks sync (push confirmed invoices to QB via `qb_reference_id`)
- By-Trade cross-project report screen (backend ready; no UI yet)
- Vendor profile management (edit `vendor_profiles.notes` in UI)
- Inline PDF viewer improvements (page navigation, zoom)
- Email notifications on approval state changes
- Budget template management (edit default templates per project type in UI)
- Export to CSV / Excel
- Mobile-responsive layout
- Alerts screen with action items
