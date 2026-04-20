// Active Acquisitions Project Financial Manager — main server.

try { require('dotenv').config(); } catch (_) { /* optional */ }

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const pool = require('./db/pool');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const qbCodeRoutes = require('./routes/qbCodes');
const projectRoutes = require('./routes/projects');
const budgetRoutes = require('./routes/budget');
const contractRoutes = require('./routes/contracts');
const invoiceRoutes = require('./routes/invoices');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/uploads');
const vendorRoutes = require('./routes/vendors');
const customerRoutes = require('./routes/customers');
const changeOrderRoutes = require('./routes/changeOrders');
const tmChargeRoutes = require('./routes/tmCharges');
const contractExpenseRoutes = require('./routes/contractExpenses');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render terminates TLS at the proxy.

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  name: 'activeacq.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
}));

// --- Health ---
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- API routes ---
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/qb-codes', qbCodeRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', budgetRoutes);        // nested under /projects/:id/budget
app.use('/api', contractRoutes);                // /projects/:id/contracts and /contracts/:id
app.use('/api', invoiceRoutes);                 // /projects/:id/invoices and /invoices/:id
app.use('/api/admin', adminRoutes);
app.use('/api/files', uploadRoutes);            // POST uploads, GET :reference downloads
app.use('/api/vendors', vendorRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api', changeOrderRoutes);
app.use('/api', tmChargeRoutes);
app.use('/api', contractExpenseRoutes);

// --- Static SPA ---
app.use(express.static(path.join(__dirname, 'public')));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Error handler ---
app.use((err, req, res, _next) => {
  console.error('Unhandled error on', req.method, req.path, err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// Auto-apply schema.sql on startup. Schema is idempotent (CREATE TABLE IF
// NOT EXISTS), so this is safe on every boot. Skippable via SKIP_MIGRATIONS=1.
async function applyMigrationsOnStartup() {
  if (process.env.SKIP_MIGRATIONS === '1') {
    console.log('SKIP_MIGRATIONS=1 — skipping migrations.');
    return;
  }
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Schema migrations applied.');
  } catch (err) {
    console.error('Startup migration failed:', err);
    // Don't crash the server — health check will surface the DB issue.
  }
}

const port = Number(process.env.PORT) || 3000;
applyMigrationsOnStartup().finally(() => {
  app.listen(port, () => {
    console.log(`ActiveAcq server listening on :${port} (${isProd ? 'prod' : 'dev'})`);
  });
});
