# ActiveAcq V3 — Full Product Requirements Document
**Version 3.0 — April 2026**
**Authors: Seth / Avraham**
**Status: Source of truth for the rebuild**

---

## 0. What This Is

A ground-up rebuild of the cost tracking system for Active Acquisitions LLC. This document is the single source of truth. Every screen, every data model decision, every workflow is defined here. Nothing gets built that isn't in this document. Nothing in this document gets skipped.

The prior version (V1/V2) proved the data model is correct. The contracts → change orders → invoices hierarchy is right. The QB code enforcement is right. The 3-tier approval chain is right. What changes in V3:

1. **The entry point is different.** Users start with project type (Industrial / Residential), then project, then project part. Budget is scoped to each project part, not to the project as a whole.
2. **Project parts ("phases") are first-class objects.** Seth calls them phases — Phase 1, Phase 2, Phase 3. Each is a distinct portion of the project with its own budget, its own contracts, and its own invoices. The word "phase" in this document always means this — a part of a real estate project — never anything else.
3. **The budget template is the anchor.** The budget spreadsheet provided is the default template. Every new project part starts from this template, pre-populated with estimate ranges, and the user edits it.
4. **The UI model is Excel / Equals / AirTable.** Dense, tabular, built for people who live in spreadsheets. No cards. No decoration. Pure financial data.

---

## 1. User Journey — Top to Bottom

```
ENTRY
  └── Select project type: INDUSTRIAL  or  RESIDENTIAL

PROJECT SELECTION
  └── Choose existing project  OR  Create new project
        Fields: Project Name, Address, Acquisition Type, Notes

PHASE SELECTION
  └── Choose existing phase  OR  Create new phase
        A phase = a distinct scope + timeline + budget
        Examples: "Phase 1 — Entitlement", "Phase 2 — Site Work", "Phase 3 — Vertical Construction"
        Each phase has: Name, Start Date (optional), End Date (optional), Status (active/complete/pending)

PHASE HOME (the command center for one phase of one project)
  └── Budget View          ← the spreadsheet — planned vs. actuals
  └── Contracts            ← vendors signed for this phase
  └── Invoices             ← all payment requests in this phase
  └── Change Orders        ← scope changes in this phase
  └── Alerts               ← anything approaching or exceeding budget
  └── History              ← full audit trail
```

---

## 2. Data Model

### 2.1 Core Hierarchy

```
PROJECT
  ├── type: industrial | residential
  ├── name, address, notes
  └── PHASES []
        ├── name (e.g., "Phase 1 — Entitlement")
        ├── status: pending | active | complete
        ├── start_date, end_date
        └── BUDGET LINES []  (the phase budget, one row per QB account)
              ├── qb_account_id        ← FK to chart of accounts
              ├── budgeted_amount      ← user-set estimate
              ├── notes                ← e.g., "Utilize Initial Engineering Proposal"
              ├── calculation_method   ← text hint from template
              └── CONTRACTS []
                    ├── vendor_name
                    ├── initial_amount    ← the signed contract value
                    ├── contract_date
                    ├── status
                    ├── qb_account_id    ← which budget line this is against
                    ├── CHANGE ORDERS []
                    │     ├── amount (positive or negative)
                    │     ├── description
                    │     └── status: pending | approved | rejected
                    └── INVOICES []
                          ├── invoice_type: fixed | tm | expense
                          ├── invoice_number
                          ├── amount
                          ├── invoice_date
                          ├── qb_account_id
                          └── status: pending | pm_approved | partner_approved | approved | pushed | paid | rejected
```

### 2.2 QB Accounts (Chart of Accounts)

Pre-loaded from the Active Acquisitions LLC account list. Hierarchical — parent accounts and sub-accounts.

```
qb_accounts
  id            SERIAL PK
  account_number  TEXT         e.g., "1720.01"
  full_name       TEXT         e.g., "Capitalized Land Cost:Entitlement:Engineering:Civil & Landscape Engineering"
  short_name      TEXT         e.g., "Civil & Landscape Engineering"
  parent_id       INTEGER FK   → qb_accounts.id (NULL for top-level)
  category        TEXT         land | entitlement | construction | professional_fees | g_and_a | closing | finance
  project_type    TEXT         industrial | residential | both
```

### 2.3 Budget Lines

```
budget_lines
  id                  SERIAL PK
  phase_id            INTEGER FK → phases.id
  qb_account_id       INTEGER FK → qb_accounts.id
  budgeted_amount     NUMERIC(14,2)
  notes               TEXT
  calculation_method  TEXT        ← from template (e.g., "$2,500 per concept")
  sort_order          INTEGER
  
  -- Computed (not stored, calculated at query time):
  committed_amount    = SUM of initial_amount on active contracts for this line
  co_amount           = SUM of approved change order amounts for contracts on this line
  total_commitment    = committed_amount + co_amount
  invoiced_amount     = SUM of approved invoice amounts for this line
  paid_amount         = SUM of paid invoice amounts for this line
  remaining_budget    = budgeted_amount - invoiced_amount
  pct_used            = invoiced_amount / budgeted_amount * 100
```

### 2.4 Contracts

```
contracts
  id                  SERIAL PK
  phase_id            INTEGER FK
  qb_account_id       INTEGER FK
  vendor_name         TEXT
  initial_amount      NUMERIC(14,2)   ← the signed contract value
  contract_date       DATE
  description         TEXT
  reference_number    TEXT
  status              TEXT           draft | pending | active | closed
  invoice_type        TEXT           fixed | tm | mixed  ← how this contract will be billed
  file_reference      TEXT           ← uploaded PDF path
  created_by          INTEGER FK → users
  created_at          TIMESTAMPTZ
```

### 2.5 Change Orders

```
change_orders
  id              SERIAL PK
  contract_id     INTEGER FK
  co_number       TEXT           e.g., "CO-001"
  description     TEXT
  amount          NUMERIC(14,2)  ← can be negative (deductive COs)
  status          TEXT          pending | approved | rejected
  submitted_date  DATE
  approved_date   DATE
  notes           TEXT
  file_reference  TEXT
```

### 2.6 Invoices

