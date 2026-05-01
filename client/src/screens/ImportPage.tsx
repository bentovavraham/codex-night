import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './ImportPage.module.css';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

// ─── Types ────────────────────────────────────────────────────────────────────

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
}

interface LineItem {
  billing_type: 'fixed' | 'tm' | 'expense';
  description: string;
  budgeted_amount: string;
  phase_budget_line_id: number | null;
  differs_from_primary?: boolean;
}

interface InvoiceLineItem {
  billing_type: 'fixed' | 'tm' | 'expense';
  description: string;
  person: string;
  line_date: string;
  hours: string;
  rate: string;
  amount: string;
  qb_account_id: number | null;
  suggested_qb_account_id: number | null;
  qb_suggestion_confidence: string | null;
  phase_budget_line_id: number | null;
  suggested_budget_line_id: number | null;
}

interface QbAccount { id: number; account_number: string; full_name: string; short_name: string; }

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued', extracting: 'Extracting…', needs_review: 'Needs Review',
  confirmed: 'Confirmed', failed: 'Failed', discarded: 'Discarded',
};

// ─── Small shared components ──────────────────────────────────────────────────

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

// ─── Budget line picker (large, for header field) ─────────────────────────────

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

// ─── Inline budget line picker (portal, for task table rows) ──────────────────

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
    return lines.filter(l => l.task_name.toLowerCase().includes(q) || (l.discipline || '').toLowerCase().includes(q));
  }, [lines, query]);

  function openPicker() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 280) });
    setQuery(''); setOpen(true);
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
        title={selected ? `${selected.task_name}${selected.discipline ? ` · ${selected.discipline}` : ''}` : 'Click to assign'}>
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

// ─── QB account picker ────────────────────────────────────────────────────────

