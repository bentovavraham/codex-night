# ActiveAcq — Financial Math Audit
**Date:** April 21, 2026  
**Prepared by:** Claude Code  
**Status:** Pre-fix review — bugs documented, not yet corrected

---

## Financial Model (Confirmed Definitions)

```
Initial Contract          The signed amount. What you agreed to pay at day one.
+ Approved Change Orders  Formally approved scope additions.
─────────────────────────────────────────────────────────
= COMMITMENT              Your legal obligation. The number you are on the hook for.

+ Approved T&M            Time & Material charges approved but may not be invoiced yet.
+ Approved Expenses       Other approved costs.
─────────────────────────────────────────────────────────
= TOTAL EXPOSURE          Full expected spend. The realistic "how much will this cost."

  Internal Budget         (Earmarked Amount) — what you set aside internally.
  Buffer                  Internal Budget − Total Exposure  (positive = room left)
  Cost Creep              Total Exposure > Internal Budget
  Contract Overrun        Invoiced > Initial Contract Amount ("Banging Us Out")
```

---

## Progress Bar — What Each Segment Means

```
│░░░░░░░░│▒▒▒▒▒▒│████████│▓▓▓▓▓│░░░░░░│
  PAID   OUTSTANDING  COMMITTED  OVERFLOW
                      (not inv'd)
         ↑                        ↑
    Initial Contract          Internal Budget
      tick mark                 tick mark
```

| Segment | Color | Definition |
|---|---|---|
| **Paid** | Green | Invoices with status = `paid` |
| **Outstanding** | Amber/Orange | Invoices approved/pushed but **not yet paid** |
| **Committed — not invoiced** | Terracotta | Commitment (contract + COs) minus total invoiced — money owed but not billed yet |
| **Overflow spike** | Red/Striped | Invoiced amount that exceeds the initial contract value |
| **Initial Contract tick** | Vertical line | Marks the $X original contract boundary |
| **Internal Budget tick** | Vertical line | Marks the internal budget boundary |

---

## Bugs Found

---

### BUG 1 — "Cost Creep" Banner: Wrong Number in Message Text
**File:** `public/js/components/Contracts.js` line ~570  
**Severity:** Medium — confusing language, not a calculation error

**What it says:**
> 🔴 Cost creep: commitment **$8,900** exceeds earmark **$10,000**

**What's wrong:**  
$8,900 does **not** exceed $10,000. The message shows `ledger.commitment` ($8,900) but the `cost_creep` flag is triggered by `totalExposure > earmarked`. Total Exposure includes T&M and expenses on top of Commitment. So the flag fires correctly — but the message blames "commitment" when the real culprit is **Total Exposure**.

**What it should say:**
> 🔴 Cost creep: total exposure **$10,088** exceeds earmark **$10,000**

---

### BUG 2 — "OVER BY" Amount Uses Wrong Variable
**File:** `public/js/components/Contracts.js` lines ~923, ~962  
**Severity:** High — wrong dollar figure shown to users

**What it shows:**  
`OVER BY: ${commitment − earmarked}`  
e.g., $8,900 − $10,000 = **−$1,100** (a negative number, shown as "OVER BY −$1,100")

**What's wrong:**  
- The `overBudget` flag is correctly triggered when `totalExposure > earmarked`
- But the OVER BY dollar amount is computed as `commitment − earmarked`, not `totalExposure − earmarked`
- When commitment < earmarked but totalExposure > earmarked, the OVER BY number will be negative — which is nonsensical for an "over budget" state

**What it should be:**  
`OVER BY: ${totalExposure − earmarked}`  
So if commitment = $8,900, T&M = $1,188, earmarked = $10,000:  
→ Total Exposure = $10,088  
→ OVER BY = **+$88** ✓

---

### BUG 3 — Alerts Sidebar: Commitment Formula is Fundamentally Wrong
**File:** `routes/alerts.js` lines 90–93  
**Severity:** High — all budget pressure calculations in the sidebar are wrong

**Current code:**
```javascript
const commitment = invoiced
  + (parseFloat(row.co_total)  || 0)
  + (parseFloat(row.tm_total)  || 0)
  + (parseFloat(row.exp_total) || 0);
```

