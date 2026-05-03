# Budget Grid — W1 / W2 Design Note

**Date:** 2026-05-03
**Status:** Design decisions locked; not yet built.
**Authors:** Avraham + Claude (conversation transcript)

---

## Problem

ActiveAcq's central canvas is the Budget Grid (Project → Phase → Budget tab). It encodes a forward-going workflow — PM enters a budget, takes proposals, signs contracts, books invoices, pushes to QB. The columns tell that story left-to-right:

> BUDGETED → REMAINING → CONTRACTED + COS + TOTAL COMMIT → FIXED + T&M + EXPENSE → BILLED + AMT DUE + PAID → $/SF + $/AC

A second use case has emerged: **historical projects already booked in QuickBooks, where the CFO/ownership want to understand what a project actually cost** — without a PM having ever touched ActiveAcq for that project.

This document captures how both workflows live in **the same Budget Grid** without forking the data model or the UI.

---

## Two workflows

### W1 — Forward (the main thing)

The current app. PM is the actor. App is the system of record. QB is the destination.

1. PM enters Original Budget per line
2. Vendor proposals roll into committed
3. Signed contracts firm up the commitment
4. Invoices arrive (Fixed / T&M / Expense)
5. Change orders modify contracts
6. App pushes to QB as it goes

**W1 is sacrosanct.** Nothing in W2 may change W1 behavior or visuals.

### W2 — Historical (separate, additive)

Stakeholders: Seth, CFO, Accounting, Ownership.

For projects already booked in QB, the same Budget Grid populates from `qb_transactions` instead of from `invoices`. Two sub-modes:

- **W2a — Cost Summary**: just roll QB transactions into the right side of the grid (BILLED / PAID / AMT DUE) by GL code. No contracts, no change orders.
- **W2b — Reconstructed Project**: PM walks through and manually groups QB rows into synthetic contracts (and tags some as change orders). Slower, but the grid ends up looking like a W1 project.

---

## The structure: three views of the same grid

The Budget tab gains three sub-tabs:

```
[ PM Source ]  [ QB Source ]  [ Compare ]
```

Default: **PM Source**.

Each view renders the **same template** (same COA rows, same columns). They differ only in what data populates the actuals columns.

| View | BUDGETED / CONTRACTED / COS | FIXED / T&M / EXPENSE | BILLED / AMT DUE / PAID |
|---|---|---|---|
| **PM Source** | PM-entered | from `invoices` | from `invoices` |
| **QB Source** | PM-entered (same as PM Source — the plan is a single fact) | blank (QB has no Fixed/T&M/Expense breakdown) | from `qb_transactions` |
| **Compare** | PM-entered | PM values; Δ columns hide where QB side is structurally blank | both sides + Δ |

**Why same plan in both:** BUDGETED / CONTRACTED / COS are facts about *intent*, entered by the PM. QB doesn't know about plan or contracts; it only knows about booked transactions. So the plan side of the grid is identical in PM Source and QB Source — the views differ only on actuals.

## The principle

> **One grid. One data model. The columns don't change. What changes is the *source* feeding each cell.**

