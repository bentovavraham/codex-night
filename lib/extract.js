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
      max_tokens: 8192,
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

Also extract:
- project_clues: any project name, site address, client name, job number, or property reference visible on the invoice that indicates which real-estate project this invoice is for. Concatenate all clues into one string. Empty string if nothing found.

Extract these HEADER fields and rate your confidence on each:
- invoice_number: the vendor's invoice number / reference as printed on the invoice
- vendor_name: the company issuing the invoice (the "from" / "remit to" party)
- amount: the total amount DUE, as a number (no currency symbol, no commas). Prefer final / balance due over subtotals.
- invoice_date: date of the invoice in YYYY-MM-DD. If only month+year, use the 1st. Empty string if not visible.
- services_thru_date: the period-end or "services through" date in YYYY-MM-DD, if stated. Empty string if not present.
- summary: 1-2 sentence plain-English summary of what this invoice is for (scope, period, notable items).

Also extract ALL LINE ITEMS from the invoice body. CRITICAL RULES for line items:
1. Each dated row in the invoice = its own line item. Never collapse multiple dates into one line.
2. If the same date has multiple persons or activities, create a separate line for each.
3. billing_type per line:
   - "tm" for hourly/time-and-material entries (has hours × rate = amount)
   - "expense" for reimbursable costs (receipts, mileage, materials at cost)
   - "fixed" for flat fees, lump-sum tasks, or retainers
4. description: include person name + activity, e.g. "John J Jahr - prep overlay maps requested by clerk"
5. amount: dollar amount for this line as a number
6. For T&M entries also include: person (name only, no title), line_date (YYYY-MM-DD), hours (decimal), rate (hourly rate as number)

For each header field (except summary and services_thru_date) also return a confidence rating:
- "high": found clearly and unambiguously in the document
- "medium": found but some uncertainty (multiple candidates, unclear formatting, partial info)
- "low": guessed or inferred — the human must verify this field

Be conservative. Empty string (or 0 for amount) if a field is genuinely not present. Return empty array for line_items if none found.`;

const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    project_clues:             { type: 'string' },
    invoice_number:            { type: 'string' },
    invoice_number_confidence: { type: 'string', enum: ['high','medium','low'] },
    vendor_name:               { type: 'string' },
    vendor_name_confidence:    { type: 'string', enum: ['high','medium','low'] },
    amount:                    { type: 'number' },
    amount_confidence:         { type: 'string', enum: ['high','medium','low'] },
    invoice_date:              { type: 'string' },
    invoice_date_confidence:   { type: 'string', enum: ['high','medium','low'] },
    services_thru_date:        { type: 'string' },
    summary:                   { type: 'string' },
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          billing_type:  { type: 'string', enum: ['fixed','tm','expense'] },
          description:   { type: 'string' },
          person:        { type: 'string' },
          line_date:     { type: 'string' },
          hours:         { type: 'number' },
          rate:          { type: 'number' },
          amount:        { type: 'number' },
        },
        required: ['billing_type','description','amount'],
        additionalProperties: false,
      },
    },
  },
  required: ['invoice_number','invoice_number_confidence','vendor_name','vendor_name_confidence',
             'amount','amount_confidence','invoice_date','invoice_date_confidence',
             'services_thru_date','summary','line_items','project_clues'],
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
  const rawDate    = (data.invoice_date     || '').trim();
  const rawThru    = (data.services_thru_date || '').trim();
  const line_items = (data.line_items || []).map(li => ({
    billing_type: li.billing_type || 'fixed',
    description:  String(li.description || '').trim(),
    person:       li.person     ? String(li.person).trim() : null,
    line_date:    li.line_date  && /^\d{4}-\d{2}-\d{2}$/.test(li.line_date.trim()) ? li.line_date.trim() : null,
    hours:        li.hours  != null ? Number(li.hours)  : null,
    rate:         li.rate   != null ? Number(li.rate)   : null,
    amount:       Number(li.amount) || 0,
  }));
  return {
    invoice_number:     String(data.invoice_number || '').trim(),
    vendor_name:        String(data.vendor_name    || '').trim(),
    amount:             Number(data.amount) || 0,
    invoice_date:       /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    services_thru_date: /^\d{4}-\d{2}-\d{2}$/.test(rawThru) ? rawThru : null,
    summary:            String(data.summary || '').trim(),
    line_items,
    confidence: {
      invoice_number: data.invoice_number_confidence || 'low',
      vendor_name:    data.vendor_name_confidence    || 'low',
      amount:         data.amount_confidence         || 'low',
      invoice_date:   data.invoice_date_confidence   || 'low',
    },
    project_clues: String(data.project_clues || '').trim(),
    usage,
  };
}

// ---------------------------------------------------------------------------
// Contract extraction
// ---------------------------------------------------------------------------
const CONTRACT_SYSTEM = `You extract structured contract / proposal data from PDF documents for a real-estate / construction acquisitions financial manager.

