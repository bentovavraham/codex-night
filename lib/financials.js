'use strict';

/**
 * Single source of truth for creating financial documents.
 *
 * All routes that create a contract must call createContract().
 * All routes that create an invoice must call createInvoice().
 *
 * Both functions expect a pg client already inside a BEGIN transaction.
 * The caller owns BEGIN / COMMIT / ROLLBACK — these functions never commit.
 * FA rows are written in the same transaction as the source document.
 */

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function parseMoney(value, field, { required = false, allowZero = true } = {}) {
  if (value == null || value === '') {
    if (required) fail(`${field} required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${field} must be a valid number`);
  if (n < 0) fail(`${field} cannot be negative`);
  if (!allowZero && n <= 0) fail(`${field} must be greater than 0`);
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 0.0001) fail(`${field} cannot have more than 2 decimal places`);
  return cents / 100;
}

function parseDate(value, field) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(`${field} must be YYYY-MM-DD`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    fail(`${field} must be a real calendar date`);
  }
  return s;
}

// Resolve phase_budget_line_id from (phaseId, qbAccountId).
// Returns a row only when the GL maps to exactly one task in the phase. Ambiguous
// GLs must be assigned by a human so accounting rows do not land on the wrong task.
async function resolvePbl(client, phaseId, qbAccountId) {
  if (!phaseId || !qbAccountId) return null;
  const r = await client.query(
    `SELECT id FROM phase_budget_lines WHERE phase_id = $1 AND qb_account_id = $2 ORDER BY id`,
    [phaseId, qbAccountId]
  );
  return r.rows.length === 1 ? r.rows[0].id : null;
}

async function resolveAllocationTarget(client, phaseId, qbAccountId, phaseBudgetLineId, label) {
  const phaseIdNum = phaseId ? Number(phaseId) : null;
  if (!phaseIdNum) fail(`${label}: phase_id required`);

  let qbId = qbAccountId != null && qbAccountId !== '' ? Number(qbAccountId) : null;
  let pblId = phaseBudgetLineId != null && phaseBudgetLineId !== '' ? Number(phaseBudgetLineId) : null;
  if (qbId != null && !Number.isInteger(qbId)) fail(`${label}: GL account is invalid`);
  if (pblId != null && !Number.isInteger(pblId)) fail(`${label}: budget task is invalid`);

  if (pblId != null) {
    const r = await client.query(
      `SELECT id, phase_id, qb_account_id
       FROM phase_budget_lines
       WHERE id = $1`,
      [pblId]
    );
    const row = r.rows[0];
    if (!row) fail(`${label}: budget task not found`);
    if (Number(row.phase_id) !== phaseIdNum) fail(`${label}: budget task does not belong to this phase`);
    if (!row.qb_account_id) fail(`${label}: selected budget task has no GL account`);
    if (qbId != null && Number(row.qb_account_id) !== qbId) {
      fail(`${label}: GL account does not match selected budget task`);
    }
    return { qbAccountId: Number(row.qb_account_id), phaseBudgetLineId: Number(row.id) };
  }

  if (qbId == null) fail(`${label}: GL account and budget task are required`);

  const matches = await client.query(
    `SELECT id FROM phase_budget_lines WHERE phase_id = $1 AND qb_account_id = $2 ORDER BY id`,
    [phaseIdNum, qbId]
  );
  if (matches.rows.length === 0) fail(`${label}: no budget task exists for this GL account in this phase`);
  if (matches.rows.length > 1) fail(`${label}: this GL account maps to multiple budget tasks; choose the exact task`);
  return { qbAccountId: qbId, phaseBudgetLineId: Number(matches.rows[0].id) };
}

/**
 * Create a contract + line items + FA rows.
 *
 * data shape:
 *   project_id, phase_id, vendor_name, description, total_value,
 *   contract_date, reference_number, file_reference, source_batch,
 *   qb_account_id          — header-level GL (used only when line_items is empty)
 *   line_items[]           — { billing_type, description, budgeted_amount,
 *                               qb_account_id, phase_budget_line_id }
 *
 * Returns { contractId, contract: row }
 */