| Column | W1 (forward) | W2 (historical) |
|---|---|---|
| BUDGETED | PM enters | empty (or PM enters retroactively) |
| CONTRACTED / COS / TOTAL COMMIT | from contracts | empty (W2a) or PM-reconstructed (W2b) |
| FIXED / T&M / EXPENSE | from PDF invoices | empty (QB doesn't have this breakdown) |
| BILLED / AMT DUE / PAID | from PDF + QB | from QB |
| REM. BUDGET / REM. % | computed | computed (uses whatever invoice-side data is available) |
| $/SF / $/AC | computed | computed |

For W2 the empty cells *are* the message: "no plan, no contracts on record for this project — here's what was actually spent."

---

## Decisions

### Decision 1 — Three sub-tabs, same grid structure, source-specific actuals

The Budget tab gets three sub-tabs (`PM Source` | `QB Source` | `Compare`), each rendering the same template (same rows, same columns) with source-specific data. Default: PM Source.

The PM Source and QB Source views are clean (no variance columns). The Compare view adds Δ columns next to **every actuals sub-column** — FIXED, T&M, EXPENSE, BILLED, AMT DUE, PAID — six new Δ columns total. Reading A by choice; the filter below is the relief valve.

**Δ visualization:** dollar amount + % side-by-side. Color-coded green if QB ≥ PM, red if QB < PM. Renders only when both sides have meaningful data.

**Active Only filter (Compare view):** a toggle at the top of Compare view that hides Δ columns where the QB side is structurally blank (FIXED, T&M, EXPENSE — since QB doesn't carry that breakdown). Default: ON. Power users can flip to "Show All" to see the full six-Δ grid. Same logic optionally applies to row visibility — hide rows where every Δ is empty or under threshold.

### Decision 2 — Source determined by sub-tab, not by data presence

Each sub-tab is bound to one source:

- **PM Source** → renders from `invoices` / `contracts` / `budget_lines` only. If a phase has no PDF data yet, the actuals columns are blank.
- **QB Source** → renders BILLED/AMT DUE/PAID from `qb_transactions` only. If a phase has no QB data loaded, those columns are blank.
- **Compare** → renders both side by side with Δs.

This is more explicit than the earlier "implicit fill" idea, and it's the right call: each view is unambiguous about what it's showing. No mixing of PDF and QB data within the same actuals column. Stakeholders see only their source unless they deliberately switch to Compare.

### Decision 3 — W2 onboarding flow uses the same five-step setup as W1

```
1. Select Industrial / Residential
2. Select Project
3. Select Phase
4. Initialize Budget Grid       ← always first move, always
5. Audit Tab → upload QB Transaction Report (optional)
6. QB data flows into the existing grid columns
```

W2 is a *parameter* of W1, not a parallel path. No separate "import historical project" wizard. The PM/CFO does the same setup; the only difference is whether step 5 happens at all and in what order vs. PDF uploads.

**3a — QB transactions on GL codes not in the initialized template:** auto-add the rows, visually flagged as "added from QB." Doesn't block the import. PM can clean up later.

**3b — QB transactions whose Customer:Job tag doesn't match the selected phase:** import them anyway, surface a warning afterwards ("23 of these had a different Customer:Job — review?"). Real QB exports are messy; don't block on tagging hygiene.

### Decision 4 — Change orders in W2 (W2b only)

QB transactions don't carry change-order markers. In W2b reconstruction, when the PM groups QB rows into a synthetic contract, individual rows get an optional toggle: *"treat this as a change order."* Flipping it pushes that row's amount into the COS column instead of the base CONTRACTED column. Same dollars, different bucket.

In W2a (no reconstruction), COS stays blank. That's correct — W2a is explicitly the lower-fidelity view.

---

## QB-side asymmetry (constraint, not a bug)

QuickBooks transactions don't carry the Fixed / T&M / Expense distinction. That breakdown only exists because Claude extracts it from PDF line items. A QB transaction is just `amount + GL code + vendor + date`.

So: in any phase that's purely W2-fed, the FIXED / T&M / EXPENSE columns will be blank, and the totals appear under BILLED / PAID / AMT DUE. Don't fake the breakdown on the QB side.

---

## Open questions (deferred — not blocking)

1. **What QB-derived fields go into BILLED vs PAID vs AMT DUE.** The mapping is straightforward (`qb_transactions.amount` → BILLED, `paid_amount` → PAID, `open_balance` → AMT DUE) but worth confirming once before build, in case Seth's mental model differs.

2. **The "use historical as template" feature.** Letting a completed project's actuals seed a new project's budget. **Deferred indefinitely** — revisit when there's real demand.

---

## Locked-in summary (one paragraph)

The Budget Grid is the single canvas for both W1 and W2. The columns don't change. In W2 phases, QB data populates the same cells PDF data would populate in W1, with the FIXED/T&M/EXPENSE breakdown left blank because QB doesn't carry that distinction. No side-by-side columns, no Δ columns, no reduce modes — the existing grid is fine. Reconciliation between PDF and QB stays in the Audit tab where it lives today. Onboarding is the same five-step flow for both workflows. W2 is a parameter of W1, not a parallel path. W1 is sacrosanct and unchanged; W2 layers on by allowing QB to be a data source for the same view.