Extract these HEADER fields and rate your confidence on each:
- vendor_name: the contracting party / vendor / subcontractor name (the "from" party)
- total_value: the total FIXED-price contract amount as a number. Sum only fixed/lump-sum tasks — exclude T&M tasks. 0 if entirely T&M.
- contract_date: date of the contract or proposal in YYYY-MM-DD. Use the signed date if present, else the proposal date.
- reference_number: contract number, PO number, project number, or any reference identifier. Empty string if not found.
- description: 1-3 sentence plain-English summary of the scope of work and key terms.

Also extract ALL CONTRACT LINE ITEMS / TASKS. For each task:
- billing_type: "fixed" for lump-sum / fixed-price tasks, "tm" for time-and-material hourly tasks, "expense" for reimbursable costs
- description: the task name and brief scope (e.g. "Task 1 – NJDOT Traffic Counts: Manual turning movement counts at 4 intersections")
- budgeted_amount: dollar amount for fixed tasks; 0 for T&M tasks

For each header field (except description) also return a confidence rating:
- "high": found clearly and unambiguously
- "medium": some uncertainty
- "low": guessed or inferred — human must verify

Be conservative. Empty string (or 0) if genuinely not present. Return empty array for line_items if no tasks found.`;

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
    line_items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          billing_type:     { type: 'string', enum: ['fixed','tm','expense'] },
          description:      { type: 'string' },
          budgeted_amount:  { type: 'number' },
        },
        required: ['billing_type','description','budgeted_amount'],
        additionalProperties: false,
      },
    },
  },
  required: ['vendor_name','vendor_name_confidence','total_value','total_value_confidence',
             'contract_date','contract_date_confidence','reference_number','reference_number_confidence',
             'description','line_items'],
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
  const line_items = (data.line_items || []).map(li => ({
    billing_type:    li.billing_type || 'fixed',
    description:     String(li.description || '').trim(),
    budgeted_amount: Number(li.budgeted_amount) || 0,
  }));
  return {
    vendor_name:      String(data.vendor_name || '').trim(),
    total_value:      Number(data.total_value) || 0,
    contract_date:    /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null,
    reference_number: String(data.reference_number || '').trim(),
    description:      String(data.description || '').trim(),
    line_items,
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
// Invoice line QB code suggestion
// ---------------------------------------------------------------------------
const SUGGEST_INVOICE_CODES_SYSTEM = `You are helping a real-estate acquisitions manager assign QuickBooks GL account codes to individual invoice line items.

You will receive:
1. The invoice PDF
2. The vendor name
3. A numbered list of available QB accounts (ID, account_number, full_name)
4. The extracted line items (index, description, amount)

For each line item, choose the SINGLE best matching QB account from the provided list.

Return a JSON object with a "suggestions" array. Each entry must have:
- line_index: integer (0-based index matching the input lines)
- qb_account_id: integer ID from the provided list (must be exact)
- account_number: the account number string (e.g. "1720.10")
- confidence: "high" | "medium" | "low"
- reason: one short sentence explaining why this code fits

