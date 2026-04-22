const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth, hasMinRole } = require('../middleware/auth');
const projects = require('./projects');
const storage = require('../lib/storage');
const { extractExpense } = require('../lib/extract');

const router = express.Router();
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_CATEGORIES = ['travel', 'tolls', 'food', 'hotel', 'copies', 'other'];

async function userCanAccessContract(userId, contractId) {
  const r = await pool.query('SELECT project_id FROM contracts WHERE id = $1', [contractId]);
  if (!r.rows[0]) return { ok: false, status: 404 };
  if (!(await projects.userCanAccess(userId, r.rows[0].project_id)))
    return { ok: false, status: 403 };
  return { ok: true, projectId: r.rows[0].project_id };
}

async function userCanAccessExpense(userId, expenseId) {
  const r = await pool.query(
    'SELECT e.id, e.contract_id, c.project_id FROM contract_expenses e JOIN contracts c ON c.id = e.contract_id WHERE e.id = $1',
    [expenseId]);
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
       WHERE LOWER(vendor_name) = LOWER($1) AND document_type = 'expense'
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
     VALUES ($1, 'expense', $2, $3)`,
    [vendorName, JSON.stringify(fields), userId]
  );
}

// POST /api/expenses/extract
router.post('/expenses/extract', requireAuth, pdfUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await storage.save(req.file.buffer, {
      filename: req.file.originalname || 'receipt.pdf',
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
      const pass1 = await extractExpense(req.file.buffer);
      const ctx = await getVendorContext(vendorName);
      if (ctx.examples.length > 0 || ctx.vendorNotes) {
        extracted = await extractExpense(req.file.buffer, ctx);
      } else {
        extracted = pass1;
      }
    }
    catch (err) { console.error('Expense extraction failed:', err.message); extract_error = err.message; }
    res.status(201).json({
      file_reference: saved.reference,
      download_url: `/api/files/${encodeURIComponent(saved.reference)}`,
      filename: saved.filename, size: saved.size, extracted, extract_error,
    });
  } catch (err) { next(err); }
});

// GET /api/contracts/:id/expenses
router.get('/contracts/:id/expenses', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT e.*, u.name AS created_by_name, q.code AS qb_code, q.name AS qb_name
       FROM contract_expenses e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN qb_codes q ON q.id = e.qb_code_id
       WHERE e.contract_id = $1 ORDER BY e.expense_date DESC NULLS LAST, e.created_at DESC`,
      [contractId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/contracts/:id/expenses
router.post('/contracts/:id/expenses', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const contractId = Number(req.params.id);
    const access = await userCanAccessContract(req.session.userId, contractId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { category, description, amount, expense_date, qb_code_id, file_reference, notes } = req.body || {};
    if (amount == null) return res.status(400).json({ error: 'amount required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return res.status(400).json({ error: 'invalid amount' });
    const cat = VALID_CATEGORIES.includes(category) ? category : 'other';
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO contract_expenses (contract_id, category, description, amount, expense_date, qb_code_id, file_reference, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [contractId, cat, description || null, amt,
       expense_date || null, qb_code_id || null, file_reference || null, notes || null, req.session.userId]);
    const desc = description ? `${description} (${cat})` : cat;
    await logContract(client, contractId, 'expense_added',
      `Expense added: ${desc} — $${amt.toFixed(2)}`, req.session.userId);
    // Save to knowledge base when a PDF was attached (PM confirmed fields).
    if (file_reference) {
      const cv = await pool.query('SELECT vendor_name FROM contracts WHERE id = $1', [contractId]);
      const vendorName = cv.rows[0]?.vendor_name || null;
      if (vendorName) {
        await saveExtractionExample(client, vendorName, {
          category: cat, description: description || null,
          amount: amt, expense_date: expense_date || null,
        }, req.session.userId);
      }
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// PUT /api/expenses/:id
router.put('/expenses/:id', requireAuth, async (req, res, next) => {
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { category, description, amount, expense_date, qb_code_id, file_reference } = req.body || {};
    const cat = category ? (VALID_CATEGORIES.includes(category) ? category : 'other') : null;
    const result = await pool.query(
      `UPDATE contract_expenses SET
         category      = COALESCE($2, category),
         description   = COALESCE($3, description),
         amount        = COALESCE($4, amount),
         expense_date  = COALESCE($5, expense_date),
         qb_code_id    = COALESCE($6, qb_code_id),
         file_reference= COALESCE($7, file_reference)
       WHERE id = $1 RETURNING *`,
      [expenseId, cat, description ?? null, amount ?? null,
       expense_date ?? null, qb_code_id ?? null, file_reference ?? null]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/expenses/:id/pm-approve
router.post('/expenses/:id/pm-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contract_expenses SET status = 'pm_approved', pm_approved_by = $2, pm_approved_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`, [expenseId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Expense must be pending for PM approval' });
    const exp = result.rows[0];
    await logContract(client, exp.contract_id, 'expense_pm_approved',
      `PM approved expense: ${exp.description || exp.category} — $${Number(exp.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(exp);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/expenses/:id/partner-approve
router.post('/expenses/:id/partner-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'partner')) return res.status(403).json({ error: 'Requires partner role or above' });
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contract_expenses SET status = 'partner_approved', partner_approved_by = $2, partner_approved_at = NOW()
       WHERE id = $1 AND status = 'pm_approved' RETURNING *`, [expenseId, req.session.userId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Expense must be PM-approved first' });
    const exp = result.rows[0];
    await logContract(client, exp.contract_id, 'expense_partner_approved',
      `Partner approved expense: ${exp.description || exp.category} — $${Number(exp.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(exp);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/expenses/:id/approve  (admin only — final)
router.post('/expenses/:id/approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'admin')) return res.status(403).json({ error: 'Requires admin role' });
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contract_expenses SET status = 'approved' WHERE id = $1 AND status = 'partner_approved' RETURNING *`,
      [expenseId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Expense must be partner-approved first' });
    const exp = result.rows[0];
    await logContract(client, exp.contract_id, 'expense_approved',
      `Final approval expense: ${exp.description || exp.category} — $${Number(exp.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(exp);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/expenses/:id/reject
router.post('/expenses/:id/reject', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    const { rejection_note } = req.body;
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE contract_expenses SET status = 'rejected', rejection_note = $2
       WHERE id = $1 AND status NOT IN ('approved','rejected') RETURNING *`,
      [expenseId, rejection_note || null]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Expense cannot be rejected in its current state' });
    const exp = result.rows[0];
    await logContract(client, exp.contract_id, 'expense_rejected',
      `Expense rejected: ${exp.description || exp.category}${rejection_note ? ' — ' + rejection_note : ''}`, req.session.userId);
    await client.query('COMMIT');
    res.json(exp);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// DELETE /api/expenses/:id (pending only)
router.delete('/expenses/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const expenseId = Number(req.params.id);
    const access = await userCanAccessExpense(req.session.userId, expenseId);
    if (!access.ok) return res.status(access.status).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const exp = await client.query('SELECT * FROM contract_expenses WHERE id = $1', [expenseId]);
    const result = await client.query(
      `DELETE FROM contract_expenses WHERE id = $1 AND status = 'pending' RETURNING id`, [expenseId]);
    if (!result.rows[0]) return res.status(400).json({ error: 'Can only delete pending expenses' });
    if (exp.rows[0]) {
      await logContract(client, exp.rows[0].contract_id, 'expense_deleted',
        `Expense deleted: ${exp.rows[0].description || exp.rows[0].category} — $${Number(exp.rows[0].amount).toFixed(2)}`, req.session.userId);
    }
    await client.query('COMMIT');
    res.json({ deleted: true });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

module.exports = router;
