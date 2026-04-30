# Import Validation Rules

These rules prevent bad invoices from entering the audit table. They are enforced at two layers: **UI (cannot click Confirm)** and **API (server rejects the request)**. The UI layer is a convenience; the API layer is the guarantee.

---

## Rule 1 — Wrong Project: Hard Block

**Trigger:** `project_match = 'mismatch'`

**What it means:** The system identified that the invoice's filename or extracted content references a different known project than the one you're importing into.

**How it is detected:**
- Filename is checked for known project keywords (e.g. `Richwood`, `Howell`, `Forman`)
- Extracted invoice text (client name, job number, site address) is checked
- Both are compared against the current phase's project AND all other known projects

**Enforcement:**
- UI: The "Confirm & Save" button is not rendered at all. Only "Discard" is available.
- API: `POST /api/import-queue/:id/confirm` returns `422` if `project_match = 'mismatch'`, regardless of what the client sends.

**What to do:** Discard the invoice. If it genuinely belongs to this project, the project's keyword list needs to be updated first (add the missing alias), then re-run "Re-match QB" to re-evaluate.

---

## Rule 2 — No Verified QB Match: Required Override

**Trigger:** `qb_match_confidence = 'low'` or `'none'`

**What it means:** No QB transaction was found that matches this invoice by both vendor name and amount. A low-confidence match means the vendor name matched but the amounts are different — a different QB transaction, a different time period, or a rollup entry.

**Enforcement:**
- UI: A warning box appears. The PM must check a second checkbox: *"I understand — confirm anyway without a QB match"* before the Confirm button becomes active.
- There is no API-level block (QB matching is imperfect and sometimes a human override is legitimate) — but the override is logged via the fact that `qb_transaction_id` will be null or weak on the resulting invoice.

**What to do:** Either find the correct QB transaction and re-match, or check the box to confirm the invoice without a QB link. The invoice will appear in the Audit table as "Not in QB."

---

## Rule 3 — Duplicate Invoice: Soft Block

**Trigger:** An invoice with the same invoice number and vendor already exists in this phase.

**Enforcement:**
- UI: A warning lists the matching invoice(s). The PM must check *"I acknowledge this may be a duplicate"* before confirming.

---

## How Project Keywords Work

Each project has a `keywords` array in the database (`projects.keywords`). The matching checks:

1. The **filename** of the uploaded PDF
2. The **extracted project clues** (client name, job #, site address pulled from the invoice by AI)

Both are checked against the current project's name and all its keywords, and also against every other project's name and keywords. If another project is a stronger match, the invoice is flagged as `mismatch`.

**To add keywords for a project**, update the `keywords` column:
```sql
UPDATE projects SET keywords = ARRAY['richwood','north harrison','24117'] WHERE id = 12;
```

Current keyword mappings (as of initial setup):

| Project | Keywords |
|---------|----------|
| Madison Marquette | richwood, north harrison, 24117, richmond marquette |
| Stavola-Howell | howell, stavola howell |
| Forman | forman, okerson |
| McDowell/Speedway/Hurley | mcdowell, speedway, hurley |
| Stavola | stavola |
| Hope Chapel (Ram) | hope chapel, ram |
| Old York CC | old york, oycc |

Add more as naming conventions evolve. The system re-evaluates project match every time "Re-match QB" is run.

---

## What These Rules Do NOT Catch

- An invoice correctly identified as belonging to this project but for the wrong phase (e.g., Phase 1 vs Phase 2) — phase distinction must be enforced by the PM during review
- Invoices where the filename has no project keyword and the PDF text has no identifiable project reference — these return `project_match = 'uncertain'` and flow through to the review queue with a warning badge
- Intentional cross-project billing (rare edge case) — discard and re-import into the correct phase