Rules:
- Only use IDs from the provided list — never invent codes
- Consider both the line description AND the vendor's typical work type
- For time-and-material engineering/traffic entries → prefer 1720.x codes
- For architectural work → prefer 1705.x codes
- For permit fees → prefer 1760.x codes
- For legal work → prefer 1750.x codes
- For survey work → prefer 1710.x codes
- If unsure, use the closest parent category code`;

const SUGGEST_INVOICE_CODES_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line_index:     { type: 'integer' },
          qb_account_id:  { type: 'integer' },
          account_number: { type: 'string' },
          confidence:     { type: 'string', enum: ['high','medium','low'] },
          reason:         { type: 'string' },
        },
        required: ['line_index','qb_account_id','account_number','confidence','reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
};

async function suggestInvoiceLineCodes(pdfBuffer, lines, qbAccounts, vendorName) {
  if (!qbAccounts || qbAccounts.length === 0 || !lines || lines.length === 0) return [];
  const accountList = qbAccounts.map(a => `ID ${a.id}: [${a.account_number}] ${a.full_name}`).join('\n');
  const lineList = lines.map((l, i) => `Line ${i}: "${l.description || ''}" — $${l.amount}`).join('\n');
  const { data } = await callClaude(
    SUGGEST_INVOICE_CODES_SYSTEM,
    SUGGEST_INVOICE_CODES_SCHEMA,
    pdfBuffer,
    `Vendor: ${vendorName || 'Unknown'}\n\nAvailable QB accounts:\n${accountList}\n\nLine items to code:\n${lineList}\n\nSuggest the best QB account for each line.`
  );
  return (data.suggestions || []).filter(s => Number.isInteger(s.line_index) && Number.isInteger(s.qb_account_id));
}

// ---------------------------------------------------------------------------
// QB code suggestion (contract-level)
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

// ---------------------------------------------------------------------------
// Per-line budget line suggestion (text-only, uses Haiku — cheap + fast)
// Called after contract extraction to assign each task to a budget category.
// Returns: { primary_budget_line_id, primary_confidence, primary_reason, lines[] }
// ---------------------------------------------------------------------------
const SUGGEST_LINE_BUDGETS_SCHEMA = {
  type: 'object',
  properties: {
    primary_budget_line_id: { type: ['integer', 'null'] },
    primary_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    primary_reason: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          line_index:           { type: 'integer' },
          budget_line_id:       { type: ['integer', 'null'] },
          differs_from_primary: { type: 'boolean' },
          confidence:           { type: 'string', enum: ['high', 'medium', 'low'] },
          reason:               { type: 'string' },
        },
        required: ['line_index', 'budget_line_id', 'differs_from_primary', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['primary_budget_line_id', 'primary_confidence', 'primary_reason', 'lines'],
  additionalProperties: false,
};

async function suggestLineBudgets(lineItems, budgetLines, context = {}) {
  if (!lineItems?.length || !budgetLines?.length) return null;
  const c = client();

  const budgetList = budgetLines.map(bl =>
    `ID ${bl.id}: "${bl.task_name}"${bl.discipline ? ` (${bl.discipline})` : ''}${bl.section ? ` [${bl.section}]` : ''}`
  ).join('\n');
  const lineList = lineItems.map((li, i) =>
    `${i}: "${li.description}" — ${li.billing_type} — ${li.budgeted_amount ? '$' + li.budgeted_amount : 'T&M'}`
  ).join('\n');

  const prompt = `You are a senior real estate development project manager with 20+ years of experience managing soft costs on land acquisition, entitlement, and pre-construction projects. You are reviewing a vendor contract and must allocate EVERY line item to the correct budget tracking category — exactly as an expert PM would when coding a contract against a project budget.

CONTRACT CONTEXT
- Vendor: ${context.vendor_name || 'Unknown'}
- Scope: ${context.description || '(no description provided)'}

AVAILABLE BUDGET LINES
${budgetList}

CONTRACT LINE ITEMS  (index | description | type | amount)
${lineList}

YOUR TASK
1. Identify the PRIMARY budget line — the discipline/category that best describes the overall contract (e.g. a civil engineering firm doing site plans → Site Plans).
2. Allocate EVERY SINGLE line item to a specific budget line. No item should be left unallocated if a reasonable match exists.
3. Set differs_from_primary=true for any item that belongs to a genuinely different budget category than the primary.

ALLOCATION RULES — non-negotiable, apply exactly:

RULE 1 — GOVERNMENT & REGULATORY FEES
Any fee payable to a government body or regulatory agency MUST go to a Fees & Permits / Permitting budget line. This applies no matter which firm is billing it. Be aggressive here — these are never engineering line items.
  Keywords: NJDEP, DEP, NJDOT, NJDCA, municipal, county board, application fee, filing fee, permit fee, review fee, escrow, freshwater wetlands, flood hazard, stormwater permit, TWA, BWS, RFA, FHA, LURP, RSIS, soil conservation, county planning, county engineering, fire official, construction permit.

