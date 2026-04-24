# ActiveAcq V2 — Product Requirements Document
**Version 2.0 — April 2026**
**Scope: Full rebuild — new frontend, new design system, same PostgreSQL backend**

---

## 0. Why Rebuild

The V1 app proved the data model and business logic are correct. Every concept — contracts, earmarked amounts, G703 pay applications, 3-tier approval, T&M charges — is right. What needs to change is the surface: the UI is hand-crafted one component at a time and shows it. Typography is inconsistent. Layout decisions are local. The container metaphor, while meaningful, is executed as decoration rather than structure.

V2 strips that away. The new reference is **Equals.app** — a financial analytics tool built for people who live in spreadsheets and need their software to think like they do. Data-dense, precise, zero decoration, fast. The design philosophy: the table is the UI.

The brand stays. The warmth stays. The two oranges stay. What changes is the execution: every pixel has a reason, every number aligns, every action is reachable in two clicks.

---

## 1. Design Reference — Equals.app Translated to ActiveAcq

### What Equals Gets Right

Equals is built for financial analysts who think in rows and columns. Its design choices:

- **Tables as first-class UI** — every data set is a table. Not a card grid. Not a kanban. A table.
- **Extreme data density** — rows are 32px tall. Headers are 28px. You see 25+ rows without scrolling.
- **No decorative chrome** — no card shadows, no gradient headers, no rounded corners on data tables. Structure comes from borders and background alternation.
- **Monospace everywhere numeric** — numbers never flow; they always align. Column-width is set to fit the widest value.
- **Toolbar above tables** — filters, search, and actions live in a slim toolbar row directly above the table. Not in a sidebar.
- **Split-pane for editing** — clicking a row opens a detail panel to the right (or bottom). The list stays visible.
- **Keyboard-first** — j/k navigation, Enter to open, Escape to close, Arrow keys in tables.
- **Status as color, not text** — a 4px left border or a small dot communicates status. The full word "approved" is secondary.
- **Zero modals for editing** — forms open in-context, in a panel. Full-screen modals are reserved for creation flows only.

### The Translation Rules for ActiveAcq

| Equals Pattern | ActiveAcq V2 Application |
|---|---|
| Table as primary UI | Contracts, invoices, change orders, expenses all in full-width tables |
| 32px row height | Standard row height for all data tables |
| Toolbar above table | Filter bar with status chips + action buttons directly above each table |
| Split pane for detail | Click contract → right panel opens with full detail. List stays. |
| 4px left border for status | Invoice status = left border color. No text badge needed. |
| Monospace numbers | All financial columns: `font-variant-numeric: tabular-nums`, monospace face |
| No card shadows | Panels separated by border lines, not shadows |
| Keyboard navigation | j/k, Enter, Escape throughout |
| One accent color | Terracotta `#c4522a` for actions only. Everything else is gray scale + warm white. |
| Dense header row | Table headers 28px, 10px font, uppercase, 0.08em letter-spacing |

### What We Keep from V1

The brand identity survives the redesign:
- **Two oranges**: terracotta (`#c4522a`) for actions, amber (`#e8921a`) for progress/fills
- **Warm backgrounds**: `#faf8f5` page bg — not cold gray
- **Sidebar ridge texture**: the container Easter egg for Seth — vertical stripe pattern stays
- **Stencil section labels**: uppercase, wide-tracked, heavy weight
- **Tabular numerals everywhere numeric**

What we drop:
- Card corner bracket accents (too decorative, fight data density)
- `.panel` rounded cards as layout containers (replaced by bordered sections)
- 12px border-radius on data containers (0–4px only in V2)
- Per-component shadow declarations (one shadow token, used sparingly)

---

## 2. Design System V2

### Color Tokens

```
/* Brand */
--accent:        #c4522a   /* terracotta — buttons, links, active nav */
--accent-hover:  #b04824
--accent-dim:    rgba(196,82,42,0.07)
--amber:         #e8921a   /* progress fills, burn bars */
--amber-dim:     rgba(232,146,26,0.10)

/* Backgrounds — warm, never cold gray */
--bg:            #faf8f5   /* page background */
--surface:       #ffffff   /* panel / table background */
--surface-2:     #f7f5f2   /* alternate table rows, toolbar bg */
--surface-3:     #f0ede8   /* table headers, inset sections */

/* Borders — warm, not cool-gray */
--border:        #e4dfd8   /* default border */
--border-2:      #d6d0c8   /* stronger border, table header bottom */
--border-3:      #c8c2b8   /* focus borders, active selections */

/* Text */
--text-1:        #1a1612   /* primary — near black, warm */
--text-2:        #4a443e   /* secondary */
--text-3:        #8a847c   /* tertiary, placeholders */
--text-4:        #b8b2a8   /* disabled */

/* Sidebar (dark, warm charcoal) */
--sidebar-bg:    #1c1814
--sidebar-border:rgba(255,255,255,0.07)

/* Semantic */
--ok:            #059669
--ok-bg:         #ecfdf5
--warn:          #d97706
--warn-bg:       #fffbeb
--danger:        #dc2626
--danger-bg:     #fef2f2
--info:          #2563eb
--info-bg:       #eff6ff
```

