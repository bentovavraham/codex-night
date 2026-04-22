// Claude-powered PDF extraction for invoices AND contracts.
//
// extractInvoice(pdfBuffer)  -> { invoice_number, vendor_name, amount, invoice_date, summary,
//                                 confidence: { invoice_number, vendor_name, amount, invoice_date } }
// extractContract(pdfBuffer) -> { vendor_name, total_value, contract_date, reference_number, description,
//                                 confidence: { vendor_name, total_value, contract_date, reference_number } }
//
// Each confidence value is "high" | "medium" | "low":
//   high   — found clearly and unambiguously in the document
//   medium — found but some uncertainty (e.g. multiple amounts, unclear formatting)
//   low    — guessed / inferred, not clearly stated; human must verify
//
// Uses Claude Opus 4.6 with structured outputs. PDFs sent as native
// document blocks via base64.

let anthropicClient = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set — PDF extraction disabled');
  }
  if (!anthropicClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic.default
      ? new Anthropic.default()
      : new Anthropic();
  }
  return anthropicClient;
}

async function callClaude(systemPrompt, schema, pdfBuffer, userText) {
  const c = client();
  const pdfBase64 = pdfBuffer.toString('base64');
  let response;
  try {
    response = await c.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: userText },
        ],
      }],
      output_config: {
        format: { type: 'json_schema', schema },
      },
    });
  } catch (err) {
    const detail = err?.error?.error?.message || err?.error?.message || err?.message || 'unknown error';
    console.error('Claude API error:', err?.status, detail, err?.error || '');
    throw new Error(`Claude API ${err?.status || ''}: ${detail}`);
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude response contained no text block');
  try {
    return { data: JSON.parse(textBlock.text), usage: response.usage };
  } catch {
    throw new Error(`Claude returned non-JSON: ${textBlock.text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Invoice extraction
// ---------------------------------------------------------------------------
const INVOICE_SYSTEM = `You extract structured invoice data from PDF documents for a real-estate / construction acquisitions financial manager.

Extract these fields and rate your confidence on each:
- invoice_number: the vendor's invoice number / reference as printed on the invoice
- vendor_name: the company issuing the invoice (the "from" / "remit to" party)
- amount: the total amount DUE, as a number (no currency symbol, no commas). Prefer final / balance due over subtotals.
- invoice_date: date of the invoice in YYYY-MM-DD. If only month+year, use the 1st. Empty string if not visible.
- summary: 1-2 sentence plain-English summary of what this invoice is for (scope, period, notable items).

For each field (except summary) also return a confidence rating:
- "high": found clearly and unambiguously in the document
- "medium": found but some uncertainty (multiple candidates, unclear formatting, partial info)
- "low": guessed or inferred — the human must verify this field

Be conservative. Empty string (or 0 for amount) if a field is genuinely not present.`;

const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    invoice_number:            { type: 'string' },
    invoice_number_confidence: { type: 'string', enum: ['high','medium','low'] },
    vendor_name:               { type: 'string' },
    vendor_name_confidence:    { type: 'string', enum: ['high','medium','low'] },
    amount:                    { type: 'number' },
    amount_confidence:         { type: 'string', enum: ['high','medium','low'] },
    invoice_date:              { type: 'string' },
    invoice_date_confidence:   { type: 'string', enum: ['high','medium','low'] },
    summary:                   { type: 'string' },
  },
  required: ['invoice_number','invoice_number_confidence','vendor_name','vendor_name_confidence',
             'amount','amount_confidence','invoice_date','invoice_date_confidence','summary'],
  additionalProperties: false,
};

async function extractInvoice(pdfBuffer, context = {}) {
  const { examples = [], vendorNotes = null } = context;
  let system = INVOICE_SYSTEM;
  if (vendorNotes) {
    system += `\n\n---\nKNOWN VENDOR CONTEXT (use to improve accuracy):\n${vendorNotes}`;
  }
  if (examples.length > 0) {
    system += '\n\n---\nPREVIOUS CONFIRMED EXTRACTIONS FROM THIS VENDOR:\n' +
      examples.map((e, i) => {
        const f = e.fields_json || e;
        return `[${i + 1}] Invoice# ${f.invoice_number} · $${f.amount} · Date ${f.invoice_date} · "${f.summary || ''}"`;
      }).join('\n');
  }
  const { data, usage } = await callClaude(
    system, INVOICE_SCHEMA, pdfBuffer,
    'Extract the invoice details from this PDF.'
  );
  const rawDate = (data.invoice_date || '').trim();
  return {
    invoice_number: String(data.invoice_number || '').trim(),
    vendor_name:    String(data.vendor_name || '').trim(),
    amount:         Number(data.amount) || 0,
    invoice_date:   /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    summary:        String(data.summary || '').trim(),
    confidence: {
      invoice_number: data.invoice_number_confidence || 'low',
      vendor_name:    data.vendor_name_confidence    || 'low',
      amount:         data.amount_confidence         || 'low',
      invoice_date:   data.invoice_date_confidence   || 'low',
    },
    usage,
  };
}