RULE 2 — SURVEY
Survey tasks go to the survey budget line even if billed by a civil/engineering firm.
  Keywords: boundary survey, topographic, ALTA, topo, survey, surveying, metes and bounds, monuments.

RULE 3 — ENVIRONMENTAL
Environmental tasks go to the environmental budget line even inside a civil or geotech contract.
  Keywords: Phase I, Phase II, ESA, environmental assessment, wetlands delineation, remediation, soil sampling, groundwater.

RULE 4 — GEOTECHNICAL
Geotech tasks stay in a geotech budget line.
  Keywords: boring, test pit, geotechnical investigation, lab testing, soil analysis, SPT, percolation, perc test, bedrock, stormwater infiltration testing.

RULE 5 — TRAFFIC / TRANSPORTATION
Traffic tasks go to the traffic budget line even inside a civil proposal.
  Keywords: traffic study, TIS, TIA, traffic impact, signal design, roadway design, offsite road, county road, NJDOT submission.

RULE 6 — FIRE / WATER / UTILITY REPORTS
Fire flow, water/sewer reports, utility load studies go to their matching budget line if one exists.
  Keywords: fire flow, fire tank, water report, sewer report, gas load, electric load, utility.

RULE 7 — CONSTRUCTION PHASE SERVICES
Construction administration, inspections, construction observation go to a construction services budget line if one exists.
  Keywords: construction observation, construction administration, construction phase, CA services, site inspection, sitework inspection.

RULE 8 — PRIMARY DISCIPLINE (CORE DELIVERABLES)
If a line item is the core deliverable of the firm's primary discipline — site plan preparation, schematic design, preliminary design, stormwater design, landscape plans — assign to the primary budget line.

FLAGGING RULE
Set differs_from_primary=true whenever you assign a line item to a budget line other than the primary. These rows will be highlighted for PM review. Be accurate, not conservative — it is better to correctly flag a permit fee to a Fees & Permits line than to lump it into engineering. The PM reviews every flagged row before confirming.

Every line item must have a budget_line_id assigned (use null only if truly no budget line is a reasonable match).`;

  try {
    const response = await c.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: { type: 'json_schema', schema: SUGGEST_LINE_BUDGETS_SCHEMA } },
    });
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) return null;
    return JSON.parse(textBlock.text);
  } catch (err) {
    console.warn('suggestLineBudgets failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Document classification
// ---------------------------------------------------------------------------
const CLASSIFY_SYSTEM = `You are a document classifier for a real estate acquisitions company. Determine if the PDF is a CONTRACT (agreement, proposal, scope of work — has service terms and total contract value) or an INVOICE (bill, payment request — has invoice number and amount due). Return only the classification.`;
const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    document_type: { type: 'string', enum: ['contract', 'invoice'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['document_type', 'confidence'],
  additionalProperties: false,
};
async function classifyDocument(pdfBuffer) {
  const { data } = await callClaude(CLASSIFY_SYSTEM, CLASSIFY_SCHEMA, pdfBuffer, 'Classify this document as a contract or invoice.');
  return { type: data.document_type, confidence: data.confidence };
}

// ---------------------------------------------------------------------------
// QuickBooks Transaction Report extraction
// ---------------------------------------------------------------------------
// Handles both the formatted QB PDF and the Excel-printed-to-PDF format.
// Returns an array of transaction rows ready to insert into qb_transactions.

const QB_TXN_SYSTEM = `You extract transaction data from QuickBooks Transaction Report PDFs for a real estate acquisitions company.

The report may be formatted (grouped by GL account sections) or a flat Excel-printed layout. Both formats contain the same data.

