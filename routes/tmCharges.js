const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth, hasMinRole } = require('../middleware/auth');
const projects = require('./projects');
const storage = require('../lib/storage');
const { extractTMCharge } = require('../lib/extract');

const router = express.Router();
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function userCanAccessContract(userId, contractId) {
  const r = await pool.query('SELECT project_id FROM contracts WHERE id = $1', [contractId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, projectId: r.rows[0].project_id };
}

async function userCanAccessTM(userId, tmId) {
  const r = await pool.query(
    'SELECT t.id, t.contract_id, c.project_id FROM tm_charges t JOIN contracts c ON c.id = t.contract_id WHERE t.id = $1',
    [tmId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, row: r.rows[0] };
}

function logContract(client, contractId, action, detail, userId) {
  return client.query(
    'INSERT INTO contract_logs (contract_id, action, detail, changed_by) VALUES ($1,$2,$3,$4)',
    [contractId, action, detail, userId]);
}

// Vendor knowledge helpers --------------------------------------------------

async function getVendorContext(vendorName, limit = 5) {
  if (!vendorName) return { examples: [], vendorNotes: null };
  const [examplesResult, profileResult] = await Promise.all([
    pool.query(
      `SELECT fields_json FROM extraction_examples
       WHERE LOWER(vendor_name) = LOWER($1) AND document_type = 'tm_charge'
       ORDER BY created_at DESC LIMIT $2`,
      [vendorName, limit]
    ),
    pool.query(
      `SELECT notes FROM vendor_profiles WHERE LOWER(vendor_name) = LOWER($1)`,
      [vendorName]
    ),
  ]);
  return {
    examples: examplesResult.rows,
    vendorNotes: profileResult.rows[0]?.notes || null,
  };
}

async function saveExtractionExample(client, vendorName, fields, userId) {
  if (!vendorName) return;
  await client.query(
    `INSERT INTO extraction_examples (vendor_name, document_type, fields_json, confirmed_by)
     VALUES ($1, 'tm_charge', $2, $3)`,
    [vendorName, JSON.stringify(fields), userId]
  );
}

// POST /api/tm-charges/extract
router.post('/tm-charges/extract', requireAuth, pdfUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await storage.save(req.file.buffer, {
      filename: req.file.originalname || 'tm.pdf',
      mimeType: req.file.mimetype || 'application/pdf',
    });
    let extracted = null, extract_error = null;
    try {
      // Look up contract vendor for context if contract_id provided.
      let vendorName = null;
      const contractId = req.body?.contract_id ? Number(req.body.contract_id) : null;
      if (contractId) {
        const c = await pool.query('SELECT vendor_name FROM contracts WHERE id = $1', [contractId]);
        vendorName = c.rows[0]?.vendor_name || null;
      }
      const pass1 = await extractTMCharge(req.file.buffer);
      const ctx = await getVendorContext(vendorName || pass1.description?.split(' ')[0]);
      if (ctx.examples.length > 0 || ctx.vendorNotes) {
        extracted = await extractTMCharge(req.file.buffer, ctx);
      } else {
        extracted = pass1;
      }
    }
    catch (err) { console.error('T&M extraction failed:', err.message); extract_error = err.message; }
    res.status(201).json({
      file_reference: saved.reference,
      download_url: `/api/files/${encodeURIComponent(saved.reference)}`,
      filename: saved.filename, size: saved.size, extracted, extract_error,
    });
  } catch (err) { next(err); }
});