// ---------------------------------------------------------------------------
// Contract extraction
// ---------------------------------------------------------------------------
const CONTRACT_SYSTEM = `You extract structured contract data from PDF documents for a real-estate / construction acquisitions financial manager.

Extract these fields and rate your confidence on each:
- vendor_name: the contracting party / vendor / subcontractor name
- total_value: the total contract amount as a number (no currency symbol, no commas). 0 if not found.
- contract_date: date of the contract in YYYY-MM-DD. Empty string if not visible.
- reference_number: contract number, PO number, or any reference identifier. Empty string if not found.
- description: 1-3 sentence plain-English summary of the scope of work, key terms, and any notable provisions.

For each field (except description) also return a confidence rating:
- "high": found clearly and unambiguously in the document
- "medium": found but some uncertainty (multiple candidates, unclear formatting, partial info)
- "low": guessed or inferred — the human must verify this field

Be conservative. Empty string (or 0 for total_value) if a field is genuinely not present.`;

const CONTRACT_SCHEMA = {
  type: 'object',
  properties: {
    vendor_name:               { type: 'string' },
    vendor_name_confidence:    { type: 'string', enum: ['high','medium','low'] },
    total_value:               { type: 'number' },
    total_value_confidence:    { type: 'string', enum: ['high','medium','low'] },
    contract_date:             { type: 'string' },
    contract_date_confidence:  { type: 'string', enum: ['high','medium','low'] },
    reference_number:          { type: 'string' },
    reference_number_confidence: { type: 'string', enum: ['high','medium','low'] },
    description:               { type: 'string' },
  },
  required: ['vendor_name','vendor_name_confidence','total_value','total_value_confidence',
             'contract_date','contract_date_confidence','reference_number','reference_number_confidence','description'],
  additionalProperties: false,
};

async function extractContract(pdfBuffer, context = {}) {
  const { examples = [], vendorNotes = null } = context;
  let system = CONTRACT_SYSTEM;
  if (vendorNotes) {
    system += `\n\n---\nKNOWN VENDOR CONTEXT (use to improve accuracy):\n${vendorNotes}`;
  }
  if (examples.length > 0) {
    system += '\n\n---\nPREVIOUS CONFIRMED EXTRACTIONS FROM THIS VENDOR:\n' +
      examples.map((e, i) => {
        const f = e.fields_json || e;
        return `[${i + 1}] Ref# ${f.reference_number} · $${f.total_value} · Date ${f.contract_date} · "${f.description || ''}"`;
      }).join('\n');
  }
  const { data, usage } = await callClaude(
    system, CONTRACT_SCHEMA, pdfBuffer,
    'Extract the contract details from this PDF.'
  );
  const rawDate = (data.contract_date || '').trim();
  return {
    vendor_name:      String(data.vendor_name || '').trim(),
    total_value:      Number(data.total_value) || 0,
    contract_date:    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    reference_number: String(data.reference_number || '').trim(),
    description:      String(data.description || '').trim(),
    confidence: {
      vendor_name:      data.vendor_name_confidence      || 'low',
      total_value:      data.total_value_confidence      || 'low',
      contract_date:    data.contract_date_confidence    || 'low',
      reference_number: data.reference_number_confidence || 'low',
    },
    usage,
  };
}