```
invoices
  id              SERIAL PK
  phase_id        INTEGER FK    ← always tied to a phase
  contract_id     INTEGER FK    ← nullable (standalone invoices have no contract)
  qb_account_id   INTEGER FK
  invoice_number  TEXT
  vendor_name     TEXT
  invoice_type    TEXT         fixed | tm | expense
  amount          NUMERIC(14,2)
  invoice_date    DATE
  description     TEXT
  file_reference  TEXT
  status          TEXT         pending | pm_approved | partner_approved | approved | pushed | paid | rejected
  duplicate_flag  BOOLEAN
  rejection_note  TEXT
  pushed_at       TIMESTAMPTZ  ← when pushed to QB
  paid_date       DATE
  
  -- For G703/AIA tracking (fixed invoices only):
  -- invoice_lines table: per-QB-code breakdown within one invoice
```

---

## 3. The Chart of Accounts — Pre-Loaded Reference

The complete QB account list from Active Acquisitions LLC is pre-loaded as seed data. It maps directly to budget line items. Users never type account codes — they select from this list.

### Account Hierarchy (top level)

| Range | Category | Display Name |
|---|---|---|
| 1600–1639 | Land | Capitalized Land Cost → Land |
| 1700 | Entitlement (root) | Capitalized Land Cost → Entitlement |
| 1705–1705.04 | Architecture | → Architecture |
| 1710–1710.06 | Survey | → Survey |
| 1720–1720.11 | Engineering | → Engineering |
| 1730–1730.07 | Consulting Fees | → Consulting Fees |
| 1740–1740.07 | Utility Design | → Utility Design |
| 1750–1750.06 | Legal Entitlement | → Legal Entitlement |
| 1760–1760.19 | Permits & Fees | → Permits & Fees |
| 1770 | Project Mgmt | → Project Management Entitlement |
| 1800 | Construction (root) | Construction and Land Development |
| 1810 | Pre-Con Sitework | → Pre-Con Sitework and Land Improvement |
| 1820–1820.10 | Building Dev | → Building Development |
| 1860–1860.08 | Professional Fees | Capitalized Land Cost → Professional Fees |
| 1880–1880.10 | G&A | → General & Administrative |
| 1920–1920.06 | Closing Costs | → Closing Costs |
| 1950–1950.08 | Finance | → Finance |
| 1999 | Capital Cost | → Expenses Capital Cost |

### Budget Template Pre-Population

When a new phase is created, the system offers:
- **"Start from template"** — creates budget lines for all applicable QB accounts, pre-filled with the estimate amounts from the budget spreadsheet
- **"Start blank"** — empty grid, user adds lines manually
- **"Copy from another phase"** — copy budget lines from a prior phase in this or any project

The template amounts come from the provided budget spreadsheet (e.g., Concept Plans: $5,000, Site Plans: $15,000, Survey ALTA: $10,000, etc.).

---

## 4. Budget Builder — The Spreadsheet View

This is the most important screen in the application. It is a read/write spreadsheet. It looks and feels like Excel. Every row is a QB account. Every column is a financial measurement.

### 4.1 Column Definition

| Column | Width | Type | Notes |
|---|---|---|---|
| Account # | 80px | Text, monospace | e.g., "1720.01" |
| Line Item | 260px | Text | Account short name. Editable inline. |
| Discipline / Category | 120px | Text | Engineering, Legal, Environmental, etc. |
| Calculation Method | 160px | Text | Editable note. e.g., "$2,500 per concept" |
| **Budgeted Amount** | 120px | Money, editable | The plan. User sets this. |
| Committed | 120px | Money, computed | SUM of initial contract amounts for this line |
| + Change Orders | 110px | Money, computed | SUM of approved COs — positive = cost increase |
| Total Commitment | 120px | Money, computed | Committed + Change Orders |
| Invoiced | 120px | Money, computed | SUM of approved invoices |
| Paid | 110px | Money, computed | SUM of paid invoices |
| **Remaining** | 110px | Money, computed | Budgeted − Invoiced. Red if negative. |
| **% Used** | 70px | %, computed | Invoiced / Budgeted. Color-coded. |
| Consultant | 140px | Text | Assigned firm/vendor name |
| Notes | 200px | Text, editable | Free text |
| ⚠ | 24px | Alert indicator | Red dot if > 90% used, red X if over budget |

### 4.2 Row Types

**Section header rows** (not editable, not computed):
- Background: `#1a1612` (dark), text: uppercase, amber, monospace
- Examples: "PROFESSIONAL FEES", "APPLICATION & OTHER FEES", "ESTIMATED EXTRAORDINARY CONSTRUCTION COSTS"

**Parent account rows** (collapsible, shows rollup):
- Background: `#f0ede8` (warm light gray)
- Bold text
- Chevron `▶`/`▼` to expand/collapse children
- Columns show SUM of all child rows

**Sub-account rows** (leaf nodes, fully editable):
- Indented 20px within parent
- All columns editable (budgeted amount, notes, consultant, calculation method)
- Standard row height 32px

**Totals row** (bottom, always visible, sticky):
- Background: `#1a1612`, text white
- Shows column totals across entire phase
- Subtotals per section appear inline above each section's last row

### 4.3 Inline Editing Rules

- **Double-click** any editable cell → goes into edit mode
- **Tab** → moves to next editable cell in the row
- **Enter** → confirms edit, moves down
- **Escape** → cancels edit
- **Click away** → auto-saves
- Number cells: right-aligned, monospace, formatted as `$1,234,567.00`
- Text cells: left-aligned, standard font
- No save button required — changes save on blur

### 4.4 Color Coding for % Used

| % Used | Color | Meaning |
|---|---|---|
| 0–74% | Black on white | Healthy |
| 75–89% | Amber `#d97706` | Approaching limit |
| 90–99% | Orange `#c4522a` | Near limit — review |
| 100%+ | Red `#dc2626` | Over budget |

### 4.5 Toolbar Above Budget Grid

```
[Phase: Phase 1 — Entitlement ▾]  [+ Add Line]  [Import Template]  [Export to Excel]  [Show: All ▾]  [⚠ 3 alerts]
```

- Phase selector: switch between phases without leaving the view
- Add Line: adds a blank row at bottom, prompts for QB account selection
- Import Template: loads the default template for this project type
- Export to Excel: downloads the current budget as .xlsx
- Show filter: All / Over Budget / Near Limit / Has Contracts / No Contracts

