const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const projects = require('./projects');
const storage = require('../lib/storage');
const { extractInvoice } = require('../lib/extract');

const router = express.Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// POST /api/invoices/extract
// multipart/form-data with a "file" field (PDF). Stores the PDF via the
// storage module, calls Claude Opus 4.6 to extract invoice fields, and
// returns both the file reference and the extracted fields.
router.post('/extract', requireAuth, pdfUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    if (!/pdf$/i.test(req.file.mimetype) && !/\.pdf$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Only PDFs are supported for extraction' });
    }

    // Save first — even if extraction fails, user still has the uploaded PDF.
    const saved = await storage.save(req.file.buffer, {
      filename: req.file.originalname || 'invoice.pdf',
      mimeType: req.file.mimetype || 'application/pdf',
    });

    let extracted = null;
    let extract_error = null;
    try {
      extracted = await extractInvoice(req.file.buffer);
    } catch (err) {
      console.error('Invoice extraction failed:', err.message);
      extract_error = err.message;
    }

    res.status(201).json({
      file_reference: saved.reference,
      download_url: `/api/files/${encodeURIComponent(saved.reference)}`,
      filename: saved.filename,
      size: saved.size,
      extracted,
      extract_error,
    });
  } catch (err) { next(err); }
});

async function getInvoiceWithProject(invoiceId) {
  const r = await pool.query(
    `SELECT i.*, c.project_id
     FROM invoices i JOIN contracts c ON c.id = i.contract_id
     WHERE i.id = $1`,
    [invoiceId]
  );
  return r.rows[0] || null;
}

// List invoices across a project with optional filters.
// /api/projects/:id/invoices?status=&contract_id=&vendor=
router.get('/projects/:id/invoices', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const filters = ['c.project_id = $1'];
    const params = [projectId];
    if (req.query.status) {
      params.push(req.query.status);
      filters.push(`i.status = $${params.length}`);
    }
    if (req.query.contract_id) {
      params.push(Number(req.query.contract_id));
      filters.push(`i.contract_id = $${params.length}`);
    }
    if (req.query.vendor) {
      params.push(`%${req.query.vendor}%`);
      filters.push(`i.vendor_name ILIKE $${params.length}`);
    }
    const result = await pool.query(
      `SELECT i.*, c.vendor_name AS contract_vendor
       FROM invoices i JOIN contracts c ON c.id = i.contract_id
       WHERE ${filters.join(' AND ')}
       ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create invoice under a contract.
router.post('/invoices', requireAuth, async (req, res, next) => {
  try {
    const {
      contract_id, invoice_number, vendor_name, amount, invoice_date,
      description, file_reference,
    } = req.body || {};
    if (!contract_id || !invoice_number || amount == null) {
      return res.status(400).json({ error: 'contract_id, invoice_number, amount required' });
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });

    const c = await pool.query('SELECT project_id, vendor_name FROM contracts WHERE id = $1', [contract_id]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Contract not found' });
    if (!(await projects.userCanAccess(req.session.userId, c.rows[0].project_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const result = await pool.query(
      `INSERT INTO invoices
         (contract_id, invoice_number, vendor_name, amount, invoice_date,
          description, file_reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [contract_id, invoice_number, vendor_name || c.rows[0].vendor_name, amt,
       invoice_date || null, description || null, file_reference || null, req.session.userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.get('/invoices/:id', requireAuth, async (req, res, next) => {
  try {
    const inv = await getInvoiceWithProject(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(inv);
  } catch (err) { next(err); }
});

router.put('/invoices/:id', requireAuth, async (req, res, next) => {
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { invoice_number, vendor_name, amount, invoice_date, description, status, file_reference } = req.body || {};
    const result = await pool.query(
      `UPDATE invoices SET
         invoice_number = COALESCE($2, invoice_number),
         vendor_name    = COALESCE($3, vendor_name),
         amount         = COALESCE($4, amount),
         invoice_date   = COALESCE($5, invoice_date),
         description    = COALESCE($6, description),
         status         = COALESCE($7, status),
         file_reference = COALESCE($8, file_reference),
         updated_at     = NOW()
       WHERE id = $1 RETURNING *`,
      [invId, invoice_number ?? null, vendor_name ?? null, amount ?? null,
       invoice_date ?? null, description ?? null, status ?? null, file_reference ?? null]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.post('/invoices/:id/approve', requireAuth, async (req, res, next) => {
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (inv.status !== 'pending') {
      return res.status(400).json({ error: `Cannot approve invoice in status '${inv.status}'` });
    }
    const result = await pool.query(
      `UPDATE invoices SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [invId, req.session.userId]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.post('/invoices/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await pool.query(
      `UPDATE invoices SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [invId]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.post('/invoices/:id/mark-pushed', requireAuth, async (req, res, next) => {
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (inv.status !== 'approved') {
      return res.status(400).json({ error: `Invoice must be approved before it can be pushed` });
    }
    // Dry version: set qb_reference_id to a placeholder string. Real QB integration
    // will replace this with the actual QB bill id.
    const result = await pool.query(
      `UPDATE invoices SET status = 'pushed',
         qb_reference_id = COALESCE(qb_reference_id, 'DRY-' || id::text),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [invId]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.post('/invoices/:id/mark-paid', requireAuth, async (req, res, next) => {
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!['approved', 'pushed'].includes(inv.status)) {
      return res.status(400).json({ error: `Invoice must be approved/pushed before it can be paid` });
    }
    const paidDate = req.body?.paid_date || null;
    const result = await pool.query(
      `UPDATE invoices SET status = 'paid',
         paid_date = COALESCE($2::date, CURRENT_DATE),
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [invId, paidDate]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