### Typography Scale

```
/* Sizes */
--text-xs:    10px    /* table headers, badges, status labels */
--text-sm:    11px    /* secondary labels, hints, meta */
--text-base:  13px    /* default body, table cells */
--text-md:    14px    /* emphasized cells, sub-headings */
--text-lg:    16px    /* section titles, panel headers */
--text-xl:    20px    /* page titles */
--text-2xl:   26px    /* hero numbers on dashboard */

/* Monospace (for all numbers) */
--mono: 'SF Mono', ui-monospace, 'Fira Code', 'Cascadia Code', Consolas, monospace

/* Number rendering */
font-variant-numeric: tabular-nums;
font-feature-settings: "tnum" 1;
letter-spacing: -0.01em;
```

### Spacing & Geometry

```
/* Row heights */
--row-sm:    28px   /* compact tables (change orders, expenses) */
--row-md:    36px   /* standard tables (invoices, contracts) */
--row-lg:    44px   /* summary rows, totals */

/* Border radius */
--radius-sm: 3px    /* buttons, chips, small elements */
--radius-md: 6px    /* panels, modals, dropdowns */
--radius-lg: 8px    /* cards on dashboard only */

/* Panel / layout */
--sidebar-w: 220px
--detail-w:  480px   /* right-side detail panel */
--toolbar-h: 40px    /* filter toolbar above each table */
--header-h:  52px    /* app top bar */
```

### Status Color System (V2 — Border-Based)

Each status maps to a 3px left border on table rows. Text color is secondary.

| Status | Border Color | Row Tint | Dot |
|---|---|---|---|
| pending | `#d97706` (amber) | — | `●` amber |
| pm_approved | `#2563eb` (blue) | — | `●` blue |
| partner_approved | `#7c3aed` (violet) | — | `●` violet |
| approved | `#059669` (green) | `rgba(5,150,105,0.03)` | `●` green |
| pushed | `#0891b2` (cyan) | — | `●` cyan |
| paid | `#059669` (green) | `rgba(5,150,105,0.05)` | `●` green (bold) |
| rejected | `#dc2626` (red) | `rgba(220,38,38,0.03)` | `●` red |
| on_hold | `#92400e` (brown) | — | `●` brown |
| draft | `#8a847c` (gray) | — | `●` gray |

---

## 3. Application Shell

### Layout Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  TOP BAR (52px)                                                 │
│  [≡ Logo]  [Project: 203010 — Riverside ▾]  [🔍]  [🔔]  [User]│
├───────────┬─────────────────────────────────────────────────────┤
│           │  MAIN CONTENT AREA                                  │
│  SIDEBAR  │  ┌───────────────────────────┬───────────────────┐  │
│  (220px)  │  │  LIST / TABLE PANE        │  DETAIL PANEL     │  │
│           │  │  (fills remaining width   │  (480px, slides   │  │
│           │  │   when panel is closed)   │   in from right)  │  │
│           │  └───────────────────────────┴───────────────────┘  │
└───────────┴─────────────────────────────────────────────────────┘
```

**Top bar** is fixed. Contains:
- Hamburger / logo (collapses sidebar on mobile)
- Project context selector — the active project, with dropdown to switch
- Global search (⌘K)
- Notification bell — count badge for items needing approval
- User avatar / menu

**Sidebar** (always dark, warm charcoal `#1c1814`, ridge texture):
- Navigation items: Dashboard · Projects · Invoices · By Trade · Alerts · Admin
- Active item: white pill, terracotta text
- Collapses to icon-only mode at < 1200px

**Main content area** — all content renders here. Two modes:
1. **Full-width** — when no row is selected (list view)
2. **Split** — when a row is selected, detail panel opens to the right at 480px. List shrinks to fill remaining space. Panel slides in, does not push content off screen.

**Detail panel** — slides in from right. Has:
- Fixed header: record type + primary identifier + status dot + Close (×) button
- Scrollable body with all fields, sub-tables, and history
- Sticky footer: primary action button (Approve / Reject / Edit)
- Keyboard: Escape closes, Tab navigates between fields

---

## 4. Navigation & Information Architecture

```
SIDEBAR NAVIGATION
  ├── Dashboard           ← cross-project health at a glance
  ├── Projects            ← project list → project detail
  │     └── [Project]
  │           ├── Overview (rollup dashboard)
  │           ├── Contracts
  │           │     └── [Contract]
  │           │           ├── Schedule of Values (G703)
  │           │           ├── Change Orders
  │           │           ├── T&M Charges
  │           │           ├── Expenses
  │           │           ├── Invoices (G703 Pay Application View)
  │           │           └── History
  │           ├── Invoices (project-wide, all types)
  │           ├── Budget
  │           └── Alerts
  ├── Invoices            ← global queue — all projects, all statuses
  ├── By Trade            ← cross-project view grouped by QB code
  ├── Alerts              ← all active alerts across all projects
  └── Admin               ← users, QB codes, import tools (Seth only)
```

