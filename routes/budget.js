const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');

const router = express.Router();

// GET /api/projects/:id/budget — all budget lines joined with qb_codes
router.get('/:id/budget', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await pool.query(
      `SELECT bl.id, bl.project_id, bl.qb_code_id, bl.original_amount, bl.current_amount,
              bl.created_at, bl.updated_at,
              q.code, q.name, q.parent_id, q.level
       FROM budget_lines bl
       JOIN qb_codes q ON q.id = bl.qb_code_id
       WHERE bl.project_id = $1
       ORDER BY q.code ASC`,
      [projectId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/budget/initialize
// Body: { lines: [{ qb_code_id, amount }, ...] }
// Creates (or upserts) budget_lines, setting original_amount on creation
// and current_amount on each call. Existing original amounts are preserved.
router.post('/:id/budget/initialize', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (lines.length === 0) return res.status(400).json({ error: 'lines array required' });

    await client.query('BEGIN');
    for (const line of lines) {
      const codeId = Number(line.qb_code_id);
      const amount = Number(line.amount);
      if (!codeId || !Number.isFinite(amount)) continue;
      await client.query(
        `INSERT INTO budget_lines (project_id, qb_code_id, original_amount, current_amount)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (project_id, qb_code_id)
         DO UPDATE SET current_amount = EXCLUDED.current_amount, updated_at = NOW()`,
        [projectId, codeId, amount]
      );
    }
    await client.query('COMMIT');

    const result = await pool.query(
      `SELECT bl.*, q.code, q.name, q.parent_id, q.level
       FROM budget_lines bl JOIN qb_codes q ON q.id = bl.qb_code_id
       WHERE bl.project_id = $1 ORDER BY q.code ASC`,
      [projectId]
    );
    res.status(201).json(result.rows);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/projects/:id/budget-lines/:lineId
// Body: { current_amount, note } — note required; writes budget_line_logs.
router.put('/:id/budget-lines/:lineId', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const projectId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { current_amount, note } = req.body || {};
    if (current_amount == null) return res.status(400).json({ error: 'current_amount required' });
    if (!note || !String(note).trim()) return res.status(400).json({ error: 'note required on budget edits' });
    const newAmount = Number(current_amount);
    if (!Number.isFinite(newAmount)) return res.status(400).json({ error: 'invalid amount' });

    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT * FROM budget_lines WHERE id = $1 AND project_id = $2 FOR UPDATE`,
      [lineId, projectId]
    );
    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Budget line not found' });
    }
    const oldAmount = Number(existing.rows[0].current_amount);

    const updated = await client.query(
      `UPDATE budget_lines SET current_amount = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [newAmount, lineId]
    );
    await client.query(
      `INSERT INTO budget_line_logs (budget_line_id, old_amount, new_amount, changed_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [lineId, oldAmount, newAmount, req.session.userId, note]
    );
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// GET /api/projects/:id/budget-lines/:lineId/history
router.get('/:id/budget-lines/:lineId/history', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const lineId = Number(req.params.lineId);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await pool.query(
      `SELECT l.*, u.name AS changed_by_name, u.email AS changed_by_email
       FROM budget_line_logs l
       JOIN users u ON u.id = l.changed_by
       WHERE l.budget_line_id = $1
       ORDER BY l.changed_at DESC`,
      [lineId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
