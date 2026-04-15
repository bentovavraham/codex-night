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
   - **Env vars:**
     - `DATABASE_URL` (internal URL)
     - `SESSION_SECRET` (long random string)
     - `SEED_TOKEN` (long random string — used to trigger first-run seeding)
     - `NODE_ENV=production`

   Or apply `render.yaml` as an Infrastructure-as-Code blueprint.

4. **Migrations run automatically on every server startup** (schema.sql is
   idempotent), so as soon as the Web Service is deployed, tables exist.

5. **Seed the DB without a shell** by hitting the token-gated admin endpoints
   from your browser / `curl`. Replace `TOKEN` with the value of your
   `SEED_TOKEN` env var and `HOST` with your Render URL:

   ```bash
   # Check what's in the DB
   curl -H "x-seed-token: TOKEN" https://HOST/api/admin/status

   # Seed the placeholder QB codes (no-op if any codes already present)
   curl -X POST -H "x-seed-token: TOKEN" https://HOST/api/admin/seed-qb-codes

   # Create your first admin user
   curl -X POST -H "x-seed-token: TOKEN" -H "Content-Type: application/json" \
        -d '{"name":"You","email":"you@example.com","password":"pickSomething","role":"admin"}' \
        https://HOST/api/admin/create-user

   # (Later) reset a password
   curl -X POST -H "x-seed-token: TOKEN" -H "Content-Type: application/json" \
        -d '{"email":"you@example.com","new_password":"newOne"}' \
        https://HOST/api/admin/reset-password
   ```

   These endpoints only respond when `SEED_TOKEN` is set, and only to requests
   that present the matching token.

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
