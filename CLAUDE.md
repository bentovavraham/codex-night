# ActiveAcq — Engineering Principles

These are standing decisions. Follow them in every task without being reminded.

---

## 1. One function per financial write operation

Every path that creates a contract must call `lib/financials.js → createContract(client, data)`.
Every path that creates an invoice must call `lib/financials.js → createInvoice(client, data)`.

No route may contain its own `INSERT INTO contracts` or `INSERT INTO invoices` logic. Those functions are the single source of truth — they always write FA rows in the same transaction, always set status correctly, always roll back as a unit.

**Why:** Multiple independent INSERT paths drift. One path gets fixed, others don't. A bug fix in one place must fix all callers automatically — that requires one place.

---

## 2. FA rows are written in the same transaction as the source document

A contract or invoice that exists without a corresponding `financial_allocations` row is a data integrity failure. The two writes are atomic — if the FA write fails, the whole transaction rolls back. Never commit a contract or invoice and write FA "after" or "later."

---

## 3. What you confirm must appear on the budget grid — no exceptions

If a user confirms a document and it does not appear on the budget grid, that is a bug, not a workflow issue. The grid reads from FA. FA is written at confirm time. There is no valid state where something is "in the system" but not on the grid.

---

## 4. One component per UI action

The same user action (import a contract, import an invoice) must use the same component everywhere in the UI — whether accessed from the nav bar, a tab, or a detail screen. Do not create parallel components for the same action. Fix the shared component; don't fork it.

---

## 5. No draft contracts

All contracts created through the application are created as `active`. Draft status is not used. Removing the status gate eliminates a class of bugs where data is "in the system" but invisible.

---

## 6. Hard deletes are blocked on financial records

The DB trigger prevents hard deletes on contracts, invoices, and financial_allocations. Always void: set `status = 'voided'` and `allocation_status = 'voided'`. Never bypass the trigger.

---

## Stack reference

- Backend: Node/Express, PostgreSQL — routes in `routes/`, shared logic in `lib/`
- Frontend: React + Vite + TanStack Query — screens in `client/src/screens/`
- Financial source of truth: `financial_allocations` table
- Budget grid reads: FA rows where `allocation_status IN ('confirmed','approved') AND phase_budget_line_id IS NOT NULL`
