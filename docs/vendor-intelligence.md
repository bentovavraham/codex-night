# Vendor Intelligence — Invoice Extraction & Matching Guide

This file documents how to identify, classify, and link invoices from key vendors to the correct
project, phase, and budget line. Used by the AI extraction layer to auto-suggest matches at upload time.

---

## How to Use This File

When an invoice is uploaded, the extraction layer should:
1. Identify the **vendor** by name, address, or letterhead
2. Extract the **vendor's internal reference number** (their project/contract number)
3. Look up that reference number against existing contracts in the system
4. Auto-suggest: Project → Phase → Budget Line → Contract
5. Present the match to the user for one-click confirmation

---

## Vendors

---

### Shropshire Associates LLC

**Type:** Traffic Engineering Consultant
**Address:** 277 White Horse Pike, Suite 203, Atco, NJ 08004
**Phone:** 609-714-0400
**Billing email:** Billing@sallc.org
**Primary contacts:** Nathan B. Mosley P.E. (Senior PM), David R. Shropshire P.E. (Principal)

#### Invoice format
- Header: "Shropshire Associates LLC" (large bold text, no logo)
- Key field: **"SA Project No."** — always present, links directly to their proposal/contract
- Billing model: **percent-complete draws** against a fixed proposal amount
  - Shows: Proposal Amount / Percent Complete / Fees Billed to Date / Prior Fees Billed / Current Fees Billed
  - Also shows prior payments and running balance due
- Invoice numbers: sequential (e.g. 31354, 31464, 31477...)
- Terms: Net 30

#### Reference number conventions
| SA Project No. | What it means |
|---|---|
| `23175` | Original contract — base number |
| `23175-A` | T&M extra work billed outside the original contract scope |
| `23175-B` | A second distinct contract/scope for the same project |
| `23175+` | Shropshire's notation that prior invoices exist on this contract |
| `23175+**` | Further internal tracking variant — still the same contract |
| `23175-B+` | Second contract, with prior invoices |
| `23175-B--**` | Second contract, further tracking variant |

**Rule:** Strip all suffixes (`+`, `*`, `-A`, `-B`) to get the base contract number, then match to the contract with that `reference_number`. Suffix `-B` (or `-C`, etc.) indicates a **separate contract**, not the same one. Suffix `-A` typically indicates **T&M extras** — treat as a direct invoice against the same budget line as the base contract, or as a change order.

#### Known contracts (Richwood Logistics Park)

| SA Project No. | Date | Scope | Amount | Phase |
|---|---|---|---|---|
| 23175 | 2023-07-11 | Original Traffic Impact Study | $29,600 | Pre-phase / GDP |
| 23175-B | 2024-02-22 | Township GDP Application TIS | $17,400 | Pre-phase / GDP |
| 24249 | 2024-09-30 | Phase 1 — TIS + Intersection Design | $82,500 | Phase 1 |
| 25118 | 2025-04-17 | Phase 3 — TIS + Conceptual Plans | $11,200 | Phase 3 |
| 25160 | 2025-06-10 | Phase 4 — TIS + Intersection Design | $51,300 | Phase 4 |

#### Budget line mapping
- All Shropshire contracts map to: **Section: Professional Fees → Task: Traffic Engineering**
- Phase-specific contracts map to that task within the correct phase's budget

#### Billing structure (percent-complete model)
Shropshire bills in draws against the fixed proposal total. Invoices should be linked to the
contract, not treated as independent line-item invoices. The system tracks:
- **Committed** = contract total value
- **Billed** = sum of all invoices against that contract
- **Remaining** = Committed − Billed

When `Billed = Committed` (100%), the contract is fully drawn down.

#### Payment history pattern (23175 example)
| Invoice | Date | Current Billed | Cumulative % |
|---|---|---|---|
| 31354 | 2023-08-18 | $7,400 | 25% |
| 31464 | 2023-09-20 | $2,960 | 35% |
| 31477 | 2023-09-20 | $905.70 | T&M extra (23175-A) |
| 31743 | 2023-12-07 | $1,480 | 40% |
| 31835 | 2024-01-15 | $7,400 | 65% |
| 31983 | 2024-03-11 | $2,960 | 75% |
| 32409 | 2024-07-15 | $7,400 | 100% |

---

## Vendor Template (copy for new vendors)

```
### [Vendor Name]

**Type:**
**Address:**
**Phone:**
**Billing email:**
**Primary contacts:**

#### Invoice format
- Header:
- Key field:
- Billing model: [ percent-complete | fixed-fee line-item | T&M hourly | milestone ]

#### Reference number conventions
| Field on invoice | What it means |
|---|---|
| | |

#### Known contracts
| Ref No. | Date | Scope | Amount | Phase |
|---|---|---|---|---|
| | | | | |

#### Budget line mapping
- Section: → Task:

#### Notes
```

---

## General Extraction Rules (all vendors)

1. **Always extract** vendor name, invoice number, invoice date, total amount due
2. **Always look for** the vendor's own project/contract reference number — this is the primary link to the contract in the system
3. **Phase determination**: the vendor's reference number → matched contract → contract knows its phase
4. **When no contract match is found**: flag as unmatched, prompt user to either (a) link to an existing contract, (b) create a new contract, or (c) mark as a direct invoice to a budget line
5. **T&M extras** (like Shropshire's `-A` suffix): treat as direct invoice against the same budget line as the parent contract, or as a change order if material in size
6. **Percent-complete invoices**: the "Current Fees Billed" field is the invoice amount — not the "Fees Billed to Date"
