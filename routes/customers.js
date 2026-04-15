const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/customers?q=<text>
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const params = [];
    let sql = 'SELECT id, qb_id, name FROM customers';
    if (q) {
      params.push(`%${q}%`);
      sql += ` WHERE name ILIKE $1`;
    }
    sql += ' ORDER BY name ASC LIMIT 25';
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