### Routing Convention

```
/                           → Dashboard (redirect)
/dashboard                  → Global dashboard
/projects                   → Project list
/projects/:id               → Project overview
/projects/:id/contracts     → Contract list (default tab)
/projects/:id/contracts/:cid  → Contract detail (opens panel)
/projects/:id/invoices      → Project invoice list
/projects/:id/budget        → Budget tree
/invoices                   → Global invoice queue
/by-trade                   → By-trade view
/alerts                     → Global alerts
/admin                      → Admin panel
```

---

## 5. Screen Specifications

---

### 5.1 Global Dashboard

**Purpose:** Seth opens the app. This screen answers: what's on fire, what needs my approval, how much money is moving.

**Layout:** Three-column at 1440px. Two-column at 1200px. Single-column on tablet.

**Sections:**

#### A. Alert Strip (top, full-width, collapsible)
- A narrow (40px) horizontal band below the top bar
- Shows: count of items needing Seth's approval, count of cost-creep warnings, count of duplicate flags
- Each count is a clickable chip that filters the relevant view
- Red chip if count > 0, gray if 0
- Collapse button → strip minimizes to a 4px colored bar

#### B. Approval Queue (left column, ~400px)
- Title: "Waiting for You" + count badge
- Table: Type | Vendor / Description | Amount | Project | Waiting Since
- Row height 36px, 3px left border by item type (terracotta = invoice, amber = CO, blue = contract)
- Each row has one-click Approve (green) and Reject (red) icon buttons
- Clicking the row title opens full detail in the right panel
- If queue is empty: "All clear." in green, with timestamp of last approved item

#### C. Project Health Cards (center, fills remaining width)
- One card per active project
- Card dimensions: full-width, 80px tall — not square
- Layout within card:
  ```
  [Project Name — short code]  [Commitment: $2.4M]  [Invoiced: $1.9M]  [Paid: $1.7M]
  [Burn bar — 100% scale = Earmarked Amount]
  [▐██████████████▌─────────┤        ]
        Paid      Invoice  Commitment  Earmarked
  ```
- Burn bar: green (paid) | amber (invoiced, not paid) | terracotta tint (committed, not invoiced)
- Thin white tick mark at "initial contract amount" on the burn bar scale
- Right side: status indicator — green dot (healthy) | amber (warning) | red (over earmark)
- Click → Project detail

#### D. Cost Creep Leaderboard (right column, ~280px)
- Title: "Cost Creep" + subtitle "Commitment vs. Original Contract"
- Table: Project | Vendor | $ Over | % Over
- Sorted by % over, descending
- Red rows where % > 25, amber where 10–25%
- Empty state: "No overruns" in green

#### E. Recent Activity (bottom, full-width)
- Last 15 events across all projects
- Table: When | Who | Action | Item | Project | Amount
- "3 hours ago", "Yesterday", etc. — relative time
- Action has a color dot: created (blue), approved (green), rejected (red), paid (teal)

---

### 5.2 Project Overview

**Purpose:** One project's full financial story.

**Header (full-width, 72px tall):**
```
[PROJECT NAME]  [Status badge]  [$2.4M Earmarked]  [$2.1M Committed]  [$1.9M Invoiced]  [$1.7M Paid]
```
All numbers monospace, right-aligned in their column. Color-coded: Committed in amber if > Earmarked.

**Sub-tabs below header:**
`Overview | Contracts | Invoices | Budget | Alerts`

**Overview tab:**
- Same burn bar as dashboard card, but full-width and 24px tall
- Contract table: list of all contracts with per-contract ledger (same columns as global leaderboard)
- Clicking a contract row → Contract detail panel opens to the right

---

### 5.3 Contract List

**Toolbar (40px):**
```
[+ New Contract]  [Status: All ▾]  [Vendor: ______]      [Sort: Date ▾]  [Export]
```

**Table columns:**
| # | Column | Width | Notes |
|---|---|---|---|
| 1 | Status dot | 20px | 8px colored circle |
| 2 | Vendor | 220px | Link, opens detail panel |
| 3 | Ref # | 100px | Monospace |
| 4 | Date | 90px | `MMM DD, YYYY` |
| 5 | Initial | 110px | Right-aligned, monospace |
| 6 | Earmarked | 110px | Right-aligned. Red if < Commitment |
| 7 | Commitment | 110px | Right-aligned. Amber if > Earmarked |
| 8 | Invoiced | 110px | Right-aligned |
| 9 | % Billed | 70px | Right-aligned. Color-coded |
| 10 | Paid | 110px | Right-aligned, green |
| 11 | Actions | 60px | ··· menu |

