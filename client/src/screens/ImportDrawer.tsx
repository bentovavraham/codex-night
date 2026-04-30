import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './ImportDrawer.module.css';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

interface ImportItem {
  id: number;
  phase_id: number;
  original_filename: string;
  file_reference: string | null;
  doc_type: string | null;
  doc_type_confidence: string | null;
  extracted_data: any | null;
  suggested_budget_line_id: number | null;
  suggested_line_name: string | null;
  match_confidence: string | null;
  status: string;
  error_message: string | null;
  // QB matching
  suggested_qb_txn_id: number | null;
  qb_match_confidence: string | null;
  qb_match_reason: string | null;
  identified_project: string | null;
  project_match: string | null;
  // QB transaction data (joined)
  qb_vendor: string | null;
  qb_ref_number: string | null;
  qb_amount: number | null;
  qb_txn_date: string | null;
  qb_gl_code: string | null;
  qb_gl_name: string | null;
  qb_is_paid: boolean | null;
  qb_open_balance: number | null;
}

interface Props {
  phaseId: number;
  onClose: () => void;
  onConfirmed?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', extracting: 'Extracting…', needs_review: 'Needs Review',
  confirmed: 'Confirmed', failed: 'Failed', discarded: 'Discarded',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`] ?? styles.badge_queued}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TypeChip({ type, onClick }: { type: string | null; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button
      className={`${styles.typeChip} ${type === 'contract' ? styles.typeContract : type === 'invoice' ? styles.typeInvoice : styles.typeUnknown}`}
      onClick={onClick}
      title={onClick ? 'Click to flip type' : undefined}
      style={onClick ? undefined : { cursor: 'default' }}
    >
      {type ? type.toUpperCase() : '?'}
    </button>
  );
}

// ── Budget Line Picker ────────────────────────────────────────────────────────

function BudgetLinePicker({ lines, value, onChange }: {
  lines: any[]; value: number | null; onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = lines.find(l => l.id === value) ?? null;
  const filtered = useMemo(() => {
    if (!query.trim()) return lines;
    const q = query.toLowerCase();
    return lines.filter(l => l.task_name.toLowerCase().includes(q) || (l.discipline || '').toLowerCase().includes(q));
  }, [lines, query]);

  useEffect(() => {
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  return (
    <div className={styles.blPicker} ref={ref}>
      <div className={`${styles.blDisplay} ${!selected ? styles.blEmpty : ''}`}
        onClick={() => { setQuery(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 30); }}>
        {selected
          ? <><span className={styles.blName}>{selected.task_name}{selected.discipline ? ` · ${selected.discipline}` : ''}</span>
              <button className={styles.blClear} onClick={e => { e.stopPropagation(); onChange(null); }}>✕</button></>
          : <span className={styles.blPlaceholder}>Search tasks…</span>}
      </div>
      {open && (
        <div className={styles.blDropdown}>
          <input ref={inputRef} className={styles.blSearch} value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Type task name or discipline…" />
          <div className={styles.blList}>
            {filtered.map(l => (
              <div key={l.id}
                className={`${styles.blOption} ${l.id === value ? styles.blOptionSelected : ''}`}
                onMouseDown={() => { onChange(l.id); setOpen(false); setQuery(''); }}>
                {l.task_name}{l.discipline ? ` · ${l.discipline}` : ''}
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.blNoMatch}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Compact inline budget line picker (portal-based, for table rows) ─────────

function InlineBudgetLinePicker({ lines, value, onChange }: {
  lines: any[]; value: number | null; onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = lines.find(l => l.id === value) ?? null;

  const filtered = useMemo(() => {
    if (!query.trim()) return lines;
    const q = query.toLowerCase();
    return lines.filter(l =>
      l.task_name.toLowerCase().includes(q) || (l.discipline || '').toLowerCase().includes(q)
    );
  }, [lines, query]);

  function openPicker() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 280) });
    setQuery('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 20);
  }

  useEffect(() => {
    if (!open) return;
    function onOut(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if ((e.target as Element)?.closest?.('[data-inbl-dp]')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  return (
    <>
      <div ref={triggerRef} className={styles.inblTrigger} onClick={openPicker}
        title={selected ? `${selected.task_name}${selected.discipline ? ` · ${selected.discipline}` : ''}` : 'Click to assign budget line'}>
        {selected ? (
          <>
            <span className={styles.inblLabel}>{selected.task_name}</span>
            <button className={styles.inblClear} onClick={e => { e.stopPropagation(); onChange(null); }}>✕</button>
          </>
        ) : (
          <span className={styles.inblEmpty}>— inherit —</span>
        )}
      </div>
      {open && createPortal(
        <div data-inbl-dp className={styles.inblDropdown} style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <input ref={inputRef} className={styles.inblSearch} value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Search budget lines…" />
          <div className={styles.inblList}>
            <div className={styles.inblOption} onMouseDown={() => { onChange(null); setOpen(false); }}>— inherit —</div>
            {filtered.map(l => (
              <div key={l.id}
                className={`${styles.inblOption} ${l.id === value ? styles.inblSelected : ''}`}
                onMouseDown={() => { onChange(l.id); setOpen(false); }}>
                {l.task_name}{l.discipline ? ` · ${l.discipline}` : ''}
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.inblNoMatch}>No match</div>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Inline GL Code Picker (portal-based, for line item rows) ────────────────

function InlineGlPicker({ accounts, value, onChange, isSuggested, suggestionReason, suggestionConfidence }: {
  accounts: QbAccount[]; value: number | null; onChange: (id: number | null) => void;
  isSuggested?: boolean; suggestionReason?: string | null; suggestionConfidence?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = accounts.find(a => a.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return accounts.filter(a =>
      !q || a.account_number.toLowerCase().includes(q) || a.full_name.toLowerCase().includes(q)
    ).slice(0, 40);
  }, [accounts, query]);

  function openPicker() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 280) });
    setQuery('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 20);
  }

  useEffect(() => {
    if (!open) return;
    function onOut(e: MouseEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if ((e.target as Element)?.closest?.('[data-ingl-dp]')) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  const confColor = suggestionConfidence === 'high' ? '#15803d' : suggestionConfidence === 'medium' ? '#92400e' : '#6b7280';

  return (
    <>
      <div
        ref={triggerRef}
        className={`${styles.inglTrigger} ${isSuggested ? styles.inglTriggerAi : ''}`}
        onClick={openPicker}
        title={isSuggested && suggestionReason ? `AI suggestion (${suggestionConfidence}): ${suggestionReason}` : undefined}
      >
        {selected ? (() => {
          const parts = selected.full_name.split(':');
          const leaf = parts.pop()!.trim();
          const path = parts.map(p => p.trim()).join(' › ');
          return (
            <>
              <div className={styles.inglTopRow}>
                {isSuggested && <span className={styles.inglAiBadge} style={{ color: confColor }}>✦</span>}
                <span className={styles.inglCode}>{selected.account_number}</span>
                <button className={styles.inglClear} onClick={e => { e.stopPropagation(); onChange(null); }}>✕</button>
              </div>
              {path && <span className={styles.inglNamePath}>{path}</span>}
              <span className={styles.inglNameLeaf}>{leaf}</span>
            </>
          );
        })() : (
          <span className={styles.inglEmpty}>Set GL…</span>
        )}
      </div>
      {open && createPortal(
        <div data-ingl-dp className={styles.inglDropdown} style={{ top: pos.top, left: pos.left, width: pos.width }}>
          <input ref={inputRef} className={styles.inglSearch} value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Code or name…" />
          <div className={styles.inglList}>
            {filtered.map(a => (
              <div key={a.id} className={styles.inglOption}
                onMouseDown={() => { onChange(a.id); setOpen(false); }}>
                <span className={styles.inglCode}>{a.account_number}</span>
                <span className={styles.inglName}>{a.full_name}</span>
              </div>
            ))}
            {!filtered.length && <div className={styles.inglNoMatch}>No match</div>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Duplicate Warning Banner ──────────────────────────────────────────────────

function DupBanner({ matches, acknowledged, onAck }: {
  matches: any[]; acknowledged: boolean; onAck: () => void;
}) {
  if (!matches.length) return null;
  const exact = matches.filter(m => m.match_type === 'exact');
  const fuzzy = matches.filter(m => m.match_type === 'fuzzy');

  return (
    <div className={`${styles.dupBanner} ${exact.length ? styles.dupBannerExact : styles.dupBannerFuzzy}`}>
      <div className={styles.dupTitle}>
        {exact.length ? '⚠ Possible Duplicate Detected' : '~ Similar Record Found'}
      </div>
      <div className={styles.dupList}>
        {matches.map((m, i) => (
          <div key={i} className={styles.dupRow}>
            <span className={`${styles.dupTag} ${m.match_type === 'exact' ? styles.dupTagExact : styles.dupTagFuzzy}`}>
              {m.match_type === 'exact' ? 'EXACT' : 'SIMILAR'}
            </span>
            <span className={styles.dupDetail}>
              {m.vendor_name} — {m.invoice_number || m.reference_number || '—'} — {usd2.format(Number(m.amount))}
              {(m.invoice_date || m.contract_date) && ` — ${String(m.invoice_date || m.contract_date).slice(0, 10)}`}
            </span>
            <span className={`${styles.dupStatus}`}>{m.status}</span>
            <span className={styles.dupReason}>{m.reason}</span>
          </div>
        ))}
      </div>
      {!acknowledged ? (
        <label className={styles.dupAck}>
          <input type="checkbox" onChange={e => { if (e.target.checked) onAck(); }} />
          <span>I reviewed the above and confirm this is not a duplicate</span>
        </label>
      ) : (
        <div className={styles.dupAcked}>✓ Duplicate check acknowledged</div>
      )}
    </div>
  );
}

// ── Full-Screen Review Overlay ────────────────────────────────────────────────

interface QbAccount { id: number; account_number: string; full_name: string; }

interface LineItem {
  billing_type: 'fixed' | 'tm' | 'expense';
  description: string;
  budgeted_amount: string;
  phase_budget_line_id: number | null;
  differs_from_primary?: boolean;
}

interface InvLineItem {
  billing_type: string;
  description: string;
  amount: string;
  person: string;
  hours: string;
  rate: string;
  qb_account_id: number | null;
  is_ai_suggested: boolean;
  suggestion_confidence: string | null;
  suggestion_reason: string | null;
}

function ReviewOverlay({ item, budgetLines, qbAccounts, onConfirm, onDiscard, onBack, saving }: {
  item: ImportItem;
  budgetLines: any[];
  qbAccounts: QbAccount[];
  onConfirm: (formData: any) => Promise<void>;
  onDiscard: () => Promise<void>;
  onBack: () => void;
  saving: boolean;
}) {
  const ext = item.extracted_data || {};
  const isContract = item.doc_type === 'contract';

  // Common fields
  const [vendor, setVendor] = useState(ext.vendor_name || '');
  const [description, setDescription] = useState(ext.description || ext.summary || '');
  // Contract budget line (contracts only)
  const [budgetLineId, setBudgetLineId] = useState<number | null>(
    isContract ? (ext.suggested_primary_budget_line_id ?? item.suggested_budget_line_id ?? null) : null
  );
  // Invoice GL code (top-level, used when no line items)
  const [glAccountId, setGlAccountId] = useState<number | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Resizable form pane — default 65%, min 600px, max 92%
  const [formWidth, setFormWidth] = useState(() => Math.max(700, Math.round(window.innerWidth * 0.65)));
  const dragState = useRef<{ active: boolean; startX: number; startW: number }>({ active: false, startX: 0, startW: 0 });

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragState.current.active) return;
      const delta = dragState.current.startX - e.clientX;
      const maxW = Math.round(window.innerWidth * 0.92);
      setFormWidth(Math.max(480, Math.min(maxW, dragState.current.startW + delta)));
    }
    function onUp() {
      if (!dragState.current.active) return;
      dragState.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  function startDrag(e: React.MouseEvent) {
    dragState.current = { active: true, startX: e.clientX, startW: formWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }

  function snapWidth(pct: number) {
    setFormWidth(Math.round(window.innerWidth * pct));
  }

  // Contract fields
  const [totalValue, setTotalValue] = useState(ext.total_value ? String(ext.total_value) : '');
  const [contractDate, setContractDate] = useState(ext.contract_date || '');
  const [referenceNumber, setReferenceNumber] = useState(ext.reference_number || '');
  const [contractStatus, setContractStatus] = useState('active');
  const [lineItems, setLineItems] = useState<LineItem[]>(() =>
    (ext.line_items || []).map((li: any) => ({
      billing_type: (['fixed','tm','expense'].includes(li.billing_type) ? li.billing_type : 'fixed') as LineItem['billing_type'],
      description: li.description || '',
      budgeted_amount: li.budgeted_amount != null ? String(li.budgeted_amount) : '',
      phase_budget_line_id: li.suggested_budget_line_id ?? null,
      differs_from_primary: li.differs_from_primary ?? false,
    }))
  );

  // Invoice fields
  const [invoiceNumber, setInvoiceNumber] = useState(ext.invoice_number || '');
  const [amount, setAmount] = useState(ext.amount ? String(ext.amount) : '');
  const [invoiceDate, setInvoiceDate] = useState(ext.invoice_date || '');
  const [invoiceType, setInvoiceType] = useState('fixed');
  const [invoiceStatus, setInvoiceStatus] = useState('pending');
  const [invoiceLines, setInvoiceLines] = useState<InvLineItem[]>(() =>
    (ext.line_items || []).map((li: any) => {
      const aiId = li.suggested_qb_account_id ?? null;
      const hasAi = aiId != null;
      return {
        billing_type: li.billing_type || 'fixed',
        description: li.description || '',
        amount: li.amount != null ? String(li.amount) : li.budgeted_amount != null ? String(li.budgeted_amount) : '',
        person: li.person || '',
        hours: li.hours != null ? String(li.hours) : '',
        rate: li.rate != null ? String(li.rate) : '',
        qb_account_id: li.qb_account_id ?? aiId,
        is_ai_suggested: hasAi && (li.qb_account_id == null),
        suggestion_confidence: li.qb_suggestion_confidence ?? null,
        suggestion_reason: li.qb_suggestion_reason ?? null,
      };
    })
  );

  // Duplicate check
  const [dupMatches, setDupMatches] = useState<any[]>([]);
  const [dupAcked, setDupAcked] = useState(false);
  const [dupLoading, setDupLoading] = useState(true);

  useEffect(() => {
    setDupLoading(true);
    api.checkImportDuplicates(item.id)
      .then(r => { setDupMatches(r.matches); })
      .catch(() => { setDupMatches([]); })
      .finally(() => setDupLoading(false));
  }, [item.id]);

  const pdfSrc = item.file_reference
    ? `/api/files/${encodeURIComponent(item.file_reference)}`
    : null;

  const fixedTotal = lineItems
    .filter(li => li.billing_type === 'fixed')
    .reduce((s, li) => s + (Number(li.budgeted_amount) || 0), 0);
  const hasTm = lineItems.some(li => li.billing_type === 'tm');

  const isWrongProject = item.project_match === 'mismatch';
  const weakQbMatch = !isContract && (item.qb_match_confidence === 'low' || item.qb_match_confidence === 'none');
  const [qbOverrideAcked, setQbOverrideAcked] = useState(false);

  const dupBlocked = dupMatches.length > 0 && !dupAcked;
  const canConfirm = reviewed && !!vendor.trim() && !dupBlocked && !saving
    && !isWrongProject
    && (!weakQbMatch || qbOverrideAcked);

  function addLine() {
    setLineItems(li => [...li, { billing_type: 'fixed', description: '', budgeted_amount: '', phase_budget_line_id: null }]);
  }
  function removeLine(idx: number) {
    setLineItems(li => li.filter((_, i) => i !== idx));
  }
  function setLine(idx: number, patch: Partial<LineItem>) {
    setLineItems(li => { const n = [...li]; n[idx] = { ...n[idx], ...patch }; return n; });
  }

  const hasLineItems = lineItems.length > 0;
  const confirmingRef = useRef(false);

  async function handleConfirm() {
    if (confirmingRef.current) return;
    setSaveError(null);
    if (!vendor.trim()) return setSaveError('Vendor name is required.');
    if (isContract && !hasLineItems && !budgetLineId) return setSaveError('Budget line is required when there are no contract tasks.');
    if (!reviewed) return setSaveError('Please confirm you have reviewed the details.');
    if (dupBlocked) return setSaveError('Please acknowledge the duplicate warning.');

    const formData = isContract
      ? {
          vendor_name: vendor.trim(), description,
          phase_budget_line_id: budgetLineId,
          total_value: Number(totalValue) || 0,
          contract_date: contractDate || null,
          reference_number: referenceNumber || null,
          status: contractStatus,
          line_items: lineItems.filter(li => li.description.trim()).map(li => ({
            billing_type: li.billing_type, description: li.description,
            budgeted_amount: Number(li.budgeted_amount) || 0,
            phase_budget_line_id: li.phase_budget_line_id ?? null,
          })),
        }
      : {
          vendor_name: vendor.trim(), description,
          qb_account_id: glAccountId,
          invoice_number: invoiceNumber,
          amount: Number(amount) || 0,
          invoice_date: invoiceDate || null,
          invoice_type: invoiceType,
          status: invoiceStatus,
          line_items: invoiceLines.map(li => ({
            billing_type: li.billing_type,
            description: li.description,
            amount: Number(li.amount) || 0,
            person: li.person || null,
            hours: li.hours ? Number(li.hours) : null,
            rate: li.rate ? Number(li.rate) : null,
            qb_account_id: li.qb_account_id ?? null,
          })),
        };
    confirmingRef.current = true;
    try { await onConfirm(formData); }
    finally { confirmingRef.current = false; }
  }

  return (
    <div className={styles.reviewOverlay}>
      {/* Left: PDF */}
      <div className={styles.reviewPdfPane}>
        {pdfSrc
          ? <embed src={`${pdfSrc}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`} type="application/pdf" className={styles.reviewPdfFrame} />
          : <div className={styles.reviewNoPdf}>No PDF available</div>}
      </div>

      {/* Drag-to-resize handle */}
      <div className={styles.reviewDragHandle} onMouseDown={startDrag} />

      {/* Right: Form */}
      <div className={styles.reviewFormPane} style={{ width: formWidth }}>
        {/* Bar */}
        <div className={styles.reviewBar}>
          <button className={styles.reviewBackBtn} onClick={onBack}>← Queue</button>
          <div className={styles.reviewBarTitle}>
            <TypeChip type={item.doc_type} />
            <span className={styles.reviewBarFile} title={item.original_filename}>{item.original_filename}</span>
          </div>
          <div className={styles.reviewSnapBtns}>
            <button className={styles.snapBtn} onClick={() => snapWidth(0.50)} title="50%">½</button>
            <button className={styles.snapBtn} onClick={() => snapWidth(0.65)} title="65%">⅔</button>
            <button className={styles.snapBtn} onClick={() => snapWidth(0.85)} title="85%">⅘</button>
          </div>
          {pdfSrc && (
            <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className={styles.openPdfBtn}
              title="Open PDF in new tab — then use Cmd+F / Ctrl+F to search">🔍</a>
          )}
          <button className={styles.reviewCloseBtn} onClick={onBack}>✕</button>
        </div>

        {/* Duplicate warning */}
        {!dupLoading && (
          <DupBanner matches={dupMatches} acknowledged={dupAcked} onAck={() => setDupAcked(true)} />
        )}
        {dupLoading && <div className={styles.dupChecking}>Checking for duplicates…</div>}

        {/* Scrollable form body */}
        <div className={styles.reviewFormScroll}>

          {/* Vendor */}
          <div className={styles.rGroup}>
            <label className={styles.rLabel}>Vendor / Payee</label>
            <input className={styles.rInput} value={vendor} onChange={e => setVendor(e.target.value)}
              placeholder="Who is this from?" />
          </div>

          {/* QB Match Panel — invoices with a match */}
          {!isContract && (item.qb_match_confidence === 'high' || item.qb_match_confidence === 'medium' || item.qb_match_confidence === 'low') && item.qb_vendor && (
            <div className={`${styles.qbMatchPanel} ${item.qb_match_confidence === 'high' ? styles.qbMatchPanelHigh : item.qb_match_confidence === 'medium' ? styles.qbMatchPanelMed : styles.qbMatchPanelLow}`}>
              <div className={styles.qbMatchHeader}>
                <QbMatchBadge confidence={item.qb_match_confidence} />
                {item.qb_match_reason && <span className={styles.qbMatchReason}>{item.qb_match_reason}</span>}
              </div>
              <div className={styles.qbMatchGrid}>
                <span className={styles.qbMatchLabel}>QB Vendor</span>
                <span className={styles.qbMatchValue}>{item.qb_vendor}</span>
                {item.qb_ref_number && <>
                  <span className={styles.qbMatchLabel}>Ref #</span>
                  <span className={styles.qbMatchValue}>{item.qb_ref_number}</span>
                </>}
                {item.qb_amount != null && <>
                  <span className={styles.qbMatchLabel}>QB Amount</span>
                  <span className={`${styles.qbMatchValue} ${styles.mono}`}>{usd2.format(Number(item.qb_amount))}</span>
                </>}
                {item.qb_txn_date && <>
                  <span className={styles.qbMatchLabel}>QB Date</span>
                  <span className={styles.qbMatchValue}>{String(item.qb_txn_date).slice(0, 10)}</span>
                </>}
                {item.qb_gl_code && <>
                  <span className={styles.qbMatchLabel}>QB GL</span>
                  <span className={styles.qbMatchValue}>{item.qb_gl_code}{item.qb_gl_name ? ` — ${item.qb_gl_name}` : ''}</span>
                </>}
                {item.qb_is_paid != null && <>
                  <span className={styles.qbMatchLabel}>QB Status</span>
                  <span className={styles.qbMatchValue}>{item.qb_is_paid ? '✓ Paid' : `Open${item.qb_open_balance != null ? ` — ${usd2.format(Number(item.qb_open_balance))} remaining` : ''}`}</span>
                </>}
              </div>
              {item.project_match === 'uncertain' && item.identified_project && (
                <div className={styles.qbMatchProjectWarn}>
                  ⚠ Invoice references "{item.identified_project}" — verify this belongs to this project
                </div>
              )}
            </div>
          )}
          {!isContract && item.qb_match_confidence === 'none' && (
            <div className={styles.qbNoMatchPanel}>
              <span className={styles.qbBadgeNone}>No QB match found</span>
              {item.qb_match_reason && <span className={styles.qbMatchReason}>{item.qb_match_reason}</span>}
              {item.identified_project && item.project_match === 'uncertain' && (
                <span className={styles.qbMatchProjectWarn}>⚠ References "{item.identified_project}"</span>
              )}
            </div>
          )}

          {/* Budget line — contracts only */}
          {isContract && !hasLineItems && (
            <div className={styles.rGroup}>
              <label className={styles.rLabel}>Task / Budget Line <span className={styles.rRequired}>required</span></label>
              <BudgetLinePicker lines={budgetLines} value={budgetLineId} onChange={setBudgetLineId} />
            </div>
          )}
          {isContract && hasLineItems && (
            <div className={styles.rGroup}>
              <label className={styles.rLabel}>Fallback Budget Line <span className={styles.rFallbackHint}>used only for tasks with no specific assignment</span></label>
              <BudgetLinePicker lines={budgetLines} value={budgetLineId} onChange={setBudgetLineId} />
            </div>
          )}

          {isContract ? (
            <>
              <div className={styles.rRow}>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Total Value</label>
                  <input className={`${styles.rInput} ${styles.mono}`} value={totalValue}
                    onChange={e => setTotalValue(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
                </div>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Contract Date</label>
                  <input className={styles.rInput} value={contractDate}
                    onChange={e => setContractDate(e.target.value)} type="date" />
                </div>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Ref / Contract #</label>
                  <input className={styles.rInput} value={referenceNumber}
                    onChange={e => setReferenceNumber(e.target.value)} placeholder="e.g. 24117" />
                </div>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Status</label>
                  <select className={styles.rSelect} value={contractStatus} onChange={e => setContractStatus(e.target.value)}>
                    <option value="draft">Draft</option>
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <div className={styles.rGroup}>
                <label className={styles.rLabel}>Scope / Description</label>
                <textarea className={styles.rTextarea} value={description}
                  onChange={e => setDescription(e.target.value)} rows={3} placeholder="Brief description…" />
              </div>

              {/* Line items table */}
              <div className={styles.rSection}>
                <div className={styles.rSectionTitle}>Contract Tasks</div>
                <table className={styles.rTable}>
                  <thead>
                    <tr className={styles.rThead}>
                      <th className={styles.rColBudgetLine}>BUDGET LINE</th>
                      <th className={styles.rColType}>TYPE</th>
                      <th className={styles.rColDesc}>DESCRIPTION</th>
                      <th className={`${styles.rColAmt} ${styles.right}`}>AMOUNT</th>
                      <th className={styles.rColDel} />
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i} className={`${styles.rTrow} ${li.differs_from_primary ? styles.rTrowFlagged : ''}`}>
                        <td className={styles.rColBudgetLine}>
                          <InlineBudgetLinePicker
                            lines={budgetLines}
                            value={li.phase_budget_line_id}
                            onChange={id => setLine(i, { phase_budget_line_id: id })}
                          />
                        </td>
                        <td className={styles.rColType}>
                          <select className={styles.rTypeSelect} value={li.billing_type}
                            onChange={e => setLine(i, { billing_type: e.target.value as LineItem['billing_type'] })}>
                            <option value="fixed">Fixed</option>
                            <option value="tm">T&amp;M</option>
                            <option value="expense">Expense</option>
                          </select>
                        </td>
                        <td className={styles.rColDesc}>
                          <input className={styles.rDescInput} value={li.description}
                            onChange={e => setLine(i, { description: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }}
                            placeholder="Task description" />
                        </td>
                        <td className={`${styles.rColAmt} ${styles.right}`}>
                          {li.billing_type === 'tm'
                            ? <span className={styles.tmTag}>T&amp;M</span>
                            : <input className={`${styles.rAmtInput} ${styles.mono}`}
                                value={li.budgeted_amount}
                                onChange={e => setLine(i, { budgeted_amount: e.target.value })}
                                placeholder="0.00"
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }} />}
                        </td>
                        <td className={styles.rColDel}>
                          <button className={styles.rDelBtn} onClick={() => removeLine(i)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className={styles.rTableFooter}>
                  <button className={styles.rAddBtn} onClick={addLine}>+ Add task</button>
                  {lineItems.some(li => li.differs_from_primary) && (
                    <button className={styles.rAddBtn} onClick={() =>
                      setLineItems(items => items.map(li => ({ ...li, differs_from_primary: false, phase_budget_line_id: null })))
                    }>Clear overrides</button>
                  )}
                  <div className={styles.rTableTotal}>
                    {fixedTotal > 0 && <span className={styles.mono}>{usd2.format(fixedTotal)} fixed</span>}
                    {hasTm && <span className={styles.tmTag}>+ T&amp;M</span>}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.rRow}>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Invoice #</label>
                  <input className={styles.rInput} value={invoiceNumber}
                    onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-2024-001" />
                </div>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Amount</label>
                  <input className={`${styles.rInput} ${styles.mono}`} value={amount}
                    onChange={e => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
                </div>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Invoice Date</label>
                  <input className={styles.rInput} value={invoiceDate}
                    onChange={e => setInvoiceDate(e.target.value)} type="date" />
                </div>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Type</label>
                  <select className={styles.rSelect} value={invoiceType} onChange={e => setInvoiceType(e.target.value)}>
                    <option value="fixed">Fixed</option>
                    <option value="tm">T&amp;M</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>Status</label>
                  <select className={styles.rSelect} value={invoiceStatus} onChange={e => setInvoiceStatus(e.target.value)}>
                    <option value="pending">Pending</option>
                    <option value="pm_approved">PM Approved</option>
                    <option value="approved">Approved</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>

              <div className={styles.rGroup}>
                <label className={styles.rLabel}>Description</label>
                <textarea className={styles.rTextarea} value={description}
                  onChange={e => setDescription(e.target.value)} rows={3} placeholder="What is this invoice for?" />
              </div>

              {/* Invoice line items — editable with GL code */}
              {invoiceLines.length > 0 ? (
                <div className={styles.rSection}>
                  <div className={styles.rSectionTitle}>
                    Line Items — assign GL codes
                    {invoiceLines.some(l => l.is_ai_suggested) && (
                      <span className={styles.aiLegend}>✦ AI suggestion — hover for reason, click to override</span>
                    )}
                  </div>
                  <table className={styles.rTable}>
                    <thead>
                      <tr className={styles.rThead}>
                        <th className={styles.rColType}>TYPE</th>
                        <th className={styles.rColGl}>GL CODE</th>
                        <th className={styles.rColDesc}>DESCRIPTION</th>
                        <th className={`${styles.rColAmt} ${styles.right}`}>AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceLines.map((li, i) => (
                        <tr key={i} className={styles.rTrow}>
                          <td className={styles.rColType}>
                            <span className={`${styles.rTypeBadge} ${li.billing_type === 'tm' ? styles.rTypeBadgeTm : li.billing_type === 'expense' ? styles.rTypeBadgeExp : styles.rTypeBadgeFixed}`}>
                              {li.billing_type === 'tm' ? 'T&M' : li.billing_type.toUpperCase()}
                            </span>
                          </td>
                          <td className={styles.rColGl}>
                            <InlineGlPicker
                              accounts={qbAccounts}
                              value={li.qb_account_id}
                              isSuggested={li.is_ai_suggested}
                              suggestionReason={li.suggestion_reason}
                              suggestionConfidence={li.suggestion_confidence}
                              onChange={id => setInvoiceLines(lines => {
                                const n = [...lines];
                                n[i] = { ...n[i], qb_account_id: id, is_ai_suggested: false };
                                return n;
                              })}
                            />
                          </td>
                          <td className={styles.rColDesc}>
                            <span style={{ fontSize: 12, color: '#1a1714', lineHeight: 1.4, display: 'block', fontWeight: 450 }}>
                              {li.person && <span style={{ fontWeight: 700, marginRight: 6, color: '#3d2e27' }}>{li.person}</span>}
                              {li.description}
                            </span>
                            {li.billing_type === 'tm' && li.hours > 0 && <span style={{ fontSize: 10.5, color: '#8a7f74', marginTop: 1, display: 'block' }}>{li.hours}h @ ${li.rate}/h</span>}
                          </td>
                          <td className={`${styles.rColAmt} ${styles.right} ${styles.mono}`} style={{ fontSize: 11.5, color: '#1a1714', fontWeight: 600 }}>
                            {usd2.format(Number(li.amount) || 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* No line items — single top-level GL code */
                <div className={styles.rGroup}>
                  <label className={styles.rLabel}>GL Code</label>
                  <InlineGlPicker accounts={qbAccounts} value={glAccountId} onChange={setGlAccountId} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div className={styles.reviewFormFooter}>
          {isWrongProject && (
            <div className={styles.blockError}>
              <strong>⛔ Wrong Project — Cannot Confirm</strong>
              <span>This invoice's filename and/or content identifies it as belonging to a different project. You must discard it.</span>
            </div>
          )}
          {!isWrongProject && weakQbMatch && (
            <div className={styles.overrideWarn}>
              <strong>⚠ No verified QB match</strong>
              <span>This invoice has no high-confidence QB transaction link. Confirming without one means the Audit table will show it as unmatched.</span>
              <label className={styles.reviewCheck} style={{ marginTop: 6 }}>
                <input type="checkbox" checked={qbOverrideAcked} onChange={e => setQbOverrideAcked(e.target.checked)} />
                <span>I understand — confirm anyway without a QB match</span>
              </label>
            </div>
          )}
          {!isWrongProject && (
            <label className={styles.reviewCheck}>
              <input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
              <span>I have reviewed this document and confirm all details are correct</span>
            </label>
          )}
          {saveError && <div className={styles.reviewSaveError}>{saveError}</div>}
          <div className={styles.reviewActions}>
            <button className={styles.discardBtn} onClick={onDiscard} disabled={saving}>Discard</button>
            {!isWrongProject && (
              <button className={styles.confirmBtn} onClick={handleConfirm} disabled={!canConfirm}>
                {saving ? 'Saving…' : 'Confirm & Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Queue Card ───────────────────────────────────────────────────────────────

function QbMatchBadge({ confidence }: { confidence: string | null }) {
  if (!confidence || confidence === 'none') return <span className={styles.qbBadgeNone}>No QB match</span>;
  if (confidence === 'high')   return <span className={styles.qbBadgeHigh}>✓ QB matched</span>;
  if (confidence === 'medium') return <span className={styles.qbBadgeMed}>~ QB possible</span>;
  return <span className={styles.qbBadgeLow}>? QB weak</span>;
}

function QueueCard({ item, onClick, onFlipType, onRetry, onDiscard }: {
  item: ImportItem; onClick: () => void; onFlipType: () => void;
  onRetry: () => void; onDiscard: () => void;
}) {
  const ext = item.extracted_data || {};
  const vendor = ext.vendor_name || '—';
  const amount = ext.amount != null ? usd.format(Number(ext.amount))
    : ext.total_value != null ? usd.format(Number(ext.total_value)) : null;

  const showQbInfo = item.doc_type === 'invoice' && (item.status === 'needs_review' || item.status === 'confirmed');

  return (
    <div className={`${styles.queueCard} ${item.qb_match_confidence === 'high' ? styles.cardMatched : item.qb_match_confidence === 'none' ? styles.cardUnmatched : ''}`}>
      <div className={styles.cardRow}>
        <TypeChip
          type={item.doc_type}
          onClick={['needs_review', 'queued', 'extracting'].includes(item.status)
            ? e => { e.stopPropagation(); onFlipType(); } : undefined}
        />
        <span
          className={`${styles.cardFilename} ${item.status === 'needs_review' ? styles.cardFilenameClickable : ''}`}
          title={item.original_filename}
          onClick={item.status === 'needs_review' ? onClick : undefined}
        >
          {item.original_filename}
        </span>
        {item.status === 'failed' && (
          <button className={styles.retryBtn} onClick={e => { e.stopPropagation(); onRetry(); }}>Retry</button>
        )}
        {item.status !== 'confirmed' && item.status !== 'discarded' && (
          <button className={styles.discardSmallBtn} onClick={e => { e.stopPropagation(); onDiscard(); }} title="Remove from queue">✕</button>
        )}
        <StatusBadge status={item.status} />
      </div>
      {(item.status === 'needs_review' || item.status === 'confirmed') && (
        <div className={styles.cardMeta}>
          <span className={styles.cardVendor}>{vendor}</span>
          {amount && <span className={styles.cardAmt}>{amount}</span>}
          {showQbInfo && <QbMatchBadge confidence={item.qb_match_confidence} />}
          {item.project_match === 'uncertain' && (
            <span className={styles.cardProjectWarn} title={item.identified_project || ''}>⚠ project?</span>
          )}
        </div>
      )}
      {showQbInfo && item.qb_vendor && (
        <div className={styles.cardQbRow}>
          <span className={styles.cardQbLabel}>QB:</span>
          <span className={styles.cardQbVendor}>{item.qb_vendor}</span>
          {item.qb_ref_number && <span className={styles.cardQbRef}>#{item.qb_ref_number}</span>}
          {item.qb_amount != null && <span className={styles.cardQbAmt}>{usd.format(Number(item.qb_amount))}</span>}
          {item.qb_gl_code && <span className={styles.cardQbGl}>{item.qb_gl_code}</span>}
        </div>
      )}
      {item.status === 'failed' && item.error_message && (
        <div className={styles.cardError}>{item.error_message}</div>
      )}
    </div>
  );
}

// ── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[], detectedFolder?: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [folderMode, setFolderMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const justDropped = useRef(false);

  const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setDragging(false);
    justDropped.current = true;
    setTimeout(() => { justDropped.current = false; }, 300);
    const all = Array.from(e.dataTransfer.files);
    const files = all.filter(isPdf);
    onFiles(files.length ? files : all);
  }, [onFiles]);

  return (
    <div>
      <div
        className={`${styles.dropZone} ${dragging ? styles.dropZoneDragging : ''}`}
        onDragEnter={e => { e.preventDefault(); setDragging(true); }}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={e => { e.preventDefault(); setDragging(false); }}
        onDrop={handleDrop}
        onClick={() => { if (!justDropped.current) inputRef.current?.click(); }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          {...(folderMode ? { webkitdirectory: '' } : {})}
          onChange={e => {
            const all = Array.from(e.target.files || []);
            const files = all.filter(isPdf);
            if (!files.length) { e.target.value = ''; return; }
            // Extract top-level folder name from webkitRelativePath e.g. "HammerInvoices/file.pdf"
            const folder = folderMode && all[0]?.webkitRelativePath
              ? all[0].webkitRelativePath.split('/')[0]
              : undefined;
            onFiles(files, folder);
            e.target.value = '';
          }}
        />
        <div className={styles.dropIcon}>↑</div>
        <div className={styles.dropText}>
          {folderMode ? 'Click to select a folder of PDFs' : 'Drop PDFs here or click to browse'}
        </div>
        <div className={styles.dropSub}>Contracts and invoices — mixed OK</div>
      </div>
      <div className={styles.dropModeRow}>
        <label className={styles.dropModeLabel}>
          <input
            type="checkbox"
            checked={folderMode}
            onChange={e => setFolderMode(e.target.checked)}
          />
          <span>Select entire folder</span>
        </label>
      </div>
    </div>
  );
}

// ── Main Drawer ──────────────────────────────────────────────────────────────

export function ImportDrawer({ phaseId, onClose, onConfirmed }: Props) {
  const queryClient = useQueryClient();
  const [reviewItem, setReviewItem] = useState<ImportItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [discardedOpen, setDiscardedOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [batchConfirming, setBatchConfirming] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);
  const [batchLabel, setBatchLabel] = useState('');
  const [rematchMsg, setRematchMsg] = useState<string | null>(null);
  const [rematching, setRematching] = useState(false);
  const uploadingRef = useRef(false);

  const { data: queue = [], refetch } = useQuery<ImportItem[]>({
    queryKey: ['importQueue', phaseId],
    queryFn: () => api.getImportQueue(phaseId),
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      const hasActive = items.some((i: ImportItem) => i.status === 'queued' || i.status === 'extracting');
      return hasActive ? 4000 : false;
    },
  });

  const { data: budgetLines = [] } = useQuery<any[]>({
    queryKey: ['budgetLines', phaseId],
    queryFn: () => api.listBudgetLines(phaseId),
  });

  const { data: qbAccounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qb-accounts'],
    queryFn: () => api.listQbAccounts(),
  });

  const pending = queue.filter(i => i.status !== 'confirmed' && i.status !== 'discarded');
  const confirmed = queue.filter(i => i.status === 'confirmed');
  const discarded = queue.filter(i => i.status === 'discarded');
  const done = [...confirmed, ...discarded];
  const failedCount = pending.filter(i => i.status === 'failed').length;

  // Tier split for needs_review items
  const processing = pending.filter(i => i.status === 'queued' || i.status === 'extracting');
  const failedItems = pending.filter(i => i.status === 'failed');
  const needsReview = pending.filter(i => i.status === 'needs_review');
  // Wrong project: filename or clues clearly identify a different project
  const tierWrongProject = needsReview.filter(i => i.project_match === 'mismatch');
  const needsReviewRight = needsReview.filter(i => i.project_match !== 'mismatch');
  const tier1Matched = needsReviewRight.filter(i =>
    i.doc_type === 'invoice' && i.qb_match_confidence === 'high'
  );
  const tier3NoMatch = needsReviewRight.filter(i =>
    i.doc_type === 'invoice' && i.qb_match_confidence === 'none'
  );
  const tier2Review = needsReviewRight.filter(i =>
    !tier1Matched.includes(i) && !tier3NoMatch.includes(i)
  );

  const liveReviewItem = reviewItem ? (queue.find(i => i.id === reviewItem.id) ?? reviewItem) : null;

  const retryMutation = useMutation({
    mutationFn: (id: number) => api.retryImportItem(id),
    onSuccess: () => refetch(),
  });

  const discardOneMutation = useMutation({
    mutationFn: (id: number) => api.discardImportItem(id),
    onSuccess: () => refetch(),
  });

  const clearFailedMutation = useMutation({
    mutationFn: () => api.clearFailedImports(phaseId),
    onSuccess: () => refetch(),
  });

  const handleFiles = async (files: File[], detectedFolder?: string) => {
    if (!files.length) { setUploadError('No PDF files detected.'); return; }
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploadError(null); setUploading(true);
    // Auto-fill batch label from folder name if not already set
    const label = batchLabel.trim() || detectedFolder || '';
    if (detectedFolder && !batchLabel.trim()) setBatchLabel(detectedFolder);
    try { await api.importFiles(phaseId, files, label || undefined); await refetch(); }
    catch (err: any) { setUploadError(err?.message || 'Upload failed'); }
    finally { setUploading(false); uploadingRef.current = false; }
  };

  const handleFlipType = async (item: ImportItem) => {
    const newType = item.doc_type === 'contract' ? 'invoice' : 'contract';
    await api.updateImportItem(item.id, { doc_type: newType });
    await refetch();
  };

  const handleConfirm = async (formData: any) => {
    if (!reviewItem) return;
    setSaving(true);
    try {
      await api.confirmImportItem(reviewItem.id, formData);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['budget', phaseId] });
      queryClient.invalidateQueries({ queryKey: ['phaseContracts', phaseId] });
      queryClient.invalidateQueries({ queryKey: ['invoices', phaseId] });
      onConfirmed?.();
      setReviewItem(null);
    } catch (err: any) {
      console.error('Confirm failed:', err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleBatchConfirmHigh = async () => {
    setBatchConfirming(true);
    setBatchMsg(null);
    try {
      const r = await api.confirmBatchHighConfidence(phaseId);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['budget', phaseId] });
      queryClient.invalidateQueries({ queryKey: ['invoices', phaseId] });
      onConfirmed?.();
      setBatchMsg(`Confirmed ${r.confirmed} of ${r.total}${r.failed ? ` (${r.failed} failed)` : ''}.`);
    } catch (err: any) {
      setBatchMsg(`Error: ${err.message}`);
    } finally {
      setBatchConfirming(false);
    }
  };

  const handleRematchQb = async () => {
    setRematching(true); setRematchMsg(null);
    try {
      const r = await api.rematchQb(phaseId);
      await refetch();
      setRematchMsg(`Re-matched ${r.updated} of ${r.total_items} items (${r.qb_transactions_loaded} QB transactions loaded).`);
    } catch (err: any) {
      setRematchMsg(`Error: ${err.message}`);
    } finally {
      setRematching(false);
    }
  };

  const handleDiscard = async () => {
    if (!reviewItem) return;
    setSaving(true);
    try { await api.discardImportItem(reviewItem.id); await refetch(); setReviewItem(null); }
    catch (err) { console.error('Discard failed:', err); }
    finally { setSaving(false); }
  };

  return (
    <>
      {/* Review overlay — full screen, above the drawer */}
      {liveReviewItem && (
        <ReviewOverlay
          item={liveReviewItem}
          budgetLines={budgetLines}
          qbAccounts={qbAccounts as QbAccount[]}
          onConfirm={handleConfirm}
          onDiscard={handleDiscard}
          onBack={() => setReviewItem(null)}
          saving={saving}
        />
      )}

      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerTitle}>Bulk Import</div>
            <div className={styles.headerSub}>AI classifies and extracts — you review and match to QB</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {needsReview.length > 0 && (
              <button className={styles.rematchBtn}
                onClick={handleRematchQb}
                disabled={rematching}
                title="Re-run QB matching on all pending items">
                {rematching ? 'Matching…' : '⟳ Re-match QB'}
              </button>
            )}
            {failedCount > 0 && (
              <button className={styles.clearFailedBtn}
                onClick={() => clearFailedMutation.mutate()}
                disabled={clearFailedMutation.isPending}>
                Clear {failedCount} failed
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>

        <div className={styles.queueView}>
          {/* Left sidebar: upload controls + status */}
          <div className={styles.queueLeft}>
            <div className={styles.dropZoneWrap}>
              {uploading
                ? <div className={styles.uploadingMsg}><div className={styles.spinner} /> Uploading…</div>
                : <DropZone onFiles={handleFiles} />}
              <div className={styles.batchLabelRow}>
                <label className={styles.batchLabelText}>Source / folder label</label>
                <input
                  className={styles.batchLabelInput}
                  placeholder="e.g. Hammer Invoices — auto-filled from folder name"
                  value={batchLabel}
                  onChange={e => setBatchLabel(e.target.value)}
                />
              </div>
              {uploadError && <div className={styles.uploadErr}>{uploadError}</div>}
            </div>

            {batchMsg && (
              <div className={styles.uploadErr} style={{ margin: '8px 14px 0', background: batchMsg.startsWith('Error') ? undefined : '#e8f5e9', color: batchMsg.startsWith('Error') ? undefined : '#2e7d32', borderColor: batchMsg.startsWith('Error') ? undefined : '#c8e6c9' }}>
                {batchMsg}
              </div>
            )}
            {rematchMsg && (
              <div className={styles.uploadErr} style={{ margin: '8px 14px 0', background: rematchMsg.startsWith('Error') ? undefined : '#e8f5e9', color: rematchMsg.startsWith('Error') ? undefined : '#2e7d32', borderColor: rematchMsg.startsWith('Error') ? undefined : '#c8e6c9' }}>
                {rematchMsg}
              </div>
            )}

            {/* Stats summary */}
            {pending.length > 0 && (
              <div className={styles.queueStats}>
                <div className={styles.queueStatRow}><span className={styles.queueStatDot} style={{ background: '#16a34a' }} /><span>{tier1Matched.length} QB matched</span></div>
                <div className={styles.queueStatRow}><span className={styles.queueStatDot} style={{ background: '#d97706' }} /><span>{tier2Review.length} needs review</span></div>
                <div className={styles.queueStatRow}><span className={styles.queueStatDot} style={{ background: '#9ca3af' }} /><span>{tier3NoMatch.length} no QB match</span></div>
                {tierWrongProject.length > 0 && <div className={styles.queueStatRow}><span className={styles.queueStatDot} style={{ background: '#dc2626' }} /><span>{tierWrongProject.length} wrong project</span></div>}
                {processing.length > 0 && <div className={styles.queueStatRow}><span className={styles.queueStatDot} style={{ background: '#3b82f6' }} /><span>{processing.length} processing…</span></div>}
                {failedItems.length > 0 && <div className={styles.queueStatRow}><span className={styles.queueStatDot} style={{ background: '#c0392b' }} /><span>{failedItems.length} failed</span></div>}
              </div>
            )}
          </div>

          {/* Right: queue tiers */}
          <div className={styles.queueRight}>

          {/* Processing (queued/extracting) */}
          {processing.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionDot} style={{ background: '#3b82f6' }} />
                Processing
                <span className={styles.sectionCount}>{processing.length}</span>
              </div>
              {processing.map(item => (
                <QueueCard key={item.id} item={item}
                  onClick={() => {}} onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {/* Tier 1 — QB Matched (high confidence) */}
          {tier1Matched.length > 0 && (
            <div className={styles.section}>
              <div className={`${styles.sectionHead} ${styles.sectionHeadGreen}`}>
                <span className={styles.sectionDot} style={{ background: '#16a34a' }} />
                ✓ QB Matched
                <span className={styles.sectionCount}>{tier1Matched.length}</span>
                <button
                  className={styles.batchConfirmBtn}
                  onClick={handleBatchConfirmHigh}
                  disabled={batchConfirming}
                >
                  {batchConfirming ? 'Confirming…' : '✓ Confirm All'}
                </button>
              </div>
              {tier1Matched.map(item => (
                <QueueCard key={item.id} item={item}
                  onClick={() => setReviewItem(item)} onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {/* Tier 2 — Needs Review (contracts, medium/low confidence, uncertain project) */}
          {tier2Review.length > 0 && (
            <div className={styles.section}>
              <div className={`${styles.sectionHead} ${styles.sectionHeadAmber}`}>
                <span className={styles.sectionDot} style={{ background: '#d97706' }} />
                ? Needs Review
                <span className={styles.sectionCount}>{tier2Review.length}</span>
              </div>
              {tier2Review.map(item => (
                <QueueCard key={item.id} item={item}
                  onClick={() => setReviewItem(item)} onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {/* Tier 3 — No QB Match */}
          {tier3NoMatch.length > 0 && (
            <div className={styles.section}>
              <div className={`${styles.sectionHead} ${styles.sectionHeadGray}`}>
                <span className={styles.sectionDot} style={{ background: '#9ca3af' }} />
                ✗ No QB Match
                <span className={styles.sectionCount}>{tier3NoMatch.length}</span>
              </div>
              {tier3NoMatch.map(item => (
                <QueueCard key={item.id} item={item}
                  onClick={() => setReviewItem(item)} onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {/* Wrong Project */}
          {tierWrongProject.length > 0 && (
            <div className={styles.section}>
              <div className={`${styles.sectionHead} ${styles.sectionHeadRed}`}>
                <span className={styles.sectionDot} style={{ background: '#dc2626' }} />
                ✗ Wrong Project
                <span className={styles.sectionCount}>{tierWrongProject.length}</span>
              </div>
              <div className={styles.wrongProjectNote}>
                These invoices appear to belong to a different project based on the filename or invoice content. Discard them or move them to the correct phase.
              </div>
              {tierWrongProject.map(item => (
                <QueueCard key={item.id} item={item}
                  onClick={() => setReviewItem(item)} onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {/* Failed */}
          {failedItems.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                Failed
                <span className={styles.sectionCount}>{failedItems.length}</span>
                <button className={styles.clearFailedBtn} style={{ marginLeft: 'auto' }}
                  onClick={() => clearFailedMutation.mutate()} disabled={clearFailedMutation.isPending}>
                  Clear all
                </button>
              </div>
              {failedItems.map(item => (
                <QueueCard key={item.id} item={item}
                  onClick={() => {}} onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {/* Confirmed section */}
          {confirmed.length > 0 && (
            <div className={styles.section}>
              <button className={styles.doneToggle} onClick={() => setDoneOpen(o => !o)}>
                <span>{doneOpen ? '▾' : '▸'} ✓ Confirmed</span>
                <span className={styles.sectionCount}>{confirmed.length}</span>
              </button>
              {doneOpen && confirmed.map(item => (
                <QueueCard key={item.id} item={item}
                  onClick={() => {}} onFlipType={() => {}}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {/* Discarded holding bin */}
          {discarded.length > 0 && (
            <div className={styles.section}>
              <button className={`${styles.doneToggle} ${styles.discardedToggle}`} onClick={() => setDiscardedOpen(o => !o)}>
                <span>{discardedOpen ? '▾' : '▸'} 🗑 Discarded / Rejected</span>
                <span className={styles.sectionCount}>{discarded.length}</span>
              </button>
              {discardedOpen && (
                <>
                  <div className={styles.holdingBinNote}>
                    These were removed from the active queue. Wrong-project invoices should be re-imported into the correct phase.
                  </div>
                  {discarded.map(item => (
                    <QueueCard key={item.id} item={item}
                      onClick={() => {}} onFlipType={() => {}}
                      onRetry={() => retryMutation.mutate(item.id)}
                      onDiscard={() => discardOneMutation.mutate(item.id)} />
                  ))}
                </>
              )}
            </div>
          )}

          {queue.length === 0 && !uploading && (
            <div className={styles.emptyQueue}>Upload a folder of PDFs to get started.</div>
          )}
          </div>{/* end queueRight */}
        </div>{/* end queueView */}
      </div>
    </>
  );
}
