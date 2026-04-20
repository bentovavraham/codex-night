# ActiveAcq — Product Requirements Document
**Version 1.0 — April 20, 2026**
**Author: Seth / Avraham | Development: AI (Claude)**

---

## 1. The Problem in One Paragraph

Active Acquisitions manages multiple real estate projects simultaneously. Each project has a base contract with a vendor, but the real cost is always higher — change orders, time & material charges, and reimbursable expenses push the final number up. Today, contracts, invoices, and change orders arrive by email, sit in inboxes, and get paid by a secretary who may not know a new contract is a duplicate or that the total cost has crept 40% above the original. There is no dashboard, no alert system, no approval chain, and no audit trail. The goal of this software is to make that problem disappear.

---

## 2. Competitive Analysis — What the Best Software Does Today

### Procore (Industry Leader — Too Big)
**What they do well:**
- The "commitment" model: a contract creates a commitment. Change orders are sub-items of that commitment. The budget always shows original + approved change orders = current commitment. This is the right mental model.
- Change order workflow: a Potential Change Order (PCO) is created → reviewed → becomes a Change Order Request (COR) → approved → becomes a Change Order (CO). Each stage has a status and approver.
- Budget vs. Actual vs. Committed: three columns on every line. You see what you budgeted, what you committed to (contracts), and what was actually paid.
- Duplicate invoice detection via invoice number matching.
- Cost codes (equivalent to QB codes) are required on every item.
- Full audit trail on every record.

**What they get wrong for us:**
- Designed for general contractors managing subs. We are an owner/developer.
- Overwhelming — hundreds of features, most irrelevant.
- Expensive ($375+/month). Complex onboarding.

**Key lessons to steal:** The commitment model. The PCO → CO workflow. Budget vs. Committed vs. Paid three-column view.

---

### Buildertrend (Best UI/UX in Construction)
**What they do well:**
- Very clean, consumer-grade UI. Feels approachable.
- Change orders are first-class objects — they have their own list view, approval status, and roll up to the budget automatically.
- "Selections" for tracking owner-approved upgrades/changes.
- Built-in email integration — you can email documents in.
- Mobile-first design. Works on a tablet on a job site.
- Budget has a running "variance" column — original vs. current at all times.

**What they get wrong for us:**
- Built for home builders, not real estate acquisition/development.
- Does not handle T&M billing well.
- No strong duplicate payment detection.

**Key lessons to steal:** The UI/UX approach. Change orders as first-class objects. Variance column always visible.

---

### Yardi Voyager (Real Estate's Accounting Standard)
**What they do well:**
- Purpose-built for real estate owners (not builders).
- Budget vs. Actual with GL code (QB code equivalent) enforcement.
- Vendor management — tracks all vendors, payment history, flags if same vendor billed twice for same period.
- Invoice approval workflows with full audit history.
- Directly integrates with external accounting systems.

**What they get wrong for us:**
- Enormously complex. Takes months to implement.
- Old UI — feels like Windows 2003.
- No AI, no modern UX.

**Key lessons to steal:** Real estate owner perspective. Vendor-level duplicate detection. Strict GL code enforcement.

---

### Sage 300 Construction (The Accountant's Tool)
**What they do well:**
- "Committed costs" model — the moment a contract is signed, the committed cost shows up in the budget, even before any invoice is paid. This is critical for forecasting.
- Subcontract ledger: every contract has its own ledger showing original amount, change orders, invoiced to date, paid to date, remaining.
- Retainage tracking — holds back a % until job completion.
- Hard budget controls — can literally block a payment if it would exceed the approved budget.

**Key lessons to steal:** Committed cost model. Per-contract ledger showing all activity. Hard budget controls.

---

### What No Software Does Well Today (Our Opportunity)
1. **Informal invoice handling** — none of them handle "your tax payment is due May 1" emails. They all assume a formal PDF.
2. **Earmarked vs. Contract amount** — most software tracks contract value as the budget. None clearly track "we signed for $350K but we earmarked $500K — here's what's left."
3. **Modern AI-assisted entry** — none do it well yet. This is our edge.
4. **Simplicity** — all of the above are complex. A real estate team of 5-10 people should not need a consultant to use their cost tracking software.

