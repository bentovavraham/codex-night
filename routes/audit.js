const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../db/pool');
const { extractQbTransactions } = require('../lib/extract');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── helpers ───────────────────────────────────────────────────────────────────

function parseAmount(v) {
  if (v == null || v === '') return null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Excel serial number
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Normalise a column header for matching regardless of capitalisation/spacing
function norm(s) { return String(s || '').toLowerCase().replace(/[\s_\-\.]+/g, ''); }

// Find the value in a row for any of the candidate header names
function pick(row, headers, ...candidates) {
  for (const c of candidates) {
    const h = headers.find(h => norm(h) === norm(c));
    if (h !== undefined && row[h] !== undefined && row[h] !== '') return row[h];
  }
  return null;
}

// Compute recon_status for an invoice row vs its linked qb_transaction
function reconStatus(inv, txn) {
  if (!txn) return 'missing_in_qb';
  const amtMatch = Math.abs((inv.amount || 0) - (txn.amount || 0)) < 0.02;
  if (!amtMatch) return 'amount_mismatch';
  // GL mismatch: compare PM-validated code vs QB gl code (if PM has set one)
  if (inv.pm_validated_gl_code && txn.qb_gl_code &&
      inv.pm_validated_gl_code !== txn.qb_gl_code) return 'gl_mismatch';
  return 'matched';
}

// ── POST /api/phases/:phaseId/audit/qb-import ─────────────────────────────────
// Accept Excel (.xlsx/.xls/.csv) or PDF QB Transaction Report.
// Parses rows, inserts into qb_transactions, auto-matches invoices.
router.post('/:phaseId/audit/qb-import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const phaseId = Number(req.params.phaseId);
  const userId  = req.session?.userId;

  try {
    // Build a normalized array of row objects regardless of source format
    let normalizedRows;

    const isPdf = req.file.mimetype === 'application/pdf' ||
                  req.file.originalname?.toLowerCase().endsWith('.pdf');

    if (isPdf) {
      const { transactions } = await extractQbTransactions(req.file.buffer);
      if (!transactions.length) return res.status(400).json({ error: 'No transactions found in PDF' });
      // Map Claude output directly — already in the right shape
      normalizedRows = transactions.map(t => ({
        vendor:    t.vendor_name,
        refNum:    t.ref_number,
        memo:      t.memo,
        glCode:    t.qb_gl_code,
        glName:    t.qb_gl_name,
        qbProject: t.qb_project,
        txnDate:   t.txn_date,
        amount:    t.amount,
        paid:      t.paid_amount,
        balance:   t.open_balance,
        isPaid:    t.is_paid,
        rawRow:    t,
      }));
    } else {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) return res.status(400).json({ error: 'Spreadsheet is empty' });

      const headers = Object.keys(rows[0]);
      normalizedRows = rows.map(row => {
        const vendor    = pick(row, headers, 'Vendor', 'Vendor Name', 'Name', 'Payee');
        const refNum    = pick(row, headers, 'Ref No.', 'RefNo', 'Invoice Number', 'Num', 'Reference', 'Invoice #', 'Bill No');
        const memo      = pick(row, headers, 'Memo', 'Description', 'Memo/Description', 'Desc');
        const glCode    = pick(row, headers, 'Account', 'GL Code', 'Account Number', 'Acct');
        const glName    = pick(row, headers, 'Account Name', 'GL Name', 'Account Description');
        const qbProject = pick(row, headers, 'Customer', 'Job', 'Customer:Job', 'Project', 'Class');
        const txnDate   = parseDate(pick(row, headers, 'Date', 'Txn Date', 'Transaction Date', 'Invoice Date'));
        const amount    = parseAmount(pick(row, headers, 'Amount', 'Total', 'Original Amount', 'Billed'));
        const paid      = parseAmount(pick(row, headers, 'Paid Amount', 'Paid', 'Paid To Date', 'Amount Paid'));
        const balance   = parseAmount(pick(row, headers, 'Open Balance', 'Balance', 'Balance Due', 'Outstanding'));
        const isPaid    = balance != null ? Math.abs(balance) < 0.02 : (paid != null && amount != null && Math.abs(paid - amount) < 0.02);
        return { vendor, refNum, memo, glCode, glName, qbProject, txnDate, amount, paid, balance, isPaid, rawRow: row };
      });
    }

    let inserted = 0, skipped = 0, matched = 0;

    for (const r of normalizedRows) {
      const { vendor, refNum, memo, glCode, glName, qbProject, txnDate, amount, paid, balance, isPaid, rawRow } = r;

      if (!vendor && !refNum && !amount) { skipped++; continue; }

      const result = await pool.query(
        `INSERT INTO qb_transactions
           (phase_id, txn_date, vendor_name, ref_number, memo,
            qb_gl_code, qb_gl_name, qb_project,
            amount, paid_amount, open_balance, is_paid, raw_row, imported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (phase_id, vendor_name, ref_number, amount) DO NOTHING
         RETURNING id`,
        [phaseId, txnDate, String(vendor||'').trim(), String(refNum||'').trim(),
         String(memo||'').trim(), String(glCode||'').trim(), String(glName||'').trim(),
         String(qbProject||'').trim(), amount, paid || 0, balance, isPaid,
         JSON.stringify(rawRow), userId]
      );

      if (!result.rows.length) { skipped++; continue; }
      inserted++;
      const txnId = result.rows[0].id;

      // Auto-match: find an invoice in this phase with same ref_number
      if (refNum) {
        const matchRes = await pool.query(
          `UPDATE invoices i
              SET qb_transaction_id = $1,
                  recon_status = CASE
                    WHEN ABS(i.amount - $2) < 0.02 THEN 'matched'
                    ELSE 'amount_mismatch'
                  END
            FROM contracts c
            WHERE i.contract_id = c.id
              AND c.phase_id = $3
              AND i.invoice_number = $4
              AND i.qb_transaction_id IS NULL
           RETURNING i.id`,
          [txnId, amount, phaseId, String(refNum).trim()]
        );
        matched += matchRes.rowCount;
      }
    }

    res.json({ inserted, skipped, matched });
  } catch (e) {
    console.error('QB import error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/phases/:phaseId/audit ───────────────────────────────────────────
// Returns the audit table: invoices joined with their QB transaction match.
// Also returns QB transactions with no matched invoice (missing source).
router.get('/:phaseId/audit', async (req, res) => {
  const phaseId = Number(req.params.phaseId);
  try {
    // Matched invoices + their QB data
    const invoicesRes = await pool.query(
      `SELECT
         i.id,
         i.invoice_number,
         i.vendor_name,
         i.amount                     AS folder_amount,
         i.invoice_date,
         i.status,
         i.recon_status,
         i.pm_validated_gl_id,
         qa_pm.account_number         AS pm_validated_gl_code,
         qa_pm.full_name              AS pm_validated_gl_name,
         -- QB side
         qt.id                        AS qb_txn_id,
         qt.amount                    AS qb_amount,
         qt.qb_gl_code,
         qt.qb_gl_name,
         qt.qb_project,
         qt.is_paid,
         qt.paid_amount,
         qt.open_balance,
         qt.memo                      AS qb_memo,
         -- active GL on invoice lines
         qa_active.account_number     AS active_gl_code,
         qa_active.full_name          AS active_gl_name
       FROM invoices i
       LEFT JOIN contracts c    ON c.id = i.contract_id
       LEFT JOIN qb_transactions qt   ON qt.id = i.qb_transaction_id
       LEFT JOIN qb_accounts qa_pm    ON qa_pm.id = i.pm_validated_gl_id
       LEFT JOIN LATERAL (
         SELECT qa.account_number, qa.full_name
           FROM invoice_line_items ili
           JOIN qb_accounts qa ON qa.id = ili.qb_account_id
          WHERE ili.invoice_id = i.id
          LIMIT 1
       ) qa_active ON true
       WHERE (i.phase_id = $1 OR c.phase_id = $1)
       ORDER BY i.invoice_date DESC NULLS LAST, i.id DESC`,
      [phaseId]
    );

    // QB transactions with no matched invoice (missing source documents)
    const unmatched = await pool.query(
      `SELECT qt.*
         FROM qb_transactions qt
        WHERE qt.phase_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM invoices i
             WHERE i.qb_transaction_id = qt.id
          )
        ORDER BY qt.txn_date DESC NULLS LAST`,
      [phaseId]
    );

    // Totals
    const totals = await pool.query(
      `SELECT
         COALESCE(SUM(i.amount), 0)            AS total_folder,
         COALESCE(SUM(qt.amount), 0)           AS total_qb,
         COALESCE(SUM(qt.paid_amount), 0)      AS total_paid_qb,
         COALESCE(SUM(qt.open_balance), 0)     AS total_open_qb,
         COUNT(*) FILTER (WHERE i.recon_status = 'matched')         AS cnt_matched,
         COUNT(*) FILTER (WHERE i.recon_status = 'amount_mismatch') AS cnt_amount_mismatch,
         COUNT(*) FILTER (WHERE i.recon_status = 'gl_mismatch')     AS cnt_gl_mismatch,
         COUNT(*) FILTER (WHERE i.recon_status = 'missing_in_qb')   AS cnt_missing_qb,
         COUNT(*) FILTER (WHERE i.qb_transaction_id IS NULL)        AS cnt_unmatched
       FROM invoices i
       LEFT JOIN contracts c ON c.id = i.contract_id
       LEFT JOIN qb_transactions qt ON qt.id = i.qb_transaction_id
       WHERE (i.phase_id = $1 OR c.phase_id = $1)`,
      [phaseId]
    );

    res.json({
      invoices:         invoicesRes.rows,
      unmatched_qb:     unmatched.rows,
      totals:           totals.rows[0],
      has_qb_data:      unmatched.rows.length > 0 || invoicesRes.rows.some(r => r.qb_txn_id),
    });
  } catch (e) {
    console.error('Audit fetch error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/phases/:phaseId/audit/transaction-report ────────────────────────
// QB transactions as the spine. Each row carries its matched invoice if one exists.
router.get('/:phaseId/audit/transaction-report', async (req, res) => {
  const phaseId = Number(req.params.phaseId);
  try {
    const txns = await pool.query(
      `SELECT
         qt.id, qt.txn_date, qt.vendor_name, qt.ref_number, qt.memo,
         qt.qb_gl_code, qt.qb_gl_name, qt.qb_project,
         qt.amount::numeric         AS amount,
         qt.paid_amount::numeric    AS paid_amount,
         qt.open_balance::numeric   AS open_balance,
         qt.is_paid,
         i.id                       AS inv_id,
         i.invoice_number,
         i.amount::numeric          AS inv_amount,
         i.invoice_date,
         i.status                   AS inv_status,
         i.recon_status,
         qa.account_number          AS pm_gl_code,
         qa.full_name               AS pm_gl_name,
         qa.id                      AS pm_gl_id
       FROM qb_transactions qt
       LEFT JOIN invoices i    ON i.qb_transaction_id = qt.id
       LEFT JOIN qb_accounts qa ON qa.id = i.pm_validated_gl_id
       WHERE qt.phase_id = $1
       ORDER BY qt.vendor_name, qt.txn_date, qt.id`,
      [phaseId]
    );

    // Invoices confirmed but not linked to any QB transaction
    const orphans = await pool.query(
      `SELECT i.id, i.invoice_number, i.vendor_name,
              i.amount::numeric AS inv_amount, i.invoice_date,
              i.status, i.recon_status,
              qa.account_number AS pm_gl_code, qa.full_name AS pm_gl_name
         FROM invoices i
         LEFT JOIN qb_accounts qa ON qa.id = i.pm_validated_gl_id
        WHERE i.phase_id = $1 AND i.qb_transaction_id IS NULL
        ORDER BY i.vendor_name, i.invoice_date`,
      [phaseId]
    );

    const rows = txns.rows;
    const totalAmt    = rows.reduce((s, r) => s + Number(r.amount   || 0), 0);
    const verifiedAmt = rows.filter(r => r.inv_id).reduce((s, r) => s + Number(r.amount || 0), 0);
    const verified    = rows.filter(r => r.inv_id && r.recon_status === 'matched').length;
    const withInvoice = rows.filter(r => r.inv_id).length;

    res.json({
      transactions:    rows,
      orphan_invoices: orphans.rows,
      summary: {
        total:          rows.length,
        with_invoice:   withInvoice,
        verified:       verified,
        total_amount:   totalAmt,
        verified_amount: verifiedAmt,
      },
    });
  } catch (e) {
    console.error('Transaction report error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/invoices/:id/validate-gl ───────────────────────────────────────
// PM sets the correct GL code for an invoice. Triggers recon_status recompute.
router.post('/invoices/:id/validate-gl', async (req, res) => {
  const { gl_account_id } = req.body;
  const invoiceId = Number(req.params.id);
  try {
    // Recompute GL mismatch status
    const result = await pool.query(
      `UPDATE invoices i
          SET pm_validated_gl_id = $1,
              recon_status = CASE
                WHEN i.qb_transaction_id IS NULL THEN 'missing_in_qb'
                WHEN ABS(i.amount - qt.amount) >= 0.02 THEN 'amount_mismatch'
                WHEN $2 IS NOT NULL AND qt.qb_gl_code IS NOT NULL
                     AND qa.account_number != qt.qb_gl_code THEN 'gl_mismatch'
                ELSE 'matched'
              END
         FROM invoices i2
         LEFT JOIN qb_transactions qt ON qt.id = i2.qb_transaction_id
         LEFT JOIN qb_accounts qa     ON qa.id = $1
         WHERE i.id = $3 AND i2.id = $3
         RETURNING i.id, i.recon_status, i.pm_validated_gl_id`,
      [gl_account_id || null, gl_account_id || null, invoiceId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Invoice not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Validate GL error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/phases/:phaseId/audit/correction-report ─────────────────────────
// CSV export of all discrepancies for Carla.
router.get('/:phaseId/audit/correction-report', async (req, res) => {
  const phaseId = Number(req.params.phaseId);
  try {
    const result = await pool.query(
      `SELECT
         i.invoice_number                     AS "Invoice #",
         i.vendor_name                        AS "Vendor",
         i.amount                             AS "Folder Amount",
         qt.amount                            AS "QB Amount",
         qt.qb_gl_code                        AS "QB GL Code",
         qt.qb_gl_name                        AS "QB GL Name",
         qa_pm.account_number                 AS "PM Correct Code",
         qa_pm.full_name                      AS "PM Correct Name",
         CASE WHEN qt.id IS NULL THEN 'Missing in QB'
              WHEN ABS(i.amount - qt.amount) >= 0.02 THEN 'Amount Mismatch'
              WHEN qa_pm.account_number IS NOT NULL
                   AND qt.qb_gl_code IS NOT NULL
                   AND qa_pm.account_number != qt.qb_gl_code THEN 'Wrong GL Code'
              ELSE 'OK'
         END                                  AS "Issue",
         qt.is_paid                           AS "Paid in QB",
         qt.open_balance                      AS "QB Open Balance",
         (i.amount - COALESCE(qt.paid_amount,0)) AS "Folder Balance"
       FROM invoices i
       JOIN contracts c ON c.id = i.contract_id
       LEFT JOIN qb_transactions qt ON qt.id = i.qb_transaction_id
       LEFT JOIN qb_accounts qa_pm  ON qa_pm.id = i.pm_validated_gl_id
       WHERE c.phase_id = $1
         AND (qt.id IS NULL
              OR ABS(i.amount - qt.amount) >= 0.02
              OR (qa_pm.account_number IS NOT NULL AND qt.qb_gl_code IS NOT NULL
                  AND qa_pm.account_number != qt.qb_gl_code))
       ORDER BY i.vendor_name, i.invoice_date`,
      [phaseId]
    );

    const headers = result.fields.map(f => f.name);
    const lines = [
      headers.join(','),
      ...result.rows.map(r =>
        headers.map(h => {
          const v = r[h] ?? '';
          return String(v).includes(',') ? `"${v}"` : v;
        }).join(',')
      )
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="correction-report-phase${phaseId}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) {
    console.error('Correction report error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
