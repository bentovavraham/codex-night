// Claude-powered PDF invoice extraction.
//
// Call: extractInvoice(pdfBuffer) -> {
//   invoice_number, vendor_name, amount, invoice_date (YYYY-MM-DD or null),
//   summary (1-2 sentence description to drop into the notes field)
// }
//
// Uses Claude Opus 4.6 with structured outputs (output_config.format =
// json_schema). PDFs are sent as native document blocks via base64 — no
// separate OCR step needed.

let anthropicClient = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set — invoice extraction disabled');
  }
  if (!anthropicClient) {
    // Lazy-require so the server can boot even when the SDK isn't installed
    // in a dev environment that doesn't use this feature.
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic.default
      ? new Anthropic.default()
      : new Anthropic();
  }
  return anthropicClient;
}

const SYSTEM_PROMPT = `You extract structured invoice data from PDF documents for a real-estate / construction acquisitions financial manager.

You will be given a single invoice PDF. Extract:
- invoice_number: the vendor's invoice number / reference (as printed on the invoice)
- vendor_name: the name of the company issuing the invoice (the "from" / "remit to" party)
- amount: the total amount DUE on the invoice, as a number (no currency symbol, no commas). Prefer the final / balance due over any subtotals.
- invoice_date: the date of the invoice in YYYY-MM-DD format. If only a month and year are given, use the first of the month. If no date is visible, use null.
- summary: a 1-2 sentence plain-English summary of what this invoice is for (scope of work, time period, notable line items). This will be saved to the project's notes so keep it informative but concise.

Be conservative. If a field is genuinely not present on the document, return an empty string (or null for invoice_date / 0 for amount). Do not hallucinate values.`;

const SCHEMA = {
  type: 'object',
  properties: {
    invoice_number: { type: 'string', description: "Vendor's invoice number. Empty string if not found." },
    vendor_name:    { type: 'string', description: 'Issuing vendor / company name. Empty string if not found.' },
    amount:         { type: 'number', description: 'Total amount due. 0 if not found.' },
    invoice_date:   { type: ['string', 'null'], description: 'YYYY-MM-DD or null.' },
    summary:        { type: 'string', description: '1-2 sentence plain-English summary of the invoice.' },
  },
  required: ['invoice_number', 'vendor_name', 'amount', 'invoice_date', 'summary'],
  additionalProperties: false,
};

async function extractInvoice(pdfBuffer) {
  const c = client();
  const pdfBase64 = pdfBuffer.toString('base64');

  const response = await c.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        { type: 'text', text: 'Extract the invoice details from this PDF.' },
      ],
    }],
    output_config: {
      format: {
        type: 'json_schema',
        name: 'invoice_extraction',
        schema: SCHEMA,
      },
    },
  });

  // With json_schema output the model returns a single text block whose
  // content is the JSON document.
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude response contained no text block');

  let extracted;
  try {
    extracted = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(`Claude returned non-JSON output: ${textBlock.text.slice(0, 200)}`);
  }

  // Light normalization.
  const invoice_date = extracted.invoice_date || null;
  return {
    invoice_number: String(extracted.invoice_number || '').trim(),
    vendor_name:    String(extracted.vendor_name || '').trim(),
    amount:         Number(extracted.amount) || 0,
    invoice_date:   typeof invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(invoice_date) ? invoice_date : null,
    summary:        String(extracted.summary || '').trim(),
    usage:          response.usage,
  };
}

module.exports = { extractInvoice };
