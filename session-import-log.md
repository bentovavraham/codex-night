# NORR — Harrison Township Phase 1 Import Log
*Session: 2026-05-06*

## Invoices Confirmed

**Invoice IN2324-0289-00-0000001** — January 23, 2025 — $21,600
Architectural Design (1705.02) → Architectural Design task. Concept Design at 90% of the $24,000 fee.

**Invoice IN2324-0289-00-0000002** — February 24, 2025 — $15,400 total, two lines:
- $2,400 → Architectural Design (1705.02) → Architectural Design task. Final 10% of Concept Design. Brings Architectural Design to $24,000 — fully billed.
- $13,000 → Fire Suppression (1720.08) → Fire-Water DD Report task. PCN01: OfficeAdds, FireTank, CivilCoord.

---

## Running Totals

**Architectural Design (1705.02)**
$24,000 billed / $24,000 budgeted — fully billed, on budget.

**Fire-Water DD Report (1720.08)**
$13,000 billed / $10,000 budgeted — $3,000 over budget. Likely needs a budget amendment or change order.

---

## Bugs Observed — 2026-05-07

Edited an invoice amount to $0 after confirming. Three things broke:

Invoice disappeared from the sidebar view but stayed in the invoices tab — likely a filter somewhere that hides zero-amount invoices from the sidebar count or list.

The reconciliation progress bar at the top of the Audit tab threw an error — likely a divide-by-zero or null when computing coverage percentages with a zero-amount invoice in the mix.

Line items appeared to be cleared in the import/edit view after the amount was zeroed. Adding them back resolved the visible issue. Root cause unclear — may be the edit form not preserving line items when the header amount is changed to zero.

Resolved for now by adding line items back. Needs proper investigation.

---
