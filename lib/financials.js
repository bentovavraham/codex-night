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

// Resolve phase_budget_line_id from (phaseId, qbAccountId).
// Returns null gracefully when no match exists.
async function resolvePbl(client, phaseId, qbAccountId) {
  if (!phaseId || !qbAccountId) return null;
  const r = await client.query(
    `SELECT id FROM phase_budget_lines WHERE phase_id = $1 AND qb_account_id = $2 LIMIT 1`,
    [phaseId, qbAccountId]
  );
  return r.rows[0]?.id ?? null;
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
    qb_account_id: headerGl,
    line_items: lineItems = [],
  } = data;

  if (!vendor_name) throw Object.assign(new Error('vendor_name required'), { status: 400 });
  if (!project_id)  throw Object.assign(new Error('project_id required'),  { status: 400 });

  // total_value is always the sum of line items — never trust the caller's header value.
  const total      = lineItems.length > 0
    ? lineItems.reduce((s, li) => s + (Number(li.budgeted_amount) || 0), 0)
    : (Number(total_value) || 0);
  const phaseIdNum = phase_id ? Number(phase_id) : null;

  const result = await client.query(
    `INSERT INTO contracts
       (project_id, phase_id, vendor_name, description, total_value,
        contract_date, reference_number, status, file_reference, source_batch, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10) RETURNING *`,
    [Number(project_id), phaseIdNum,
     vendor_name, description || null, total,
     contract_date || null, reference_number || null,
     file_reference || null, source_batch || null, userId]
  );
  const contractId = result.rows[0].id;

  if (lineItems.length > 0) {
    for (let i = 0; i < lineItems.length; i++) {
      const li          = lineItems[i];
      const qbAccountId = li.qb_account_id ? Number(li.qb_account_id) : null;
      if (!qbAccountId) throw Object.assign(new Error(`GL code required on line ${i + 1}`), { status: 400 });
      const explicitPbl = li.phase_budget_line_id ? Number(li.phase_budget_line_id) : null;
      const pblId       = explicitPbl ?? await resolvePbl(client, phaseIdNum, qbAccountId);
      const billingType = ['fixed', 'tm', 'expense'].includes(li.billing_type) ? li.billing_type : 'fixed';
      const amount      = Number(li.budgeted_amount) || 0;

      const cliRes = await client.query(
        `INSERT INTO contract_line_items
           (contract_id, billing_type, description, budgeted_amount, sort_order, phase_budget_line_id, qb_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [contractId, billingType, li.description || null, amount, i, pblId, qbAccountId]
      );

      await client.query(
        `INSERT INTO financial_allocations
           (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
            phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
         VALUES ('contract_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
        [contractId, cliRes.rows[0].id, phaseIdNum, qbAccountId, pblId,
         billingType, amount, pblId ? 'confirmed' : 'needs_review', userId]
      );
    }
  } else if (total > 0 && phaseIdNum && headerGl) {
    // No line items — single FA row for the contract total
    const pblId = await resolvePbl(client, phaseIdNum, Number(headerGl));
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('contract_line',$1,NULL,$2,$3,$4,'fixed',$5,$6,'explicit',$7)`,
      [contractId, phaseIdNum, Number(headerGl), pblId, total,
       pblId ? 'confirmed' : 'needs_review', userId]
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
    if (!li.qb_account_id) continue;
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('contract_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
      [contractId, li.id, phaseId, li.qb_account_id, li.phase_budget_line_id,
       li.billing_type, Number(li.budgeted_amount) || 0,
       li.phase_budget_line_id ? 'confirmed' : 'needs_review', userId]
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

  if (!project_id) throw Object.assign(new Error('project_id required'), { status: 400 });
  if (!phase_id)   throw Object.assign(new Error('phase_id required'),   { status: 400 });

  const phaseIdNum  = Number(phase_id);
  const invoiceType = ['fixed', 'tm', 'expense'].includes(invoiceTypeRaw) ? invoiceTypeRaw : 'fixed';
  const resolvedGl  = pm_validated_gl_id
    ? Number(pm_validated_gl_id)
    : (headerGl ? Number(headerGl) : null);

  // Amount is always the sum of line items — never trust the caller's header value.
  // If there are no line items, fall back to the passed amount (single-line invoice).
  const amt = lineItems.length > 0
    ? lineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0)
    : (Number(amount) || 0);

  const result = await client.query(
    `INSERT INTO invoices
       (project_id, phase_id, phase_budget_line_id, contract_id, vendor_name, invoice_number,
        amount, invoice_date, description, status, file_reference, invoice_type,
        qb_account_id, pm_validated_gl_id, qb_transaction_id, source_batch, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved',$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [Number(project_id), phaseIdNum,
     phase_budget_line_id ? Number(phase_budget_line_id) : null,
     contract_id ? Number(contract_id) : null,
     vendor_name || '', invoice_number || '',
     amt, invoice_date || null, description || null,
     file_reference || null, invoiceType,
     resolvedGl, resolvedGl,
     qb_transaction_id || null, source_batch || null, userId]
  );
  const invoiceId = result.rows[0].id;

  let wroteFA = false;

  if (lineItems.length > 0) {
    for (let i = 0; i < lineItems.length; i++) {
      const li      = lineItems[i];
      const liAmt   = Number(li.amount) || 0;
      if (!liAmt) continue;
      const liType  = ['fixed', 'tm', 'expense'].includes(li.billing_type) ? li.billing_type : invoiceType;
      const liPbl   = li.phase_budget_line_id != null ? Number(li.phase_budget_line_id) : null;

      // Derive GL from budget task when not explicitly set on the line
      let liGl = li.qb_account_id != null ? Number(li.qb_account_id) : null;
      if (!liGl && liPbl) {
        const blRow = await client.query(
          'SELECT qb_account_id FROM phase_budget_lines WHERE id=$1', [liPbl]
        );
        if (blRow.rows[0]?.qb_account_id) liGl = blRow.rows[0].qb_account_id;
      }

      const iliRes = await client.query(
        `INSERT INTO invoice_line_items
           (invoice_id, billing_type, description, person, line_date, hours, rate,
            amount, sort_order, qb_account_id, phase_budget_line_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [invoiceId, liType,
         li.description || null, li.person || null, li.line_date || null,
         li.hours != null ? Number(li.hours) : null,
         li.rate  != null ? Number(li.rate)  : null,
         liAmt, i, liGl, liPbl]
      );

      if (liGl) {
        await client.query(
          `INSERT INTO financial_allocations
             (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
              phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
           VALUES ('invoice_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
          [invoiceId, iliRes.rows[0].id, phaseIdNum, liGl, liPbl,
           liType, liAmt, liPbl ? 'confirmed' : 'needs_review', userId]
        );
        wroteFA = true;
      }
    }
  }

  // Fallback: no line items but header GL present — single FA row
  if (!wroteFA && resolvedGl) {
    const pblId = phase_budget_line_id ? Number(phase_budget_line_id) : null;
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('invoice_line',$1,NULL,$2,$3,$4,$5,$6,$7,'explicit',$8)`,
      [invoiceId, phaseIdNum, resolvedGl, pblId,
       invoiceType, amt, pblId ? 'confirmed' : 'needs_review', userId]
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
    let liGl = li.qb_account_id ?? null;
    // Derive GL from budget task when not set on the line
    if (!liGl && li.phase_budget_line_id) {
      const blRow = await client.query(
        'SELECT qb_account_id FROM phase_budget_lines WHERE id=$1', [li.phase_budget_line_id]
      );
      if (blRow.rows[0]?.qb_account_id) liGl = blRow.rows[0].qb_account_id;
    }
    if (!liGl || !Number(li.amount)) continue;
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('invoice_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
      [invoiceId, li.id, inv.phase_id, liGl, li.phase_budget_line_id,
       li.billing_type, Number(li.amount),
       li.phase_budget_line_id ? 'confirmed' : 'needs_review', userId]
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
      const pblId = inv.phase_budget_line_id ?? null;
      await client.query(
        `INSERT INTO financial_allocations
           (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
            phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
         VALUES ('invoice_line',$1,NULL,$2,$3,$4,$5,$6,$7,'explicit',$8)`,
        [invoiceId, inv.phase_id, resolvedGl, pblId,
         inv.invoice_type ?? 'fixed', fallbackAmt,
         pblId ? 'confirmed' : 'needs_review', userId]
      );
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
    let liGl = li.qb_account_id ?? null;
    if (!liGl && li.phase_budget_line_id) {
      const blRow = await client.query(
        'SELECT qb_account_id FROM phase_budget_lines WHERE id=$1', [li.phase_budget_line_id]
      );
      if (blRow.rows[0]?.qb_account_id) liGl = blRow.rows[0].qb_account_id;
    }
    if (!liGl || !Number(li.budgeted_amount)) continue;
    await client.query(
      `INSERT INTO financial_allocations
         (source_type, source_document_id, source_line_id, phase_id, qb_account_id,
          phase_budget_line_id, billing_type, amount, allocation_status, allocation_source, created_by)
       VALUES ('co_line',$1,$2,$3,$4,$5,$6,$7,$8,'explicit',$9)`,
      [coId, li.id, coRow.phase_id, liGl, li.phase_budget_line_id,
       li.billing_type ?? 'fixed', Number(li.budgeted_amount),
       li.phase_budget_line_id ? 'confirmed' : 'needs_review', userId]
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

module.exports = { createContract, createInvoice, syncContractFA, syncInvoiceFA, syncChangeOrderFA, resolvePbl };