---

## 3. Nomenclature (Standard Language for ActiveAcq)

| Term | Definition |
|------|------------|
| **Contract** | Base agreement with a vendor. Has a Scope, Estimated Cost, and Contract Date. |
| **Earmarked Amount** | The internal budget allocated to cover this contract including expected extras. Always ≥ Contract value. |
| **Commitment** | Contract Estimated Cost + all approved Change Orders. What we are legally on the hook for. |
| **Change Order (CO)** | A formal modification to the original Contract that changes scope and/or cost. Requires approval. |
| **Time & Material (T&M)** | Non-contract billable work. Charged by the hour + materials. Not covered by original scope. |
| **Contract Expense** | Reimbursable expenses (travel, tolls, food, hotels) billed by the vendor on top of contract work. |
| **Invoice** | A payment request against any of the above. Has an Invoice Number, Amount, Date, and QB Code. |
| **QB Code** | QuickBooks general ledger account. Required on every invoice line. |
| **Cost Creep** | When total commitment (Contract + COs + T&M + Expenses) exceeds the original Earmarked Amount. |
| **Overrun** | When total invoiced amount exceeds the Commitment. |
| **Duplicate** | An invoice or contract that appears to have already been paid (same vendor + similar amount + same period). |

---

## 4. The Financial Model (How Numbers Flow)

```
EARMARKED AMOUNT:      $500,000   ← internal budget (set by PM, approved by Seth)
  └─ Contract:         $350,000   ← signed agreement
  └─ CO Contingency:   $ 50,000   ← earmarked for expected change orders
  └─ T&M Contingency:  $ 50,000   ← earmarked for T&M
  └─ Expense Reserve:  $ 50,000   ← earmarked for reimbursables

COMMITMENT (live):     $420,000   ← contract + approved COs to date
  └─ Original Contract:$350,000
  └─ CO #1 (approved): $ 40,000
  └─ CO #2 (approved): $ 30,000

INVOICED TO DATE:      $390,000   ← what has actually been billed
PAID TO DATE:          $350,000   ← what has actually been paid
REMAINING COMMITMENT:  $ 30,000   ← commitment minus paid

ALERTS:
  ⚠️  Cost Creep: Commitment ($420K) is $70K above original contract ($350K)
  🔴  Earmark Burn: $420K committed of $500K earmarked — $80K remaining
  ⚠️  If CO #3 ($60K pending) is approved, only $20K of earmark remains → needs Seth approval
```

---

## 5. Approval Workflow

```
CONTRACT ENTRY
  PM creates contract → [PENDING APPROVAL]
    → Partner reviews → APPROVES or REJECTS
      → Seth reviews → APPROVES or REJECTS
        → Contract is ACTIVE → Invoices can be entered

CHANGE ORDER ENTRY
  PM creates CO → [PENDING APPROVAL]
    → Partner reviews → APPROVES or REJECTS
      → Seth reviews → APPROVES or REJECTS
        → CO is APPROVED → Added to Commitment

INVOICE ENTRY
  PM enters invoice → [PENDING APPROVAL]
    → Duplicate check runs automatically
    → Budget check runs automatically (would this exceed commitment or earmark?)
    → Partner reviews → APPROVES or REJECTS (with note)
      → Seth reviews → APPROVES or REJECTS
        → Invoice APPROVED → Ready for QB export / payment
```

---

## 6. Dashboard Requirements — "Living Story at a Glance"

The dashboard is the most important screen. It must answer these questions in under 5 seconds:

1. **What projects are in trouble?** (Over earmark, over commitment, pending approvals)
2. **What is waiting for my approval?** (Contracts, COs, invoices)
3. **Where is the money going?** (By project, by vendor, by QB code)
4. **Are we at risk of a duplicate payment?**

### Dashboard Components
- **Alert Bar** — Top of screen. Red/yellow callouts for: over earmark, pending approvals >24hrs, duplicate flags
- **Project Cards** — Each project shows: Earmarked / Committed / Invoiced / Paid as a progress bar. Color coded.
- **Approval Queue** — All items waiting for the current user's approval
- **Cost Creep Leaderboard** — Projects ranked by % over original contract