Row height: 36px. Header: 28px, uppercase, `--text-xs`.

**Row interaction:**
- Hover: `--surface-2` background
- Selected: `--accent-dim` background + `--border-3` left border 3px
- Click row → detail panel opens to the right

**Empty state:**
- Full-width centered message: "No contracts yet. [+ Add the first one]"

---

### 5.4 Contract Detail Panel

When a contract row is clicked, a 480px panel slides in from the right. The contract list reflows to fill remaining width.

**Panel Header (52px, sticky):**
```
[CONTRACT]  Bright View Engineering  ● active  [Edit]  [×]
```

**Panel Body (scrollable):**

#### Section 1 — Ledger (the numbers at a glance)
A 2-column grid of stat cells, each 48px tall with label and value:

```
Initial Contract    $6,300.00    Earmarked       $22,000.00
Approved COs       $0.00        Earmark Buffer   $15,700.00
T&M Approved       $8,264.50    Commitment       $14,564.50
Expenses Approved  $0.00        Invoiced         $12,396.00
                                Paid             $8,264.50
```

All numbers monospace. "Earmark Buffer" turns red if negative. "Commitment" turns amber if > Earmarked.

**Burn bar** — full panel width, 16px tall:
- Scale: 0 → Earmarked Amount
- Segments: Paid (green) | Invoiced (amber) | Committed (terracotta, lighter) | Pending COs (dashed pattern)
- Tick mark at Initial Contract Amount
- Tick mark at Earmarked Amount (right edge)
- Labels below bar for each segment amount

#### Section 2 — Reference Info
Compact 2-column key/value grid:
- Reference # | Contract Date | Status | QB Code | Description

#### Section 3 — Tabbed Sub-sections (below the numbers)

Tabs: `G703 / SOV | Change Orders | T&M | Expenses | History`

**G703 / Schedule of Values tab:**
- Table: QB Code | Line Item | Contract Amt | Prev Billed | This Period (latest invoice) | % Complete
- Totals row at bottom
- "View full pay application history →" link that navigates to the Invoices tab

**Change Orders tab:**
- Toolbar: `[+ Add CO]  [Status: All ▾]`
- Table: # | Description | Amount | Status | Date | Actions
- Row click → inline expansion showing approval chain and notes
- Status filter chips: All | Pending | Approved | Rejected

**T&M Charges tab:**
- Toolbar: `[+ Add T&M]`
- Table: # | Description | Hours | Rate | Amount | Status | Date

**Expenses tab:**
- Toolbar: `[+ Add Expense]`
- Table: # | Category | Description | Amount | Status | Date | Receipt

**History tab:**
- Chronological audit log
- Table: When | Who | Action | Details
- Compact rows (28px), no interaction needed

#### Section 4 — Invoices sub-section
(Rendered as a full-width view within the contract context, not in the narrow panel)

When user clicks "Invoices" from the Contract panel or navigates to `/projects/:id/contracts/:cid/invoices`, the main content area switches to the G703 Pay Application View with the contract detail accessible via a "← Contract" breadcrumb.

---

### 5.5 Invoice List (Project or Global)

The invoice list is the highest-frequency screen for Richard and Seth. It must be fast to scan and fast to act on.

**Toolbar (40px):**
```
[+ New Invoice]  ● pending(4)  ● approved(12)  ● paid(38)  ▾  [Vendor: ___]  [Date: ___]  [QB: ___]  [Sort ▾]
```

Status chips are clickable filters. The number is the count. Active filter chip has terracotta background.

**Table columns:**
| # | Column | Width | Notes |
|---|---|---|---|
| 1 | Status | 3px | Left border color only |
| 2 | Invoice # | 120px | Monospace, link |
| 3 | Vendor | 180px | |
| 4 | Contract | 160px | Gray if standalone |
| 5 | Date | 90px | |
| 6 | QB Code | 90px | Monospace, small |
| 7 | Amount | 110px | Right-aligned, monospace |
| 8 | Status | 90px | Text + dot, left-aligned |
| 9 | File | 40px | PDF icon if attached |
| 10 | Actions | 80px | Approve / Reject / ··· |

**Approve/Reject inline buttons:**
- Visible on hover only for `pending` rows
- `✓` (green) and `✗` (red) icon buttons, 24px
- Clicking `✗` opens a popover with a required "Rejection note" textarea + Confirm button

**Row click → Detail panel:**

**Invoice detail panel:**
- Header: Invoice # | Vendor | Amount | Status
- Approval chain: PM → Partner → Seth — each step shows name, date, action (or "Waiting")
- Fields: Invoice Number | Date | Vendor | Amount | QB Code | Description | Contract
- File attachment: if PDF, inline preview or link
- Duplicate warning banner if flagged
- Timeline / history at bottom
- Action buttons (sticky footer): context-aware based on status and current user's role

---

### 5.6 G703 Pay Application View

