# PRD V4 — Invoice Upload & QB-Style Entry
**Date:** 2026-04-26  
**Status:** Shipped

---

## Overview

A PDF-driven invoice entry flow that mirrors QuickBooks' Autofill experience. Upload an invoice PDF → Claude reads it → form auto-seeds with every dated line item → user reviews, adjusts QB codes, checks the review box → saves to the database.

---

## What Was Built

### 1. Invoice Upload Flow (`/phases/:phaseId/invoices`)

**Left pane (42% width)**
- Drag-and-drop zone for PDF upload, or click-to-browse
- Instant PDF preview via `URL.createObjectURL()` before extraction begins

**Right pane — form**
- Header bar shows invoice number once extracted; spinner while Claude reads
- QB-style **header fields**: Payee, Contract (optional link), Invoice Date, Ref #, Services Through date
- **Category details table** — QB's exact layout: `# | CATEGORY | TYPE | DESCRIPTION | AMOUNT`
- **Footer**: "Add lines" + "Clear all lines" + running total
- **Total Amount** field with AI confidence dot
- **Review checkbox** — "I have reviewed this invoice and confirm all details are correct" — gates Save
- **Save & Close** — disabled until reviewed + required fields filled

### 2. Per-Line TYPE Selector

Every line item has its own billing type: **Fixed | T&M | Expense**  
- Derived automatically from extraction; user can override per line
- Switching a line to **T&M** reveals sub-fields: Person, Date, Hours × Rate
- New manually-added lines default to **Fixed** (no empty T&M sub-fields)
- Invoice-level `invoice_type` is derived from line items (if any T&M → 'tm', any expense → 'expense', else 'fixed')

### 3. AI-Powered Extraction (Claude claude-opus-4-6)

**Multi-pass extraction:**
- Pass 1: Extract header fields + ALL line items from PDF
- Pass 2: Re-extract with vendor context (previous examples + notes) if known vendor
- Pass 3: Suggest QB GL account code per line item using vendor context + line description
- Pass 4: Fuzzy-match vendor name against `vendors` table (threshold 0.7)

**Extraction rules (critical for T&M invoices):**
- Each dated row = its own line item — never collapse multiple dates
- Same date + different person = separate lines
- T&M lines include: person name, line_date, hours, rate, amount
- Description includes person name: `"John J Jahr - prep overlay maps requested by clerk"`
- `max_tokens: 8192` to handle invoices with many detailed lines

### 4. QB Code Autocomplete (QbPicker)

- Full account list — all QB GL accounts, fully scannable by scrolling (no cap)
- Real-time filter by account number, full name, or short name
- Displays full account path: `1720.10 Capitalized Land Cost:Entitled WIP`
- AI-suggested codes shown with **dashed amber border** + confidence dot (green/yellow/red)
- Manual pick overrides AI suggestion; clear button restores to suggestion
- On save: uses manual pick if set, else AI suggestion

### 5. Vendor Fuzzy Matching

- Normalizes vendor names (lowercase, strip non-alphanumeric)
- Longest-common-prefix score; matches at >0.7 threshold
- Exact match: no warning
- Fuzzy match: shows "Matched to QB vendor: BrightView Engineering LLC"
- No match: shows "⚠ New vendor — will be created in QB on push"

### 6. Database Changes

**New tables:**
```sql
invoice_line_items (
  id, invoice_id, billing_type, description, person,
  line_date, hours, rate, amount, qb_account_id, sort_order
)

contract_line_items (
  id, contract_id, code, description, billing_type,
  budgeted_amount, sort_order
)
```

**New API endpoints:**
- `POST /api/invoices/extract` — multipart PDF upload, returns extracted + line items + QB suggestions + vendor match
- `GET /api/phases/:phaseId/invoices` — all invoices for a phase (through contracts or direct)
- `GET /api/phases/:phaseId/contracts` — all contracts with nested change_orders

### 7. CommitmentsGrid Expandable Rows

- Budget lines with contracts show chevron → click to expand
- Contract sub-rows: vendor, status badge, ref#, total value, CO value, remaining
- Change order sub-rows (amber amounts) under each contract

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Type per-line, not header | An invoice can mix Fixed + T&M + Expense across lines |
| QB code per line | Data goes into QB as a bill — code assignment is mandatory |
| AI suggests, human confirms | Confidence dots signal where to focus review |
| Review checkbox gates Save | Explicit human sign-off before any data enters DB |
| max_tokens 8192 | T&M invoices with 7+ dated lines exceeded 2000 token limit |
| Full QB code list scannable | User needs to browse all ~60 GL codes, not just top 40 |
| Enter key adds line | Matches QB keyboard behavior |

---

## Pending / Phase 2

- **QB API push** — OAuth 2.0 at developer.intuit.com, POST /v3/company/{realmId}/bill. Data structure is QB-ready.
- **Contract upload flow** — same PDF-left / form-right pattern; `extractContract` already exists
- **Vendor bill history sidebar** — QB's "Add to Expense" panel showing related open bills from same vendor
- **Vendor list sync with QB** — vendors table mirrors QB; need import/sync mechanism
- **Approval workflow** — PM approve → Partner approve → Seth final approve → Push to QB
- **Enter key in description** → moves to Amount field (currently adds new line)
- **Alerts tab**, **History tab**, **Project edit screen** (project #, PM, gla_sf, gla_ac)

---

## Files Changed

| File | Change |
|---|---|
| `client/src/screens/InvoicesTab.tsx` | New — full QB-style invoice entry UI |
| `client/src/screens/InvoicesTab.module.css` | New — styles for all invoice UI components |
| `client/src/screens/CommitmentsGrid.tsx` | Expandable contract/CO sub-rows |
| `client/src/screens/CommitmentsGrid.module.css` | New — contract/CO row styles |
| `client/src/main.tsx` | Wire InvoicesTab to `/invoices` route |
| `lib/extract.js` | Multi-pass extraction, per-line billing type, QB code suggestion, max_tokens 8192 |
| `routes/invoices.js` | Extract endpoint passes 3+4, save invoice_line_items |
| `routes/phaseBudget.js` | Phase contracts + phase invoices endpoints |
| `db/schema.sql` | invoice_line_items + contract_line_items tables |
