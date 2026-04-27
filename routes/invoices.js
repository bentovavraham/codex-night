const express = require('express');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth, hasMinRole } = require('../middleware/auth');
const projects = require('./projects');
const storage = require('../lib/storage');
const { extractInvoice, suggestInvoiceLineCodes } = require('../lib/extract');

const router = express.Router();
const pdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Vendor knowledge helpers --------------------------------------------------

async function getVendorContext(vendorName, limit = 5) {
  if (!vendorName) return { examples: [], vendorNotes: null };
  const [examplesResult, profileResult] = await Promise.all([
    pool.query(
      `SELECT fields_json FROM extraction_examples
       WHERE LOWER(vendor_name) = LOWER($1) AND document_type = 'invoice'
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
     VALUES ($1, 'invoice', $2, $3)`,
    [vendorName, JSON.stringify(fields), userId]
  );
}

// Helpers -------------------------------------------------------------------

async function getInvoiceWithProject(invoiceId) {
  const r = await pool.query(
    `SELECT i.*, COALESCE(i.project_id, c.project_id) AS project_id
     FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id
     WHERE i.id = $1`, [invoiceId]);
  return r.rows[0] || null;
}

async function logInvoice(client, invoiceId, action, detail, userId) {
  await client.query(
    `INSERT INTO invoice_logs (invoice_id, action, detail, changed_by)
     VALUES ($1,$2,$3,$4)`, [invoiceId, action, detail, userId]);
}

// POST /api/invoices/extract ------------------------------------------------
router.post('/invoices/extract', requireAuth, pdfUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file field required' });
    const saved = await storage.save(req.file.buffer, {
      filename: req.file.originalname || 'invoice.pdf',
      mimeType: req.file.mimetype || 'application/pdf',
    });
    let extracted = null, extract_error = null;
    try {
      // Pass 1: quick extraction to get vendor name.
      const pass1 = await extractInvoice(req.file.buffer);
      // Pass 2: re-extract with vendor context if we know this vendor.
      const ctx = await getVendorContext(pass1.vendor_name);
      if (ctx.examples.length > 0 || ctx.vendorNotes) {
        extracted = await extractInvoice(req.file.buffer, ctx);
      } else {
        extracted = pass1;
      }

      // Pass 3: suggest QB codes per line item (uses both description + vendor).
      if (extracted && extracted.line_items && extracted.line_items.length > 0) {
        try {
          const qbResult = await pool.query(
            `SELECT id, account_number, full_name FROM qb_accounts WHERE is_leaf = true ORDER BY sort_order`
          );
          const suggestions = await suggestInvoiceLineCodes(
            req.file.buffer, extracted.line_items, qbResult.rows, extracted.vendor_name
          );
          // Merge suggestions back onto each line item.
          const byIndex = {};
          for (const s of suggestions) byIndex[s.line_index] = s;
          extracted.line_items = extracted.line_items.map((li, i) => ({
            ...li,
            suggested_qb_account_id:  byIndex[i]?.qb_account_id  ?? null,
            suggested_qb_number:      byIndex[i]?.account_number  ?? null,
            qb_suggestion_confidence: byIndex[i]?.confidence      ?? null,
            qb_suggestion_reason:     byIndex[i]?.reason          ?? null,
          }));
        } catch (codeErr) {
          console.warn('QB code suggestion failed:', codeErr.message);
        }
      }

      // Pass 4: fuzzy-match vendor name against known vendors.
      if (extracted && extracted.vendor_name) {
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const vendorNorm = normalize(extracted.vendor_name);
        const vendorsRes = await pool.query('SELECT id, name FROM vendors ORDER BY name');
        let bestMatch = null, bestScore = 0;
        for (const v of vendorsRes.rows) {
          const vn = normalize(v.name);
          if (vn === vendorNorm) { bestMatch = v; bestScore = 1; break; }
          // Simple longest-common-prefix score
          let common = 0;
          const minLen = Math.min(vn.length, vendorNorm.length);
          for (let i = 0; i < minLen; i++) { if (vn[i] === vendorNorm[i]) common++; else break; }
          const score = common / Math.max(vn.length, vendorNorm.length);
          if (score > bestScore && score > 0.7) { bestScore = score; bestMatch = v; }
        }
        extracted.vendor_match = bestMatch
          ? { id: bestMatch.id, name: bestMatch.name, score: bestScore, exact: bestScore === 1 }
          : null;
        extracted.vendor_is_new = !bestMatch;
      }
    }
    catch (err) { console.error('Invoice extraction failed:', err.message); extract_error = err.message; }
    res.status(201).json({
      file_reference: saved.reference,
      download_url: `/api/files/${encodeURIComponent(saved.reference)}`,
      filename: saved.filename, size: saved.size, extracted, extract_error,
    });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/invoices --------------------------------------------
router.get('/projects/:id/invoices', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const filters = ['(i.project_id = $1 OR c.project_id = $1)'];
    const params = [projectId];
    if (req.query.status) { params.push(req.query.status); filters.push(`i.status = $${params.length}`); }
    if (req.query.contract_id === 'none') { filters.push('i.contract_id IS NULL'); }
    else if (req.query.contract_id) { params.push(Number(req.query.contract_id)); filters.push(`i.contract_id = $${params.length}`); }
    if (req.query.vendor) { params.push(`%${req.query.vendor}%`); filters.push(`i.vendor_name ILIKE $${params.length}`); }
    if (req.query.qb_code_id) { params.push(Number(req.query.qb_code_id)); filters.push(`i.qb_code_id = $${params.length}`); }
    if (req.query.invoice_type) { params.push(req.query.invoice_type); filters.push(`COALESCE(i.invoice_type,'fixed') = $${params.length}`); }
    const sortMap = { vendor: 'i.vendor_name ASC', amount: 'i.amount DESC', status: 'i.status ASC, i.created_at DESC' };
    const order = sortMap[req.query.sort] || 'i.invoice_date DESC NULLS LAST, i.created_at DESC';
    const result = await pool.query(
      `SELECT i.*, c.vendor_name AS contract_vendor, c.total_value AS contract_total,
              u_created.name AS created_by_name, u_approved.name AS approved_by_name,
              (SELECT COUNT(*) FROM invoice_contracts ic WHERE ic.invoice_id = i.id)::int AS alloc_count
       FROM invoices i
       LEFT JOIN contracts c ON c.id = i.contract_id
       LEFT JOIN users u_created ON u_created.id = i.created_by
       LEFT JOIN users u_approved ON u_approved.id = i.approved_by
       WHERE ${filters.join(' AND ')} ORDER BY ${order}`, params);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/invoices/export (CSV) --------------------------------
router.get('/projects/:id/invoices/export', requireAuth, async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    if (!(await projects.userCanAccess(req.session.userId, projectId))) return res.status(403).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT i.invoice_number, i.vendor_name, i.amount, i.invoice_date, i.status,
              i.description, i.created_at, i.approved_at, i.paid_date, i.rejection_note,
              c.vendor_name AS contract_vendor, c.reference_number AS contract_ref
       FROM invoices i LEFT JOIN contracts c ON c.id = i.contract_id
       WHERE (i.project_id = $1 OR c.project_id = $1)
       ORDER BY i.invoice_date DESC NULLS LAST`, [projectId]);
    const header = 'Invoice #,Vendor,Amount,Date,Status,Description,Contract Vendor,Contract Ref,Approved At,Paid Date,Rejection Note,Created At\n';
    const rows = result.rows.map(r =>
      [r.invoice_number, r.vendor_name, r.amount, r.invoice_date || '', r.status,
       `"${(r.description || '').replace(/"/g, '""')}"`, r.contract_vendor || '',
       r.contract_ref || '', r.approved_at || '', r.paid_date || '',
       `"${(r.rejection_note || '').replace(/"/g, '""')}"`, r.created_at].join(',')
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="invoices-project-${projectId}.csv"`);
    res.send(header + rows);
  } catch (err) { next(err); }
});

// POST /api/invoices --------------------------------------------------------
// Supports single contract (contract_id) or multi-contract (contracts: [{contract_id, amount}]).
router.post('/invoices', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { contract_id, contracts: contractAllocs, project_id, invoice_number, vendor_name, amount,
            invoice_date, description, file_reference, qb_code_id, invoice_type: invoiceTypeRaw,
            phase_budget_line_id } = req.body || {};
    if (!invoice_number || amount == null) return res.status(400).json({ error: 'invoice_number and amount required' });
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be > 0' });
    const invoiceType = ['fixed', 'tm', 'expense'].includes(invoiceTypeRaw) ? invoiceTypeRaw : 'fixed';

    // Build allocation list: either from contracts array or single contract_id.
    let allocs = [];
    if (Array.isArray(contractAllocs) && contractAllocs.length > 0) {
      allocs = contractAllocs.map(a => ({ contract_id: Number(a.contract_id), amount: Number(a.amount) }));
      const allocSum = allocs.reduce((s, a) => s + a.amount, 0);
      if (Math.abs(allocSum - amt) > 0.01) {
        return res.status(400).json({ error: `Contract allocations ($${allocSum.toFixed(2)}) must sum to invoice amount ($${amt.toFixed(2)}).` });
      }
    } else if (contract_id) {
      allocs = [{ contract_id: Number(contract_id), amount: amt }];
    }

    let resolvedProjectId = project_id ? Number(project_id) : null;
    let resolvedVendor = vendor_name || '';
    // Primary contract_id stored on invoice = first allocation (for backward compat).
    const primaryContractId = allocs.length > 0 ? allocs[0].contract_id : null;

    const force = req.body?.force === true;

    // Validate each contract allocation.
    for (const alloc of allocs) {
      const c = await pool.query('SELECT project_id, vendor_name, total_value FROM contracts WHERE id = $1', [alloc.contract_id]);
      if (!c.rows[0]) return res.status(404).json({ error: `Contract ${alloc.contract_id} not found` });
      resolvedProjectId = resolvedProjectId || c.rows[0].project_id;
      if (!resolvedVendor) resolvedVendor = c.rows[0].vendor_name;

      // Hard duplicate: same vendor + invoice_number + contract, not rejected.
      if (invoice_number) {
        const hardDup = await pool.query(
          `SELECT id, invoice_number, amount, status, invoice_date FROM invoices
           WHERE LOWER(vendor_name) = LOWER($1) AND LOWER(invoice_number) = LOWER($2)
             AND contract_id = $3 AND status != 'rejected'`,
          [resolvedVendor, invoice_number, alloc.contract_id]);
        if (hardDup.rows.length > 0) {
          const d = hardDup.rows[0];
          return res.status(409).json({
            error: `Invoice #${invoice_number} from ${resolvedVendor} already exists for this contract (status: ${d.status}, amount: $${Number(d.amount).toFixed(2)}).`,
            hard_duplicate: true,
            existing_id: d.id,
          });
        }
      }

      // Overspend check per contract.
      const invoiced = await pool.query(
        `SELECT COALESCE(SUM(ic.amount),0)::numeric AS total
         FROM invoice_contracts ic JOIN invoices i ON i.id = ic.invoice_id
         WHERE ic.contract_id = $1 AND i.status NOT IN ('rejected')
         AND COALESCE(i.invoice_type,'fixed') = 'fixed'`, [alloc.contract_id]);
      // Also count legacy invoices that only use contract_id directly.
      const legacyInvoiced = await pool.query(
        `SELECT COALESCE(SUM(amount),0)::numeric AS total FROM invoices
         WHERE contract_id = $1 AND status NOT IN ('rejected')
         AND COALESCE(invoice_type,'fixed') = 'fixed'
         AND id NOT IN (SELECT invoice_id FROM invoice_contracts)`, [alloc.contract_id]);
      if (invoiceType === 'fixed') {
        // Only fixed-scope invoices count against the contract's committed value.
        const totalInvoiced = Number(invoiced.rows[0].total) + Number(legacyInvoiced.rows[0].total);
        const remaining = Number(c.rows[0].total_value) - totalInvoiced;
        if (alloc.amount > remaining + 0.01) {
          return res.status(400).json({
            error: `Allocation of $${alloc.amount.toFixed(2)} to contract "${c.rows[0].vendor_name}" exceeds remaining balance ($${remaining.toFixed(2)}).`,
          });
        }
      }
    }

    if (!resolvedProjectId) return res.status(400).json({ error: 'contract_id or project_id required' });
    if (!(await projects.userCanAccess(req.session.userId, resolvedProjectId)))
      return res.status(403).json({ error: 'Forbidden' });

    // Soft duplicate: same vendor + contract + amount within 90 days, unless force=true.
    if (!force && allocs.length > 0) {
      const refDate = req.body?.invoice_date || null;
      const softDupRows = [];
      for (const alloc of allocs) {
        const sd = await pool.query(
          `SELECT id, invoice_number, amount, status, invoice_date FROM invoices
           WHERE LOWER(vendor_name) = LOWER($1)
             AND contract_id = $2
             AND amount = $3
             AND status != 'rejected'
             AND ABS(COALESCE(invoice_date, created_at::date) - COALESCE($4::date, CURRENT_DATE)) < 90`,
          [resolvedVendor, alloc.contract_id, amt, refDate]);
        softDupRows.push(...sd.rows);
      }
      if (softDupRows.length > 0) {
        return res.status(409).json({
          soft_duplicate: true,
          message: `Found ${softDupRows.length} existing invoice${softDupRows.length > 1 ? 's' : ''} from ${resolvedVendor} for the same amount ($${amt.toFixed(2)}) within 90 days. Possible duplicate.`,
          duplicates: softDupRows,
        });
      }
    }

    await client.query('BEGIN');
    // Resolve phase_budget_line_id: explicit value, or derive from contract if only one allocation
    let resolvedPblId = phase_budget_line_id ? Number(phase_budget_line_id) : null;
    if (!resolvedPblId && allocs.length === 1) {
      const pblRes = await pool.query('SELECT phase_budget_line_id FROM contracts WHERE id = $1', [allocs[0].contract_id]);
      resolvedPblId = pblRes.rows[0]?.phase_budget_line_id || null;
    }

    const result = await client.query(
      `INSERT INTO invoices (contract_id, project_id, phase_budget_line_id, invoice_number, vendor_name, amount,
          invoice_date, description, file_reference, qb_code_id, invoice_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [primaryContractId, resolvedProjectId, resolvedPblId, invoice_number, resolvedVendor, amt,
       invoice_date || null, description || null, file_reference || null,
       qb_code_id || null, invoiceType, req.session.userId]);
    const invoiceId = result.rows[0].id;
    // Insert allocation rows.
    for (const alloc of allocs) {
      await client.query(
        'INSERT INTO invoice_contracts (invoice_id, contract_id, amount) VALUES ($1, $2, $3)',
        [invoiceId, alloc.contract_id, alloc.amount]);
    }
    const contractNames = allocs.map(a => `contract #${a.contract_id}: $${a.amount.toFixed(2)}`).join(', ');
    await logInvoice(client, invoiceId, 'created',
      `Created: ${invoice_number} for $${amt.toFixed(2)} from ${resolvedVendor}${allocs.length > 1 ? ` (split: ${contractNames})` : ''}`,
      req.session.userId);
    // Save confirmed fields as a future few-shot example for this vendor.
    if (file_reference && resolvedVendor) {
      await saveExtractionExample(client, resolvedVendor, {
        invoice_number, vendor_name: resolvedVendor,
        amount: amt, invoice_date: invoice_date || null,
        description: description || null,
      }, req.session.userId);
    }
    // Insert G703 line items (pay-application line breakdown, legacy fixed-scope)
    const lines = req.body?.lines;
    if (Array.isArray(lines) && lines.length > 0 && invoiceType === 'fixed') {
      for (const line of lines) {
        const lineAmt = Number(line.current_amount);
        if (!line.qb_code_id || !lineAmt || lineAmt <= 0) continue;
        await client.query(
          'INSERT INTO invoice_lines (invoice_id, qb_code_id, current_amount) VALUES ($1, $2, $3)',
          [invoiceId, Number(line.qb_code_id), lineAmt]
        );
      }
    }

    // Insert detailed invoice_line_items (new model: T&M hours, fixed tasks, expenses per line)
    const invoiceLineItems = req.body?.invoice_line_items;
    if (Array.isArray(invoiceLineItems) && invoiceLineItems.length > 0) {
      for (let idx = 0; idx < invoiceLineItems.length; idx++) {
        const li = invoiceLineItems[idx];
        const liAmt = Number(li.amount);
        if (!liAmt) continue;
        const liType = ['fixed','tm','expense'].includes(li.billing_type) ? li.billing_type : invoiceType;
        await client.query(
          `INSERT INTO invoice_line_items
             (invoice_id, billing_type, description, person, line_date, hours, rate, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [invoiceId, liType,
           li.description || null,
           li.person      || null,
           li.line_date   || null,
           li.hours  != null ? Number(li.hours)  : null,
           li.rate   != null ? Number(li.rate)   : null,
           liAmt,
           li.sort_order != null ? Number(li.sort_order) : idx]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// GET /api/invoices/:id -----------------------------------------------------
router.get('/invoices/:id', requireAuth, async (req, res, next) => {
  try {
    const inv = await getInvoiceWithProject(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    // Fetch multi-contract allocations.
    const allocs = await pool.query(
      `SELECT ic.contract_id, ic.amount, c.vendor_name
       FROM invoice_contracts ic JOIN contracts c ON c.id = ic.contract_id
       WHERE ic.invoice_id = $1 ORDER BY ic.id`, [inv.id]);
    // Fetch G703 line items with previous_billed computed
    const lines = await pool.query(
      `SELECT il.id, il.qb_code_id, il.current_amount,
              qc.code, qc.name AS qc_name,
              cl.amount AS contract_amount,
              COALESCE((
                SELECT SUM(il2.current_amount)
                FROM invoice_lines il2
                JOIN invoices i2 ON i2.id = il2.invoice_id
                WHERE il2.qb_code_id = il.qb_code_id
                  AND i2.contract_id = $2
                  AND (i2.invoice_date < $3 OR (i2.invoice_date = $3 AND i2.id < $4))
                  AND i2.status != 'rejected'
              ), 0) AS previous_billed
       FROM invoice_lines il
       JOIN qb_codes qc ON qc.id = il.qb_code_id
       LEFT JOIN contract_lines cl ON cl.contract_id = $2 AND cl.qb_code_id = il.qb_code_id
       WHERE il.invoice_id = $1
       ORDER BY qc.code`,
      [inv.id, inv.contract_id || 0, inv.invoice_date, inv.id]
    );
    const lineItems = await pool.query(
      `SELECT ili.*, qa.account_number AS qb_account_number, qa.full_name AS qb_account_name
       FROM invoice_line_items ili
       LEFT JOIN qb_accounts qa ON qa.id = ili.qb_account_id
       WHERE ili.invoice_id = $1
       ORDER BY ili.sort_order, ili.id`,
      [inv.id]
    );
    res.json({ ...inv, contract_allocations: allocs.rows, lines: lines.rows, invoice_line_items: lineItems.rows });
  } catch (err) { next(err); }
});

// GET /api/invoices/:id/history ---------------------------------------------
router.get('/invoices/:id/history', requireAuth, async (req, res, next) => {
  try {
    const inv = await getInvoiceWithProject(Number(req.params.id));
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    const result = await pool.query(
      `SELECT l.*, u.name AS changed_by_name FROM invoice_logs l
       JOIN users u ON u.id = l.changed_by
       WHERE l.invoice_id = $1 ORDER BY l.changed_at DESC`, [inv.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

// PUT /api/invoices/:id -----------------------------------------------------
router.put('/invoices/:id', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });

    const {
      invoice_number, vendor_name, amount, invoice_date, description,
      status, file_reference, phase_budget_line_id, contract_id,
      invoice_type: invoiceTypeRaw, invoice_line_items: lineItems,
    } = req.body || {};

    const invoiceType = ['fixed', 'tm', 'expense'].includes(invoiceTypeRaw)
      ? invoiceTypeRaw : (inv.invoice_type || 'fixed');

    const changes = [];
    if (invoice_number && invoice_number !== inv.invoice_number) changes.push(`number: ${inv.invoice_number} → ${invoice_number}`);
    if (amount != null && Number(amount) !== Number(inv.amount)) changes.push(`amount: $${Number(inv.amount).toFixed(2)} → $${Number(amount).toFixed(2)}`);
    if (status && status !== inv.status) changes.push(`status: ${inv.status} → ${status}`);

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET
         invoice_number       = COALESCE($2, invoice_number),
         vendor_name          = COALESCE($3, vendor_name),
         amount               = COALESCE($4, amount),
         invoice_date         = $5,
         description          = $6,
         status               = COALESCE($7, status),
         file_reference       = COALESCE($8, file_reference),
         phase_budget_line_id = $9,
         contract_id          = $10,
         invoice_type         = $11,
         updated_at           = NOW()
       WHERE id = $1 RETURNING *`,
      [invId,
       invoice_number ?? null,
       vendor_name ?? null,
       amount != null ? Number(amount) : null,
       invoice_date ?? null,
       description ?? null,
       status ?? null,
       file_reference ?? null,
       phase_budget_line_id != null ? Number(phase_budget_line_id) : null,
       contract_id != null ? Number(contract_id) : null,
       invoiceType]);

    // Replace line items when provided (full replace)
    if (Array.isArray(lineItems)) {
      await client.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [invId]);
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx];
        const liAmt = Number(li.amount);
        if (!liAmt) continue;
        const liType = ['fixed', 'tm', 'expense'].includes(li.billing_type) ? li.billing_type : invoiceType;
        await client.query(
          `INSERT INTO invoice_line_items
             (invoice_id, billing_type, description, person, line_date, hours, rate, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [invId, liType,
           li.description || null,
           li.person      || null,
           li.line_date   || null,
           li.hours  != null ? Number(li.hours)  : null,
           li.rate   != null ? Number(li.rate)   : null,
           liAmt,
           li.sort_order != null ? Number(li.sort_order) : idx]
        );
      }
      if (lineItems.length > 0) changes.push(`line items updated (${lineItems.length} lines)`);
    }

    if (changes.length > 0) {
      await logInvoice(client, invId, 'edited', changes.join('; '), req.session.userId);
    }
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/pm-approve  (any role)
router.post('/invoices/:id/pm-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'pending') return res.status(400).json({ error: 'Invoice must be pending for PM approval' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'pm_approved', pm_approved_by = $2, pm_approved_at = NOW(),
         rejection_note = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [invId, req.session.userId]);
    await logInvoice(client, invId, 'pm_approved', `PM approved $${Number(inv.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/partner-approve  (partner or admin)
router.post('/invoices/:id/partner-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'partner')) return res.status(403).json({ error: 'Requires partner role or above' });
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'pm_approved') return res.status(400).json({ error: 'Invoice must be PM-approved first' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'partner_approved', partner_approved_by = $2, partner_approved_at = NOW(),
         updated_at = NOW() WHERE id = $1 RETURNING *`,
      [invId, req.session.userId]);
    await logInvoice(client, invId, 'partner_approved', `Partner approved $${Number(inv.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/approve  (admin/Seth only — final approval)
router.post('/invoices/:id/approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!hasMinRole(req.session.role, 'admin')) return res.status(403).json({ error: 'Requires admin role' });
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'partner_approved') return res.status(400).json({ error: 'Invoice must be partner-approved first' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'approved', approved_by = $2, approved_at = NOW(),
         rejection_note = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [invId, req.session.userId]);
    await logInvoice(client, invId, 'approved', `Final approval $${Number(inv.amount).toFixed(2)}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/reject — requires a note ---------------------------
router.post('/invoices/:id/reject', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const note = (req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: 'A rejection reason is required.' });
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'rejected', rejection_note = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`, [invId, note]);
    await logInvoice(client, invId, 'rejected', `Rejected: ${note}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/revert — revert approved/rejected/on_hold back to pending
router.post('/invoices/:id/revert', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status === 'pending')
      return res.status(400).json({ error: 'Invoice is already pending.' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'pending',
         pm_approved_by = NULL, pm_approved_at = NULL,
         partner_approved_by = NULL, partner_approved_at = NULL,
         approved_by = NULL, approved_at = NULL,
         rejection_note = NULL, paid_date = NULL, qb_reference_id = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING *`, [invId]);
    await logInvoice(client, invId, 'reverted', `Reverted from ${inv.status} to pending`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/hold — put invoice on hold -------------------------
router.post('/invoices/:id/hold', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const note = (req.body?.note || '').trim();
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (!['pending', 'approved'].includes(inv.status))
      return res.status(400).json({ error: `Cannot hold an invoice in status '${inv.status}'` });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'on_hold', rejection_note = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`, [invId, note || null]);
    await logInvoice(client, invId, 'on_hold', note ? `Put on hold: ${note}` : 'Put on hold', req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/bulk-approve -------------------------------------------
router.post('/invoices/bulk-approve', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    await client.query('BEGIN');
    let approved = 0;
    for (const id of ids) {
      const inv = await getInvoiceWithProject(id);
      if (!inv || inv.status !== 'pending') continue;
      if (!(await projects.userCanAccess(req.session.userId, inv.project_id))) continue;
      await client.query(
        `UPDATE invoices SET status = 'pm_approved', pm_approved_by = $2, pm_approved_at = NOW(),
           rejection_note = NULL, updated_at = NOW() WHERE id = $1`, [id, req.session.userId]);
      await logInvoice(client, id, 'pm_approved', `Bulk PM-approved $${Number(inv.amount).toFixed(2)}`, req.session.userId);
      approved++;
    }
    await client.query('COMMIT');
    res.json({ approved, total: ids.length });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/mark-pushed ----------------------------------------
router.post('/invoices/:id/mark-pushed', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (inv.status !== 'approved')
      return res.status(400).json({ error: 'Invoice must be approved before it can be pushed' });
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'pushed', qb_reference_id = COALESCE(qb_reference_id, 'DRY-' || id::text),
         updated_at = NOW() WHERE id = $1 RETURNING *`, [invId]);
    await logInvoice(client, invId, 'pushed', 'Marked as pushed to QB', req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /api/invoices/:id/mark-paid ------------------------------------------
router.post('/invoices/:id/mark-paid', requireAuth, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    if (!['approved', 'pushed'].includes(inv.status))
      return res.status(400).json({ error: 'Invoice must be approved/pushed before it can be marked paid' });
    const paidDate = req.body?.paid_date || null;
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE invoices SET status = 'paid', paid_date = COALESCE($2::date, CURRENT_DATE),
         updated_at = NOW() WHERE id = $1 RETURNING *`, [invId, paidDate]);
    await logInvoice(client, invId, 'paid', `Marked paid on ${result.rows[0].paid_date}`, req.session.userId);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// GET /api/contracts/:id/g703 ------------------------------------------------
// Full AIA G703 pay-application history for a contract.
// Returns: { contract, contract_lines (with cumulative totals), invoices (with per-invoice lines + previous_billed) }
router.get('/contracts/:id/g703', requireAuth, async (req, res, next) => {
  try {
    const contractId = Number(req.params.id);
    const contractRes = await pool.query('SELECT * FROM contracts WHERE id = $1', [contractId]);
    if (!contractRes.rows[0]) return res.status(404).json({ error: 'Not found' });
    const contract = contractRes.rows[0];
    if (!(await projects.userCanAccess(req.session.userId, contract.project_id)))
      return res.status(403).json({ error: 'Forbidden' });

    const [contractLinesRes, invoicesRes] = await Promise.all([
      pool.query(
        `SELECT cl.qb_code_id, cl.amount, qc.code, qc.name
         FROM contract_lines cl
         JOIN qb_codes qc ON qc.id = cl.qb_code_id
         WHERE cl.contract_id = $1
         ORDER BY qc.code`,
        [contractId]
      ),
      pool.query(
        `SELECT * FROM invoices
         WHERE contract_id = $1 AND status != 'rejected'
         ORDER BY invoice_date NULLS LAST, id`,
        [contractId]
      ),
    ]);

    const invoiceIds = invoicesRes.rows.map(i => i.id);
    let allLines = [];
    if (invoiceIds.length > 0) {
      const linesRes = await pool.query(
        `SELECT il.*, qc.code, qc.name AS qc_name, cl.amount AS contract_amount
         FROM invoice_lines il
         JOIN qb_codes qc ON qc.id = il.qb_code_id
         LEFT JOIN contract_lines cl ON cl.contract_id = $1 AND cl.qb_code_id = il.qb_code_id
         WHERE il.invoice_id = ANY($2::int[])
         ORDER BY il.invoice_id, qc.code`,
        [contractId, invoiceIds]
      );
      allLines = linesRes.rows;
    }

    // Process invoices in chronological order, tracking cumulative per code
    const cumulativeByCode = {};
    const invoicesWithLines = invoicesRes.rows.map(inv => {
      const invLines = allLines.filter(l => Number(l.invoice_id) === inv.id);
      const linesWithPrev = invLines.map(l => ({
        id: l.id, qb_code_id: l.qb_code_id,
        code: l.code, name: l.qc_name,
        contract_amount: Number(l.contract_amount) || 0,
        previous_billed: cumulativeByCode[l.qb_code_id] || 0,
        current_amount: Number(l.current_amount),
      }));
      for (const l of invLines) {
        cumulativeByCode[l.qb_code_id] = (cumulativeByCode[l.qb_code_id] || 0) + Number(l.current_amount);
      }
      return { ...inv, lines: linesWithPrev };
    });

    const contractLines = contractLinesRes.rows.map(cl => ({
      qb_code_id: cl.qb_code_id, code: cl.code, name: cl.name,
      contract_amount: Number(cl.amount),
      total_billed: cumulativeByCode[cl.qb_code_id] || 0,
      pct_complete: cl.amount > 0
        ? ((cumulativeByCode[cl.qb_code_id] || 0) / Number(cl.amount)) * 100
        : null,
    }));

    res.json({ contract, contract_lines: contractLines, invoices: invoicesWithLines });
  } catch (err) { next(err); }
});

// DELETE /api/invoices/:id — permanently remove an invoice and its line items.
router.delete('/invoices/:id', requireAuth, async (req, res, next) => {
  try {
    const invId = Number(req.params.id);
    const inv = await getInvoiceWithProject(invId);
    if (!inv) return res.status(404).json({ error: 'Not found' });
    if (!(await projects.userCanAccess(req.session.userId, inv.project_id)))
      return res.status(403).json({ error: 'Forbidden' });
    await pool.query('DELETE FROM invoices WHERE id = $1', [invId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