This is the AIA Continuation Sheet format, adapted to V2 aesthetics.

**Context:** Accessible from a contract's Invoices tab. Full-width view (not a panel).

**Header breadcrumb:**
```
Projects / Riverside / Contracts / Bright View Engineering / G703
```

**Two-section layout:**

#### Section A — Summary (collapsed by default after first view)
The G703 summary table: one row per QB code.

Table: Code | Line Item | Contract Amount | Previously Billed | This Period | % Complete | Remaining

Row height 32px. Header 28px. Totals row 40px. Monospace on all number columns.

#### Section B — Pay Application History
One row per invoice.

**Closed row (36px):**
```
▶  INV-001   Mar 15, 2026   $4,132.50   Cumulative: $4,132.50   ● approved   [PDF]
```

**Expanded row** — reveals G703 line detail sub-table:
```
   Code  |  Line Item             |  Contract Amt  |  Prev Billed  |  This Period
   ──────────────────────────────────────────────────────────────────────────────
   05100  |  Structural Steel     |  $3,200.00     |  $0.00        |  $3,200.00
   06200  |  Finish Carpentry     |  $3,100.00     |  $0.00        |  $932.50
                                                                      ──────────
                                                              Subtotal  $4,132.50
```

Grand total row at bottom of Section B.

**Toolbar above Section B:**
```
[+ New Pay Application]  [Export G703 PDF]
```

---

### 5.7 Budget Screen

Full-width tree table. Each row is a budget line (QB code).

**Toolbar:** `[+ Add Line]  [Initialize from QB Codes]  [Expand All / Collapse All]`

**Table columns:**
| Column | Width | Notes |
|---|---|---|
| Code | 90px | Monospace, indented for tree |
| Line Item | 240px | |
| Budget | 120px | Editable inline |
| Committed | 120px | Sum of all contract amounts for this code |
| Invoiced | 120px | Sum of approved invoices |
| Paid | 120px | Sum of paid invoices |
| Uncommitted Est. | 120px | Editable — forecast |
| Variance | 100px | Budget − (Committed + Uncommitted). Red if negative. |
| % Used | 70px | Right-aligned, color-coded |

Tree rows: parent rows expand to show child QB codes. Toggle with `▶`/`▼` or keyboard.

---

### 5.8 By Trade View

Cross-project table. Each row is a vendor+QB combination.

**Toolbar:** `[Status: Active ▾]  [Project: All ▾]  [QB: ___]`

Columns: Vendor | QB Code | Projects | Contracts | Committed | Invoiced | Paid | Status

---

### 5.9 Alerts Screen

Full-width list of all active alerts across all projects.

**Alert categories (filterable via chips):**
- Cost Creep (Commitment > Earmarked)
- Overrun (Invoiced > Commitment)
- Pending Approval (> 24 hours)
- Duplicate Flagged
- Budget Exceeded (line-level)

Each alert row: Severity badge | Project | Contract/Invoice | Description | Amount at Risk | Age | Action

Severity: `CRITICAL` (red) | `HIGH` (orange) | `MODERATE` (amber) | `LOW` (yellow)

Clicking an alert → navigates to the record.

---

### 5.10 New Invoice Modal (Creation Flow)

One of two remaining full-screen modals (the other is New Contract).

**Full-screen, two-column layout:**
```
┌──────────────────────────────────┬──────────────────────────────────┐
│  DOCUMENT PREVIEW (left half)    │  FORM (right half)               │
│                                  │                                  │
│  [Drag PDF here or click to      │  [Invoice Type: Fixed / T&M]    │
│   upload]                        │  [Contract selector]            │
│                                  │  [Invoice # ]  [Date]           │
│  — PDF renders inline once       │  [Vendor]                        │
│    uploaded                      │  [Amount] (or G703 table)       │
│  — AI fills form fields          │  [QB Code]                      │
│    on upload, with confidence    │  [Description]                  │
│    indicators                    │                                  │
│                                  │  [Duplicate warning if flagged]  │
│                                  │  [Budget check if over limit]   │
│                                  │                                  │
│                                  │  [Cancel]          [Submit →]   │
└──────────────────────────────────┴──────────────────────────────────┘
```

**Form field rules (same as V1):**
- QB Code required before Submit is enabled
- Duplicate detection runs on invoice # + vendor + amount on blur
- For Fixed invoices with G703 lines: amount field is replaced by the G703 line table
- For T&M invoices: single amount field with T&M label
- AI confidence dots on auto-filled fields (high = green, medium = amber, low = red)

---

### 5.11 New Contract Modal

Same two-column layout as New Invoice.

Left: PDF upload + preview (contract document)
Right: Form with AI extraction

Fields: Vendor | Reference # | Initial Contract Amount | Earmarked Amount | Date | Status | Description | QB Code lines (initialize Schedule of Values)

---

## 6. Component Library

### 6.1 DataTable

The primary component. Used everywhere there's a list.