---

## 5. Contracts Module

### 5.1 Contract List View

A full-width table. One row per contract. Accessible from the Contracts tab within a phase.

**Toolbar:**
```
[+ New Contract]  [Status: All ▾]  [QB Account: All ▾]  [Vendor: ______]  [Invoice Type: All ▾]
```

**Columns:**
| Column | Width | Notes |
|---|---|---|
| Status dot | 20px | Color per status |
| Vendor | 200px | Link — opens contract detail panel |
| QB Account | 130px | Account # + short name |
| Invoice Type | 90px | Fixed / T&M / Mixed |
| Initial Amount | 120px | Right-aligned, monospace |
| Approved COs | 110px | Right-aligned. Amber if > 0 |
| Total Commitment | 120px | Initial + COs. Red if > budget line |
| Invoiced | 110px | Sum of approved invoices |
| % Billed | 70px | Invoiced / Total Commitment |
| Paid | 110px | Sum of paid invoices |
| Ref # | 100px | Contract reference number |
| Date | 90px | Contract date |
| ⚠ | 24px | Alert if approaching/over |
| Actions | 60px | ··· menu |

**Row click → detail panel slides in from right (480px).**

### 5.2 Contract Detail Panel

**Header:** Vendor name · QB Account · Status badge · [Edit] [×]

**Ledger section (top of panel):**
```
Initial Contract    $50,000.00     QB Account      1720.01 Civil & Landscape Eng.
Approved COs        $5,200.00     Contract Date   Mar 15, 2026
Total Commitment   $55,200.00     Invoice Type    Fixed
Invoiced           $40,000.00     Reference #     BVE-2026-01
Paid               $30,000.00     Status          Active
Remaining          $15,200.00
```

**Burn bar:**
```
[██████████████████████████████──────────────────]
                                                 Budget line: $75,000
←──── Paid ($30k) ────────── Invoiced ($40k) ─────── Commitment ($55.2k) ──────→
```

**Tabs below ledger:** Change Orders | Invoices | History

**Change Orders tab:**
- Table: CO # | Description | Amount | Status | Date
- `[+ Add Change Order]` button
- Row click → inline expansion with approval chain
- Approved COs: green dot, adds to Total Commitment
- Rejected COs: red dot, struck-through amount
- Pending COs: amber dot, dashed outline — "If approved, commitment becomes $X"

**Invoices tab:**
- Same as project-level invoice list but filtered to this contract
- Shows invoice type badge (Fixed / T&M / Expense)
- For fixed contracts: shows G703 breakdown per QB line

**Contract Creep Section** (visible when COs or T&M invoices exist):
```
CONTRACT CREEP ANALYSIS
  Initial Contract:          $50,000
  + Approved Change Orders:   $5,200   (+10.4%)
  + T&M Invoiced:             $8,264   (+16.5%)
  + Expenses Invoiced:        $1,100   (+2.2%)
  ─────────────────────────────────────
  Total vs. Initial:         $64,564   (+29.1%)  ← amber warning if > 10%, red if > 25%
```

---

## 6. Invoice Module

### 6.1 Invoice Types

Every invoice is one of three types. This distinction is how we measure contract creep:

| Type | Description | Budget Impact |
|---|---|---|
| **Fixed** | Payment against a fixed line item in the contract. Reduces the remaining committed amount. | Against contract's QB line |
| **Time & Materials (T&M)** | Hourly/materials billing beyond the fixed scope. The "lowball and run" problem. | Against contract's QB line, but tracked separately — T&M total shown as its own column |
| **Expense** | Reimbursable costs: travel, hotel, tolls, food, copies. Should be a small fraction of contract value. | Against contract's QB line, tracked separately |

**Why separate tracking matters:**
A contract initially for $50,000 (Fixed) might accumulate $40,000 in T&M and $5,000 in Expenses. The "true cost" is $95,000 — nearly double the signed contract. The system must make this visible and alarming.

### 6.2 Invoice List View

**Toolbar:**
```
[+ New Invoice]  ● pending(4)  ● approved(12)  ● paid(38)  [Type: All ▾]  [Vendor ___]  [Date ___]  [QB ___]
```

Status filter chips — each shows count, clicking filters the table.

**Columns:**
| Column | Width | Notes |
|---|---|---|
| Status (border) | 3px | Left border, color only |
| Invoice # | 120px | Monospace |
| Vendor | 180px | |
| Type | 70px | Fixed / T&M / Expense badge |
| QB Account | 130px | |
| Contract | 160px | "Standalone" if no contract |
| Date | 90px | |
| Amount | 110px | Right-aligned |
| Status | 90px | Dot + text |
| PDF | 40px | Icon if attached |
| ⚠ | 24px | Duplicate flag or budget flag |
| Actions | 100px | Approve ✓ / Reject ✗ / ··· |

Approve/Reject icons appear on hover for `pending` rows. Reject opens an inline popover requiring a note.

### 6.3 Invoice Lifecycle

```
CREATED (pending)
  → [Duplicate check runs automatically]
  → [Budget check: will this push the QB line over budget?]
  → PM Approves     → pm_approved
  → Partner Approves → partner_approved
  → Seth Approves   → approved
  → Push to QB      → pushed
  → Mark Paid       → paid

At any point:
  → Hold (requires note)   → on_hold
  → Reject (requires note) → rejected
  → Revert to pending      → pending
```

### 6.4 New Invoice Modal — Full Screen, Two Columns

```
┌──────────────────────────────────┬──────────────────────────────────┐
│  DOCUMENT PREVIEW                │  FORM                            │
│                                  │                                  │
│  [Drag PDF here]                 │  Invoice Type: [Fixed] [T&M] [Expense]
│                                  │                                  │
│  Once uploaded:                  │  Phase:     Phase 1 — Entitlement│
│  → PDF renders inline            │  Contract:  [Select or None] ▾  │
│  → AI fills fields               │  QB Account:[Search accounts] ▾ │
│  → Confidence dots on            │                                  │
│    each field                    │  Invoice #: ___________________  │
│                                  │  Date:      ___________________  │
│                                  │  Vendor:    ___________________  │
│                                  │  Amount:    ___________________  │
│                                  │                                  │
│                                  │  Description: ______________     │
│                                  │                                  │
│  ⚠ DUPLICATE WARNING             │  ─────────────────────────────── │
│  (if AI detects match)           │  Budget Check:                  │
│                                  │  QB 1720.01: $12k of $75k used  │
│                                  │  This invoice: $8,264           │
│                                  │  After: $20,264 (27% of budget) │
│                                  │  ✓ Within budget                │
│                                  │                                  │
│                                  │        [Cancel]  [Submit →]     │
└──────────────────────────────────┴──────────────────────────────────┘
```

