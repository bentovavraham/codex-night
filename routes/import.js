const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db/pool');
const fileStorage = require('../lib/storage');
const { requireAuth } = require('../middleware/auth');
const { classifyDocument, extractContract, extractInvoice, suggestLineBudgets, suggestInvoiceLineCodes, matchQbTransaction, matchProject } = require('../lib/extract');

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

// Contract matching — normalize vendor name and find best contract match
function normalizeVendor(name) {
  return (name || '').toLowerCase()
    .replace(/\b(llc|inc|corp|ltd|co\b|company|associates|engineering|land|consulting)\b/g, '')
    .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchInvoiceToContract(extracted, contracts) {
  if (!contracts.length) return null;
  const invVendor = normalizeVendor(extracted.vendor_name);
  if (!invVendor) return null;

  // Build a searchable text blob from all extracted invoice data
  const invText = JSON.stringify(extracted).toLowerCase();

  const vendorMatches = contracts.filter(c => {
    const cv = normalizeVendor(c.vendor_name);
    return cv === invVendor || cv.startsWith(invVendor) || invVendor.startsWith(cv) ||
           (invVendor.length > 5 && cv.includes(invVendor)) ||
           (cv.length > 5 && invVendor.includes(cv));
  });

  if (vendorMatches.length === 0) return null;

  // Among vendor matches, try to pin to a specific contract by reference number
  for (const c of vendorMatches) {
    if (c.reference_number && invText.includes(c.reference_number.toLowerCase())) {
      return { contract_id: c.id, confidence: 'high', reason: 'Vendor + contract reference number found in invoice' };
    }
  }

  // Single vendor match — high confidence
  if (vendorMatches.length === 1) {
    return { contract_id: vendorMatches[0].id, confidence: 'high', reason: 'Vendor name match' };
  }

  // Multiple vendor matches, pick largest contract (most likely the primary engagement)
  const sorted = [...vendorMatches].sort((a, b) => Number(b.total_value) - Number(a.total_value));
  return { contract_id: sorted[0].id, confidence: 'medium', reason: 'Vendor match — multiple contracts, picked largest' };
}

// POST /api/phases/:phaseId/import — upload multiple files
router.post('/phases/:phaseId/import', requireAuth, upload.array('files', 50), async (req, res, next) => {
  try {
    const phaseId = Number(req.params.phaseId);
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    const sourceBatch = req.body.source_batch || null;

    // Save each file to Postgres and create queue entries
    const queueItems = [];
    for (const file of files) {
      const saved = await fileStorage.save(file.buffer, {
        filename: file.originalname,
        mimeType: file.mimetype || 'application/pdf',
      });
      const r = await pool.query(
        `INSERT INTO import_queue (phase_id, original_filename, file_reference, status, source_batch, created_by)
         VALUES ($1, $2, $3, 'queued', $4, $5) RETURNING *`,
        [phaseId, file.originalname, saved.reference, sourceBatch, req.session.userId]
      );
      queueItems.push({ ...r.rows[0], _buffer: file.buffer });
    }

    res.json({ items: queueItems });

    // Process in background — 2 concurrent workers with exponential backoff on rate limits
    const budgetLines = (await pool.query(
      'SELECT id, task_name, discipline FROM phase_budget_lines WHERE phase_id = $1',
      [phaseId]
    )).rows;

    const qbAccounts = (await pool.query('SELECT id, account_number, full_name, short_name FROM qb_accounts ORDER BY account_number')).rows;

    // QB transactions for this phase (for matching)
    const qbTransactions = (await pool.query(
      'SELECT id, vendor_name, ref_number, amount, txn_date, qb_gl_code FROM qb_transactions WHERE phase_id=$1',
      [phaseId]
    )).rows;

    // Project info for project matching
    const phaseProjectRes = await pool.query(
      'SELECT pr.id, pr.name, pr.keywords FROM projects pr JOIN phases ph ON ph.project_id=pr.id WHERE ph.id=$1',
      [phaseId]
    );
    const phaseProject = phaseProjectRes.rows[0] || null;
    const allProjects = (await pool.query('SELECT id, name, keywords FROM projects')).rows;
    const vendorJobMap = (await pool.query('SELECT vendor_name, vendor_job_number, project_id FROM vendor_project_map')).rows;

    const phaseContracts = (await pool.query(`
      SELECT DISTINCT c.id, c.vendor_name, c.reference_number, c.total_value, c.status
      FROM contracts c
      WHERE c.phase_budget_line_id IN (
        SELECT id FROM phase_budget_lines WHERE phase_id = $1
      ) AND c.status NOT IN ('voided')
      UNION
      SELECT DISTINCT c.id, c.vendor_name, c.reference_number, c.total_value, c.status
      FROM contracts c
      JOIN contract_line_items cli ON cli.contract_id = c.id
      WHERE cli.phase_budget_line_id IN (
        SELECT id FROM phase_budget_lines WHERE phase_id = $1
      ) AND c.status NOT IN ('voided')
    `, [phaseId])).rows;

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
        if (type === 'contract') {
          // ── Contract: AI budget line suggestions per task ──
          if (extracted.line_items?.length && budgetLines.length) {
            try {
              const blSuggestions = await callWithRetry(() => suggestLineBudgets(
                extracted.line_items, budgetLines,
                { vendor_name: extracted.vendor_name, description: extracted.description }
              ));
              if (blSuggestions) {
                extracted.suggested_primary_budget_line_id = blSuggestions.primary_budget_line_id;
                const byIndex = {};
                for (const s of blSuggestions.lines) byIndex[s.line_index] = s;
                extracted.line_items = extracted.line_items.map((li, i) => ({
                  ...li,
                  suggested_budget_line_id: byIndex[i]?.budget_line_id ?? null,
                  differs_from_primary:     byIndex[i]?.differs_from_primary ?? false,
                  budget_line_confidence:   byIndex[i]?.confidence ?? null,
                  budget_line_reason:       byIndex[i]?.reason ?? null,
                }));
              }
            } catch (blErr) {
              console.warn('suggestLineBudgets (contract) failed:', blErr.message);
            }
          }
        } else {
          // ── Invoice: contract match + QB codes + budget line ──

          // 1. Auto-match to existing contract
          const contractMatch = matchInvoiceToContract(extracted, phaseContracts);
          if (contractMatch) {
            extracted.suggested_contract_id = contractMatch.contract_id;
            extracted.contract_match_confidence = contractMatch.confidence;
            extracted.contract_match_reason = contractMatch.reason;
          }

          // 2. QB account suggestions per line item (budget tasks are primary signal)
          if (extracted.line_items?.length && qbAccounts.length) {
            try {
              const codeSuggestions = await callWithRetry(() =>
                suggestInvoiceLineCodes(buf, extracted.line_items, qbAccounts, extracted.vendor_name, budgetLines)
              );
              const byIndex = {};
              for (const s of codeSuggestions) byIndex[s.line_index] = s;
              extracted.line_items = extracted.line_items.map((li, i) => ({
                ...li,
                suggested_qb_account_id:  byIndex[i]?.qb_account_id  ?? null,
                qb_suggestion_confidence: byIndex[i]?.confidence      ?? null,
                qb_suggestion_reason:     byIndex[i]?.reason          ?? null,
              }));
            } catch (qbErr) {
              console.warn('suggestInvoiceLineCodes failed:', qbErr.message);
            }
          }

          // 3. Budget line suggestion
          if (budgetLines.length) {
            const lineItems = extracted.line_items?.length
              ? extracted.line_items
              : [{ description: extracted.summary || extracted.vendor_name, amount: extracted.amount }];
            try {
              const blSuggestions = await callWithRetry(() => suggestLineBudgets(
                lineItems, budgetLines,
                { vendor_name: extracted.vendor_name, description: extracted.summary }
              ));
              if (blSuggestions) {
                extracted.suggested_primary_budget_line_id = blSuggestions.primary_budget_line_id;
                if (extracted.line_items?.length) {
                  const byIndex = {};
                  for (const s of blSuggestions.lines) byIndex[s.line_index] = s;
                  // Build a lookup of budget line id → qb_account_id
                  const blGlLookup = {};
                  for (const bl of budgetLines) blGlLookup[bl.id] = bl.qb_account_id;

                  extracted.line_items = extracted.line_items.map((li, i) => {
                    const taskSuggestion = byIndex[i];
                    const suggestedBudgetLineId = taskSuggestion?.budget_line_id ?? null;
                    // If we have a task match, derive GL code from that task — overrides the vendor-based suggestion
                    const derivedGlId = suggestedBudgetLineId ? (blGlLookup[suggestedBudgetLineId] ?? li.suggested_qb_account_id) : li.suggested_qb_account_id;
                    const derivedConf = suggestedBudgetLineId ? (taskSuggestion.confidence ?? li.qb_suggestion_confidence) : li.qb_suggestion_confidence;
                    return {
                      ...li,
                      suggested_budget_line_id: suggestedBudgetLineId,
                      budget_line_confidence:   taskSuggestion?.confidence ?? null,
                      suggested_qb_account_id:  derivedGlId,
                      qb_suggestion_confidence: derivedConf,
                    };
                  });
                }
              }
            } catch (blErr) {
              console.warn('suggestLineBudgets (invoice) failed:', blErr.message);
            }
          }
        }

        const desc = type === 'contract' ? extracted.description : extracted.summary;
        const vendor = extracted.vendor_name;
        const primaryLineId = (type === 'contract' && extracted.suggested_primary_budget_line_id) || null;
        const invLineId = (type === 'invoice' && extracted.suggested_primary_budget_line_id) || null;
        const { lineId: fallbackLineId, confidence: matchConf } = matchBudgetLine(desc, vendor, budgetLines);
        const lineId = primaryLineId ?? invLineId ?? fallbackLineId;

        // QB + project matching for invoices
        let qbTxnId = null, qbMatchConf = null, qbMatchReason = null;
        let identifiedProject = null, projectMatchResult = null;
        if (type === 'invoice') {
          const qbMatch = matchQbTransaction(extracted, qbTransactions);
          qbTxnId = qbMatch.txn_id;
          qbMatchConf = qbMatch.confidence;
          qbMatchReason = qbMatch.reason;

          if (phaseProject) {
            const aliases = phaseProject.keywords || [];
            const pm = matchProject(extracted.project_clues, phaseProject.name, aliases, item.original_filename || '', allProjects, vendorJobMap, extracted.vendor_name || '', extracted.vendor_job_number || '', phaseProject.id);
            projectMatchResult = pm.match;
            identifiedProject = extracted.project_clues || null;
          }
        }

        await pool.query(
          `UPDATE import_queue SET status='needs_review', doc_type=$1, doc_type_confidence=$2,
           extracted_data=$3, suggested_budget_line_id=$4, match_confidence=$5,
           suggested_qb_txn_id=$6, qb_match_confidence=$7, qb_match_reason=$8,
           identified_project=$9, project_match=$10,
           updated_at=NOW() WHERE id=$11`,
          [type, confidence, JSON.stringify(extracted), lineId, matchConf,
           qbTxnId, qbMatchConf, qbMatchReason, identifiedProject, projectMatchResult,
           item.id]
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
          `SELECT i.id, i.vendor_name, i.invoice_number, i.amount::numeric as amount, i.invoice_date, i.status,
                  i.created_at AS confirmed_at,
                  ph.name AS phase_name, pr.name AS project_name
           FROM invoices i
           LEFT JOIN phases ph ON ph.id = i.phase_id
           LEFT JOIN projects pr ON pr.id = ph.project_id
           WHERE LOWER(TRIM(i.vendor_name))=$1 AND LOWER(TRIM(i.invoice_number))=$2`,
          [vendor, invNum]
        );
        r.rows.forEach(row => matches.push({ ...row, match_type: 'exact', reason: 'Same vendor + invoice number' }));
      }

      // Fuzzy: same vendor + amount within 5% + date within 60 days
      if (vendor && amount > 0 && invDate) {
        const r = await pool.query(
          `SELECT i.id, i.vendor_name, i.invoice_number, i.amount::numeric as amount, i.invoice_date, i.status,
                  i.created_at AS confirmed_at,
                  ph.name AS phase_name, pr.name AS project_name
           FROM invoices i
           LEFT JOIN phases ph ON ph.id = i.phase_id
           LEFT JOIN projects pr ON pr.id = ph.project_id
           WHERE LOWER(TRIM(i.vendor_name))=$1
             AND ABS(i.amount::numeric - $2) / NULLIF($2, 0) < 0.05
             AND i.invoice_date IS NOT NULL
             AND ABS(i.invoice_date::date - $3::date) < 60`,
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
          `SELECT c.id, c.vendor_name, c.reference_number, c.total_value::numeric as amount, c.contract_date, c.status,
                  c.created_at AS confirmed_at,
                  ph.name AS phase_name, pr.name AS project_name
           FROM contracts c
           LEFT JOIN phases ph ON ph.id = c.phase_id
           LEFT JOIN projects pr ON pr.id = ph.project_id
           WHERE LOWER(TRIM(c.vendor_name))=$1 AND LOWER(TRIM(c.reference_number))=$2`,
          [vendor, refNum]
        );
        r.rows.forEach(row => matches.push({ ...row, match_type: 'exact', reason: 'Same vendor + reference number' }));
      }

      // Fuzzy: same vendor + amount within 10% + date within 90 days
      if (vendor && amount > 0 && cDate) {
        const r = await pool.query(
          `SELECT c.id, c.vendor_name, c.reference_number, c.total_value::numeric as amount, c.contract_date, c.status,
                  c.created_at AS confirmed_at,
                  ph.name AS phase_name, pr.name AS project_name
           FROM contracts c
           LEFT JOIN phases ph ON ph.id = c.phase_id
           LEFT JOIN projects pr ON pr.id = ph.project_id
           WHERE LOWER(TRIM(c.vendor_name))=$1
             AND ABS(c.total_value::numeric - $2) / NULLIF($2, 0) < 0.10
             AND c.contract_date IS NOT NULL
             AND ABS(c.contract_date::date - $3::date) < 90`,
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
      `SELECT iq.*,
              pbl.task_name AS suggested_line_name,
              qt.vendor_name   AS qb_vendor,
              qt.ref_number    AS qb_ref_number,
              qt.amount        AS qb_amount,
              qt.txn_date      AS qb_txn_date,
              qt.qb_gl_code,
              qt.qb_gl_name,
              qt.is_paid       AS qb_is_paid,
              qt.open_balance  AS qb_open_balance
       FROM import_queue iq
       LEFT JOIN phase_budget_lines pbl ON pbl.id = iq.suggested_budget_line_id
       LEFT JOIN qb_transactions qt     ON qt.id  = iq.suggested_qb_txn_id
       WHERE iq.phase_id = $1
       ORDER BY iq.created_at ASC`,
      [phaseId]
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// POST /api/phases/:phaseId/import/rematch-qb
// Re-run QB matching on existing needs_review items without re-extracting PDFs.
router.post('/phases/:phaseId/import/rematch-qb', requireAuth, async (req, res, next) => {
  const phaseId = Number(req.params.phaseId);
  try {
    const qbTransactions = (await pool.query(
      'SELECT id, vendor_name, ref_number, amount, txn_date, qb_gl_code FROM qb_transactions WHERE phase_id=$1',
      [phaseId]
    )).rows;

    const phaseProjectRes = await pool.query(
      'SELECT pr.id, pr.name, pr.keywords FROM projects pr JOIN phases ph ON ph.project_id=pr.id WHERE ph.id=$1',
      [phaseId]
    );
    const phaseProject = phaseProjectRes.rows[0] || null;
    const allProjects = (await pool.query('SELECT id, name, keywords FROM projects')).rows;
    const vendorJobMap = (await pool.query('SELECT vendor_name, vendor_job_number, project_id FROM vendor_project_map')).rows;
    const itemsWithFilenames = (await pool.query(
      `SELECT id, extracted_data, original_filename FROM import_queue WHERE phase_id=$1 AND status='needs_review' AND doc_type='invoice'`,
      [phaseId]
    )).rows;

    let updated = 0;
    for (const item of itemsWithFilenames) {
      const ext = item.extracted_data || {};
      const qbMatch = matchQbTransaction(ext, qbTransactions);
      let pm = { match: null, reason: null };
      if (phaseProject) {
        const aliases = phaseProject.keywords || [];
        pm = matchProject(ext.project_clues, phaseProject.name, aliases, item.original_filename || '', allProjects, vendorJobMap, ext.vendor_name || '', ext.vendor_job_number || '', phaseProject.id);
      }

      await pool.query(
        `UPDATE import_queue SET
           suggested_qb_txn_id=$1, qb_match_confidence=$2, qb_match_reason=$3,
           identified_project=$4, project_match=$5, updated_at=NOW()
         WHERE id=$6`,
        [qbMatch.txn_id, qbMatch.confidence, qbMatch.reason,
         ext.project_clues || null, pm.match, item.id]
      );
      updated++;
    }
    res.json({ updated, total_items: itemsWithFilenames.length, qb_transactions_loaded: qbTransactions.length });
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
    // project_match === 'mismatch' is surfaced as a warning on the frontend; user can override and confirm anyway
    const { formData } = req.body;
    const lineId = formData.phase_budget_line_id || item.suggested_budget_line_id || null;

    await client.query('BEGIN');
    let contractId = null, invoiceId = null, pmGlId = null;

    if (item.doc_type === 'contract') {
      const phaseRes = await client.query('SELECT project_id FROM phases WHERE id=$1', [item.phase_id]);
      const projectId = phaseRes.rows[0]?.project_id;
      const r = await client.query(
        `INSERT INTO contracts (project_id, phase_budget_line_id, vendor_name, description, total_value,
          contract_date, reference_number, status, file_reference, source_batch, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [projectId, lineId, formData.vendor_name, formData.description, Number(formData.total_value)||0,
         formData.contract_date||null, formData.reference_number||null,
         formData.status||'active', item.file_reference, item.source_batch||null, req.session.userId]
      );
      contractId = r.rows[0].id;

      // Insert line items if present
      const lineItems = formData.line_items || [];
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx];
        await client.query(
          `INSERT INTO contract_line_items
             (contract_id, sort_order, billing_type, description, budgeted_amount, phase_budget_line_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [contractId, idx, li.billing_type||'fixed', li.description||'',
           Number(li.budgeted_amount)||0,
           li.phase_budget_line_id ? Number(li.phase_budget_line_id) : null]
        );
      }
    } else {
      const phaseRes = await client.query('SELECT project_id FROM phases WHERE id=$1', [item.phase_id]);
      const projectId = phaseRes.rows[0]?.project_id;
      // Determine PM validated GL from header or first line item
      pmGlId = formData.qb_account_id
        ? Number(formData.qb_account_id)
        : (Array.isArray(formData.line_items) && formData.line_items[0]?.qb_account_id
            ? Number(formData.line_items[0].qb_account_id) : null);
      const r = await client.query(
        `INSERT INTO invoices (project_id, phase_id, phase_budget_line_id, contract_id, vendor_name, invoice_number, amount,
          invoice_date, description, status, file_reference, invoice_type, qb_account_id, pm_validated_gl_id, qb_transaction_id, source_batch, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [projectId, item.phase_id, lineId, formData.contract_id||null, formData.vendor_name, formData.invoice_number||'',
         Number(formData.amount)||0, formData.invoice_date||null, formData.description||null,
         'approved', item.file_reference, formData.invoice_type||'fixed',
         pmGlId, pmGlId,
         item.suggested_qb_txn_id || null,
         item.source_batch||null, req.session.userId]
      );
      invoiceId = r.rows[0].id;
      // Save invoice line items
      // GL code is always derived from the selected budget task (phase_budget_line_id) when one is set —
      // this ensures the two can never disagree regardless of what the form sent.
      const invLines = Array.isArray(formData.line_items) ? formData.line_items : [];
      for (let idx = 0; idx < invLines.length; idx++) {
        const li = invLines[idx];
        let lineGlId = li.qb_account_id ? Number(li.qb_account_id) : null;
        if (li.phase_budget_line_id) {
          const blRow = await client.query(
            'SELECT qb_account_id FROM phase_budget_lines WHERE id=$1',
            [Number(li.phase_budget_line_id)]
          );
          if (blRow.rows[0]?.qb_account_id) lineGlId = blRow.rows[0].qb_account_id;
        }
        await client.query(
          `INSERT INTO invoice_line_items
             (invoice_id, sort_order, billing_type, description, person, line_date, hours, rate, amount, qb_account_id, phase_budget_line_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [invoiceId, idx, li.billing_type||'fixed', li.description||'',
           li.person||null, li.line_date||null,
           li.hours != null ? Number(li.hours) : null,
           li.rate != null ? Number(li.rate) : null,
           Number(li.amount)||0,
           lineGlId,
           li.phase_budget_line_id ? Number(li.phase_budget_line_id) : null]
        );
      }
    }

    // Compute recon_status immediately if we have a linked QB transaction
    if (invoiceId && item.suggested_qb_txn_id) {
      const txnRes = await client.query(
        'SELECT amount, qb_gl_code FROM qb_transactions WHERE id=$1', [item.suggested_qb_txn_id]
      );
      const txn = txnRes.rows[0];
      if (txn) {
        const invAmount = Number(formData.amount) || 0;
        const pmGlAccount = pmGlId
          ? (await client.query('SELECT account_number FROM qb_accounts WHERE id=$1', [pmGlId])).rows[0]?.account_number
          : null;
        let recon = 'matched';
        if (Math.abs(invAmount - Number(txn.amount)) >= 0.02) recon = 'amount_mismatch';
        else if (pmGlAccount && txn.qb_gl_code && pmGlAccount !== txn.qb_gl_code) recon = 'gl_mismatch';
        await client.query('UPDATE invoices SET recon_status=$1 WHERE id=$2', [recon, invoiceId]);
      }
    }

    // Learn vendor job number → project mapping from confirmed invoices
    const ext = item.extracted_data || {};
    const vjn = String(ext.vendor_job_number || '').trim();
    const vname = String(formData.vendor_name || ext.vendor_name || '').trim();
    if (vjn && vname && item.phase_id) {
      const phaseProjectForMap = (await client.query('SELECT project_id FROM phases WHERE id=$1', [item.phase_id])).rows[0];
      if (phaseProjectForMap) {
        await client.query(`
          INSERT INTO vendor_project_map (vendor_name, vendor_job_number, project_id, confirmed_count)
          VALUES ($1, $2, $3, 1)
          ON CONFLICT (vendor_name, vendor_job_number)
          DO UPDATE SET confirmed_count = vendor_project_map.confirmed_count + 1, updated_at = NOW()
        `, [vname, vjn, phaseProjectForMap.project_id]);
      }
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

    const qbAccountsRetry = (await pool.query('SELECT id, account_number, full_name, short_name FROM qb_accounts ORDER BY account_number')).rows;

    const phaseContractsRetry = (await pool.query(`
      SELECT DISTINCT c.id, c.vendor_name, c.reference_number, c.total_value FROM contracts c
      WHERE c.phase_budget_line_id IN (SELECT id FROM phase_budget_lines WHERE phase_id = $1)
        AND c.status NOT IN ('voided')
      UNION
      SELECT DISTINCT c.id, c.vendor_name, c.reference_number, c.total_value FROM contracts c
      JOIN contract_line_items cli ON cli.contract_id = c.id
      WHERE cli.phase_budget_line_id IN (SELECT id FROM phase_budget_lines WHERE phase_id = $1)
        AND c.status NOT IN ('voided')
    `, [item.phase_id])).rows;

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
        if (type === 'contract') {
          if (extracted.line_items?.length && budgetLines.length) {
            try {
              const blSuggestions = await callWithRetry(() => suggestLineBudgets(
                extracted.line_items, budgetLines,
                { vendor_name: extracted.vendor_name, description: extracted.description }
              ));
              if (blSuggestions) {
                extracted.suggested_primary_budget_line_id = blSuggestions.primary_budget_line_id;
                const byIndex = {};
                for (const s of blSuggestions.lines) byIndex[s.line_index] = s;
                extracted.line_items = extracted.line_items.map((li, i) => ({
                  ...li,
                  suggested_budget_line_id: byIndex[i]?.budget_line_id ?? null,
                  differs_from_primary:     byIndex[i]?.differs_from_primary ?? false,
                  budget_line_confidence:   byIndex[i]?.confidence ?? null,
                  budget_line_reason:       byIndex[i]?.reason ?? null,
                }));
              }
            } catch (blErr) { console.warn('suggestLineBudgets (retry contract) failed:', blErr.message); }
          }
        } else {
          const contractMatch = matchInvoiceToContract(extracted, phaseContractsRetry);
          if (contractMatch) {
            extracted.suggested_contract_id = contractMatch.contract_id;
            extracted.contract_match_confidence = contractMatch.confidence;
          }
          if (extracted.line_items?.length && qbAccountsRetry.length) {
            try {
              const codeSuggestions = await callWithRetry(() =>
                suggestInvoiceLineCodes(buf, extracted.line_items, qbAccountsRetry, extracted.vendor_name, budgetLines)
              );
              const byIndex = {};
              for (const s of codeSuggestions) byIndex[s.line_index] = s;
              extracted.line_items = extracted.line_items.map((li, i) => ({
                ...li,
                suggested_qb_account_id:  byIndex[i]?.qb_account_id ?? null,
                qb_suggestion_confidence: byIndex[i]?.confidence     ?? null,
                qb_suggestion_reason:     byIndex[i]?.reason         ?? null,
              }));
            } catch (qbErr) { console.warn('suggestInvoiceLineCodes (retry) failed:', qbErr.message); }
          }
          if (budgetLines.length) {
            try {
              const lineItems = extracted.line_items?.length
                ? extracted.line_items
                : [{ description: extracted.summary || extracted.vendor_name, amount: extracted.amount }];
              const blSuggestions = await callWithRetry(() => suggestLineBudgets(
                lineItems, budgetLines,
                { vendor_name: extracted.vendor_name, description: extracted.summary }
              ));
              if (blSuggestions) {
                extracted.suggested_primary_budget_line_id = blSuggestions.primary_budget_line_id;
                if (extracted.line_items?.length) {
                  const byIndex = {};
                  for (const s of blSuggestions.lines) byIndex[s.line_index] = s;
                  const blGlLookup = {};
                  for (const bl of budgetLines) blGlLookup[bl.id] = bl.qb_account_id;
                  extracted.line_items = extracted.line_items.map((li, i) => {
                    const taskSuggestion = byIndex[i];
                    const suggestedBudgetLineId = taskSuggestion?.budget_line_id ?? null;
                    const derivedGlId = suggestedBudgetLineId ? (blGlLookup[suggestedBudgetLineId] ?? li.suggested_qb_account_id) : li.suggested_qb_account_id;
                    return {
                      ...li,
                      suggested_budget_line_id: suggestedBudgetLineId,
                      budget_line_confidence:   taskSuggestion?.confidence ?? null,
                      suggested_qb_account_id:  derivedGlId,
                      qb_suggestion_confidence: suggestedBudgetLineId ? (taskSuggestion?.confidence ?? li.qb_suggestion_confidence) : li.qb_suggestion_confidence,
                    };
                  });
                }
              }
            } catch (blErr) { console.warn('suggestLineBudgets (retry invoice) failed:', blErr.message); }
          }
        }
        const desc = type === 'contract' ? extracted.description : extracted.summary;
        const primaryLineId = (type === 'contract' && extracted.suggested_primary_budget_line_id) || null;
        const invLineId = (type === 'invoice' && extracted.suggested_primary_budget_line_id) || null;
        const { lineId: fallbackLineId, confidence: matchConf } = matchBudgetLine(desc, extracted.vendor_name, budgetLines);
        const lineId = primaryLineId ?? invLineId ?? fallbackLineId;
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

// POST /api/phases/:phaseId/import/reprocess — re-run AI on all needs_review items
router.post('/phases/:phaseId/import/reprocess', requireAuth, async (req, res, next) => {
  try {
    const phaseId = Number(req.params.phaseId);
    const items = (await pool.query(
      `SELECT * FROM import_queue WHERE phase_id=$1 AND status='needs_review' ORDER BY created_at`,
      [phaseId]
    )).rows;
    if (!items.length) return res.json({ ok: true, count: 0 });

    // Mark all as queued so UI shows progress
    await pool.query(
      `UPDATE import_queue SET status='queued', updated_at=NOW() WHERE phase_id=$1 AND status='needs_review'`,
      [phaseId]
    );
    res.json({ ok: true, count: items.length });

    // Run same background pipeline as initial import
    const budgetLines = (await pool.query(
      'SELECT id, task_name, discipline FROM phase_budget_lines WHERE phase_id=$1', [phaseId]
    )).rows;
    const qbAccounts = (await pool.query('SELECT id, account_number, full_name, short_name FROM qb_accounts ORDER BY account_number')).rows;
    const phaseContracts = (await pool.query(`
      SELECT DISTINCT c.id, c.vendor_name, c.reference_number, c.total_value FROM contracts c
      WHERE c.phase_budget_line_id IN (SELECT id FROM phase_budget_lines WHERE phase_id=$1) AND c.status NOT IN ('voided')
      UNION
      SELECT DISTINCT c.id, c.vendor_name, c.reference_number, c.total_value FROM contracts c
      JOIN contract_line_items cli ON cli.contract_id = c.id
      WHERE cli.phase_budget_line_id IN (SELECT id FROM phase_budget_lines WHERE phase_id=$1) AND c.status NOT IN ('voided')
    `, [phaseId])).rows;

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

    const CONCURRENCY = 2;
    let i = 0;
    async function processOne() {
      if (i >= items.length) return;
      const item = items[i++];
      try {
        await pool.query(`UPDATE import_queue SET status='extracting', updated_at=NOW() WHERE id=$1`, [item.id]);
        const buf = (await fileStorage.read(item.file_reference)).buffer;
        const { type, confidence } = await callWithRetry(() => classifyDocument(buf));
        const extracted = await callWithRetry(() =>
          type === 'contract' ? extractContract(buf) : extractInvoice(buf)
        );
        if (type === 'contract') {
          if (extracted.line_items?.length && budgetLines.length) {
            try {
              const bl = await callWithRetry(() => suggestLineBudgets(extracted.line_items, budgetLines,
                { vendor_name: extracted.vendor_name, description: extracted.description }));
              if (bl) {
                extracted.suggested_primary_budget_line_id = bl.primary_budget_line_id;
                const byIdx = {};
                for (const s of bl.lines) byIdx[s.line_index] = s;
                extracted.line_items = extracted.line_items.map((li, idx) => ({
                  ...li,
                  suggested_budget_line_id: byIdx[idx]?.budget_line_id ?? null,
                  differs_from_primary: byIdx[idx]?.differs_from_primary ?? false,
                  budget_line_confidence: byIdx[idx]?.confidence ?? null,
                  budget_line_reason: byIdx[idx]?.reason ?? null,
                }));
              }
            } catch (e) { console.warn('reprocess bl error:', e.message); }
          }
        } else {
          const contractMatch = matchInvoiceToContract(extracted, phaseContracts);
          if (contractMatch) { extracted.suggested_contract_id = contractMatch.contract_id; extracted.contract_match_confidence = contractMatch.confidence; }
          if (extracted.line_items?.length && qbAccounts.length) {
            try {
              const sug = await callWithRetry(() => suggestInvoiceLineCodes(buf, extracted.line_items, qbAccounts, extracted.vendor_name));
              const byIdx = {};
              for (const s of sug) byIdx[s.line_index] = s;
              extracted.line_items = extracted.line_items.map((li, idx) => ({
                ...li, suggested_qb_account_id: byIdx[idx]?.qb_account_id ?? null, qb_suggestion_confidence: byIdx[idx]?.confidence ?? null,
              }));
            } catch (e) { console.warn('reprocess qb error:', e.message); }
          }
          if (budgetLines.length) {
            try {
              const lineItems = extracted.line_items?.length ? extracted.line_items
                : [{ description: extracted.summary || '', amount: extracted.amount }];
              const bl = await callWithRetry(() => suggestLineBudgets(lineItems, budgetLines,
                { vendor_name: extracted.vendor_name, description: extracted.summary }));
              if (bl) {
                extracted.suggested_primary_budget_line_id = bl.primary_budget_line_id;
                if (extracted.line_items?.length) {
                  const byIdx2 = {};
                  for (const s of bl.lines) byIdx2[s.line_index] = s;
                  extracted.line_items = extracted.line_items.map((li, idx) => ({
                    ...li, suggested_budget_line_id: byIdx2[idx]?.budget_line_id ?? null,
                  }));
                }
              }
            } catch (e) { console.warn('reprocess invoice bl error:', e.message); }
          }
        }
        const desc = type === 'contract' ? extracted.description : extracted.summary;
        const primaryLineId = extracted.suggested_primary_budget_line_id || null;
        const { lineId: fallbackLineId, confidence: matchConf } = matchBudgetLine(desc, extracted.vendor_name, budgetLines);
        const lineId = primaryLineId ?? fallbackLineId;
        await pool.query(
          `UPDATE import_queue SET status='needs_review', doc_type=$1, doc_type_confidence=$2,
           extracted_data=$3, suggested_budget_line_id=$4, match_confidence=$5, updated_at=NOW() WHERE id=$6`,
          [type, confidence, JSON.stringify(extracted), lineId, matchConf, item.id]
        );
      } catch (err) {
        await pool.query(`UPDATE import_queue SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2`, [err.message, item.id]);
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => {
      const run = async () => { await processOne(); if (i < items.length) await run(); };
      return run();
    });
    Promise.all(workers).catch(e => console.error('Reprocess worker error:', e));

  } catch (err) { next(err); }
});

// DELETE /api/import-queue/:id
router.delete('/import-queue/:id', requireAuth, async (req, res, next) => {
  try {
    await pool.query(`UPDATE import_queue SET status='discarded', updated_at=NOW() WHERE id=$1`, [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/phases/:phaseId/import/confirm-batch-high
// Batch-confirms all needs_review items with match_confidence='high' using extracted_data directly.
router.post('/phases/:phaseId/import/confirm-batch-high', requireAuth, async (req, res, next) => {
  const phaseId = Number(req.params.phaseId);
  try {
    const items = (await pool.query(
      `SELECT * FROM import_queue WHERE phase_id=$1 AND status='needs_review' AND match_confidence='high'`,
      [phaseId]
    )).rows;

    const phaseRes = await pool.query('SELECT project_id FROM phases WHERE id=$1', [phaseId]);
    const projectId = phaseRes.rows[0]?.project_id;

    let confirmed = 0, failed = 0;

    for (const item of items) {
      const client = await pool.connect();
      try {
        const ext = item.extracted_data || {};
        const lineId = item.suggested_budget_line_id || null;

        await client.query('BEGIN');
        let contractId = null, invoiceId = null;

        if (item.doc_type === 'contract') {
          const r = await client.query(
            `INSERT INTO contracts (project_id, phase_budget_line_id, vendor_name, description, total_value,
               contract_date, reference_number, status, file_reference, source_batch, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [projectId, lineId, ext.vendor_name || 'Unknown', ext.description || ext.summary || null,
             Number(ext.total_value) || 0, ext.contract_date || null, ext.reference_number || null,
             'active', item.file_reference, item.source_batch || null, req.session.userId]
          );
          contractId = r.rows[0].id;
          const lineItems = ext.line_items || [];
          for (let idx = 0; idx < lineItems.length; idx++) {
            const li = lineItems[idx];
            await client.query(
              `INSERT INTO contract_line_items
                 (contract_id, sort_order, billing_type, description, budgeted_amount, phase_budget_line_id)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [contractId, idx, li.billing_type || 'fixed', li.description || '',
               Number(li.budgeted_amount) || 0, li.suggested_budget_line_id || null]
            );
          }
        } else {
          const r = await client.query(
            `INSERT INTO invoices (project_id, phase_id, phase_budget_line_id, contract_id, vendor_name, invoice_number,
               amount, invoice_date, description, status, file_reference, invoice_type, qb_transaction_id, source_batch, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
            [projectId, item.phase_id, lineId, null, ext.vendor_name || 'Unknown', ext.invoice_number || '',
             Number(ext.amount) || 0, ext.invoice_date || null, ext.description || null,
             'approved', item.file_reference, ext.invoice_type || 'fixed',
             item.suggested_qb_txn_id || null,
             item.source_batch || null, req.session.userId]
          );
          invoiceId = r.rows[0].id;
        }

        await client.query(
          `UPDATE import_queue SET status='confirmed', confirmed_contract_id=$1, confirmed_invoice_id=$2, updated_at=NOW() WHERE id=$3`,
          [contractId, invoiceId, item.id]
        );
        await client.query('COMMIT');
        confirmed++;
      } catch (err) {
        await client.query('ROLLBACK');
        failed++;
      } finally {
        client.release();
      }
    }

    res.json({ confirmed, failed, total: items.length });
  } catch (err) { next(err); }
});

module.exports = router;
