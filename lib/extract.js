// Claude-powered PDF extraction for invoices AND contracts.
//
// extractInvoice(pdfBuffer)  -> { invoice_number, vendor_name, amount, invoice_date, summary }
// extractContract(pdfBuffer) -> { vendor_name, total_value, contract_date, reference_number, description }
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

Extract:
- invoice_number: the vendor's invoice number / reference as printed on the invoice
- vendor_name: the company issuing the invoice (the "from" / "remit to" party)
- amount: the total amount DUE, as a number (no currency symbol, no commas). Prefer final / balance due over subtotals.
- invoice_date: date of the invoice in YYYY-MM-DD. If only month+year, use the 1st. Empty string if not visible.
- summary: 1-2 sentence plain-English summary of what this invoice is for (scope, period, notable items).

Be conservative. Empty string (or 0 for amount) if a field is genuinely not present.`;

const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    invoice_number: { type: 'string' },
    vendor_name:    { type: 'string' },
    amount:         { type: 'number' },
    invoice_date:   { type: 'string' },
    summary:        { type: 'string' },
  },
  required: ['invoice_number', 'vendor_name', 'amount', 'invoice_date', 'summary'],
  additionalProperties: false,
};

async function extractInvoice(pdfBuffer) {
  const { data, usage } = await callClaude(
    INVOICE_SYSTEM, INVOICE_SCHEMA, pdfBuffer,
    'Extract the invoice details from this PDF.'
  );
  const rawDate = (data.invoice_date || '').trim();
  return {
    invoice_number: String(data.invoice_number || '').trim(),
    vendor_name:    String(data.vendor_name || '').trim(),
    amount:         Number(data.amount) || 0,
    invoice_date:   /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    summary:        String(data.summary || '').trim(),
    usage,
  };
}

// ---------------------------------------------------------------------------
// Contract extraction
// ---------------------------------------------------------------------------
const CONTRACT_SYSTEM = `You extract structured contract data from PDF documents for a real-estate / construction acquisitions financial manager.

Extract:
- vendor_name: the contracting party / vendor / subcontractor name
- total_value: the total contract amount as a number (no currency symbol, no commas). 0 if not found.
- contract_date: date of the contract in YYYY-MM-DD. Empty string if not visible.
- reference_number: contract number, PO number, or any reference identifier. Empty string if not found.
- description: 1-3 sentence plain-English summary of the scope of work, key terms, and any notable provisions.

Be conservative. Empty string (or 0 for total_value) if a field is genuinely not present.`;

const CONTRACT_SCHEMA = {
  type: 'object',
  properties: {
    vendor_name:      { type: 'string' },
    total_value:      { type: 'number' },
    contract_date:    { type: 'string' },
    reference_number: { type: 'string' },
    description:      { type: 'string' },
  },
  required: ['vendor_name', 'total_value', 'contract_date', 'reference_number', 'description'],
  additionalProperties: false,
};

async function extractContract(pdfBuffer) {
  const { data, usage } = await callClaude(
    CONTRACT_SYSTEM, CONTRACT_SCHEMA, pdfBuffer,
    'Extract the contract details from this PDF.'
  );
  const rawDate = (data.contract_date || '').trim();
  return {
    vendor_name:      String(data.vendor_name || '').trim(),
    total_value:      Number(data.total_value) || 0,
    contract_date:    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    reference_number: String(data.reference_number || '').trim(),
    description:      String(data.description || '').trim(),
    usage,
  };
}

module.exports = { extractInvoice, extractContract };
