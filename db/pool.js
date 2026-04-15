const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  // Load .env for local development.
  try { require('dotenv').config(); } catch (_) { /* dotenv optional in prod */ }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Configure it in the environment or .env.');
  process.exit(1);
}

// Render's internal hostnames don't need SSL; external hostnames do.
// Heuristic: require SSL if the URL contains a public domain suffix.
const url = process.env.DATABASE_URL;
const needsSsl = /\.render\.com|\.rds\.amazonaws\.com/i.test(url);

const pool = new Pool({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err);
});

module.exports = pool;