**Props:**
- `columns` — array of `{ key, label, width, align, render, sortable }`
- `rows` — data array
- `onRowClick` — handler, opens detail panel
- `selectedId` — highlights selected row
- `toolbar` — ReactNode rendered above the table
- `emptyState` — ReactNode or string
- `statusBorderKey` — row field to use for 3px left-border status color

**Keyboard behavior:**
- `j` / `↓` — move selection down
- `k` / `↑` — move selection up
- `Enter` — open selected row
- `Escape` — deselect / close panel
- `a` — approve selected (if applicable, with confirmation)

**Pagination:** Virtualized scroll for > 200 rows. No page numbers.

### 6.2 DetailPanel

Slides in from right at 480px width.

**Behavior:**
- Opening: 200ms ease-out slide from right
- Closing: 150ms ease-in slide out
- Stays open when navigating between rows in the list (content transitions, not panel)
- `Escape` or `×` button closes
- On mobile (< 768px): opens as full-screen modal instead

### 6.3 StatusBadge

```
<StatusBadge status="approved" />
→  ● Approved   (green dot, text, no background box in tables)
→  [Approved]   (filled pill with bg, used in panels/headers)
```

Two variants: `dot` (for tables) and `pill` (for panels).

### 6.4 MoneyCell

Always: monospace font, tabular nums, right-aligned, 2 decimal places, `$` prefix.

Optional props: `color` (e.g., red if negative), `bold`, `dim` (faded color for zero).

### 6.5 BurnBar

```
<BurnBar
  paid={350000}
  invoiced={390000}
  commitment={420000}
  earmarked={500000}
  initialContract={350000}
/>
```

Renders the segmented horizontal bar. Always relative to earmarked as 100% scale.

### 6.6 ApprovalChain

```
PM [Richard] → ✓ Apr 20  →  Partner [Dana] → ✓ Apr 21  →  Seth → ⏳ Waiting
```

Horizontal chain of steps. Checkmark with date for completed steps. Clock for pending. X for rejected.

### 6.7 FilterBar

```
<FilterBar>
  <StatusFilter value={status} onChange={setStatus} counts={counts} />
  <TextFilter placeholder="Vendor..." value={vendor} onChange={setVendor} />
  <DateRangeFilter ... />
  <Spacer />
  <Button variant="primary">+ New</Button>
</FilterBar>
```

Always 40px tall. Sits directly above its DataTable. Background `--surface-2`.

### 6.8 CommandPalette (⌘K)

Full-text search across all records. Opens on ⌘K.

Results grouped by type: Contracts | Invoices | Change Orders | Projects

Each result shows: type icon | primary identifier | project | amount | status

Keyboard navigable. Enter → navigate to record.

---

## 7. Technical Architecture

### 7.1 Stack Decision

| Layer | V1 | V2 |
|---|---|---|
| Frontend framework | React (Babel standalone, no build) | React 18 + Vite build pipeline |
| Routing | Custom hash-based | React Router v6 |
| State management | Component-level useState | Zustand for global state (user, project context) |
| Data fetching | Custom `window.api` wrapper | TanStack Query (React Query) — caching, refetch, stale-while-revalidate |
| Styling | Inline styles + global CSS | CSS Modules + design tokens (CSS custom properties) |
| Tables | Custom div-grid tables | TanStack Table (headless) |
| Virtualization | None | TanStack Virtual for large lists |
| Forms | Uncontrolled React state | React Hook Form |
| Date handling | Manual string manipulation | date-fns |
| Build | None | Vite 5 |
| TypeScript | No | Yes — strict mode |
| Testing | None | Vitest + Testing Library (unit) + Playwright (E2E) |
| Backend | Express + PostgreSQL | **No change** — all API routes stay identical |
| Auth | Express session | **No change** |
| AI extraction | Anthropic SDK | **No change** |

### 7.2 Key Architectural Principles

**Single source of truth for project context.** A Zustand store holds `{ activeProjectId, activeContractId }`. Navigation updates this store. All components subscribe to it.

**React Query for all data fetching.** Every API call is wrapped in a `useQuery` or `useMutation` hook. This gives:
- Automatic background refetch (stale-while-revalidate)
- Optimistic updates on mutations
- Global loading/error states
- Cache invalidation on save (e.g., saving an invoice invalidates the invoice list AND the contract ledger)

**URL = state.** The full application state (selected project, contract, invoice, active tab) is reflected in the URL. Deep links work. Browser back/forward works.

**No `window.*` globals.** V1 attached everything to `window` because there was no module system. V2 uses proper ES module imports everywhere.

**Zero custom CSS class names for layout.** All layout is via CSS Modules scoped to the component. The global stylesheet contains only tokens and base resets.

### 7.3 File Structure