**AI Extraction behavior:**
- User drops PDF → file uploads to `/api/invoices/extract`
- AI returns: invoice_number, vendor_name, amount, invoice_date, description, suggested_qb_account
- Each AI-filled field shows a confidence dot: green (high), amber (medium), red (low)
- User reviews, corrects if needed, then submits
- QB account suggestion: AI picks from the account list based on vendor name + description

**Budget check (real-time, runs as user fills Amount field):**
- Looks up the selected QB account's budget line for this phase
- Shows: budgeted | already invoiced | this invoice | total after | % used
- Color-coded: green (safe) | amber (75–89%) | red (90%+) | flashing red (would exceed budget)

**Duplicate detection (runs on invoice_number + vendor_name + amount):**
- If a match is found: yellow warning banner with: "Possible duplicate: Invoice #INV-204 from [vendor] for $8,264 was already entered on March 10."
- User must check a "I've reviewed this and it is not a duplicate" checkbox before submitting

---

## 7. Contract Upload + AI Extraction

### 7.1 Contract Upload Flow

Same two-column layout as invoice modal.

Left: PDF preview
Right: Extracted fields

Fields extracted from contract PDF:
- Vendor / Party name
- Contract amount
- Contract date
- Scope of work (summary → auto-fills description)
- Suggested QB account (AI picks from account list based on scope description)
- Reference number / contract number
- Invoice type (fixed / T&M / mixed — AI infers from contract language)

The AI also scans for:
- **Escalation clauses** → flags with: "This contract contains an escalation clause. Budget accordingly."
- **T&M language** → flags if contract has open-ended T&M billing language
- **Expiration date** → fills end date field

### 7.2 QB Account Suggestion Logic

The AI prompt includes:
1. The full QB account list as context
2. The vendor name, description, and any line items in the document
3. Instruction to return the most likely account number + a confidence level

Example mappings:
- "Langan Engineering" → 1720.10 (Engineering: Traffic)
- "Cofone Engineering" → 1720.01 (Civil & Landscape Engineering)
- "Colliers" → 1730.02 (Consulting Fees: Planning)
- "Survey by XYZ" → 1710.01 (Survey: Boundary/ALTA Survey)
- A contract mentioning "legal representation before planning board" → 1750.01 (Legal Entitlement: Land Use Legal)

If confidence is low, the field is pre-filled but highlighted amber and marked "(AI guess — please verify)".

---

## 8. Budget Alerts System

### 8.1 Alert Types

| Alert | Trigger | Severity |
|---|---|---|
| **Budget Approaching** | A QB line's invoiced amount reaches 75% of budgeted amount | Warning (amber) |
| **Budget Near Limit** | Invoiced reaches 90% of budgeted amount | High (orange) |
| **Budget Exceeded** | Invoiced exceeds budgeted amount | Critical (red) |
| **Commitment Exceeds Budget** | Total commitment (contracts + approved COs) exceeds budgeted amount | High (orange) |
| **Invoice Pending Approval** | Invoice has been pending > 24 hours | Warning |
| **Contract Creep** | A contract's total billings (Fixed + T&M + Expenses) exceed 125% of initial contract amount | Warning |
| **Severe Contract Creep** | Total billings exceed 150% of initial contract amount | Critical |
| **Duplicate Invoice** | New invoice matches an existing one | Critical |
| **T&M Exceeds Fixed** | T&M billings on a contract exceed the initial fixed contract amount | Warning |

### 8.2 Where Alerts Surface

**Alert indicator (⚠) on budget grid rows:**
- Small icon in the ⚠ column of every row
- Red = over budget, amber = approaching
- Tooltip on hover: "This line is at 94% of budget. $3,200 remaining."

**Alert strip at top of phase view:**
- A 40px horizontal band below the phase header
- Shows: "3 budget alerts, 1 duplicate flag, 2 approvals waiting"
- Each item is a clickable chip

**Alerts tab:**
- Full list of all active alerts for the phase
- Columns: Severity | Type | QB Line / Contract | Details | $ at Risk | Age
- One-click navigate to the affected record

**Dashboard (across all projects/phases):**
- Red project cards if any phase has a critical alert
- "Needs Attention" section: list of items requiring action

### 8.3 Alert Notifications

When a critical alert is triggered:
- In-app notification bell shows a count badge
- Bell click → dropdown shows list of alerts with one-click navigate

---

## 9. QuickBooks Integration

### 9.1 Push Flow

When an invoice reaches `approved` status:
1. A "Push to QuickBooks" button appears on the invoice
2. User clicks → system creates an AP Bill in QuickBooks via QB API
3. Fields mapped:
   - Vendor → QB Vendor
   - Amount → Bill Amount
   - Invoice # → Bill Ref #
   - Date → Bill Date
   - QB Account # → Expense Account (the `account_number` field)
   - Description → Memo
4. On success: invoice status → `pushed`, `pushed_at` timestamp recorded
5. On failure: error shown inline, invoice stays `approved`

### 9.2 QB Sync Back

When QB marks a bill as paid:
- Webhook or polling sync updates invoice status → `paid`
- `paid_date` recorded
- This triggers recomputation of "Paid to Date" on the budget line

### 9.3 Bulk Push

From the invoice list:
- Multi-select checkboxes on `approved` rows
- "Push selected to QB" button in toolbar
- Batch API call, results shown per row

---

## 10. Design System — Excel / Equals / AirTable for Real Estate Pros

### 10.1 Philosophy

The users are real estate professionals who live in Excel. They are comfortable with:
- Dense rows of financial data
- Column-based navigation
- Freeze panes (header and first columns sticky)
- Right-click context menus
- Keyboard shortcuts
- Seeing 30+ rows of data at once without scrolling

