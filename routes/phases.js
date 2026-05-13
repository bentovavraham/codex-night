const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');

const router = express.Router();

async function userCanAccessPhase(userId, phaseId) {
  const r = await pool.query('SELECT project_id FROM phases WHERE id = $1', [phaseId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id))) {
    return { ok: false, status: 403 };
  }
  return { ok: true, projectId: r.rows[0].project_id };
}

// GET /api/projects/:projectId/phases
router.get('/:projectId/phases', requireAuth, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    if (!(await projects.userCanAccess(req.session.userId, Number(projectId)))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await pool.query(
      `SELECT id, project_id, name, phase_number, status, start_date, end_date, notes, sort_order
       FROM phases
       WHERE project_id = $1
       ORDER BY sort_order, phase_number, id`,
      [projectId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/projects/:projectId/phases
router.post('/:projectId/phases', requireAuth, async (req, res, next) => {
  try {
    const { projectId } = req.params;
    if (!(await projects.userCanAccess(req.session.userId, Number(projectId)))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { name, phase_number, status = 'planning', start_date, end_date, notes } = req.body;

    const sortResult = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort FROM phases WHERE project_id = $1',
      [projectId]
    );
    const sort_order = sortResult.rows[0].next_sort;

    const result = await pool.query(
      `INSERT INTO phases (project_id, name, phase_number, status, start_date, end_date, notes, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [projectId, name, phase_number, status, start_date || null, end_date || null, notes, sort_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId
router.get('/phases/:phaseId', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const access = await userCanAccessPhase(req.session.userId, Number(phaseId));
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Phase not found' : 'Forbidden' });
    const result = await pool.query(
      `SELECT p.*, proj.name AS project_name, proj.project_type
       FROM phases p
       JOIN projects proj ON proj.id = p.project_id
       WHERE p.id = $1`,
      [phaseId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Phase not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// PATCH /api/phases/:phaseId
router.patch('/phases/:phaseId', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const access = await userCanAccessPhase(req.session.userId, Number(phaseId));
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Phase not found' : 'Forbidden' });
    const fields = ['name', 'phase_number', 'status', 'start_date', 'end_date', 'notes', 'sort_order'];
    const updates = [];
    const values = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(phaseId);
    const result = await pool.query(
      `UPDATE phases SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Phase not found' });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/phases/:phaseId
router.delete('/phases/:phaseId', requireAuth, async (req, res, next) => {
  try {
    const { phaseId } = req.params;
    const access = await userCanAccessPhase(req.session.userId, Number(phaseId));
    if (!access.ok) return res.status(access.status).json({ error: access.status === 404 ? 'Phase not found' : 'Forbidden' });
    await pool.query('DELETE FROM phases WHERE id = $1', [phaseId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