// ---------------------------------------------------------------------------
// QB code suggestion
// ---------------------------------------------------------------------------
const SUGGEST_LINES_SYSTEM = `You are helping a real-estate acquisitions manager allocate a construction or professional-services contract to QuickBooks cost codes.

You will receive:
1. The contract PDF
2. The total contract value
3. A numbered list of available QB codes (ID, code, name)

Your job: suggest how the contract total should be split across one or more of those codes.

Return a JSON object with a "lines" array. Each entry must have:
- qb_code_id: integer ID from the provided list (must be exact)
- amount: dollar amount as a number (no symbols, no commas)
- confidence: "high" | "medium" | "low"
- reason: one short sentence explaining the match

Rules:
- All amounts must sum exactly to the contract total
- Prefer fewer lines — split only when the contract clearly spans multiple cost categories
- Only use IDs from the provided list — never invent codes
- If no code is a reasonable match, return an empty lines array`;

const SUGGEST_LINES_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          qb_code_id: { type: 'integer' },
          amount:     { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason:     { type: 'string' },
        },
        required: ['qb_code_id', 'amount', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

async function suggestContractLines(pdfBuffer, qbCodes, totalValue) {
  if (!qbCodes || qbCodes.length === 0) return [];
  const codeList = qbCodes.map(c => `ID ${c.id}: [${c.code}] ${c.name}`).join('\n');
  const { data } = await callClaude(
    SUGGEST_LINES_SYSTEM,
    SUGGEST_LINES_SCHEMA,
    pdfBuffer,
    `Contract total: $${totalValue}\n\nAvailable QB codes:\n${codeList}\n\nSuggest allocations.`
  );
  return (data.lines || []).filter(l => Number.isInteger(l.qb_code_id) && l.amount > 0);
}

// ---------------------------------------------------------------------------
// T&M Charge extraction
// ---------------------------------------------------------------------------
const TM_SYSTEM = `You extract structured time-and-material charge data from PDF documents (timesheets, work orders, daily reports) for a real-estate / construction acquisitions financial manager.

Extract these fields and rate your confidence on each:
- description: brief description of the work performed (1-2 sentences)
- hours: number of hours worked as a decimal number. 0 if not stated.
- rate: hourly billing rate in dollars as a number. 0 if not stated.
- amount: total billable amount as a number. If hours and rate are both present, verify amount = hours × rate. Prefer the explicitly stated total if given. 0 if not found.
- charge_date: date the work was performed in YYYY-MM-DD. Empty string if not visible.

For each field (except description) also return a confidence rating:
- "high": found clearly and unambiguously
- "medium": found but some uncertainty
- "low": guessed or inferred — the human must verify

Be conservative. 0 for numeric fields, empty string for dates, if genuinely not present.`;

const TM_SCHEMA = {
  type: 'object',
  properties: {
    description:            { type: 'string' },
    hours:                  { type: 'number' },
    hours_confidence:       { type: 'string', enum: ['high','medium','low'] },
    rate:                   { type: 'number' },
    rate_confidence:        { type: 'string', enum: ['high','medium','low'] },
    amount:                 { type: 'number' },
    amount_confidence:      { type: 'string', enum: ['high','medium','low'] },
    charge_date:            { type: 'string' },
    charge_date_confidence: { type: 'string', enum: ['high','medium','low'] },
  },
  required: ['description','hours','hours_confidence','rate','rate_confidence',
             'amount','amount_confidence','charge_date','charge_date_confidence'],
  additionalProperties: false,
};

async function extractTMCharge(pdfBuffer, context = {}) {
  const { examples = [], vendorNotes = null } = context;
  let system = TM_SYSTEM;
  if (vendorNotes) system += `\n\n---\nKNOWN VENDOR CONTEXT:\n${vendorNotes}`;
  if (examples.length > 0) {
    system += '\n\n---\nPREVIOUS CONFIRMED CHARGES FROM THIS VENDOR:\n' +
      examples.map((e, i) => {
        const f = e.fields_json || e;
        return `[${i + 1}] ${f.description || ''} · ${f.hours ? f.hours + 'h' : ''} · $${f.amount} · Date ${f.charge_date}`;
      }).join('\n');
  }
  const { data } = await callClaude(
    system, TM_SCHEMA, pdfBuffer,
    'Extract the time-and-material charge details from this document.'
  );
  const rawDate = (data.charge_date || '').trim();
  return {
    description:  String(data.description || '').trim(),
    hours:        Number(data.hours) || 0,
    rate:         Number(data.rate)  || 0,
    amount:       Number(data.amount) || 0,
    charge_date:  /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    confidence: {
      hours:       data.hours_confidence       || 'low',
      rate:        data.rate_confidence        || 'low',
      amount:      data.amount_confidence      || 'low',
      charge_date: data.charge_date_confidence || 'low',
    },
  };
}

// ---------------------------------------------------------------------------
// Expense / receipt extraction
// ---------------------------------------------------------------------------
const EXPENSE_SYSTEM = `You extract structured expense and receipt data from PDF documents for a real-estate / construction acquisitions financial manager.

Extract these fields and rate your confidence on each:
- amount: total amount on the receipt as a number (no currency symbol, no commas). 0 if not found.
- expense_date: date on the receipt in YYYY-MM-DD. Empty string if not visible.
- category: classify the expense as exactly one of: travel, tolls, food, hotel, copies, other
- description: 1-sentence plain-English description of what the expense was for.

For each field (except description) also return a confidence rating:
- "high": found clearly and unambiguously
- "medium": found but some uncertainty
- "low": guessed or inferred — the human must verify

Be conservative. 0 for amount, empty string for date, "other" for unknown categories, if genuinely not clear.`;

const EXPENSE_SCHEMA = {
  type: 'object',
  properties: {
    amount:                  { type: 'number' },
    amount_confidence:       { type: 'string', enum: ['high','medium','low'] },
    expense_date:            { type: 'string' },
    expense_date_confidence: { type: 'string', enum: ['high','medium','low'] },
    category:                { type: 'string', enum: ['travel','tolls','food','hotel','copies','other'] },
    category_confidence:     { type: 'string', enum: ['high','medium','low'] },
    description:             { type: 'string' },
  },
  required: ['amount','amount_confidence','expense_date','expense_date_confidence',
             'category','category_confidence','description'],
  additionalProperties: false,
};

async function extractExpense(pdfBuffer, context = {}) {
  const { examples = [], vendorNotes = null } = context;
  let system = EXPENSE_SYSTEM;
  if (vendorNotes) system += `\n\n---\nKNOWN VENDOR CONTEXT:\n${vendorNotes}`;
  if (examples.length > 0) {
    system += '\n\n---\nPREVIOUS CONFIRMED EXPENSES FROM THIS VENDOR:\n' +
      examples.map((e, i) => {
        const f = e.fields_json || e;
        return `[${i + 1}] ${f.category} · $${f.amount} · Date ${f.expense_date} · "${f.description || ''}"`;
      }).join('\n');
  }
  const { data } = await callClaude(
    system, EXPENSE_SCHEMA, pdfBuffer,
    'Extract the expense/receipt details from this document.'
  );
  const rawDate = (data.expense_date || '').trim();
  return {
    amount:       Number(data.amount) || 0,
    expense_date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    category:     data.category || 'other',
    description:  String(data.description || '').trim(),
    confidence: {
      amount:       data.amount_confidence       || 'low',
      expense_date: data.expense_date_confidence || 'low',
      category:     data.category_confidence     || 'low',
    },
  };
}

module.exports = { extractInvoice, extractContract, suggestContractLines, extractTMCharge, extractExpense };