The UI must feel like a purpose-built financial tool, not a consumer app. **No rounded cards for data containers. No large whitespace. No decorative illustrations. Every pixel earns its place.**

Design references:
- **Excel**: Dense rows, column headers, cell editing, freeze panes, color-coded cells
- **Equals.app**: Monospace numbers, toolbar-above-table pattern, split-pane detail, zero decoration
- **AirTable**: Row click → side panel, status badges, filter chips, grouped views
- **Bloomberg Terminal**: Information density, muted background, high-contrast numbers, monospace

### 10.2 Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR (48px)                                                              │
│ [ACTIVE ACQUISITIONS]  [Industrial ▾]  [Project ▾]  [Phase ▾]  [⌘K Search] [🔔] [User]│
├──────────────┬──────────────────────────────────────────────────────────────┤
│              │ PHASE TAB BAR (36px)                                         │
│   SIDEBAR    │ [Budget] [Contracts] [Invoices] [Change Orders] [Alerts] [History]│
│   (200px)    ├──────────────────────────────────────────────────────────────┤
│              │ TOOLBAR (40px) — filters + actions for current view          │
│   Dark warm  ├────────────────────────────────────┬─────────────────────────┤
│   charcoal   │                                    │                         │
│   Ridge      │  TABLE / GRID (fills remaining)    │  DETAIL PANEL (480px)   │
│   texture    │                                    │  (slides in when row    │
│              │                                    │   is selected)          │
│              │                                    │                         │
│              │                                    │                         │
└──────────────┴────────────────────────────────────┴─────────────────────────┘
```

**Context is always visible in the top bar.** A user always knows: what type → what project → what phase.

### 10.3 Color Tokens

```css
/* Brand */
--accent:       #c4522a;   /* terracotta — buttons, active states */
--amber:        #e8921a;   /* progress, fills, warnings */

/* Backgrounds — warm, never cold gray */
--bg:           #faf8f5;
--surface:      #ffffff;
--surface-2:    #f5f2ee;   /* alternate rows, toolbar bg */
--surface-3:    #ede9e3;   /* section headers, totals rows */

/* Borders */
--border:       #e0dbd3;
--border-2:     #ccc7be;

/* Text */
--text-1:       #1a1612;
--text-2:       #4a443e;
--text-3:       #8a847c;
--text-4:       #b8b2a8;

/* Sidebar */
--sidebar-bg:   #1c1814;

/* Semantic */
--ok:           #059669;
--warn:         #d97706;
--danger:       #dc2626;
--info:         #2563eb;
```

### 10.4 Typography

```
Primary font:    Inter, system-ui, sans-serif
Monospace:       'SF Mono', ui-monospace, 'Cascadia Code', Consolas, monospace

Table headers:   10px, 600 weight, uppercase, 0.08em letter-spacing
Table cells:     13px, 400 weight
Numbers:         13px, monospace, tabular-nums, right-aligned
Section labels:  10px, 700 weight, uppercase, 0.1em letter-spacing (stencil feel)
Panel headers:   16px, 600 weight
Page title:      20px, 700 weight
```

### 10.5 Row Heights

```
Spreadsheet rows:  32px  (budget grid, compact)
Table rows:        36px  (contract/invoice lists)
Summary rows:      44px  (totals, section footers)
Toolbar:           40px
Tab bar:           36px
Top bar:           48px
```

### 10.6 Status Colors — Left Border System

Instead of text badges in tables, status is communicated via a 3px left border on each row:

| Status | Left Border Color |
|---|---|
| pending | amber `#d97706` |
| pm_approved | blue `#2563eb` |
| partner_approved | violet `#7c3aed` |
| approved | green `#059669` |
| pushed | cyan `#0891b2` |
| paid | dark green `#065f46` |
| rejected | red `#dc2626` |
| draft | gray `#9ca3af` |

In the detail panel, status uses a full pill badge with background color.

### 10.7 The Budget Spreadsheet — Excel Behaviors

The budget grid must implement these Excel-like behaviors:

- **Frozen first column**: Account # + Line Item columns stay visible when scrolling right
- **Frozen header row**: Column headers stay visible when scrolling down
- **Frozen totals row**: Bottom totals row stays visible (or is pinned at bottom of viewport)
- **Click to select**: Single click selects a row (highlights it)
- **Double-click to edit**: Opens cell for inline editing
- **Tab navigation**: Within a row, Tab moves to next editable cell
- **Column resize**: Drag column border to resize (persisted in localStorage)
- **Column sort**: Click header to sort (where meaningful — e.g., sort by % Used to see worst lines first)
- **Right-click context menu**: Edit | Add row below | Delete row | View contracts | View invoices
- **Subtotals per section**: Each section (Professional Fees, Application Fees, etc.) shows a subtotal row above the next section
- **Expand/collapse sections**: Section header rows have a `▶`/`▼` toggle to collapse all rows in that section

---

## 11. Navigation & Screens

### 11.1 Sidebar Navigation

```
ACTIVE ACQUISITIONS (logo)

── NAVIGATION
   Dashboard
   Projects
   Invoices (global queue)
   By Trade
   Alerts
   
── ADMIN (Seth only)
   Users
   QB Accounts
   Import Tools
```

### 11.2 Top Bar — Cascading Context

The top bar is the primary navigation context. Three cascading dropdowns:

```
[INDUSTRIAL ▾]  →  [203010 — Riverside ▾]  →  [Phase 1 — Entitlement ▾]
```

- Selecting a different project type resets to project selection
- Selecting a different project resets to phase selection
- Selecting a different phase loads that phase's data
- All dropdowns show a `+ New` option at the bottom

### 11.3 Screen Inventory

| Screen | Route | Description |
|---|---|---|
| Dashboard | `/` | Cross-project health, approval queue, alerts |
| Project List | `/projects` | All projects, filterable by type |
| Phase Budget | `/projects/:id/phases/:pid/budget` | The budget spreadsheet |
| Phase Contracts | `/projects/:id/phases/:pid/contracts` | Contract list + detail panel |
| Phase Invoices | `/projects/:id/phases/:pid/invoices` | Invoice list + detail panel |
| Phase Change Orders | `/projects/:id/phases/:pid/change-orders` | CO list |
| Phase Alerts | `/projects/:id/phases/:pid/alerts` | Alert list |
| Phase History | `/projects/:id/phases/:pid/history` | Audit trail |
| Global Invoices | `/invoices` | All invoices, all projects |
| By Trade | `/by-trade` | Cross-project QB code summary |
| Alerts | `/alerts` | All alerts, all projects |
| Admin | `/admin` | Users, QB codes, imports |