For EVERY transaction row in the report, extract:
- txn_date: transaction date in YYYY-MM-DD. Empty string if missing.
- vendor_name: vendor / payee / name on the transaction. Empty string if missing.
- ref_number: invoice number, check number, reference number, bill number, or any unique reference on that row. Empty string if missing.
- memo: the memo or description field on the transaction. Empty string if missing.
- qb_gl_code: the numeric GL account code (e.g. "1705", "1720.10"). Extract from the Account column or Account full name. In "Account full name" format like "-- Capitalized Land Cost:1700 Entitlement:1705 Architecture", the code is the number in the LAST colon-separated segment (here "1705"). Empty string if not determinable.
- qb_gl_name: the descriptive name for that GL code (e.g. "Architecture", "Traffic Engineering"). In the full name format, this is the text after the code in the last segment. Empty string if not determinable.
- qb_project: the Customer:Job or Project field if present. Empty string if missing.
- amount: the transaction total as a positive number (no symbols, no commas). Amounts shown in parentheses or with a minus sign are NEGATIVE — return them as negative numbers. 0 if not found.
- paid_amount: amount already paid as a positive number. 0 if not shown.
- open_balance: remaining unpaid balance as a number. Negative or parenthetical values are negative. 0 if not shown.
- is_paid: true if the open balance is 0 or near-zero (< $0.02), or if the row is marked "Paid" or "Closed". false otherwise.

Skip subtotal rows, total rows, blank rows, and header rows — only include actual transaction lines.

Return ALL transactions found. Accuracy is critical — do not truncate or summarize.`;

const QB_TXN_SCHEMA = {
  type: 'object',
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          txn_date:     { type: 'string' },
          vendor_name:  { type: 'string' },
          ref_number:   { type: 'string' },
          memo:         { type: 'string' },
          qb_gl_code:   { type: 'string' },
          qb_gl_name:   { type: 'string' },
          qb_project:   { type: 'string' },
          amount:       { type: 'number' },
          paid_amount:  { type: 'number' },
          open_balance: { type: 'number' },
          is_paid:      { type: 'boolean' },
        },
        required: ['txn_date','vendor_name','ref_number','memo','qb_gl_code','qb_gl_name',
                   'qb_project','amount','paid_amount','open_balance','is_paid'],
        additionalProperties: false,
      },
    },
  },
  required: ['transactions'],
  additionalProperties: false,
};

async function extractQbTransactions(pdfBuffer) {
  const c = client();
  const pdfBase64 = pdfBuffer.toString('base64');
  let fullText = '';
  let usage = null;
  try {
    const stream = await c.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 64000,
      system: QB_TXN_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: 'Extract every transaction row from this QuickBooks Transaction Report. Include all pages.' },
        ],
      }],
      output_config: {
        format: { type: 'json_schema', schema: QB_TXN_SCHEMA },
      },
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text;
      }
    }
    const finalMsg = await stream.finalMessage();
    usage = finalMsg.usage;
  } catch (err) {
    const detail = err?.error?.error?.message || err?.error?.message || err?.message || 'unknown error';
    console.error('Claude QB extract error:', err?.status, detail);
    throw new Error(`Claude API ${err?.status || ''}: ${detail}`);
  }
  if (!fullText) throw new Error('Claude returned empty response');
  let data;
  try {
    data = JSON.parse(fullText);
  } catch {
    throw new Error(`Claude returned non-JSON: ${fullText.slice(0, 200)}`);
  }
  const txns = (data.transactions || []).map(t => ({
    txn_date:     t.txn_date && /^\d{4}-\d{2}-\d{2}$/.test(t.txn_date.trim()) ? t.txn_date.trim() : null,
    vendor_name:  String(t.vendor_name  || '').trim(),
    ref_number:   String(t.ref_number   || '').trim(),
    memo:         String(t.memo         || '').trim(),
    qb_gl_code:   String(t.qb_gl_code   || '').trim(),
    qb_gl_name:   String(t.qb_gl_name   || '').trim(),
    qb_project:   String(t.qb_project   || '').trim(),
    amount:       Number(t.amount)       || 0,
    paid_amount:  Number(t.paid_amount)  || 0,
    open_balance: Number(t.open_balance) || 0,
    is_paid:      Boolean(t.is_paid),
  }));
  return { transactions: txns, usage };
}

// ---------------------------------------------------------------------------
// QB transaction matching (algorithmic — no AI call)
// ---------------------------------------------------------------------------

function normVendor(s) {
  return String(s || '').toLowerCase()
    .replace(/\binc\b\.?|\bllc\b\.?|\bltd\b\.?|\bcorp\b\.?|\bco\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function vendorSimilarity(a, b) {
  const na = normVendor(a), nb = normVendor(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Token overlap
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  const shared = [...ta].filter(t => t.length > 2 && tb.has(t)).length;
  return shared / Math.max(ta.size, tb.size);
}

function matchQbTransaction(extracted, qbTransactions) {
  if (!qbTransactions || !qbTransactions.length) {
    return { txn_id: null, confidence: 'none', reason: 'No QB transactions loaded for this phase' };
  }
  const invNum = String(extracted.invoice_number || '').trim();
  const vendor = String(extracted.vendor_name || '').trim();
  const amount = Number(extracted.amount) || 0;

  // Tier 1: exact invoice # = QB ref_number (case-insensitive, ignore leading zeros)
  if (invNum) {
    const normInv = invNum.replace(/^0+/, '').toLowerCase();
    const exact = qbTransactions.find(t => {
      const r = String(t.ref_number || '').trim().replace(/^0+/, '').toLowerCase();
      return r && r === normInv;
    });
    if (exact) return {
      txn_id: exact.id, confidence: 'high',
      reason: `Invoice # ${invNum} exactly matches QB ref# ${exact.ref_number} (${exact.vendor_name}, $${exact.amount})`,
    };
  }

  // Tier 2: vendor name similarity ≥ 0.8 AND amount within 2%
  if (vendor && amount > 0) {
    const candidates = qbTransactions.filter(t => {
      const sim = vendorSimilarity(vendor, t.vendor_name);
      const amtClose = Math.abs((t.amount || 0) - amount) / Math.max(amount, 1) <= 0.02;
      return sim >= 0.8 && amtClose;
    });
    if (candidates.length === 1) return {
      txn_id: candidates[0].id, confidence: 'medium',
      reason: `Vendor "${vendor}" ≈ "${candidates[0].vendor_name}" and amount $${amount} matches QB $${candidates[0].amount}`,
    };
    if (candidates.length > 1) return {
      txn_id: candidates[0].id, confidence: 'medium',
      reason: `${candidates.length} possible QB matches by vendor+amount — closest shown`,
    };
  }

  // Tier 3: vendor similarity ≥ 0.7 (amount mismatch or no amount)
  if (vendor) {
    const vendorMatches = qbTransactions
      .map(t => ({ t, sim: vendorSimilarity(vendor, t.vendor_name) }))
      .filter(x => x.sim >= 0.7)
      .sort((a, b) => b.sim - a.sim);
    if (vendorMatches.length) return {
      txn_id: vendorMatches[0].t.id, confidence: 'low',
      reason: `Vendor "${vendor}" loosely matches QB "${vendorMatches[0].t.vendor_name}" but amounts differ ($${amount} vs $${vendorMatches[0].t.amount})`,
    };
  }

  return { txn_id: null, confidence: 'none', reason: `No QB match found for "${vendor}" / $${amount} / ref# "${invNum}"` };
}

