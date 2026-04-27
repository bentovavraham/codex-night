const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const fileStorage = require('../lib/storage');
const { requireAuth } = require('../middleware/auth');
const { classifyDocument, extractContract, extractInvoice } = require('../lib/extract');

// Use memory storage — save to Postgres immediately so files survive restarts + Render deploys
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Budget line matching — simple keyword overlap
function matchBudgetLine(description, vendorName, budgetLines) {
  const text = ((description || '') + ' ' + (vendorName || '')).toLowerCase();
  const textWords = text.split(/\W+/).filter(w => w.length > 3);
  let best = null, bestScore = 0;
  for (const line of budgetLines) {
    const lineWords = (line.task_name || '').toLowerCase().split(/\W+/).filter(w => w.length > 3);
    if (!lineWords.length) continue;
    const matches = lineWords.filter(lw => textWords.some(tw => tw.includes(lw) || lw.includes(tw)));
    const score = matches.length / lineWords.length;
    if (score > bestScore) { bestScore = score; best = line; }
  }
  if (!best || bestScore < 0.2) return { lineId: null, confidence: 'low' };
  return { lineId: best.id, confidence: bestScore > 0.6 ? 'high' : 'medium' };
}

// POST /api/phases/:phaseId/import — upload multiple files
router.post('/phases/:phaseId/import', requireAuth, upload.array('files', 50), async (req, res, next) => {
  try {
    const phaseId = Number(req.params.phaseId);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    // Save each file to Postgres and create queue entries
    const queueItems = [];
    for (const file of files) {
      const saved = await fileStorage.save(file.buffer, {
        filename: file.originalname,
        mimeType: file.mimetype || 'application/pdf',
      });
      const r = await pool.query(
        `INSERT INTO import_queue (phase_id, original_filename, file_reference, status, created_by)
         VALUES ($1, $2, $3, 'queued', $4) RETURNING *`,
        [phaseId, file.originalname, saved.reference, req.session.userId]
      );
      queueItems.push({ ...r.rows[0], _buffer: file.buffer });
    }

    res.json({ items: queueItems });

    // Process in background — 2 concurrent workers with exponential backoff on rate limits
    const budgetLines = (await pool.query(
      'SELECT id, task_name, discipline FROM phase_budget_lines WHERE phase_id = $1',
      [phaseId]
    )).rows;

    const CONCURRENCY = 2;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    async function callWithRetry(fn, maxRetries = 5) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          const is429 = err.status === 429 || String(err.message).includes('429') || String(err.message).includes('rate limit');
          if (is429 && attempt < maxRetries) {
            const wait = Math.min(60000, 6000 * Math.pow(2, attempt));
            console.log(`Rate limit hit, waiting ${wait}ms before retry ${attempt + 1}/${maxRetries}`);
            await sleep(wait);
          } else {
            throw err;
          }
        }
      }
    }

    let i = 0;
    async function next_file() {
      if (i >= files.length) return;
      const idx = i++;
      const file = files[idx];
      const item = queueItems[idx];
      try {
        await pool.query(`UPDATE import_queue SET status='extracting', updated_at=NOW() WHERE id=$1`, [item.id]);
        const buf = item._buffer || (await fileStorage.read(item.file_reference)).buffer;
        const { type, confidence } = await callWithRetry(() => classifyDocument(buf));
        const extracted = await callWithRetry(() =>
          type === 'contract' ? extractContract(buf) : extractInvoice(buf)
        );
        const desc = type === 'contract' ? extracted.description : extracted.summary;
        const vendor = extracted.vendor_name;
        const { lineId, confidence: matchConf } = matchBudgetLine(desc, vendor, budgetLines);
        await pool.query(
          `UPDATE import_queue SET status='needs_review', doc_type=$1, doc_type_confidence=$2,
           extracted_data=$3, suggested_budget_line_id=$4, match_confidence=$5, updated_at=NOW()
           WHERE id=$6`,
          [type, confidence, JSON.stringify(extracted), lineId, matchConf, item.id]
        );
      } catch (err) {
        await pool.query(
          `UPDATE import_queue SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`,
          [err.message, item.id]
        );
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => {
      const run = async () => { await next_file(); if (i < files.length) await run(); };
      return run();
    });
    Promise.all(workers).catch(e => console.error('Import worker error:', e));

  } catch (err) { next(err); }
});

// POST /api/phases/:phaseId/import/clear-failed — discard all failed items
router.post('/phases/:phaseId/import/clear-failed', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query(
      `UPDATE import_queue SET status='discarded', updated_at=NOW()
       WHERE phase_id=$1 AND status='failed' RETURNING id`,
      [Number(req.params.phaseId)]
    );
    res.json({ cleared: r.rowCount });
  } catch (err) { next(err); }
});