---

## 12. Dashboard

### 12.1 What It Must Answer in 5 Seconds

1. What projects/phases are over budget or approaching limits?
2. What invoices are waiting for my approval?
3. Where is significant contract creep happening?
4. Are there any duplicate flags I need to review?

### 12.2 Dashboard Layout

**Top: Alert Strip (40px, full-width)**
```
⚠ 3 budget alerts  ●  2 pending approvals  ●  1 duplicate flag  ●  4 contracts with T&M > Fixed
```
Each item is clickable, navigates to the relevant filtered view.

**Left Column (380px): Approval Queue**
- Title: "Waiting for You" + count
- Table: Type | Vendor | Amount | Phase | Age
- Inline Approve ✓ / Reject ✗ per row
- Empty state: "All clear ✓" in green

**Right Section: Project/Phase Cards**
- One row per active phase
- Each row: Phase name · Project name | Budgeted | Committed | Invoiced | Paid | [Burn bar] | Alert badge
- Burn bar: 100% = budgeted amount. Shows committed (terracotta) / invoiced (amber) / paid (green)
- Click row → navigates to that phase's budget view

**Bottom: Contract Creep Leaderboard**
- Table: Contract | Vendor | Phase | Initial | Total Billed | % Creep
- Sorted by % Creep descending
- Red rows > 150%, amber > 125%

---

## 13. Technical Architecture

### 13.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Proper build pipeline, HMR, type safety |
| Routing | React Router v6 | URL = state, deep links |
| State | Zustand | Lightweight, no boilerplate |
| Data fetching | TanStack Query (React Query) | Caching, invalidation, background refetch |
| Tables | TanStack Table (headless) | Full control over rendering, virtualization |
| Virtualization | TanStack Virtual | 1000+ row budget grids |
| Forms | React Hook Form | Performance, validation |
| Styling | CSS Modules + CSS custom properties | Scoped styles, design tokens |
| Backend | Express.js + PostgreSQL | Carry forward from V1 |
| Auth | Express session | Carry forward |
| AI | Anthropic Claude SDK | PDF extraction, QB code suggestion |
| QB Integration | QuickBooks Online API (OAuth 2.0) | Push approved invoices |
| File storage | Local filesystem → S3 (later) | PDF attachments |

### 13.2 Key Principles

**URL = full state.** Selected project type, project, phase, tab, and selected row are all in the URL. Shareable, bookmarkable, browser back/forward works.

**TanStack Query for everything.** All API calls are `useQuery`/`useMutation` hooks. Mutations automatically invalidate related queries (save invoice → invalidates invoice list + budget line totals + contract ledger).

**Computed values are computed at query time.** No stored aggregates. The budget grid's "Invoiced", "Paid", "Remaining", "% Used" columns are computed via SQL aggregation on each request. This ensures accuracy without sync issues.

**The budget grid is a virtual spreadsheet.** TanStack Virtual renders only visible rows. A 200-row budget grid renders in < 16ms.

### 13.3 Database Schema (Key Tables)