function QbPicker({ accounts, value, suggestedId, suggestionConfidence: _suggestionConfidence, onChange }: {
  accounts: QbAccount[]; value: number | null; suggestedId: number | null;
  suggestionConfidence: string | null; onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected  = accounts.find(a => a.id === value) ?? null;
  const suggested = accounts.find(a => a.id === suggestedId) ?? null;
  const display   = selected ?? suggested;
  const isAi      = !selected && !!suggested;
  const filtered  = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.toLowerCase();
    return accounts.filter(a => a.account_number.toLowerCase().includes(q) || a.full_name.toLowerCase().includes(q));
  }, [accounts, query]);
  useEffect(() => {
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);
  return (
    <div ref={ref} className={styles.qbPicker}>
      <div className={`${styles.qbDisplay} ${isAi ? styles.qbAi : ''} ${!display ? styles.qbEmpty : ''}`}
        onClick={() => { setQuery(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 20); }}>
        {display ? (
          <>
            <span className={styles.qbNum}>{display.account_number}</span>
            <span className={styles.qbName}>{display.full_name}</span>
            <button className={styles.qbClear} onClick={e => { e.stopPropagation(); onChange(null); }}>✕</button>
          </>
        ) : <span className={styles.qbPlaceholder}>Category…</span>}
      </div>
      {open && (
        <div className={styles.qbDropdown}>
          <input ref={inputRef} className={styles.qbSearch} value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Search by number or name…" />
          <div className={styles.qbList}>
            {filtered.map(a => (
              <div key={a.id} className={`${styles.qbOption} ${a.id === (value ?? suggestedId) ? styles.qbOptionSelected : ''}`}
                onMouseDown={() => { onChange(a.id); setOpen(false); }}>
                <span className={styles.qbOptNum}>{a.account_number}</span>
                <span className={styles.qbOptName}>{a.full_name}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.qbNoMatch}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Duplicate warning ────────────────────────────────────────────────────────

function DupBanner({ matches, acknowledged, onAck }: {
  matches: any[]; acknowledged: boolean; onAck: () => void;
}) {
  if (!matches.length) return null;
  const exact = matches.filter(m => m.match_type === 'exact');
  return (
    <div className={`${styles.dupBanner} ${exact.length ? styles.dupBannerExact : styles.dupBannerFuzzy}`}>
      <div className={styles.dupTitle}>{exact.length ? '⚠ Possible Duplicate' : '~ Similar Record Found'}</div>
      <div className={styles.dupList}>
        {matches.map((m, i) => (
          <div key={i} className={styles.dupRow}>
            <span className={`${styles.dupTag} ${m.match_type === 'exact' ? styles.dupTagExact : styles.dupTagFuzzy}`}>
              {m.match_type === 'exact' ? 'EXACT' : 'SIMILAR'}
            </span>
            <span className={styles.dupDetail}>
              {m.vendor_name} — {m.invoice_number || m.reference_number || '—'} — {usd2.format(Number(m.amount))}
            </span>
          </div>
        ))}
      </div>
      {!acknowledged
        ? <label className={styles.dupAck}><input type="checkbox" onChange={e => { if (e.target.checked) onAck(); }} /><span>Confirmed not a duplicate</span></label>
        : <div className={styles.dupAcked}>✓ Acknowledged</div>}
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
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
    <div
      className={`${styles.dropZone} ${dragging ? styles.dropZoneDragging : ''}`}
      onDragEnter={e => { e.preventDefault(); setDragging(true); }}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => { e.preventDefault(); setDragging(false); }}
      onDrop={handleDrop}
      onClick={() => { if (!justDropped.current) inputRef.current?.click(); }}
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden
        onChange={e => { const f = Array.from(e.target.files || []).filter(isPdf); if (f.length) onFiles(f); e.target.value = ''; }} />
      <div className={styles.dropIcon}>↑</div>
      <div className={styles.dropLabel}>Drop PDFs or click to browse</div>
    </div>
  );
}

// ─── Queue card ───────────────────────────────────────────────────────────────

function QueueCard({ item, selected, onClick, onFlipType, onRetry, onDiscard }: {
  item: ImportItem; selected: boolean; onClick: () => void;
  onFlipType: () => void; onRetry: () => void; onDiscard: () => void;
}) {
  const ext = item.extracted_data || {};
  const vendor = ext.vendor_name || '—';
  const amount = ext.amount != null ? usd.format(Number(ext.amount))
    : ext.total_value != null ? usd.format(Number(ext.total_value)) : null;

  return (
    <div
      className={`${styles.qCard} ${selected ? styles.qCardSelected : ''} ${item.status === 'needs_review' ? styles.qCardClickable : ''}`}
      onClick={item.status === 'needs_review' ? onClick : undefined}
    >
      <div className={styles.qCardRow}>
        <TypeChip type={item.doc_type}
          onClick={['needs_review','queued','extracting'].includes(item.status) ? e => { e.stopPropagation(); onFlipType(); } : undefined} />
        <span className={styles.qCardFile} title={item.original_filename}>{item.original_filename}</span>
        {item.status === 'failed' && (
          <button className={styles.retryBtn} onClick={e => { e.stopPropagation(); onRetry(); }}>Retry</button>
        )}
        {!['confirmed','discarded'].includes(item.status) && (
          <button className={styles.discardSmallBtn} onClick={e => { e.stopPropagation(); onDiscard(); }} title="Remove">✕</button>
        )}
        <StatusBadge status={item.status} />
      </div>
      {['needs_review','confirmed'].includes(item.status) && (
        <div className={styles.qCardMeta}>
          <span className={styles.qCardVendor}>{vendor}</span>
          {amount && <span className={styles.qCardAmt}>{amount}</span>}
        </div>
      )}
      {item.status === 'failed' && item.error_message && (
        <div className={styles.qCardError}>{item.error_message}</div>
      )}
    </div>
  );
}

// ─── Review form (right panel content) ───────────────────────────────────────

function ReviewForm({ item, budgetLines, contracts, qbAccounts, onConfirm, onDiscard, saving }: {
  item: ImportItem;
  budgetLines: any[];
  contracts: any[];
  qbAccounts: QbAccount[];
  onConfirm: (formData: any) => Promise<void>;
  onDiscard: () => Promise<void>;
  saving: boolean;
}) {
  const ext = item.extracted_data || {};
  const isContract = item.doc_type === 'contract';

  const [vendor, setVendor] = useState(ext.vendor_name || '');
  const [description, setDescription] = useState(ext.description || ext.summary || '');
  const [budgetLineId, setBudgetLineId] = useState<number | null>(
    isContract
      ? (ext.suggested_primary_budget_line_id ?? item.suggested_budget_line_id ?? null)
      : (ext.suggested_primary_budget_line_id ?? item.suggested_budget_line_id ?? null)
  );
  const [reviewed, setReviewed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const [invoiceNumber, setInvoiceNumber] = useState(ext.invoice_number || '');
  const [amount, setAmount] = useState(ext.amount ? String(ext.amount) : '');
  const [invoiceDate, setInvoiceDate] = useState(ext.invoice_date || '');
  const [invoiceStatus, setInvoiceStatus] = useState('pending');
  const [contractId, setContractId] = useState<number | null>(ext.suggested_contract_id ?? null);
  const [invoiceLineItems, setInvoiceLineItems] = useState<InvoiceLineItem[]>(() =>
    (ext.line_items || []).map((li: any) => ({
      billing_type: (['fixed','tm','expense'].includes(li.billing_type) ? li.billing_type : 'fixed') as InvoiceLineItem['billing_type'],
      description: li.description || '',
      person: li.person || '',
      line_date: li.line_date || '',
      hours: li.hours != null ? String(li.hours) : '',
      rate: li.rate != null ? String(li.rate) : '',
      amount: li.amount != null ? String(li.amount) : '',
      qb_account_id: null,
      suggested_qb_account_id: li.suggested_qb_account_id ?? null,
      qb_suggestion_confidence: li.qb_suggestion_confidence ?? null,
      phase_budget_line_id: li.suggested_budget_line_id ?? null,
      suggested_budget_line_id: li.suggested_budget_line_id ?? null,
    }))
  );

  const [dupMatches, setDupMatches] = useState<any[]>([]);
  const [dupAcked, setDupAcked] = useState(false);
  const [dupLoading, setDupLoading] = useState(true);

  useEffect(() => {
    setDupLoading(true);
    api.checkImportDuplicates(item.id)
      .then(r => setDupMatches(r.matches))
      .catch(() => setDupMatches([]))
      .finally(() => setDupLoading(false));
  }, [item.id]);

  const hasLineItems = lineItems.length > 0;
  const fixedTotal = lineItems.filter(li => li.billing_type === 'fixed').reduce((s, li) => s + (Number(li.budgeted_amount) || 0), 0);

  const invLineTotal = invoiceLineItems.reduce((s, li) => s + (Number(li.amount) || 0), 0);
  const hasInvLines = invoiceLineItems.length > 0;

  function addInvLine() { setInvoiceLineItems(li => [...li, { billing_type: 'fixed', description: '', person: '', line_date: '', hours: '', rate: '', amount: '', qb_account_id: null, suggested_qb_account_id: null, qb_suggestion_confidence: null, phase_budget_line_id: null, suggested_budget_line_id: null }]); }
  function removeInvLine(idx: number) { setInvoiceLineItems(li => li.filter((_, i) => i !== idx)); }
  function setInvLine(idx: number, patch: Partial<InvoiceLineItem>) {
    setInvoiceLineItems(li => { const n = [...li]; n[idx] = { ...n[idx], ...patch }; return n; });
  }
  const hasTm = lineItems.some(li => li.billing_type === 'tm');
  const dupBlocked = dupMatches.length > 0 && !dupAcked;
  const hasBudgetTarget = isContract ? true : (!!contractId || !!budgetLineId);
  const canConfirm = reviewed && !!vendor.trim() && !dupBlocked && !saving && hasBudgetTarget;
  const confirmingRef = useRef(false);

  function addLine() { setLineItems(li => [...li, { billing_type: 'fixed', description: '', budgeted_amount: '', phase_budget_line_id: null }]); }
  function removeLine(idx: number) { setLineItems(li => li.filter((_, i) => i !== idx)); }
  function setLine(idx: number, patch: Partial<LineItem>) {
    setLineItems(li => { const n = [...li]; n[idx] = { ...n[idx], ...patch }; return n; });
  }

  async function handleConfirm() {
    if (confirmingRef.current) return;
    setSaveError(null);
    if (!vendor.trim()) return setSaveError('Vendor name is required.');
    if (!hasLineItems && !budgetLineId && isContract) return setSaveError('Budget line is required when there are no contract tasks.');
    if (!isContract && !contractId && !budgetLineId) return setSaveError('Link to a contract or select a budget line.');
    if (!reviewed) return setSaveError('Please confirm you have reviewed the details.');
    if (dupBlocked) return setSaveError('Please acknowledge the duplicate warning.');
    const base = { vendor_name: vendor.trim(), description, phase_budget_line_id: budgetLineId };
    const invTypes = new Set(invoiceLineItems.map(li => li.billing_type));
    const derivedType = invTypes.has('tm') ? 'tm' : invTypes.has('expense') ? 'expense' : 'fixed';
    const formData = isContract
      ? { ...base, total_value: Number(totalValue) || 0, contract_date: contractDate || null,
          reference_number: referenceNumber || null, status: contractStatus,
          line_items: lineItems.filter(li => li.description.trim()).map(li => ({
            billing_type: li.billing_type, description: li.description,
            budgeted_amount: Number(li.budgeted_amount) || 0,
            phase_budget_line_id: li.phase_budget_line_id ?? null,
          })) }
      : { ...base, invoice_number: invoiceNumber,
          contract_id: contractId,
          amount: hasInvLines ? invLineTotal : (Number(amount) || 0),
          invoice_date: invoiceDate || null, invoice_type: derivedType, status: invoiceStatus,
          line_items: invoiceLineItems.filter(li => li.description.trim() || Number(li.amount)).map(li => ({
            billing_type: li.billing_type, description: li.description,
            person: li.person || null, line_date: li.line_date || null,
            hours: li.hours ? Number(li.hours) : null, rate: li.rate ? Number(li.rate) : null,
            amount: Number(li.amount) || 0,
            qb_account_id: li.qb_account_id ?? li.suggested_qb_account_id ?? null,
            phase_budget_line_id: li.phase_budget_line_id ?? null,
          })) };
    confirmingRef.current = true;
    try { await onConfirm(formData); }
    finally { confirmingRef.current = false; }
  }

  return (
    <div className={styles.formWrap}>
      {/* Form header */}
      <div className={styles.formHeader}>
        <TypeChip type={item.doc_type} />
        <span className={styles.formHeaderFile} title={item.original_filename}>{item.original_filename}</span>
      </div>

      {/* Dup warning */}
      {!dupLoading && <DupBanner matches={dupMatches} acknowledged={dupAcked} onAck={() => setDupAcked(true)} />}
      {dupLoading && <div className={styles.dupChecking}>Checking for duplicates…</div>}

      {/* Scrollable body */}
      <div className={styles.formBody}>

        <div className={styles.fGroup}>
          <label className={styles.fLabel}>Vendor / Payee</label>
          <input className={styles.fInput} value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Who is this from?" />
        </div>

        {!hasLineItems ? (
          <div className={styles.fGroup}>
            <label className={styles.fLabel}>Task / Budget Line <span className={styles.fRequired}>required</span></label>
            <BudgetLinePicker lines={budgetLines} value={budgetLineId} onChange={setBudgetLineId} />
          </div>
        ) : (
          <div className={styles.fGroup}>
            <label className={styles.fLabel}>Fallback Budget Line <span className={styles.fHint}>used only for tasks with no specific assignment</span></label>
            <BudgetLinePicker lines={budgetLines} value={budgetLineId} onChange={setBudgetLineId} />
          </div>
        )}

        {isContract ? (
          <>
            <div className={styles.fRow}>
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Total Value</label>
                <input className={`${styles.fInput} ${styles.mono}`} value={totalValue}
                  onChange={e => setTotalValue(e.target.value)} type="number" min="0" step="0.01" placeholder="0.00" />
              </div>
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Contract Date</label>
                <input className={styles.fInput} value={contractDate} onChange={e => setContractDate(e.target.value)} type="date" />
              </div>
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Ref / Contract #</label>
                <input className={styles.fInput} value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} placeholder="e.g. 24117" />
              </div>
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Status</label>
                <select className={styles.fSelect} value={contractStatus} onChange={e => setContractStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>

            <div className={styles.fGroup}>
              <label className={styles.fLabel}>Scope / Description</label>
              <textarea className={styles.fTextarea} value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Brief description…" />
            </div>

            {/* Contract tasks table */}
            <div className={styles.tasksSection}>
              <div className={styles.tasksSectionTitle}>
                Contract Tasks
                {fixedTotal > 0 && <span className={styles.tasksTotal}>{usd2.format(fixedTotal)} fixed{hasTm ? ' + T&M' : ''}</span>}
              </div>
              <table className={styles.tasksTable}>
                <thead>
                  <tr className={styles.tasksThead}>
                    <th className={styles.tColBl}>BUDGET LINE</th>
                    <th className={styles.tColType}>TYPE</th>
                    <th className={styles.tColDesc}>DESCRIPTION</th>
                    <th className={`${styles.tColAmt} ${styles.right}`}>AMOUNT</th>
                    <th className={styles.tColDel} />
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li, i) => (
                    <tr key={i} className={`${styles.tRow} ${li.differs_from_primary ? styles.tRowFlagged : ''}`}>
                      <td className={styles.tColBl}>
                        <InlineBudgetLinePicker lines={budgetLines} value={li.phase_budget_line_id}
                          onChange={id => setLine(i, { phase_budget_line_id: id })} />
                      </td>
                      <td className={styles.tColType}>
                        <select className={styles.tTypeSelect} value={li.billing_type}
                          onChange={e => setLine(i, { billing_type: e.target.value as LineItem['billing_type'] })}>
                          <option value="fixed">Fixed</option>
                          <option value="tm">T&amp;M</option>
                          <option value="expense">Exp</option>
                        </select>
                      </td>
                      <td className={styles.tColDesc}>
                        <input className={styles.tDescInput} value={li.description}
                          onChange={e => setLine(i, { description: e.target.value })}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }}
                          placeholder="Task description" />
                      </td>
                      <td className={`${styles.tColAmt} ${styles.right}`}>
                        {li.billing_type === 'tm'
                          ? <span className={styles.tmTag}>T&amp;M</span>
                          : <input className={`${styles.tAmtInput} ${styles.mono}`} value={li.budgeted_amount}
                              onChange={e => setLine(i, { budgeted_amount: e.target.value })} placeholder="0.00"
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }} />}
                      </td>
                      <td className={styles.tColDel}>
                        <button className={styles.tDelBtn} onClick={() => removeLine(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.tasksFooter}>
                <button className={styles.addBtn} onClick={addLine}>+ Add task</button>
                {lineItems.some(li => li.differs_from_primary) && (
                  <button className={styles.clearBtn} onClick={() =>
                    setLineItems(items => items.map(li => ({ ...li, differs_from_primary: false, phase_budget_line_id: null })))
                  }>Clear overrides</button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Contract link */}
            <div className={styles.fGroup}>
              <label className={styles.fLabel}>Contract <span className={styles.fHint}>optional — links this invoice to a contract</span></label>
              <select className={styles.fSelect} value={contractId ?? ''}
                onChange={e => setContractId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— No contract (standalone invoice) —</option>
                {contracts.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.vendor_name}{c.reference_number ? ` · ${c.reference_number}` : ''} (${Number(c.total_value).toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            {/* Budget line — required when no contract */}
            {!contractId && (
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Task / Budget Line <span className={styles.fRequired}>required</span></label>
                <BudgetLinePicker lines={budgetLines} value={budgetLineId} onChange={setBudgetLineId} />
              </div>
            )}

            <div className={styles.fRow}>
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Invoice #</label>
                <input className={styles.fInput} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. 8241" />
              </div>
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Invoice Date</label>
                <input className={styles.fInput} value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} type="date" />
              </div>
              <div className={styles.fGroup}>
                <label className={styles.fLabel}>Status</label>
                <select className={styles.fSelect} value={invoiceStatus} onChange={e => setInvoiceStatus(e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="pm_approved">PM Approved</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>

            <div className={styles.fGroup}>
              <label className={styles.fLabel}>Description / Scope</label>
              <textarea className={styles.fTextarea} value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="What is this invoice for?" />
            </div>

            {/* Category details — full line item table */}
            <div className={styles.tasksSection}>
              <div className={styles.tasksSectionTitle}>
                Category Details
                {hasInvLines && <span className={styles.tasksTotal}>{usd2.format(invLineTotal)}</span>}
              </div>
              <table className={styles.tasksTable}>
                <thead>
                  <tr className={styles.tasksThead}>
                    <th className={styles.tColHash}>#</th>
                    <th className={styles.tColBl}>BUDGET LINE</th>
                    <th className={styles.tColCat}>QB CATEGORY</th>
                    <th className={styles.tColType}>TYPE</th>
                    <th className={styles.tColDesc}>DESCRIPTION</th>
                    <th className={`${styles.tColAmt} ${styles.right}`}>AMOUNT</th>
                    <th className={styles.tColDel} />
                  </tr>
                </thead>
                <tbody>
                  {invoiceLineItems.map((li, i) => (
                    <tr key={i} className={`${styles.tRow} ${li.phase_budget_line_id !== li.suggested_budget_line_id && li.suggested_budget_line_id ? styles.tRowFlagged : ''}`}>
                      <td className={styles.tColHash}>{i + 1}</td>
                      <td className={styles.tColBl}>
                        <InlineBudgetLinePicker lines={budgetLines} value={li.phase_budget_line_id}
                          onChange={id => setInvLine(i, { phase_budget_line_id: id })} />
                      </td>
                      <td className={styles.tColCat}>
                        <QbPicker accounts={qbAccounts} value={li.qb_account_id}
                          suggestedId={li.suggested_qb_account_id} suggestionConfidence={li.qb_suggestion_confidence}
                          onChange={id => setInvLine(i, { qb_account_id: id })} />
                      </td>
                      <td className={styles.tColType}>
                        <select className={styles.tTypeSelect} value={li.billing_type}
                          onChange={e => setInvLine(i, { billing_type: e.target.value as InvoiceLineItem['billing_type'] })}>
                          <option value="fixed">Fixed</option>
                          <option value="tm">T&amp;M</option>
                          <option value="expense">Expense</option>
                        </select>
                      </td>
                      <td className={styles.tColDesc}>
                        <input className={styles.tDescInput} value={li.description}
                          onChange={e => setInvLine(i, { description: e.target.value })} placeholder="Description"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvLine(); } }} />
                        {li.billing_type === 'tm' && (
                          <div className={styles.tmSub}>
                            <input className={styles.tmField} value={li.person} onChange={e => setInvLine(i, { person: e.target.value })} placeholder="Person" />
                            <input className={styles.tmField} type="date" value={li.line_date} onChange={e => setInvLine(i, { line_date: e.target.value })} />
                            <input className={styles.tmField} value={li.hours} onChange={e => setInvLine(i, { hours: e.target.value })} placeholder="hrs" style={{ width: 44 }} />
                            <span className={styles.tmSep}>×</span>
                            <input className={styles.tmField} value={li.rate} onChange={e => setInvLine(i, { rate: e.target.value })} placeholder="rate" style={{ width: 54 }} />
                          </div>
                        )}
                      </td>
                      <td className={`${styles.tColAmt} ${styles.right}`}>
                        <input className={`${styles.tAmtInput} ${styles.mono}`} value={li.amount}
                          onChange={e => setInvLine(i, { amount: e.target.value })} placeholder="0.00"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addInvLine(); } }} />
                      </td>
                      <td className={styles.tColDel}>
                        <button className={styles.tDelBtn} onClick={() => removeInvLine(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.tasksFooter}>
                <button className={styles.addBtn} onClick={addInvLine}>+ Add line</button>
                {hasInvLines && invoiceLineItems.length > 0 && Math.abs(invLineTotal - (Number(amount) || 0)) > 0.02 && (
                  <span className={styles.totalMismatch}>⚠ Lines total {usd2.format(invLineTotal)}, header says {usd2.format(Number(amount))}</span>
                )}
              </div>
            </div>

            {/* Total amount (header) */}
            <div className={styles.fGroup}>
              <label className={styles.fLabel}>Total Amount</label>
              <input className={`${styles.fInput} ${styles.mono}`} value={hasInvLines ? usd2.format(invLineTotal) : amount}
                onChange={e => { if (!hasInvLines) setAmount(e.target.value); }}
                readOnly={hasInvLines} style={hasInvLines ? { background: '#f5f0eb' } : {}}
                placeholder="0.00" />
            </div>
          </>
        )}
      </div>

      {/* Sticky footer */}
      <div className={styles.formFooter}>
        <label className={styles.reviewCheck}>
          <input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
          <span>I have reviewed this document and confirm all details are correct</span>
        </label>
        {saveError && <div className={styles.saveError}>{saveError}</div>}
        <div className={styles.formActions}>
          <button className={styles.discardBtn} onClick={onDiscard} disabled={saving}>Discard</button>
          <button className={styles.confirmBtn} onClick={handleConfirm} disabled={!canConfirm}>
            {saving ? 'Saving…' : 'Confirm & Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const { projectId: _projectId, phaseId } = useParams<{ projectId: string; phaseId: string }>();
  const phaseIdNum = Number(phaseId);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const uploadingRef = useRef(false);

  // Resizable form panel
  const [formWidth, setFormWidth] = useState(() => Math.min(480, Math.round(window.innerWidth * 0.38)));
  const dragState = useRef<{ active: boolean; startX: number; startW: number }>({ active: false, startX: 0, startW: 0 });

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragState.current.active) return;
      const delta = dragState.current.startX - e.clientX;
      const maxW = window.innerWidth - 260 - 200;
      setFormWidth(Math.max(340, Math.min(maxW, dragState.current.startW + delta)));
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

  const { data: queue = [], refetch } = useQuery<ImportItem[]>({
    queryKey: ['importQueue', phaseIdNum],
    queryFn: () => api.getImportQueue(phaseIdNum),
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      const hasActive = items.some((i: ImportItem) => ['queued','extracting'].includes(i.status));
      return hasActive ? 3000 : false;
    },
  });

  const { data: budgetLines = [] } = useQuery<any[]>({
    queryKey: ['budgetLines', phaseIdNum],
    queryFn: () => api.listBudgetLines(phaseIdNum),
    staleTime: 60_000,
  });

  const { data: contracts = [] } = useQuery<any[]>({
    queryKey: ['phaseContracts', phaseIdNum],
    queryFn: () => api.listContracts(phaseIdNum),
    staleTime: 30_000,
  });

  const { data: qbAccounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qbAccounts'],
    queryFn: () => api.listQbAccounts(),
    staleTime: Infinity,
  });

  const pending = queue.filter(i => !['confirmed','discarded'].includes(i.status));
  const done    = queue.filter(i =>  ['confirmed','discarded'].includes(i.status));
  const failedCount = pending.filter(i => i.status === 'failed').length;

  // Keep selectedId in sync — auto-select first needs_review if nothing selected
  useEffect(() => {
    if (selectedId !== null) return;
    const first = queue.find(i => i.status === 'needs_review');
    if (first) setSelectedId(first.id);
  }, [queue, selectedId]);

  const selectedItem = queue.find(i => i.id === selectedId) ?? null;
  const pdfSrc = selectedItem?.file_reference
    ? `/api/files/${encodeURIComponent(selectedItem.file_reference)}`
    : null;

  const retryMutation = useMutation({
    mutationFn: (id: number) => api.retryImportItem(id),
    onSuccess: () => refetch(),
  });
  const discardMutation = useMutation({
    mutationFn: (id: number) => api.discardImportItem(id),
    onSuccess: (_, id) => {
      if (selectedId === id) advanceSelection(id);
      refetch();
    },
  });
  const clearFailedMutation = useMutation({
    mutationFn: () => api.clearFailedImports(phaseIdNum),
    onSuccess: () => refetch(),
  });

  const reprocessMutation = useMutation({
    mutationFn: () => api.reprocessImports(phaseIdNum),
    onSuccess: () => refetch(),
  });

  function advanceSelection(doneId: number) {
    const remaining = queue.filter(i => i.status === 'needs_review' && i.id !== doneId);
    setSelectedId(remaining.length > 0 ? remaining[0].id : null);
  }

  const handleFiles = async (files: File[]) => {
    if (!files.length) { setUploadError('No PDF files detected.'); return; }
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploadError(null); setUploading(true);
    try { await api.importFiles(phaseIdNum, files); await refetch(); }
    catch (err: any) { setUploadError(err?.message || 'Upload failed'); }
    finally { setUploading(false); uploadingRef.current = false; }
  };

  const handleFlipType = async (item: ImportItem) => {
    const newType = item.doc_type === 'contract' ? 'invoice' : 'contract';
    await api.updateImportItem(item.id, { doc_type: newType });
    await refetch();
  };

  const handleConfirm = async (formData: any) => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      await api.confirmImportItem(selectedItem.id, formData);
      await refetch();
      qc.invalidateQueries({ queryKey: ['budget', phaseIdNum] });
      qc.invalidateQueries({ queryKey: ['phaseContracts', phaseIdNum] });
      qc.invalidateQueries({ queryKey: ['invoices', phaseIdNum] });
      advanceSelection(selectedItem.id);
    } catch (err: any) {
      console.error('Confirm failed:', err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = async () => {
    if (!selectedItem) return;
    setSaving(true);
    try { await api.discardImportItem(selectedItem.id); await refetch(); advanceSelection(selectedItem.id); }
    catch (err) { console.error('Discard failed:', err); }
    finally { setSaving(false); }
  };

  return (
    <div className={styles.page}>

      {/* ── Left: Queue panel ── */}
      <div className={styles.queuePanel}>
        <div className={styles.queueHeader}>
          <span className={styles.queueTitle}>Import Queue</span>
          {pending.filter(i => i.status === 'needs_review').length > 0 && (
            <button className={styles.reprocessBtn} onClick={() => reprocessMutation.mutate()}
              disabled={reprocessMutation.isPending} title="Re-run AI on all pending items">
              {reprocessMutation.isPending ? '…' : '↺ Re-process'}
            </button>
          )}
          {failedCount > 0 && (
            <button className={styles.clearFailedBtn} onClick={() => clearFailedMutation.mutate()}
              disabled={clearFailedMutation.isPending}>
              Clear {failedCount} failed
            </button>
          )}
        </div>

        <div className={styles.queueDropWrap}>
          {uploading
            ? <div className={styles.uploadingMsg}><div className={styles.spinner} /> Uploading…</div>
            : <DropZone onFiles={handleFiles} />}
          {uploadError && <div className={styles.uploadErr}>{uploadError}</div>}
        </div>

        <div className={styles.queueList}>
          {pending.length > 0 && (
            <div className={styles.qSection}>
              <div className={styles.qSectionHead}>Pending <span className={styles.qCount}>{pending.length}</span></div>
              {pending.map(item => (
                <QueueCard key={item.id} item={item} selected={selectedId === item.id}
                  onClick={() => setSelectedId(item.id)}
                  onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {done.length > 0 && (
            <div className={styles.qSection}>
              <button className={styles.doneToggle} onClick={() => setDoneOpen(o => !o)}>
                <span>{doneOpen ? '▾' : '▸'} Done</span>
                <span className={styles.qCount}>{done.length}</span>
              </button>
              {doneOpen && done.map(item => (
                <QueueCard key={item.id} item={item} selected={false}
                  onClick={() => {}}
                  onFlipType={() => {}}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardMutation.mutate(item.id)} />
              ))}
            </div>
          )}

          {queue.length === 0 && !uploading && (
            <div className={styles.emptyQueue}>Drop PDFs above to start</div>
          )}
        </div>
      </div>

      {/* ── Center: PDF viewer ── */}
      <div className={styles.pdfPanel}>
        {pdfSrc ? (
          <>
            <iframe src={pdfSrc} className={styles.pdfFrame} title="Document" />
            <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className={styles.openPdfBtn}
              title="Open in new tab to search (Cmd+F)">⬆ Open &amp; Search</a>
          </>
        ) : (
          <div className={styles.pdfEmpty}>
            <div className={styles.pdfEmptyIcon}>📄</div>
            <div className={styles.pdfEmptyText}>Select an item from the queue to review</div>
          </div>
        )}
      </div>

      {/* ── Drag handle ── */}
      <div className={styles.dragHandle} onMouseDown={startDrag} />

      {/* ── Right: Review form ── */}
      <div className={styles.formPanel} style={{ width: formWidth }}>
        {selectedItem ? (
          <ReviewForm
            key={selectedItem.id}
            item={selectedItem}
            budgetLines={budgetLines}
            contracts={contracts}
            qbAccounts={qbAccounts}
            onConfirm={handleConfirm}
            onDiscard={handleDiscard}
            saving={saving}
          />
        ) : (
          <div className={styles.formEmpty}>
            <div className={styles.formEmptyText}>Select a contract or invoice from the queue</div>
          </div>
        )}
      </div>

    </div>
  );
}