async function createContract(client, data, userId) {
  const {
    project_id, phase_id, vendor_name, description, total_value,
    contract_date, reference_number, file_reference, source_batch,
    phase_budget_line_id: headerPbl,
    qb_account_id: headerGl,
    line_items: lineItems = [],
  } = data;

  if (!vendor_name) fail('vendor_name required');
  if (!project_id) fail('project_id required');

  // total_value is always the sum of line items — never trust the caller's header value.
  const normalizedLines = lineItems.map((li, i) => {
    const billingType = ['fixed', 'tm', 'expense'].includes(li.billing_type) ? li.billing_type : 'fixed';
    const amount = parseMoney(li.budgeted_amount, `contract line ${i + 1} amount`, {
      required: billingType !== 'tm',
      allowZero: billingType === 'tm',
    }) ?? 0;
    if (billingType !== 'tm' && amount <= 0) fail(`contract line ${i + 1} amount must be greater than 0`);
    if (!String(li.description || '').trim()) fail(`contract line ${i + 1} description required`);
    return { ...li, billing_type: billingType, budgeted_amount: amount };
  });
  const total = normalizedLines.length > 0
    ? normalizedLines.reduce((s, li) => s + li.budgeted_amount, 0)
    : (parseMoney(total_value, 'total_value', { required: true, allowZero: false }) ?? 0);
  const phaseIdNum = phase_id ? Number(phase_id) : null;
  parseDate(contract_date, 'contract_date');

  const result = await client.query(
    `INSERT INTO contracts
       (project_id, phase_id, phase_budget_line_id, vendor_name, description, total_value,
        contract_date, reference_number, status, file_reference, source_batch, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$11) RETURNING *`,
    [Number(project_id), phaseIdNum,
     headerPbl ? Number(headerPbl) : null,
     vendor_name, description || null, total,
     parseDate(contract_date, 'contract_date'), reference_number || null,
     file_reference || null, source_batch || null, userId]
  );
  const contractId = result.rows[0].id;

  if (normalizedLines.length > 0) {
    for (let i = 0; i < normalizedLines.length; i++) {
      const li = normalizedLines[i];
      const target = await resolveAllocationTarget(
        client,
        phaseIdNum,
        li.qb_account_id ?? null,
        li.phase_budget_line_id ?? null,
        `contract line ${i + 1}`
      );

      const cliRes = await client.query(
        `INSERT INTO contract_line_items
           (contract_id, billing_type, description, budgeted_amount, sort_order, phase_budget_line_id, qb_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [contractId, li.billing_type, li.description || null, li.budgeted_amount, i,
         target.phaseBudgetLineId, target.qbAccountId]
      );

      await client.query(
        `INSERT INTO financial_allocations
           (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
            phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
         VALUES ('contract_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
        [contractId, cliRes.rows[0].id, phaseIdNum, target.qbAccountId, target.phaseBudgetLineId,
         li.billing_type, li.budgeted_amount, 'confirmed', userId]
      );
    }
  } else if (total > 0) {
    // No line items — single FA row for the contract total
    const target = await resolveAllocationTarget(client, phaseIdNum, headerGl, headerPbl ?? null, 'contract');
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('contract_line',$1,NULL,$2,$3,$4,'fixed',$5,$6,'explicit',$7)`,
      [contractId, phaseIdNum, target.qbAccountId, target.phaseBudgetLineId, total,
       'confirmed', userId]
    );
  }

  await client.query(
    `INSERT INTO contract_logs (contract_id, action, detail, changed_by)
     VALUES ($1,'created',$2,$3)`,
    [contractId, `Created: ${vendor_name} for $${total}`, userId]
  );

  return { contractId, contract: result.rows[0] };
}

/**
 * Sync FA rows after a contract's line items are replaced (PUT /contracts/:id).
 * Voids all existing FA rows for the contract then rewrites from current line items.
 *
 * Must be called inside the same transaction as the line-item replace.
 */
async function syncContractFA(client, contractId, phaseId, userId) {
  await client.query(
    `UPDATE financial_allocations
     SET allocation_status = 'voided', updated_at = NOW()
     WHERE source_type = 'contract_line' AND source_document_id = $1
       AND allocation_status != 'voided'`,
    [contractId]
  );

  const lines = (await client.query(
    `SELECT id, qb_account_id, phase_budget_line_id, billing_type, budgeted_amount
     FROM contract_line_items WHERE contract_id = $1 ORDER BY sort_order`,
    [contractId]
  )).rows;

  for (const li of lines) {
    const target = await resolveAllocationTarget(
      client,
      phaseId,
      li.qb_account_id ?? null,
      li.phase_budget_line_id ?? null,
      `contract line ${li.id}`
    );
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('contract_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
      [contractId, li.id, phaseId, target.qbAccountId, target.phaseBudgetLineId,
       li.billing_type, parseMoney(li.budgeted_amount, `contract line ${li.id} amount`) ?? 0,
       'confirmed', userId]
    );
  }
}

/**
 * Create an invoice + line items + FA rows.
 *
 * data shape:
 *   project_id, phase_id, vendor_name, invoice_number, amount,
 *   invoice_date, description, file_reference, invoice_type,
 *   source_batch, qb_account_id, qb_transaction_id, pm_validated_gl_id,
 *   contract_id            — primary contract (optional)
 *   phase_budget_line_id   — header-level task (optional)
 *   line_items[]           — { billing_type, description, amount, qb_account_id,
 *                               phase_budget_line_id, person, hours, rate, line_date }
 *
 * Returns { invoiceId, invoice: row }
 */
async function createInvoice(client, data, userId) {
  const {
    project_id, phase_id, vendor_name, invoice_number, amount,
    invoice_date, description, file_reference,
    invoice_type: invoiceTypeRaw,
    source_batch, qb_account_id: headerGl,
    qb_transaction_id, pm_validated_gl_id,
    contract_id, phase_budget_line_id,
    line_items: lineItems = [],
  } = data;

  if (!project_id) fail('project_id required');
  if (!phase_id) fail('phase_id required');

  const phaseIdNum  = Number(phase_id);
  const invoiceType = ['fixed', 'tm', 'expense'].includes(invoiceTypeRaw) ? invoiceTypeRaw : 'fixed';
  let resolvedGl  = pm_validated_gl_id
    ? Number(pm_validated_gl_id)
    : (headerGl ? Number(headerGl) : null);
  let resolvedHeaderPbl = phase_budget_line_id ? Number(phase_budget_line_id) : null;

  // Amount is always the sum of line items — never trust the caller's header value.
  // If there are no line items, fall back to the passed amount (single-line invoice).
  const normalizedLines = lineItems.map((li, i) => {
    const liAmt = parseMoney(li.amount, `invoice line ${i + 1} amount`, { required: true, allowZero: false }) ?? 0;
    if (!String(li.description || '').trim()) fail(`invoice line ${i + 1} description required`);
    return {
      ...li,
      billing_type: ['fixed', 'tm', 'expense'].includes(li.billing_type) ? li.billing_type : invoiceType,
      amount: liAmt,
    };
  });

  const headerAmount = parseMoney(amount, 'invoice amount', {
    required: normalizedLines.length === 0,
    allowZero: false,
  });
  const amt = normalizedLines.length > 0
    ? normalizedLines.reduce((s, li) => s + li.amount, 0)
    : (headerAmount ?? 0);
  if (normalizedLines.length > 0 && headerAmount != null && Math.abs(headerAmount - amt) > 0.01) {
    fail(`invoice amount (${headerAmount.toFixed(2)}) must equal line item total (${amt.toFixed(2)})`);
  }
  parseDate(invoice_date, 'invoice_date');

  let headerTarget = null;
  if (normalizedLines.length === 0) {
    headerTarget = await resolveAllocationTarget(client, phaseIdNum, resolvedGl, resolvedHeaderPbl, 'invoice');
    resolvedGl = headerTarget.qbAccountId;
    resolvedHeaderPbl = headerTarget.phaseBudgetLineId;
  }

  const result = await client.query(
    `INSERT INTO invoices
       (project_id, phase_id, phase_budget_line_id, contract_id, vendor_name, invoice_number,
        amount, invoice_date, description, status, file_reference, invoice_type,
        qb_account_id, pm_validated_gl_id, qb_transaction_id, source_batch, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [Number(project_id), phaseIdNum,
     resolvedHeaderPbl,
     contract_id ? Number(contract_id) : null,
     vendor_name || '', invoice_number || '',
     amt, parseDate(invoice_date, 'invoice_date'), description || null,
     file_reference || null, invoiceType,
     resolvedGl, resolvedGl,
     qb_transaction_id || null, source_batch || null, userId]
  );
  const invoiceId = result.rows[0].id;

  let wroteFA = false;

  if (normalizedLines.length > 0) {
    for (let i = 0; i < normalizedLines.length; i++) {
      const li = normalizedLines[i];
      const target = await resolveAllocationTarget(
        client,
        phaseIdNum,
        li.qb_account_id ?? null,
        li.phase_budget_line_id ?? null,
        `invoice line ${i + 1}`
      );

      const iliRes = await client.query(
        `INSERT INTO invoice_line_items
           (invoice_id, billing_type, description, person, line_date, hours, rate,
            amount, sort_order, qb_account_id, phase_budget_line_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [invoiceId, li.billing_type,
         li.description || null, li.person || null, li.line_date || null,
         li.hours != null ? Number(li.hours) : null,
         li.rate  != null ? Number(li.rate)  : null,
         li.amount, i, target.qbAccountId, target.phaseBudgetLineId]
      );

      await client.query(
        `INSERT INTO financial_allocations
           (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
            phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
         VALUES ('invoice_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
        [invoiceId, iliRes.rows[0].id, phaseIdNum, target.qbAccountId, target.phaseBudgetLineId,
         li.billing_type, li.amount, 'confirmed', userId]
      );
      wroteFA = true;
    }
  }

  // Fallback: no line items but header GL present — single FA row
  if (!wroteFA) {
    const target = headerTarget ?? await resolveAllocationTarget(client, phaseIdNum, resolvedGl, resolvedHeaderPbl, 'invoice');
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('invoice_line',$1,NULL,$2,$3,$4,$5,$6,$7,'explicit',$8)`,
      [invoiceId, phaseIdNum, target.qbAccountId, target.phaseBudgetLineId,
       invoiceType, amt, 'confirmed', userId]
    );
  }

  await client.query(
    `INSERT INTO invoice_logs (invoice_id, action, detail, changed_by)
     VALUES ($1,'created',$2,$3)`,
    [invoiceId,
     `Created: ${invoice_number || '(no number)'} for $${amt.toFixed(2)} from ${vendor_name || '(unknown)'}`,
     userId]
  );

  return { invoiceId, invoice: result.rows[0] };
}

/**
 * Sync FA rows after an invoice's line items are replaced (PUT /invoices/:id).
 * Voids all existing FA rows for the invoice then rewrites from current line items.
 *
 * Must be called inside the same transaction as the line-item replace.
 */
async function syncInvoiceFA(client, invoiceId, userId) {
  await client.query(
    `UPDATE financial_allocations
     SET allocation_status = 'voided', updated_at = NOW()
     WHERE source_type = 'invoice_line' AND source_document_id = $1
       AND allocation_status != 'voided'`,
    [invoiceId]
  );

  const inv = (await client.query(
    `SELECT phase_id, qb_account_id, pm_validated_gl_id, phase_budget_line_id, invoice_type, amount
     FROM invoices WHERE id = $1`,
    [invoiceId]
  )).rows[0];
  if (!inv) return;

  const lines = (await client.query(
    `SELECT id, qb_account_id, phase_budget_line_id, billing_type, amount
     FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order, id`,
    [invoiceId]
  )).rows;

  let wroteFA = false;
  for (const li of lines) {
    const lineAmount = parseMoney(li.amount, `invoice line ${li.id} amount`) ?? 0;
    if (!lineAmount) continue;
    const target = await resolveAllocationTarget(
      client,
      inv.phase_id,
      li.qb_account_id ?? null,
      li.phase_budget_line_id ?? null,
      `invoice line ${li.id}`
    );
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('invoice_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
      [invoiceId, li.id, inv.phase_id, target.qbAccountId, target.phaseBudgetLineId,
       li.billing_type, lineAmount, 'confirmed', userId]
    );
    wroteFA = true;
  }

  // Keep invoices.amount in sync with the sum of its line items.
  const lineSum = lines.reduce((s, li) => s + (Number(li.amount) || 0), 0);
  if (lines.length > 0) {
    await client.query(
      `UPDATE invoices SET amount = $1 WHERE id = $2`,
      [lineSum, invoiceId]
    );
  }

  // Fallback: no line items with GL — use invoice header GL
  if (!wroteFA) {
    const resolvedGl = inv.pm_validated_gl_id ?? inv.qb_account_id ?? null;
    const fallbackAmt = lines.length > 0 ? lineSum : Number(inv.amount);
    if (resolvedGl && fallbackAmt) {
      const target = await resolveAllocationTarget(
        client,
        inv.phase_id,
        resolvedGl,
        inv.phase_budget_line_id ?? null,
        `invoice ${invoiceId}`
      );
      await client.query(
        `INSERT INTO financial_allocations
           (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
            phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
         VALUES ('invoice_line',$1,NULL,$2,$3,$4,$5,$6,$7,'explicit',$8)`,
        [invoiceId, inv.phase_id, target.qbAccountId, target.phaseBudgetLineId,
         inv.invoice_type ?? 'fixed', fallbackAmt,
         'confirmed', userId]
      );
    } else if (fallbackAmt) {
      fail(`invoice ${invoiceId}: GL account and budget task are required`);
    }
  }
}

/**
 * Sync FA rows after a change order is created or updated.
 * Voids all existing FA rows for the CO then rewrites from current line items.
 *
 * Must be called inside the same transaction as the CO write.
 */
async function syncChangeOrderFA(client, coId, userId) {
  const coRow = (await client.query(
    `SELECT co.id, co.amount, c.phase_id
     FROM change_orders co JOIN contracts c ON c.id = co.contract_id
     WHERE co.id = $1`,
    [coId]
  )).rows[0];
  if (!coRow) return;

  await client.query(
    `UPDATE financial_allocations
     SET allocation_status = 'voided', updated_at = NOW()
     WHERE source_type = 'co_line' AND source_document_id = $1
       AND allocation_status != 'voided'`,
    [coId]
  );

  const lines = (await client.query(
    `SELECT id, qb_account_id, phase_budget_line_id, billing_type, budgeted_amount
     FROM change_order_line_items WHERE change_order_id = $1 ORDER BY sort_order, id`,
    [coId]
  )).rows;

  let wroteFA = false;
  for (const li of lines) {
    const lineAmount = parseMoney(li.budgeted_amount, `change order line ${li.id} amount`) ?? 0;
    if (!lineAmount) continue;
    const target = await resolveAllocationTarget(
      client,
      coRow.phase_id,
      li.qb_account_id ?? null,
      li.phase_budget_line_id ?? null,
      `change order line ${li.id}`
    );
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('co_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
      [coId, li.id, coRow.phase_id, target.qbAccountId, target.phaseBudgetLineId,
       li.billing_type ?? 'fixed', lineAmount, 'confirmed', userId]
    );
    wroteFA = true;
  }

  // Fallback: no GL-tagged line items — write one FA row against the contract's
  // primary budget line (if the contract has exactly one confirmed FA row).
  if (!wroteFA && Number(coRow.amount)) {
    const contractFa = (await client.query(
      `SELECT fa.qb_account_id, fa.phase_budget_line_id
       FROM financial_allocations fa
       JOIN change_orders co ON co.contract_id = (
         SELECT contract_id FROM change_orders WHERE id = $1
       )
       WHERE fa.source_type = 'contract_line'
         AND fa.source_document_id = (
           SELECT contract_id FROM change_orders WHERE id = $1
         )
         AND fa.allocation_status IN ('confirmed','approved')
       LIMIT 1`,
      [coId]
    )).rows[0];

    if (contractFa?.qb_account_id) {
      await client.query(
        `INSERT INTO financial_allocations
           (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
            phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
         VALUES ('co_line',$1,NULL,$2,$3,$4,'fixed',$5,$6,'explicit',$7)`,
        [coId, coRow.phase_id, contractFa.qb_account_id, contractFa.phase_budget_line_id,
         Number(coRow.amount),
         contractFa.phase_budget_line_id ? 'confirmed' : 'needs_review', userId]
      );
    }
  }
}

module.exports = {
  createContract,
  createInvoice,
  syncContractFA,
  syncInvoiceFA,
  syncChangeOrderFA,
  resolvePbl,
  _test: { parseMoney, parseDate, resolveAllocationTarget },
};