---

## 7. Development Phases

---

### Phase 1 — Foundation (MVP) — Build Now
**Goal:** Replace the chaos with a structured tracking system. Manual entry. All the data is in one place.

**What gets built:**
- [ ] Contract management with proper nomenclature (Estimated Cost, Earmarked Amount)
- [ ] Change Order as a first-class object — linked to a Contract, has its own approval status
- [ ] T&M charges — linked to a Contract, tracked separately from COs
- [ ] Contract Expenses — linked to a Contract or CO, categorized (travel/tolls/food/hotels/other)
- [ ] Invoice — can be against a Contract, CO, T&M, or Expense record
- [ ] Per-contract ledger: Original | COs | T&M | Expenses | Total Commitment | Invoiced | Paid | Remaining
- [ ] Cost Creep alert: when Commitment exceeds Earmarked Amount
- [ ] Overrun alert: when Invoiced exceeds Commitment
- [ ] Duplicate detection: flag if same vendor + similar amount invoiced twice in 30 days
- [ ] QB code required on every invoice (enforced, not optional)
- [ ] Full audit trail on every record
- [ ] **Document library view** — filterable/sortable list of ALL documents across all projects
- [ ] **Global search** — search by vendor, invoice #, amount, description, project, date range
- [ ] Every record links directly to its source PDF — one click, always

**Success metric:** PM can enter a contract, add a change order, log an invoice, the dashboard immediately reflects the updated cost position, AND any document can be found in under 10 seconds.

---

### Phase 2 — Approval Workflows — Next
**Goal:** Formalize the PM → Partner → Seth approval chain across all record types.

**What gets built:**
- [ ] User roles: PM, Partner, Admin (Seth)
- [ ] Approval chain: PM creates → Partner approves → Seth approves
- [ ] Email notifications when item is waiting for approval
- [ ] Approval timeout alerts (pending >24hrs)
- [ ] "My Approvals" queue on dashboard — one-click approve/reject
- [ ] Rejection notes — required when rejecting, visible to submitter
- [ ] Hard budget controls — cannot approve an invoice that would cause overrun without override
- [ ] Override approval — overrun requires escalated approval (Seth only)

**Success metric:** Seth can open the app and see everything waiting for him to approve, approve with one click, and get an email when new items come in.

---

### Phase 3 — AI-Assisted Data Entry
**Goal:** Make entering data faster and nearly error-free.

**What gets built:**
- [ ] Side-by-side view: PDF on left, form on right — always
- [ ] AI field extraction from uploaded PDF (invoice number, vendor, amount, date, line items)
- [ ] AI QB code suggestion based on description + vendor + historical patterns
- [ ] Each AI-suggested field shown with a "confidence" indicator — user must confirm
- [ ] AI duplicate flag: "This looks similar to Invoice #INV-204 from the same vendor last month"
- [ ] Smart contract matching: when an invoice is uploaded, AI suggests which contract it belongs to
- [ ] Informal invoice handling: plain-text email entries with no PDF attachment

**Success metric:** Entering an invoice from a PDF takes under 2 minutes and requires zero manual field lookup.

---

### Phase 4 — Integrations & Automation
**Goal:** Remove manual work entirely for routine documents.

**What gets built:**
- [ ] Email ingestion: documents emailed to invoice@activeacq.com are auto-processed
- [ ] QuickBooks API: approved invoices push directly to QB as AP bills
- [ ] QuickBooks payment sync: when QB marks something paid, status updates here
- [ ] SharePoint integration: all PDFs stored and indexed in SharePoint
- [ ] Reporting: monthly cost reports by project, by vendor, by QB code — exportable to PDF

**Success metric:** An invoice arrives by email, gets processed by AI, shows up in the approval queue, gets one-click approved, and pushes to QuickBooks — with zero manual data entry.

---

## 8. Data Model (What Gets Tracked)

