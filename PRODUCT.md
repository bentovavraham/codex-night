# ActiveAcq — Product Reference Document

**Last updated: 2026-05-01**
**Author: Seth (owner), documented by Claude**

---

## 1. The Problem

A real estate acquisition company manages dozens of active projects simultaneously. Each project generates hundreds of contracts, change orders, invoices, and expense reimbursements. Without a system:

- No one knows the true committed cost of a project at any moment
- Invoices get paid twice (different filename, same scope)
- Change orders creep unnoticed until a project is $200K over budget
- The PM has no accountability — there's no paper trail between what was budgeted and what was spent
- The accountant has to manually sort QuickBooks entries to understand what went where

**ActiveAcq is the system that closes all of those gaps.**

---

## 2. The Core Mission

Three things, in priority order:

1. **AI-assisted budget benchmarking** — use historical verified cost data to establish what things *should* cost, so future budgets are grounded in reality, not guesswork
2. **PM accountability** — every dollar has a paper trail: who approved what, when, against which contract
3. **Verified historical costs** — every invoice matched to a QB transaction, every QB transaction matched to an invoice. The audit trail is complete and machine-readable

---

## 3. The Four-Stage Financial Flow

This is the central data model. Every dollar in a project travels through four stages:

```
1. BUDGET      — What we plan to spend         → phase_budget_lines.budgeted_amount
2. COMMITTED   — What we've signed contracts for → contracts + contract_line_items
3. BILLED      — What vendors have invoiced us   → invoices
4. PAID/VERIFIED — What QB shows actually moved  → qb_transactions
```

The Budget Grid shows all four stages side by side for every GL account line. This is the primary financial dashboard.

### What each stage means

| Stage | Table | Drives |
|---|---|---|
| Budget | `phase_budget_lines` | "Budget" column |
| Committed | `contracts` + `contract_line_items` | "Committed" column |
| Billed | `invoices` | "Billed" column |
| Paid | `invoices` (status=paid) + `qb_transactions` | "Paid" column / Audit reconciliation |

### Critical distinction: contracts vs invoices

**The GL code on a contract is a routing label, not a charge.**

When a contract is signed, it commits dollars against a budget line (reducing "Remaining Commitment") but does NOT charge against the GL account totals. The charge comes when an invoice is submitted against that contract.

- Contract → Committed column goes up
- Invoice against that contract → Billed column goes up
- QB transaction matched to that invoice → Verified in Audit tab

This means: a contract could be fully committed but $0 billed. That's normal — the work hasn't been invoiced yet.

---

## 4. The Chart of Accounts (COA) as the Organizing Spine

Every financial record — budget lines, contracts, invoices, QB transactions — is organized by GL account code from the Chart of Accounts.

- **Source of truth:** `qb_accounts` table (812 active lines as of 2026-05-01)
- **Structure:** Parent accounts → leaf accounts (e.g., 1760 → 1760.03)
- **Budget template:** Pre-populates a `phase_budget_line` for every GL code when a phase is initialized. This guarantees that any contract or invoice with a valid GL code always has a budget line to attach to — no orphans.
- **Old `qb_codes` table:** Dead. Zero rows used. Ignore it.

The vocabulary throughout the app is **"Chart of Accounts"** or **"GL Account"** — never "QB Codes" or "QB Code."

---

## 5. The Data Model

### Key tables and their roles

| Table | Role |
|---|---|
| `phases` | A project phase (e.g., "Phase 1 (v2)") — the primary unit of work |
| `phase_budget_lines` | One row per GL code per phase. Holds `budgeted_amount`, `qb_account_id`, `consultant`, `notes`, `calculation_method` |
| `qb_accounts` | Chart of Accounts — the single GL code reference |
| `contracts` | Signed vendor agreements. Linked to a phase via `phase_budget_line_id` (resolved from GL code) |
| `contract_line_items` | Individual scopes within a contract. Each has a `qb_account_id` → resolved to `phase_budget_line_id` at save time |
| `invoices` | Vendor billing documents. Linked to a contract and/or directly to a budget line |
| `invoice_line_items` | Per-line invoice detail with GL code assignment |
| `qb_transactions` | Raw ledger entries imported from QuickBooks. The audit spine. |
| `change_orders` | Modifications to a contract — require approval before counting toward commitment |

### How contracts link to the budget

A contract line item has a `qb_account_id`. When saved, the backend resolves:

```sql
SELECT id FROM phase_budget_lines
WHERE phase_id = ? AND qb_account_id = ?
```

This `phase_budget_line_id` is what the budget query uses to roll up committed spend. The GL code is how the user thinks about it; the `phase_budget_line_id` is the internal join key. The two are equivalent within a phase because the budget template ensures a 1:1 mapping.

---

## 6. The Audit / Reconciliation Model

The Audit tab is **transaction-first**: QB transactions are the spine, invoices attach to them.