**Two problems:**

1. **Invoiced amount is included in commitment.** Invoiced money is a subset of commitment — it's what you've already been billed for. Adding it to commitment double-counts it. A vendor can invoice $4,000 against a $6,000 contract — commitment is still $6,000, not $10,000.

2. **T&M and Expenses are included in commitment.** Per our model, Commitment = Initial + Approved COs only. T&M and Expenses make up Total Exposure, not Commitment.

**What it should be:**
```javascript
const commitment    = initial + (parseFloat(row.co_total)  || 0);
const totalExposure = commitment
                    + (parseFloat(row.tm_total)  || 0)
                    + (parseFloat(row.exp_total) || 0);

// Budget pressure: total exposure vs earmarked
const budgetUsedPct = earmarked > 0 ? (totalExposure / earmarked) * 100 : 0;
```

**Impact:** Every "Budget Pressure" severity rating in the alerts sidebar is computed against the wrong number.

---

### FINDING 4 — Sidebar vs Detail Invoiced Mismatch — RESOLVED ✅
**Files:** `routes/alerts.js` vs `routes/contracts.js`  
**Severity:** Not a bug — two separate contracts

**Investigation result (DB query, April 21 2026):**

| Contract ID | Project | Total Value | Earmarked | Invoiced |
|---|---|---|---|---|
| 1 | Parkwood Projects A:Gaitway | $6,300 | none | **$10,432** |
| 8 | Morningside Riviera Apr 20 2026 | $6,300 | $10,000 | **$4,232** |

**Explanation:** The alerts sidebar showed Contract #1 (Parkwood, genuinely critical — invoiced $4,132 more than the contract). The main contract detail tab was showing Contract #8 (Morningside). Same vendor name, different projects, different histories. The alerts sidebar is global (shows flagged contracts across all projects), so seeing a different number than the currently open contract is expected behavior.

**No code fix needed.**

---

## Summary Table

| # | Location | Bug | Impact |
|---|---|---|---|
| 1 | `Contracts.js` ~570 | "Cost creep" message says "commitment" when it means "total exposure" | Confusing — wrong dollar cited |
| 2 | `Contracts.js` ~923, ~962 | OVER BY uses `commitment − earmarked` instead of `totalExposure − earmarked` | Shows wrong (often negative) dollar amount |
| 3 | `alerts.js` 90–93 | Commitment formula adds invoiced amount + T&M + expenses — fundamentally wrong | All budget pressure alerts miscalculated |
| 4 | `alerts.js` vs `contracts.js` | Sidebar invoiced ($10,433) ≠ detail ($4,233) | ✅ Resolved — two different contracts, same vendor |

---

## What Is Working Correctly

| Item | File | Status |
|---|---|---|
| Contract detail commitment formula | `routes/contracts.js` line 427 | ✅ `original + approvedCOs` |
| Contract detail total exposure formula | `routes/contracts.js` line 428 | ✅ `commitment + tmApproved + expApproved` |
| Cost creep trigger flag | `routes/contracts.js` line 432 | ✅ `totalExposure > earmarked` |
| Overrun trigger flag | `routes/contracts.js` line 434 | ✅ `invoiced > totalExposure` |
| overBudget trigger in frontend | `Contracts.js` line ~890 | ✅ `totalExposure > earmarked` |
| Progress bar segment logic | `Contracts.js` | ✅ Correct segments, correct tick marks |
| Alerts over-initial calculation | `alerts.js` lines 96–98 | ✅ `invoiced − initial` |
| History/audit trail UNION query | `routes/contracts.js` | ✅ Covers all event types |

---

## Recommended Fix Order

1. **Fix Bug 3 first** (`alerts.js`) — the commitment formula affects every number downstream in the sidebar
2. **Fix Bug 2** (`Contracts.js`) — the OVER BY dollar amount is the most visible wrong number to users
3. **Fix Bug 1** (`Contracts.js`) — the message text fix, once the right variable is used
4. **Investigate Finding 4** — query DB to check if there are multiple contracts for the same vendor
