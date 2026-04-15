# ActiveAcq — Project Financial Manager

Budget → Contract → Invoice → Approved → Pushed → Paid lifecycle tracker for
construction / real-estate acquisitions projects.

- **Backend:** Node.js / Express, `pg`, `express-session` with Postgres session store
- **Frontend:** React SPA (served via CDN + Babel standalone — no build step)
- **Database:** Postgres on Render

## Quick start (local)

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL + SESSION_SECRET
npm run migrate               # applies db/schema.sql
npm run seed                  # placeholder QB codes + demo users/data
npm start                     # http://localhost:3000
```

Demo credentials (from `db/seed.js`):

- **admin@activeacq.local / admin** (admin role)
- **pm@activeacq.local / password** (PM role, owns "Demo Acquisition")

## Deployment (Render)

1. Push this repo to GitHub.
2. Create a Render Postgres instance (or reuse the existing
   `activeacqdb` — the connection strings are documented in `.env.example`).
3. Create a **Web Service** from the repo with:
   - **Build:** `npm install`
   - **Start:** `node server.js`
   - **Env vars:** `DATABASE_URL` (internal URL), `SESSION_SECRET`, `NODE_ENV=production`

   Or apply `render.yaml` as an Infrastructure-as-Code blueprint.
4. From a shell with the **external** `DATABASE_URL`, run:
   ```bash
   npm run migrate
   npm run seed
   ```

## QB Chart of Accounts

**WAITING ON** the real QB chart of accounts from Seth/Calev. Placeholder codes
are seeded in `db/seed.js` (`PLACEHOLDER_QB_CODES`). When real codes arrive,
replace that constant and re-run `npm run seed`.

## Architecture

```
/
├── server.js              # Express bootstrap, session, static SPA
├── db/
│   ├── pool.js            # pg pool (auto-enables SSL for Render external URL)
│   ├── schema.sql         # idempotent schema
│   ├── migrate.js         # runner for schema.sql
│   └── seed.js            # placeholder QB codes + demo data
├── middleware/auth.js
├── routes/
│   ├── auth.js            # /api/auth
│   ├── users.js           # /api/users
│   ├── qbCodes.js         # /api/qb-codes (hierarchy)
│   ├── projects.js        # /api/projects + dashboard aggregation
│   ├── budget.js          # budget lines + change log
│   ├── contracts.js       # contracts + allocation lines
│   └── invoices.js        # invoice lifecycle + approval/push/paid
└── public/
    ├── index.html         # SPA shell (React via CDN)
    ├── styles.css
    └── js/
        ├── api.js         # fetch wrapper
        ├── util.js        # formatters
        ├── app.js         # root component
        └── components/    # Login, ProjectList, Project, Dashboard,
                           #   Budget, Contracts, Invoices
```

### Dashboard aggregation

`GET /api/projects/:id/dashboard` returns the full QB hierarchy annotated with:

- `budget_original`, `budget_current` (direct from `budget_lines`)
- `contracted` (sum of `contract_lines.amount` for that code)
- `approved`, `paid` — pro-rated across a contract's QB-code allocation
  proportional to each line's share of the contract total

Each node carries both its own direct values (`direct`) and rolled-up
sum-of-descendants-plus-self values (`rollup`). The UI renders rollups and
color-codes rows: **yellow** if contracted > current budget, **red** if
approved invoices > contracted.

## API routes (summary)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login` | email + password |
| POST | `/api/auth/logout` | |
| GET  | `/api/auth/me` | current user |
| GET  | `/api/users` | admin only |
| POST | `/api/users` | admin only |
| GET  | `/api/users/directory` | all users (lightweight) |
| GET  | `/api/qb-codes` | full hierarchy + flat |
| GET  | `/api/projects` | user's projects (all if admin) |
| POST | `/api/projects` | creator auto-added as PM |
| GET  | `/api/projects/:id` | project + members |
| PUT  | `/api/projects/:id` | |
| POST | `/api/projects/:id/members` | |
| GET  | `/api/projects/:id/dashboard` | aggregation |
| GET  | `/api/projects/:id/budget` | |
| POST | `/api/projects/:id/budget/initialize` | bulk upsert |
| PUT  | `/api/projects/:id/budget-lines/:lineId` | note required |
| GET  | `/api/projects/:id/budget-lines/:lineId/history` | |
| GET  | `/api/projects/:id/contracts` | |
| POST | `/api/projects/:id/contracts` | validates allocation sum |
| GET  | `/api/contracts/:id` | with lines + invoices + remaining |
| PUT  | `/api/contracts/:id` | |
| GET  | `/api/contracts/:id/invoices` | |
| GET  | `/api/projects/:id/invoices` | filterable |
| POST | `/api/invoices` | under a contract |
| GET  | `/api/invoices/:id` | |
| PUT  | `/api/invoices/:id` | |
| POST | `/api/invoices/:id/approve` | |
| POST | `/api/invoices/:id/reject` | |
| POST | `/api/invoices/:id/mark-pushed` | dry (will be replaced by QB) |
| POST | `/api/invoices/:id/mark-paid` | dry |

## Future phases

- QuickBooks API integration (push approved invoices as AP bills, pull payments)
- SharePoint API integration for PDF storage
- Claude API auto-extraction of invoice details from PDFs
- Approval workflows for budget amendments
- Richer role-based permissions (viewer, bookkeeper separation)