// GET /api/import-queue/:id/duplicates — check existing contracts/invoices for likely duplicates
router.get('/import-queue/:id/duplicates', requireAuth, async (req, res, next) => {
  try {
    const item = (await pool.query('SELECT * FROM import_queue WHERE id=$1', [Number(req.params.id)])).rows[0];
    if (!item) return res.status(404).json({ error: 'Not found' });
    const ext = item.extracted_data || {};
    const vendor = ((ext.vendor_name || '')).toLowerCase().trim();
    const matches = [];

    if (item.doc_type === 'invoice') {
      const invNum = (ext.invoice_number || '').toLowerCase().trim();
      const amount = Number(ext.amount) || 0;
      const invDate = ext.invoice_date || null;

      // Exact: same vendor + invoice number
      if (vendor && invNum) {
        const r = await pool.query(
          `SELECT id, vendor_name, invoice_number, amount::numeric as amount, invoice_date, status
           FROM invoices WHERE LOWER(TRIM(vendor_name))=$1 AND LOWER(TRIM(invoice_number))=$2`,
          [vendor, invNum]
        );
        r.rows.forEach(row => matches.push({ ...row, match_type: 'exact', reason: 'Same vendor + invoice number' }));
      }

      // Fuzzy: same vendor + amount within 5% + date within 60 days
      if (vendor && amount > 0 && invDate) {
        const r = await pool.query(
          `SELECT id, vendor_name, invoice_number, amount::numeric as amount, invoice_date, status
           FROM invoices
           WHERE LOWER(TRIM(vendor_name))=$1
             AND ABS(amount::numeric - $2) / NULLIF($2, 0) < 0.05
             AND invoice_date IS NOT NULL
             AND ABS(EXTRACT(EPOCH FROM (invoice_date::date - $3::date))) < 86400*60`,
          [vendor, amount, invDate]
        );
        r.rows.forEach(row => { if (!matches.find(m => m.id === row.id)) matches.push({ ...row, match_type: 'fuzzy', reason: 'Same vendor, similar amount & date' }); });
      }

    } else if (item.doc_type === 'contract') {
      const refNum = (ext.reference_number || '').toLowerCase().trim();
      const amount = Number(ext.total_value) || 0;
      const cDate = ext.contract_date || null;

      // Exact: same vendor + reference number
      if (vendor && refNum) {
        const r = await pool.query(
          `SELECT id, vendor_name, reference_number, total_value::numeric as amount, contract_date, status
           FROM contracts WHERE LOWER(TRIM(vendor_name))=$1 AND LOWER(TRIM(reference_number))=$2`,
          [vendor, refNum]
        );
        r.rows.forEach(row => matches.push({ ...row, match_type: 'exact', reason: 'Same vendor + reference number' }));
      }

      // Fuzzy: same vendor + amount within 10% + date within 90 days
      if (vendor && amount > 0 && cDate) {
        const r = await pool.query(
          `SELECT id, vendor_name, reference_number, total_value::numeric as amount, contract_date, status
           FROM contracts
           WHERE LOWER(TRIM(vendor_name))=$1
             AND ABS(total_value::numeric - $2) / NULLIF($2, 0) < 0.10
             AND contract_date IS NOT NULL
             AND ABS(EXTRACT(EPOCH FROM (contract_date::date - $3::date))) < 86400*90`,
          [vendor, amount, cDate]
        );
        r.rows.forEach(row => { if (!matches.find(m => m.id === row.id)) matches.push({ ...row, match_type: 'fuzzy', reason: 'Same vendor, similar amount & date' }); });
      }
    }

    res.json({ matches });
  } catch (err) { next(err); }
});