// GET /api/contracts/:id/tm-charges
router.get('/contracts/:id/tm-charges', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT t.*, u.name AS created_by_name, q.code AS qb_code, q.name AS qb_name
       FROM tm_charges t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN qb_codes q ON q.id = t.qb_code_id
       WHERE t.contract_id = $1 ORDER BY t.charge_date DESC NULLS LAST, t.created_at DESC`,
      [contractId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/contracts/:id/tm-charges
router.post('/contracts/:id/tm-charges', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { description, hours, rate, amount, charge_date, qb_code_id, file_reference, notes } = req.body || {};
    if (!description || amount == null) return res.status(400).json({ error: 'description and amount required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return res.status(400).json({ error: 'invalid amount' });
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO tm_charges (contract_id, description, hours, rate, amount, charge_date, qb_code_id, file_reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [contractId, description, hours ?? null, rate ?? null, amt,
       charge_date || null, qb_code_id || null, file_reference || null, notes || null, req.session.userId]);
    const hoursStr = hours ? ` (${hours}h @ $${Number(rate||0).toFixed(2)}/h)` : '';
    await logContract(client, contractId, 'tm_added',
      `T&M added: ${description}${hoursStr} — $${amt.toFixed(2)}`, req.session.userId);
    // Save to knowledge base when a PDF was attached (PM confirmed fields).
    if (file_reference) {
      const cv = await pool.query('SELECT vendor_name FROM contracts WHERE id = $1', [contractId]);
      const vendorName = cv.rows[0]?.vendor_name || null;
      if (vendorName) {
        await saveExtractionExample(client, vendorName, {
          description, hours: hours ?? null, rate: rate ?? null,
          amount: amt, charge_date: charge_date || null,
        }, req.session.userId);
      }
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// PUT /api/tm-charges/:id
router.put('/tm-charges/:id', requireAuth, async (req, res, next) => {
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { description, hours, rate, amount, charge_date, qb_code_id, file_reference } = req.body || {};
    const result = await pool.query(
      `UPDATE tm_charges SET
         description   = COALESCE($2, description),
         hours         = COALESCE($3, hours),
         rate          = COALESCE($4, rate),
         amount        = COALESCE($5, amount),
         charge_date   = COALESCE($6, charge_date),
         qb_code_id    = COALESCE($7, qb_code_id),
         file_reference= COALESCE($8, file_reference)
       WHERE id = $1 RETURNING *`,
      [tmId, description ?? null, hours ?? null, rate ?? null, amount ?? null,
       charge_date ?? null, qb_code_id ?? null, file_reference ?? null]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/tm-charges/:id/pm-approve
router.post('/tm-charges/:id/pm-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE tm_charges SET status = 'pm_approved', pm_approved_by = $2, pm_approved_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`, [tmId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'T&M charge must be pending for PM approval' });
    const tm = result.rows[0];
    await logContract(client, tm.contract_id, 'tm_pm_approved',
      `PM approved T&M: ${tm.description} — $${Number(tm.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(tm);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/tm-charges/:id/partner-approve
router.post('/tm-charges/:id/partner-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'partner')) return res.status(403).json({ error: 'Requires partner role or above' });
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE tm_charges SET status = 'partner_approved', partner_approved_by = $2, partner_approved_at = NOW()
       WHERE id = $1 AND status = 'pm_approved' RETURNING *`, [tmId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'T&M charge must be PM-approved first' });
    const tm = result.rows[0];
    await logContract(client, tm.contract_id, 'tm_partner_approved',
      `Partner approved T&M: ${tm.description} — $${Number(tm.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(tm);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/tm-charges/:id/approve  (admin only — final)
router.post('/tm-charges/:id/approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'admin')) return res.status(403).json({ error: 'Requires admin role' });
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE tm_charges SET status = 'approved' WHERE id = $1 AND status = 'partner_approved' RETURNING *`,
      [tmId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'T&M charge must be partner-approved first' });
    const tm = result.rows[0];
    await logContract(client, tm.contract_id, 'tm_approved',
      `Final approval T&M: ${tm.description} — $${Number(tm.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(tm);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/tm-charges/:id/reject
router.post('/tm-charges/:id/reject', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { rejection_note } = req.body;
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE tm_charges SET status = 'rejected', rejection_note = $2
       WHERE id = $1 AND status NOT IN ('approved','rejected') RETURNING *`,
      [tmId, rejection_note || null]);
    if (!result.rows[0]) return res.status(400).json({ error: 'T&M charge cannot be rejected in its current state' });
    const tm = result.rows[0];
    await logContract(client, tm.contract_id, 'tm_rejected',
      `T&M rejected: ${tm.description}${rejection_note ? ' — ' + rejection_note : ''}`, req.session.userId);
    await client.query('COMMIT');
    res.json(tm);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// DELETE /api/tm-charges/:id (pending only)
router.delete('/tm-charges/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const tmId = Number(req.params.id);
    const access = await userCanAccessTM(req.session.userId, tmId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const tm = await client.query('SELECT * FROM tm_charges WHERE id = $1', [tmId]);
    const result = await client.query(
      `DELETE FROM tm_charges WHERE id = $1 AND status = 'pending' RETURNING id`, [tmId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Can only delete pending T&M charges' });
    if (tm.rows[0]) {
      await logContract(client, tm.rows[0].contract_id, 'tm_deleted',
        `T&M deleted: ${tm.rows[0].description} — $${Number(tm.rows[0].amount).toFixed(2)}`, req.session.userId);
    }
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

module.exports = router;