```
src/
  components/
    DataTable/          ← DataTable.tsx + DataTable.module.css
    DetailPanel/
    FilterBar/
    BurnBar/
    StatusBadge/
    MoneyCell/
    ApprovalChain/
    CommandPalette/
    Modal/
    Sidebar/
    TopBar/
  screens/
    Dashboard/
    Projects/
    Contracts/
    Invoices/
    Budget/
    ByTrade/
    Alerts/
    Admin/
  hooks/
    useContracts.ts
    useInvoices.ts
    useContractLedger.ts
    useG703.ts
    useApprovals.ts
    useAlerts.ts
    useSearch.ts
  store/
    appStore.ts         ← Zustand: activeProject, activeContract, panelOpen
    userStore.ts        ← Zustand: currentUser, role
  api/
    client.ts           ← fetch wrapper (same logic as V1 window.api)
    contracts.ts
    invoices.ts
    changeOrders.ts
    tmCharges.ts
    expenses.ts
    budget.ts
    alerts.ts
  types/
    contract.ts
    invoice.ts
    changeOrder.ts
    budget.ts
    user.ts
  utils/
    money.ts
    dates.ts
    status.ts
  styles/
    tokens.css          ← all CSS custom properties
    base.css            ← reset + base typography
    sidebar.css         ← sidebar with ridge texture
```

### 7.4 Backend Compatibility

The V2 frontend must work with the existing V1 API with zero breaking changes. All routes, request shapes, and response shapes are frozen. New routes may be added, but no existing routes are modified.

The V2 frontend is served from a separate Vite dev server in development (proxied to port 3000) and from the same Express server in production (Vite build output → `public/v2/`).

Migration path: run both V1 and V2 simultaneously. Seth switches at his own pace. V1 `/` → V2 at `/v2/`.

---

## 8. Feature Parity Checklist

Everything in V1 must exist in V2 before V1 is deprecated.

### Contracts
- [ ] List view with full ledger columns
- [ ] Create (modal with PDF + AI extraction)
- [ ] Edit (inline panel)
- [ ] Approval chain (PM → Partner → Seth)
- [ ] Per-contract cost ledger
- [ ] Schedule of Values (QB code lines)
- [ ] History / audit trail

### Change Orders
- [ ] List per contract
- [ ] Create, edit, delete
- [ ] Approval chain
- [ ] Rolls up to Commitment automatically

### T&M Charges
- [ ] List per contract
- [ ] Create (with PDF extraction)
- [ ] Approval chain
- [ ] Rolls up to Commitment

### Expenses
- [ ] List per contract
- [ ] Create (with PDF extraction)
- [ ] Category: travel | hotel | tolls | copies | food | other
- [ ] Approval chain

### Invoices
- [ ] List at project level (all types)
- [ ] List at contract level (G703 view)
- [ ] Create — fixed (G703 line entry) / T&M / expense / standalone
- [ ] Full approval lifecycle (pending → pm_approved → partner_approved → approved → pushed → paid)
- [ ] Hold and release
- [ ] Reject with required note
- [ ] Revert to pending
- [ ] Mark pushed (QB export)
- [ ] Mark paid (with date)
- [ ] Duplicate detection
- [ ] Bulk approve
- [ ] PDF attachment + inline preview

### G703 Pay Application
- [ ] Summary table (Contract Amt | Total Billed | % Complete per QB code)
- [ ] Per-invoice expandable rows with line breakdown
- [ ] Running cumulative column
- [ ] New pay application modal with G703 line entry
- [ ] Export to PDF (V2 new feature)

### Budget
- [ ] Tree view by QB code
- [ ] Editable budget lines
- [ ] Committed / Invoiced / Paid columns
- [ ] Uncommitted estimate (forecast)
- [ ] Variance column

### Dashboard
- [ ] Approval queue
- [ ] Project health cards with burn bars
- [ ] Cost creep leaderboard
- [ ] Recent activity feed
- [ ] Alert strip

### Alerts
- [ ] Cost creep detection
- [ ] Overrun detection
- [ ] Pending approval timeout (>24h)
- [ ] Duplicate flag
- [ ] Per-project alert strip
- [ ] Global alerts screen

### By Trade
- [ ] Cross-project table by QB code
- [ ] Status filter

### Search
- [ ] Global ⌘K command palette
- [ ] Search by vendor, invoice#, amount, description, project, QB code

### Admin (Seth only)
- [ ] User management
- [ ] QB code management
- [ ] Import tools (contracts, invoices, QB codes)

---

## 9. New Features in V2 (Not in V1)

These features are blocked by V1's technical limitations and unblocked by the V2 rebuild.

### 9.1 G703 PDF Export
The G703 pay application view can be exported as a properly formatted AIA Continuation Sheet PDF. Uses a server-side PDF renderer (Puppeteer or pdfmake). Route: `GET /api/contracts/:id/g703/pdf`.

### 9.2 Keyboard Navigation Throughout
Full j/k row navigation in all tables. ⌘K global search. All modals keyboard-dismissible.

