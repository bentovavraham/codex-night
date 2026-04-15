const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Return full hierarchy. Each node has `children: []`.
router.get('/', requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, code, name, parent_id, level FROM qb_codes ORDER BY code ASC'
    );
    const rows = result.rows;
    const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
    const roots = [];
    for (const row of rows) {
      const node = byId.get(row.id);
      if (row.parent_id == null) roots.push(node);
      else byId.get(row.parent_id)?.children.push(node);
    }
    res.json({ roots, flat: rows });
  } catch (err) { next(err); }
});

module.exports = router;
