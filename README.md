# ActiveAcq — Project Financial Manager

Budget → Contract → Invoice → Approved → Pushed → Paid lifecycle tracker for
construction and real-estate acquisition projects.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js / Express, PostgreSQL (`pg`) |
| Frontend | React + Vite (TypeScript), TanStack Query |
| Auth | express-session with Postgres session store |
| File storage | Postgres `files` table (BYTEA) |
| AI | Anthropic Claude API — invoice/contract extraction, GL suggestions |

## Local setup

```bash
npm install
cd client && npm install && cd ..
cp .env.example .env          # fill in DATABASE_URL, SESSION_SECRET, ANTHROPIC_API_KEY
npm run migrate               # applies db/schema.sql (idempotent)
npm run dev                   # starts backend (port 3000) + Vite dev server (port 5173)
```

First user:
```bash
curl -X POST -H "x-seed-token: TOKEN" -H "Content-Type: application/json" \
     -d '{"name":"You","email":"you@example.com","password":"pick","role":"admin"}' \
     https://HOST/api/admin/create-user
```

## Architecture

```
/
├── server.js              # Express bootstrap, session, mounts all routes
├── db/
│   ├── pool.js            # pg connection pool
│   ├── schema.sql         # idempotent schema — runs on every startup
│   └── migrate.js         # schema.sql runner
├── lib/
│   ├── financials.js      # Single source of truth for all financial writes
│   ├── extract.js         # Claude AI — PDF extraction + GL code suggestions
│   └── storage.js         # File read/write (Postgres BYTEA)
├── routes/                # HTTP layer only — auth, validation, transaction wrapper
│   ├── contracts.js
│   ├── invoices.js
│   ├── changeOrders.js
│   ├── import.js          # Import queue + AI extraction pipeline
│   ├── phaseBudget.js     # Budget grid, drillthrough, cross-check, snapshots
│   └── ...
└── client/                # React + Vite frontend
    └── src/
        ├── api/client.ts  # Typed fetch wrapper for all API calls
        └── screens/       # One file per screen/tab
            ├── BudgetGrid.tsx
            ├── ContractsTab.tsx
            ├── InvoicesTab.tsx
            ├── ImportDrawer.tsx   # Import queue UI + ReviewOverlay (used for edit too)
            └── ...
```

## Financial data flow

Every dollar flows through `financial_allocations` before appearing on the budget grid.
All writes go through `lib/financials.js` — no route contains direct INSERTs into
contracts, invoices, or financial_allocations.

```
User action
  └── route (auth + validation only)
        └── lib/financials.js  ← createContract / createInvoice / syncContractFA /
                                  syncInvoiceFA / syncChangeOrderFA
              └── financial_allocations  ← budget grid reads this exclusively
```

See `CLAUDE.md` for the engineering principles that govern every change.

## Deployment (Render)

1. Push to GitHub.
2. Render Web Service: build `npm install && cd client && npm install && npm run build`, start `node server.js`.
3. Env vars: `DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `NODE_ENV=production`.
4. Schema runs automatically on startup (idempotent).