### 9.3 Invoice Approval from Notification
The notification bell (top bar) shows a dropdown of pending approvals. Each item has inline Approve/Reject. No navigation required.

### 9.4 Column Customization
Each table has a column picker (⚙ icon in toolbar). User can hide/show/reorder columns. Preference is persisted per user in localStorage.

### 9.5 Dark Mode
The V2 design system ships with a dark mode token set. The sidebar is already dark; the main content area gets a dark variant (`--bg: #141210`, `--surface: #1c1814`). Toggle in user menu.

### 9.6 Inline Editing for Simple Fields
Invoice number, date, amount on an invoice can be edited inline (click → input appears in place) without opening a full edit form. Saves on blur or Enter. Keyboard Escape cancels.

### 9.7 Multi-Project View
"By Trade" screen gains a multi-project filter — select 2–3 projects and see their QB code costs side by side. Useful for comparing vendor spend across similar projects.

---

## 10. Design Constraints (What V2 Must Not Do)

These are non-negotiable. They protect the brand and the user experience.

1. **No cold grays.** Every gray in the system must have a warm undertone. Test: convert to HSL, check that hue is in 20–40° range.
2. **No card shadows deeper than `0 1px 3px rgba(0,0,0,0.08)`** on content. Panels are separated by borders, not depth.
3. **No blue as a brand color.** Blue is info/link only. Never primary actions.
4. **The sidebar ridge texture is permanent.** It is the physical-world Easter egg for Seth.
5. **Financial numbers are always monospace, right-aligned, 2 decimal places.** No exceptions.
6. **QB code is required on every invoice.** The submit button is disabled until it is set. No override.
7. **The approval chain is visible on every record.** You should never have to ask "where is this?"
8. **No more than 2 levels of modal nesting.** A modal may contain an inline form. It may not open another modal.

---

## 11. Development Phases

### Phase 1 — Foundation (4 weeks)
**Goal:** Shell + tables + read-only views of all existing data.

- [ ] Vite + React 18 + TypeScript project scaffold
- [ ] Design token CSS file (all tokens from Section 2)
- [ ] Sidebar component with ridge texture and navigation
- [ ] Top bar with project selector and notification bell
- [ ] DataTable component (virtualized, keyboard nav, 3px status border)
- [ ] DetailPanel component (slide-in, Escape to close)
- [ ] FilterBar component
- [ ] React Router setup with all routes
- [ ] TanStack Query client wired to existing V1 API
- [ ] All list screens (Contracts, Invoices, Change Orders, T&M, Expenses) — read-only
- [ ] Dashboard (approval queue, health cards, burn bars)

### Phase 2 — Write Operations (3 weeks)
**Goal:** Full CRUD across all record types.

- [ ] New Invoice modal (G703 line entry for fixed, single amount for T&M)
- [ ] New Contract modal
- [ ] Inline editing for simple fields
- [ ] Approval actions (approve/reject/hold/revert/push/mark-paid) from table and panel
- [ ] Bulk approve from invoice list
- [ ] Duplicate detection UI
- [ ] Budget table with inline editing

### Phase 3 — G703 & Advanced Views (2 weeks)
**Goal:** Full G703 pay application view and advanced analytics.

- [ ] G703 pay application view with expandable invoice rows
- [ ] G703 PDF export
- [ ] Budget tree view with variance column
- [ ] By Trade multi-project view
- [ ] Global alerts screen

### Phase 4 — Polish & AI (2 weeks)
**Goal:** AI extraction, command palette, keyboard shortcuts, dark mode.

- [ ] ⌘K command palette with cross-entity search
- [ ] AI field extraction in New Invoice + New Contract modals
- [ ] Confidence indicators on AI-filled fields
- [ ] Keyboard navigation j/k throughout
- [ ] Dark mode token set + toggle
- [ ] Column customization (show/hide, persist to localStorage)
- [ ] Performance audit (Lighthouse, bundle size < 200KB gzipped)

### Phase 5 — Migration & Deprecation (1 week)
**Goal:** V2 becomes the default. V1 accessible at `/legacy` for 30 days then removed.

- [ ] V2 served at `/` — V1 moved to `/legacy`
- [ ] User preference: show migration banner on V1 with "Switch to new UI" link
- [ ] 30-day parallel run
- [ ] V1 code archived, not deleted

---

## 12. Success Metrics

| Metric | V1 Baseline | V2 Target |
|---|---|---|
| Time to approve an invoice | ~4 clicks + scroll | 1 click from notification bell |
| Time to find an invoice by number | ~10 seconds | < 2 seconds via ⌘K |
| Rows visible without scroll (invoices) | ~10 | ~22 |
| Page load (Lighthouse Performance) | Not measured | > 90 |
| Time to enter a new invoice (from PDF) | ~3 minutes | < 90 seconds |
| "What is the current commitment on contract X?" | Open contract, read header | Visible in contract list row |

---

*Last updated: April 2026*
*Status: Ready for development kickoff*