// GET /api/phases/:phaseId/import-queue
router.get('/phases/:phaseId/import-queue', requireAuth, async (req, res, next) => {
  try {
    const phaseId = Number(req.params.phaseId);
    const r = await pool.query(
      `SELECT iq.*, pbl.task_name AS suggested_line_name
       FROM import_queue iq
       LEFT JOIN phase_budget_lines pbl ON pbl.id = iq.suggested_budget_line_id
       WHERE iq.phase_id = $1
       ORDER BY iq.created_at ASC`,
      [phaseId]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// PATCH /api/import-queue/:id — update type, budget line, extracted data
router.patch('/import-queue/:id', requireAuth, async (req, res, next) => {
  try {
    const { doc_type, suggested_budget_line_id, extracted_data } = req.body;
    const sets = []; const vals = [];
    if (doc_type !== undefined) { sets.push(`doc_type=$${sets.length+1}`); vals.push(doc_type); }
    if (suggested_budget_line_id !== undefined) { sets.push(`suggested_budget_line_id=$${sets.length+1}`); vals.push(suggested_budget_line_id || null); }
    if (extracted_data !== undefined) { sets.push(`extracted_data=$${sets.length+1}`); vals.push(JSON.stringify(extracted_data)); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push(`updated_at=NOW()`);
    vals.push(Number(req.params.id));
    const r = await pool.query(
      `UPDATE import_queue SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// POST /api/import-queue/:id/confirm — save real contract or invoice
router.post('/import-queue/:id/confirm', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const item = (await pool.query('SELECT * FROM import_queue WHERE id=$1', [Number(req.params.id)])).rows[0];
    if (!item) return res.status(404).json({ error: 'Not found' });
    const { formData } = req.body;
    const lineId = formData.phase_budget_line_id || item.suggested_budget_line_id || null;

    await client.query('BEGIN');
    let contractId = null, invoiceId = null;

    if (item.doc_type === 'contract') {
      const phaseRes = await client.query('SELECT project_id FROM phases WHERE id=$1', [item.phase_id]);
      const projectId = phaseRes.rows[0]?.project_id;
      const r = await client.query(
        `INSERT INTO contracts (project_id, phase_budget_line_id, vendor_name, description, total_value,
          contract_date, reference_number, status, file_reference, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [projectId, lineId, formData.vendor_name, formData.description, Number(formData.total_value)||0,
         formData.contract_date||null, formData.reference_number||null,
         formData.status||'active', item.file_reference, req.session.userId]
      );
      contractId = r.rows[0].id;

      // Insert line items if present
      const lineItems = formData.line_items || [];
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx];
        await client.query(
          `INSERT INTO contract_line_items (contract_id, sort_order, billing_type, description, budgeted_amount)
           VALUES ($1,$2,$3,$4,$5)`,
          [contractId, idx, li.billing_type||'fixed', li.description||'', Number(li.budgeted_amount)||0]
        );
      }
    } else {
      const phaseRes = await client.query('SELECT project_id FROM phases WHERE id=$1', [item.phase_id]);
      const projectId = phaseRes.rows[0]?.project_id;
      const r = await client.query(
        `INSERT INTO invoices (project_id, phase_budget_line_id, vendor_name, invoice_number, amount,
          invoice_date, description, status, file_reference, invoice_type, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [projectId, lineId, formData.vendor_name, formData.invoice_number||'',
         Number(formData.amount)||0, formData.invoice_date||null, formData.description||null,
         formData.status||'pending', item.file_reference, formData.invoice_type||'fixed',
         req.session.userId]
      );
      invoiceId = r.rows[0].id;
    }

    await client.query(
      `UPDATE import_queue SET status='confirmed', confirmed_contract_id=$1, confirmed_invoice_id=$2, updated_at=NOW() WHERE id=$3`,
      [contractId, invoiceId, item.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, contract_id: contractId, invoice_id: invoiceId });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// POST /api/import-queue/:id/retry — re-queue a failed item
router.post('/import-queue/:id/retry', requireAuth, async (req, res, next) => {
  try {
    const item = (await pool.query('SELECT * FROM import_queue WHERE id=$1', [Number(req.params.id)])).rows[0];
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (item.status !== 'failed') return res.status(400).json({ error: 'Only failed items can be retried' });

    await pool.query(`UPDATE import_queue SET status='queued', error_message=NULL, updated_at=NOW() WHERE id=$1`, [item.id]);
    res.json({ ok: true });

    const budgetLines = (await pool.query(
      'SELECT id, task_name, discipline FROM phase_budget_lines WHERE phase_id = $1',
      [item.phase_id]
    )).rows;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function callWithRetry(fn, maxRetries = 5) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try { return await fn(); } catch (err) {
          const is429 = err.status === 429 || String(err.message).includes('429') || String(err.message).includes('rate limit');
          if (is429 && attempt < maxRetries) { await sleep(Math.min(60000, 6000 * Math.pow(2, attempt))); }
          else { throw err; }
        }
      }
    }

    (async () => {
      try {
        await pool.query(`UPDATE import_queue SET status='extracting', updated_at=NOW() WHERE id=$1`, [item.id]);
        const buf = (await fileStorage.read(item.file_reference)).buffer;
        const { type, confidence } = await callWithRetry(() => classifyDocument(buf));
        const extracted = await callWithRetry(() =>
          type === 'contract' ? extractContract(buf) : extractInvoice(buf)
        );
        const desc = type === 'contract' ? extracted.description : extracted.summary;
        const { lineId, confidence: matchConf } = matchBudgetLine(desc, extracted.vendor_name, budgetLines);
        await pool.query(
          `UPDATE import_queue SET status='needs_review', doc_type=$1, doc_type_confidence=$2,
           extracted_data=$3, suggested_budget_line_id=$4, match_confidence=$5, updated_at=NOW() WHERE id=$6`,
          [type, confidence, JSON.stringify(extracted), lineId, matchConf, item.id]
        );
      } catch (err) {
        await pool.query(`UPDATE import_queue SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`, [err.message, item.id]);
      }
    })();
  } catch (err) { next(err); }
});

// DELETE /api/import-queue/:id
router.delete('/import-queue/:id', requireAuth, async (req, res, next) => {
  try {
    await pool.query(`UPDATE import_queue SET status='discarded', updated_at=NOW() WHERE id=$1`, [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