```sql
-- Project types
CREATE TABLE project_types (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL  -- 'industrial' | 'residential'
);

-- Projects
CREATE TABLE projects (
  id               SERIAL PRIMARY KEY,
  project_type     TEXT NOT NULL,  -- 'industrial' | 'residential'
  name             TEXT NOT NULL,
  address          TEXT,
  notes            TEXT,
  status           TEXT DEFAULT 'active',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Phases
CREATE TABLE phases (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER REFERENCES projects(id),
  name         TEXT NOT NULL,   -- e.g., "Phase 1 — Entitlement"
  phase_number INTEGER,
  status       TEXT DEFAULT 'active',  -- pending | active | complete
  start_date   DATE,
  end_date     DATE,
  notes        TEXT,
  sort_order   INTEGER
);

-- QB Accounts (Chart of Accounts — pre-loaded seed data)
CREATE TABLE qb_accounts (
  id              SERIAL PRIMARY KEY,
  account_number  TEXT UNIQUE,   -- e.g., "1720.01"
  full_name       TEXT,          -- full colon-delimited path
  short_name      TEXT,          -- last segment only
  parent_id       INTEGER REFERENCES qb_accounts(id),
  category        TEXT,          -- entitlement | construction | professional_fees | etc.
  project_type    TEXT DEFAULT 'both',  -- industrial | residential | both
  sort_order      INTEGER
);

-- Budget Lines (one per QB account per phase)
CREATE TABLE budget_lines (
  id                  SERIAL PRIMARY KEY,
  phase_id            INTEGER REFERENCES phases(id),
  qb_account_id       INTEGER REFERENCES qb_accounts(id),
  budgeted_amount     NUMERIC(14,2) DEFAULT 0,
  notes               TEXT,
  calculation_method  TEXT,
  consultant          TEXT,
  sort_order          INTEGER,
  UNIQUE (phase_id, qb_account_id)
);

-- Contracts
CREATE TABLE contracts (
  id               SERIAL PRIMARY KEY,
  phase_id         INTEGER REFERENCES phases(id),
  qb_account_id    INTEGER REFERENCES qb_accounts(id),
  vendor_name      TEXT NOT NULL,
  initial_amount   NUMERIC(14,2),
  contract_date    DATE,
  description      TEXT,
  reference_number TEXT,
  invoice_type     TEXT DEFAULT 'fixed',  -- fixed | tm | mixed
  status           TEXT DEFAULT 'draft',
  file_reference   TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Change Orders
CREATE TABLE change_orders (
  id              SERIAL PRIMARY KEY,
  contract_id     INTEGER REFERENCES contracts(id),
  co_number       TEXT,
  description     TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,  -- can be negative
  status          TEXT DEFAULT 'pending',
  submitted_date  DATE,
  approved_date   DATE,
  approved_by     INTEGER REFERENCES users(id),
  notes           TEXT,
  file_reference  TEXT
);

-- Invoices
CREATE TABLE invoices (
  id               SERIAL PRIMARY KEY,
  phase_id         INTEGER REFERENCES phases(id),
  contract_id      INTEGER REFERENCES contracts(id),  -- nullable
  qb_account_id    INTEGER REFERENCES qb_accounts(id),
  invoice_number   TEXT,
  vendor_name      TEXT,
  invoice_type     TEXT NOT NULL,  -- fixed | tm | expense
  amount           NUMERIC(14,2),
  invoice_date     DATE,
  description      TEXT,
  file_reference   TEXT,
  status           TEXT DEFAULT 'pending',
  duplicate_flag   BOOLEAN DEFAULT FALSE,
  rejection_note   TEXT,
  pushed_at        TIMESTAMPTZ,
  paid_date        DATE,
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Invoice Lines (for G703/AIA breakdown on fixed invoices)
CREATE TABLE invoice_lines (
  id               SERIAL PRIMARY KEY,
  invoice_id       INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  qb_account_id    INTEGER REFERENCES qb_accounts(id),
  current_amount   NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- Approval events (audit trail for all approvals)
CREATE TABLE approval_events (
  id          SERIAL PRIMARY KEY,
  record_type TEXT NOT NULL,  -- invoice | contract | change_order
  record_id   INTEGER NOT NULL,
  action      TEXT NOT NULL,  -- pm_approve | partner_approve | approve | reject | hold | revert
  user_id     INTEGER REFERENCES users(id),
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Alerts
CREATE TABLE alerts (
  id           SERIAL PRIMARY KEY,
  phase_id     INTEGER REFERENCES phases(id),
  alert_type   TEXT NOT NULL,
  severity     TEXT NOT NULL,  -- warning | high | critical
  record_type  TEXT,           -- budget_line | contract | invoice
  record_id    INTEGER,
  message      TEXT,
  resolved     BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 14. Budget Template — Pre-Loaded Data

When a phase is initialized with "Start from template", the following budget lines are created. Amounts are the estimates from the provided budget spreadsheet, stored as the default `budgeted_amount`. All are editable.

### Professional Fees Template (Industrial / Commercial)

| QB Account | Short Name | Default Budget | Calculation Method |
|---|---|---|---|
| 1705.02 | Architectural Design | $5,000 | $2,500 per concept |
| 1705.04 | Board Submissions | — | — |
| 1710.01 | Boundary/ALTA Survey | $10,000 | Utilize Initial Survey Proposal |
| 1710.02 | Topographic Survey | — | Included in ALTA |
| 1720.01 | Civil & Landscape Engineering | $15,000 | $50k–$300k range |
| 1720.02 | Geotech | — | $1,500–$3,500 per disturbed acre |
| 1720.07 | Environmental & LSRP | $20,000 | Phase I |
| 1720.07 | Environmental Phase II | $25,000 | As necessary per Phase I |
| 1720.09 | Ecological | — | — |
| 1720.10 | Traffic | $12,000 | +$2,000 per testimony/PB meeting |
| 1720.08 | Fire Suppression | $10,000 | Fire-Water DD Report |
| 1730.07 | Acoustical | $12,000 | Sound Study |
| 1750.01 | Land Use Legal | $50,000 | — |
| 1750.04 | Environmental Legal | — | — |
| 1760.01 | County Fees | $25,000 | — |
| 1760.02 | Municipal Fees | — | Research per town |
| 1760.05 | State Fees | $15,000 | Regional Sewerage Authority |
| 1760.08 | NJDEP Fees | $15,000 | — |
| 1760.10 | NJDOT Fees | — | — |
| 1760.12 | Electric Permits | — | — |
| 1760.14 | Water Permits | $10,000 | BWSE |
| 1760.15 | Sewer Permits | $15,000 | NJDEP TWA |
| 1770 | Project Management | — | — |

Remaining accounts from the chart of accounts are available to add but not pre-populated.

---

## 15. Complete Feature Checklist

Everything that must be built. Grouped by functional area. No item ships until it is checked.

### Shell & Navigation
- [ ] Project scaffold: React 18 + TypeScript + Vite + React Router + Zustand + TanStack Query
- [ ] Design token CSS (all tokens from Section 10.3)
- [ ] Sidebar with dark charcoal + ridge texture
- [ ] Top bar with cascading context dropdowns: Project Type → Project → Project Part
- [ ] Project type selection screen: INDUSTRIAL / RESIDENTIAL
- [ ] Project list — filterable by type, create new project
- [ ] Project part list — create / edit / rename / reorder parts
- [ ] QB account seed data loaded (full chart of accounts from Active Acquisitions LLC)
- [ ] Global ⌘K search: vendor, invoice #, amount, QB code, project, project part
- [ ] Notification bell with count badge
- [ ] Role-based access: PM / Partner / Admin (Seth)

### Budget Grid
- [ ] Spreadsheet grid: frozen header row, frozen first two columns, sticky totals row
- [ ] Section header rows: PROFESSIONAL FEES / APPLICATION & OTHER FEES / ESTIMATED EXTRAORDINARY CONSTRUCTION COSTS
- [ ] Parent account rows: collapsible with ▶/▼ toggle, shows rollup of children
- [ ] Sub-account rows: leaf nodes, fully editable inline
- [ ] Columns: Account # · Line Item · Discipline · Calculation Method · Budgeted Amount · Committed · + Change Orders · Total Commitment · Invoiced · Paid · Remaining · % Used · Consultant · Notes · ⚠
- [ ] All computed columns (Committed, Invoiced, Paid, Remaining, % Used) update live as data changes
- [ ] Double-click to edit any editable cell; Tab to next; Enter to confirm; Escape to cancel; auto-save on blur
- [ ] Column resize by dragging header border (persisted in localStorage)
- [ ] Sort by column header click (% Used, Remaining, Budgeted Amount)
- [ ] Right-click context menu: Edit · Add row below · Delete row · View contracts · View invoices
- [ ] % Used color coding: 0–74% black · 75–89% amber · 90–99% orange · 100%+ red
- [ ] ⚠ column: amber dot at 75%, red dot at 90%, red X if over budget; tooltip with detail
- [ ] "Start from template" — loads default budget lines with pre-filled amounts
- [ ] "Start blank" — empty grid
- [ ] "Copy from another project part" — clone budget lines
- [ ] Export to Excel (.xlsx)
- [ ] Subtotal row per section

### Contracts
- [ ] Contract list table with status left-border color system
- [ ] Columns: Status · Vendor · QB Account · Invoice Type · Initial Amount · Approved COs · Total Commitment · Invoiced · % Billed · Paid · Ref # · Date · ⚠ · Actions
- [ ] Row click → detail panel slides in from right (480px)
- [ ] Contract detail panel: ledger section, burn bar, tabs (Change Orders / Invoices / History)
- [ ] Contract Creep Analysis section (visible when COs or T&M invoices exist)
- [ ] New contract: manual entry form
- [ ] New contract: PDF upload + AI extraction (vendor, amount, date, scope, QB suggestion, T&M language flag)
- [ ] AI escalation clause detection ("This contract contains an escalation clause")
- [ ] AI T&M language flag ("This contract has open-ended T&M billing language")
- [ ] Edit contract inline from panel
- [ ] Contract status lifecycle: draft → pending → active → closed
- [ ] Approval chain on contracts: PM → Partner → Seth

### Change Orders
- [ ] Change order list per contract
- [ ] Create CO: CO number, description, amount (positive or negative), notes, optional PDF
- [ ] Approval chain: PM → Partner → Seth
- [ ] Approved COs: add to Total Commitment automatically
- [ ] Rejected COs: struck-through, excluded from Commitment
- [ ] Pending COs: show "If approved, commitment becomes $X" indicator
- [ ] Deductive COs: negative amounts reduce Commitment

### Invoices
- [ ] Invoice list table with status left-border color system
- [ ] Status filter chips with counts: pending / approved / paid (and others)
- [ ] Columns: Status · Invoice # · Vendor · Type · QB Account · Contract · Date · Amount · Status · PDF · ⚠ · Actions
- [ ] Approve ✓ / Reject ✗ icon buttons appear on hover for pending rows
- [ ] Reject opens inline popover requiring a note
- [ ] Row click → detail panel
- [ ] Invoice detail panel: all fields, approval chain, file attachment, history
- [ ] New invoice modal: full-screen, two-column (PDF preview left / form right)
- [ ] Invoice types: Fixed / T&M / Expense — selectable at top of form
- [ ] PDF upload + AI extraction: invoice number, vendor, amount, date, QB account suggestion
- [ ] AI confidence dots on each filled field (green / amber / red)
- [ ] Real-time budget check as amount is filled: shows budgeted / already invoiced / this invoice / after / % used
- [ ] Duplicate detection on invoice_number + vendor + amount; warning banner + acknowledgment checkbox required
- [ ] Full approval lifecycle: pending → pm_approved → partner_approved → approved → pushed → paid
- [ ] Hold (requires note) → on_hold
- [ ] Reject (requires note) → rejected
- [ ] Revert to pending from any status
- [ ] Mark paid (manual) with paid_date
- [ ] Bulk approve: multi-select + "Approve selected" button
- [ ] Standalone invoices (no contract): tied directly to project part + QB account

### Alerts
- [ ] Alert strip at top of every project part view (40px band, clickable chips)
- [ ] Alert types: Budget Approaching (75%) · Budget Near Limit (90%) · Budget Exceeded · Commitment Exceeds Budget · Invoice Pending >24h · Contract Creep (>125%) · Severe Contract Creep (>150%) · T&M Exceeds Fixed · Duplicate Invoice
- [ ] ⚠ indicator on each budget grid row with tooltip
- [ ] Alerts tab: full list, sortable by severity, one-click navigate to record
- [ ] Notification bell: count badge, dropdown with list of active alerts
- [ ] Dashboard alert strip: cross-project summary

### QuickBooks Integration
- [ ] QuickBooks OAuth 2.0 connection (Admin setup)
- [ ] "Push to QuickBooks" button on approved invoices
- [ ] Maps: Vendor / Amount / Invoice # / Date / QB Account # / Description → QB AP Bill
- [ ] On push success: status → pushed, pushed_at recorded
- [ ] On push failure: error shown inline, status stays approved
- [ ] Bulk push: multi-select approved invoices → push all
- [ ] QB sync back: when QB marks paid → status → paid, paid_date recorded

### Dashboard
- [ ] Alert strip: cross-project counts, clickable chips
- [ ] Approval queue: table of all items waiting for current user, inline approve/reject
- [ ] Project part health rows: Budgeted / Committed / Invoiced / Paid / burn bar / alert badge
- [ ] Contract Creep Leaderboard: sorted by % creep, color-coded
- [ ] Empty state: "All clear" when nothing needs attention

### Audit Trail
- [ ] Every create / edit / approve / reject / push / pay action recorded in approval_events
- [ ] History tab on every project part: full chronological log
- [ ] History tab on every contract: all changes and approvals
- [ ] History tab on every invoice: all status transitions with actor + timestamp + note

---

## 16. What Success Looks Like

A real estate project manager opens the app:

1. Selects **INDUSTRIAL** → picks **Project 203010 — Riverside** → selects **Phase 1 — Entitlement**
2. Sees the budget grid. Immediately knows that Civil Engineering is at 82% of budget. Legal is over budget by $12,000. Traffic is untouched.
3. Sees "2 invoices pending approval" in the alert strip. Clicks → approves both in 30 seconds.
4. Drops a PDF invoice from Langan Engineering into the new invoice modal. AI fills in: $8,264 / Langan / March invoice / QB: 1720.10 Traffic. Confidence: all green. User clicks Submit.
5. Budget grid auto-updates: Traffic line moves from 42% to 71% used.
6. Contract for Langan shows: Initial $6,300 | T&M to date $12,396 | That's 97% above initial contract. Red alert: "Contract creep: T&M has exceeded fixed scope amount."
7. Seth logs in, sees the alert, approves the invoice, it pushes to QuickBooks.

That flow — from PDF drop to QB push — happens in under 3 minutes, with every number visible and every alert surfaced automatically.

---

*Last updated: April 2026*
*Status: Final. Ready for development.*