```
PROJECT
  └─ Contracts[]
       └─ id, vendor, scope, estimated_cost, earmarked_amount
       └─ status: draft | pending_partner | pending_seth | active | closed
       └─ ChangeOrders[]
            └─ id, description, amount, status (same approval flow)
       └─ TMCharges[]
            └─ id, description, hours, rate, amount, date
       └─ Expenses[]
            └─ id, category (travel|tolls|food|hotel|other), amount, date, receipt
       └─ Invoices[]
            └─ id, invoice_number, vendor, amount, date, qb_code, status
            └─ linked_to: contract | change_order | tm | expense
            └─ duplicate_flag: boolean
```

---

## 9. UI/UX Principles (Steve Jobs Standard)

1. **One job per screen.** The dashboard tells you what needs attention. The contract detail shows you one contract's full story. Never mix.
2. **Alerts are unavoidable.** Cost creep and duplicates are shown in red, above the fold, always. You cannot miss them.
3. **The form is next to the document.** Always. You never enter data without seeing the source.
4. **QB codes are not optional.** The submit button is disabled until a code is selected. Period.
5. **One-click approvals.** The approval queue is designed for speed — see the item, approve, move on.
6. **Numbers tell a story.** Every dollar amount is contextualized: "42% of earmark used," not just "$210,000."
7. **Audit trail is always visible.** Every record shows its full history. Nothing is hidden.

---

## 10. Knowledge Management — The Document Library

This is a core requirement, not a Phase 4 nice-to-have. The system is the single source of truth for every contract, change order, invoice, and expense. **No one should ever search their inbox again.**

### The Problem Today
- Contracts are emailed, saved in random folders, sometimes printed
- Finding "the HVAC contract from March" means searching email, asking the secretary, or hoping someone remembers the filename
- There is no way to know if a document exists without asking a person

### How We Solve It

**Every document has a permanent home.** When a contract, CO, invoice, or expense is created in the system, its PDF is attached and stored. It is indexed and findable forever.

**Global search** — one search bar, searches across:
- Vendor names
- Contract descriptions
- Invoice numbers
- Dollar amounts
- QB codes
- Project names
- Date ranges
- Document text (full-text search of PDFs — Phase 3)

**Filter + browse** — beyond search, users can browse the full library filtered by:
- Document type (Contract / Change Order / Invoice / T&M / Expense)
- Project
- Vendor
- Status (pending / approved / paid)
- Date range
- QB code
- Amount range

**Every document is one click away.** From any record — a contract, an invoice, a change order — there is a "View Document" button that opens the original PDF instantly. No folders, no filenames, no searching.

**Audit trail = knowledge trail.** Every record shows who touched it, when, and what they changed. "Who approved this contract?" → one click.

### What This Means for the Build

- Phase 1: All documents stored in Postgres (already done). Every record has a direct PDF link.
- Phase 1: Global search endpoint — search across contracts, invoices, COs by vendor/amount/number/description
- Phase 1: Document library view — a filterable, sortable list of ALL documents across ALL projects
- Phase 3: Full-text PDF indexing — search inside the document content, not just metadata
- Phase 4: SharePoint as the permanent archive backend

### The "No More Inbox Searching" Promise
When fully built, a user can find any document by typing:
- A vendor name → see every contract, invoice, CO ever associated with that vendor
- A dollar amount → find the invoice
- A date → find everything submitted that week
- A project name → see the complete financial picture
- An invoice number → pull it up instantly

This is the library. It lives inside the cost management tool because the two are inseparable — you cannot manage costs without being able to find the documents.

---

## 11. What to Build Next (Immediate Priority)

Based on Phase 1, here is the build order:

1. **Rename "total_value" to "estimated_cost" throughout** — language matters
2. **Add "earmarked_amount" to contracts** — separate from contract value
3. **Build Change Order as a first-class object** — with its own form, list, approval status
4. **Build T&M and Expense records** — linked to contracts
5. **Per-contract cost ledger** — the single most important view
6. **Cost creep alerts** — visual, unavoidable
7. **Duplicate detection** — automatic, on every invoice entry
8. **QB code enforcement** — disabled submit until code selected
9. **Dashboard redesign** — tells the story described above

---

*This document is a living PRD. Update it as decisions are made.*
*Last updated: 2026-04-20*