```
QB Transaction (bank ledger entry)
  └── Invoice (vendor document)
        └── GL validation (does the PM's code match QB's code?)
```

**Verification statuses:**
- `verified` — invoice exists, amounts match, GL codes match
- `amount_off` — invoice exists but amount differs from QB
- `gl_off` — invoice exists but GL code differs between PM and QB
- `unverified` — QB transaction has no invoice attached yet

The progress bar in the Audit tab shows: "X of Y transactions have an invoice · $A of $B covered."

---

## 7. The Import / Upload Architecture

**One front door: the Audit tab.**

| Button | What it does |
|---|---|
| `↑ QB Export` | Imports QuickBooks Excel export → `qb_transactions` |
| `↑ Import Invoices` | PDF batch → AI extraction → review queue → `invoices` |
| `↑ Import Contract` | Contract PDF → AI extraction → review form → `contracts` |

There is no separate Import tab. The Contracts tab is a view-only list — upload happens from Audit.

### The invoice import pipeline

1. Drop PDF(s) in the import drawer
2. AI extracts: vendor, invoice number, amount, date, line items, GL code suggestions
3. Review queue — human confirms or corrects each field
4. On confirm → writes to `invoices` + `invoice_line_items`, attempts QB match
5. Appears in Audit tab reconciliation view

### The contract import pipeline

1. Drop PDF in the contract upload panel
2. AI extracts: vendor, contract date, contract #, scope, line items with GL suggestions
3. Human reviews — assigns GL account per line item (COA picker)
4. On save → writes to `contracts` + `contract_line_items`, auto-resolves `phase_budget_line_id` from GL code
5. Budget "Committed" column updates immediately

---

## 8. Duplicate Detection

On invoice import, the system checks for existing invoices with the same vendor + invoice number. If found:

- Shows a card-based banner: "This invoice is already in the system"
- Displays where the duplicate lives (Project / Phase) and when it was confirmed
- Requires explicit checkbox acknowledgment: "I understand — this is intentionally a separate entry"
- Only then allows confirmation

---

## 9. The Budget Template

When a phase is initialized, `POST /api/phases/:phaseId/budget/init` populates `phase_budget_lines` from a template covering every GL code in the COA. This means:

- Every possible GL code already has a budget slot ($0 by default)
- Contracts and invoices with any valid GL code always have a budget line to attach to
- The PM fills in `budgeted_amount` for the lines relevant to their phase
- There is never a case where a valid GL code has no budget line

---

## 10. The Excel Export

`GET /api/phases/:phaseId/budget/export-excel` downloads a two-sheet workbook:

**Sheet 1: Variance Report** — rolled up by parent GL code
- Columns: GL Code | Description | Budget | % of Budget | Committed | % of Committed | Actual (Billed) | Variance (Committed − Actual)

**Sheet 2: Budget Detail** — one row per budget line
- Columns: GL Code | Parent GL | Task/Description | Consultant | Calc Method | Budget | Rem. Budget | Rem. % | Contracted | COs | Total Commit | Fixed | T&M | Expense | Billed | Amt Due | Paid | QB Codes Used | Notes

---

## 11. Approval Workflow (Phase 2 — not yet built)

Planned three-level approval for invoices and change orders:
1. PM enters and submits
2. Partner reviews and approves
3. Seth gives final approval

No payment should occur without all three levels. This is a future phase — the data model should anticipate it (status fields exist on invoices and change orders already).

---

## 12. AI Assistance Philosophy

> "AI assists, human confirms. Must NEVER introduce errors."

- AI suggests GL codes, amounts, vendor names, line items from PDFs
- Confidence levels (high / medium / low) are shown per field
- Human reviews every suggested field before confirming
- Confirmed examples are saved as few-shot training data for future extractions (per vendor)
- The system gets smarter the more you use it

---

## 13. Seth's North Star Metrics (what success looks like)

- Any project's true financial position visible in under 10 seconds
- Zero duplicate payments
- Every QB transaction has a matched invoice within 30 days
- Historical cost data sufficient to benchmark a new budget within ±15%
- PMs can enter a contract or invoice in under 2 minutes

---

## 14. Competitors

- **Buildertrend** — good UX, built for home builders, not acquisition/development
- **Procore** — too large and complex for this operation

ActiveAcq's edge: purpose-built for the acquisition → entitlement → construction pipeline, with AI extraction and COA-driven organization from day one.

---

## 15. Technical Stack (as of 2026-05-01)

| Layer | Technology |
|---|---|
| Frontend | Vite + React + TypeScript (port 5173) |
| Backend | Node.js + Express (server.js, port 3000) |
| Database | PostgreSQL (hosted on Render) |
| AI extraction | Anthropic Claude API |
| File storage | Render persistent disk (local) |
| Auth | Session-based (express-session) |

Design system: container-inspired UI, warm charcoal sidebar, terracotta (#c4522a) + amber (#e8921a) as primary colors, warm off-white background.