// ---------------------------------------------------------------------------
// Project matching (compares project_clues against known project aliases)
// ---------------------------------------------------------------------------

function matchProject(projectClues, projectName, projectAliases = []) {
  if (!projectClues) return { match: 'unknown', reason: 'Invoice contains no project references' };
  const clues = projectClues.toLowerCase();
  const allNames = [projectName, ...projectAliases].map(n => n.toLowerCase());
  for (const name of allNames) {
    // Check significant words (≥5 chars) from project name against clues
    const words = name.split(/\s+/).filter(w => w.length >= 4);
    const matches = words.filter(w => clues.includes(w));
    if (matches.length >= 2 || (matches.length === 1 && words.length <= 2)) {
      return { match: 'confirmed', reason: `Invoice mentions "${matches.join(', ')}" matching project "${projectName}"` };
    }
  }
  // Check if it mentions a clearly different known place/project (common false-positive filter)
  // We flag it as 'uncertain' rather than 'different' unless we have explicit contrary evidence
  if (clues.length > 0) {
    return { match: 'uncertain', reason: `Invoice has project clues ("${projectClues.slice(0, 80)}") but no clear match to "${projectName}"` };
  }
  return { match: 'unknown', reason: 'Invoice contains no recognizable project references' };
}

module.exports = { extractInvoice, extractContract, suggestContractLines, suggestInvoiceLineCodes, extractTMCharge, extractExpense, classifyDocument, suggestLineBudgets, extractQbTransactions, matchQbTransaction, matchProject };
