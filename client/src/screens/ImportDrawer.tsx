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
}

interface Props {
  phaseId: number;
  onClose: () => void;
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

interface LineItem {
  billing_type: 'fixed' | 'tm' | 'expense';
  description: string;
  budgeted_amount: string;
  phase_budget_line_id: number | null;
  differs_from_primary?: boolean;
}

function ReviewOverlay({ item, budgetLines, onConfirm, onDiscard, onBack, saving }: {
  item: ImportItem;
  budgetLines: any[];
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
  const [budgetLineId, setBudgetLineId] = useState<number | null>(
    ext.suggested_primary_budget_line_id ?? item.suggested_budget_line_id ?? null
  );
  const [reviewed, setReviewed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Resizable form pane
  const [formWidth, setFormWidth] = useState(() => Math.min(520, Math.round(window.innerWidth * 0.45)));
  const dragState = useRef<{ active: boolean; startX: number; startW: number }>({ active: false, startX: 0, startW: 0 });

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragState.current.active) return;
      const delta = dragState.current.startX - e.clientX;
      const maxW = window.innerWidth - 200;
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

  const dupBlocked = dupMatches.length > 0 && !dupAcked;
  const canConfirm = reviewed && !!vendor.trim() && !dupBlocked && !saving;

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
    if (!hasLineItems && !budgetLineId) return setSaveError('Budget line is required when there are no contract tasks.');
    if (!reviewed) return setSaveError('Please confirm you have reviewed the details.');
    if (dupBlocked) return setSaveError('Please acknowledge the duplicate warning.');

    const base = { vendor_name: vendor.trim(), description, phase_budget_line_id: budgetLineId };
    const formData = isContract
      ? { ...base, total_value: Number(totalValue) || 0, contract_date: contractDate || null,
          reference_number: referenceNumber || null, status: contractStatus,
          line_items: lineItems.filter(li => li.description.trim()).map(li => ({
            billing_type: li.billing_type, description: li.description,
            budgeted_amount: Number(li.budgeted_amount) || 0,
            phase_budget_line_id: li.phase_budget_line_id ?? null,
          })) }
      : { ...base, invoice_number: invoiceNumber, amount: Number(amount) || 0,
          invoice_date: invoiceDate || null, invoice_type: invoiceType, status: invoiceStatus };
    confirmingRef.current = true;
    try { await onConfirm(formData); }
    finally { confirmingRef.current = false; }
  }

  return (
    <div className={styles.reviewOverlay}>
      {/* Left: PDF */}
      <div className={styles.reviewPdfPane}>
        {pdfSrc
          ? <iframe src={pdfSrc} className={styles.reviewPdfFrame} title="Document" />
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

          {/* Budget line — only required for simple contracts with no task breakdown */}
          {!hasLineItems && (
            <div className={styles.rGroup}>
              <label className={styles.rLabel}>Task / Budget Line <span className={styles.rRequired}>required</span></label>
              <BudgetLinePicker lines={budgetLines} value={budgetLineId} onChange={setBudgetLineId} />
            </div>
          )}
          {hasLineItems && (
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

              {/* Line items — read-only preview */}
              {ext.line_items?.length > 0 && (
                <div className={styles.rSection}>
                  <div className={styles.rSectionTitle}>Line Items ({ext.line_items.length})</div>
                  <table className={styles.rTable}>
                    <thead>
                      <tr className={styles.rThead}>
                        <th className={styles.rColType}>TYPE</th>
                        <th className={styles.rColDesc}>DESCRIPTION</th>
                        <th className={`${styles.rColAmt} ${styles.right}`}>AMOUNT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ext.line_items.map((li: any, i: number) => (
                        <tr key={i} className={styles.rTrow}>
                          <td className={styles.rColType}>
                            <span className={styles.rTypeBadge}>{(li.billing_type || 'fixed').toUpperCase()}</span>
                          </td>
                          <td className={styles.rColDesc} style={{ color: 'var(--text-2)', fontSize: 11 }}>
                            {li.person && <span style={{ fontWeight: 600, marginRight: 6 }}>{li.person}</span>}
                            {li.description}
                            {li.hours && <span style={{ color: 'var(--text-4)', marginLeft: 6 }}>{li.hours}h @ ${li.rate}/h</span>}
                          </td>
                          <td className={`${styles.rColAmt} ${styles.right} ${styles.mono}`} style={{ fontSize: 11 }}>
                            {usd2.format(Number(li.amount || li.budgeted_amount || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div className={styles.reviewFormFooter}>
          <label className={styles.reviewCheck}>
            <input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
            <span>I have reviewed this document and confirm all details are correct</span>
          </label>
          {saveError && <div className={styles.reviewSaveError}>{saveError}</div>}
          <div className={styles.reviewActions}>
            <button className={styles.discardBtn} onClick={onDiscard} disabled={saving}>Discard</button>
            <button className={styles.confirmBtn} onClick={handleConfirm} disabled={!canConfirm}>
              {saving ? 'Saving…' : 'Confirm & Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Queue Card ───────────────────────────────────────────────────────────────

function QueueCard({ item, onClick, onFlipType, onRetry, onDiscard }: {
  item: ImportItem; onClick: () => void; onFlipType: () => void;
  onRetry: () => void; onDiscard: () => void;
}) {
  const ext = item.extracted_data || {};
  const vendor = ext.vendor_name || '—';
  const amount = ext.amount != null ? usd.format(Number(ext.amount))
    : ext.total_value != null ? usd.format(Number(ext.total_value)) : null;

  return (
    <div className={styles.queueCard}>
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
          {item.suggested_line_name && (
            <span className={styles.cardLine} title={item.suggested_line_name}>{item.suggested_line_name}</span>
          )}
        </div>
      )}
      {item.status === 'failed' && item.error_message && (
        <div className={styles.cardError}>{item.error_message}</div>
      )}
    </div>
  );
}

// ── Drop Zone ────────────────────────────────────────────────────────────────

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
        onChange={e => { const files = Array.from(e.target.files || []).filter(isPdf); if (files.length) onFiles(files); e.target.value = ''; }} />
      <div className={styles.dropIcon}>↑</div>
      <div className={styles.dropText}>Drop PDFs here or click to browse</div>
      <div className={styles.dropSub}>Contracts and invoices — mixed OK</div>
    </div>
  );
}

// ── Main Drawer ──────────────────────────────────────────────────────────────

export function ImportDrawer({ phaseId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [reviewItem, setReviewItem] = useState<ImportItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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

  const pending = queue.filter(i => i.status !== 'confirmed' && i.status !== 'discarded');
  const done = queue.filter(i => i.status === 'confirmed' || i.status === 'discarded');
  const failedCount = pending.filter(i => i.status === 'failed').length;

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

  const handleFiles = async (files: File[]) => {
    if (!files.length) { setUploadError('No PDF files detected.'); return; }
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploadError(null); setUploading(true);
    try { await api.importFiles(phaseId, files); await refetch(); }
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
      setReviewItem(null);
    } catch (err: any) {
      console.error('Confirm failed:', err);
      throw err;
    } finally {
      setSaving(false);
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
          onConfirm={handleConfirm}
          onDiscard={handleDiscard}
          onBack={() => setReviewItem(null)}
          saving={saving}
        />
      )}

      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerTitle}>Bulk Import</div>
            <div className={styles.headerSub}>AI classifies and extracts — you review</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
          {/* Drop zone */}
          <div className={styles.dropZoneWrap}>
            {uploading
              ? <div className={styles.uploadingMsg}><div className={styles.spinner} /> Uploading…</div>
              : <DropZone onFiles={handleFiles} />}
            {uploadError && <div className={styles.uploadErr}>{uploadError}</div>}
          </div>

          {/* Pending section */}
          {pending.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHead}>
                Pending
                <span className={styles.sectionCount}>{pending.length}</span>
              </div>
              {pending.map(item => (
                <QueueCard
                  key={item.id}
                  item={item}
                  onClick={() => setReviewItem(item)}
                  onFlipType={() => handleFlipType(item)}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)}
                />
              ))}
            </div>
          )}

          {/* Done section */}
          {done.length > 0 && (
            <div className={styles.section}>
              <button className={styles.doneToggle} onClick={() => setDoneOpen(o => !o)}>
                <span>{doneOpen ? '▾' : '▸'} Done</span>
                <span className={styles.sectionCount}>{done.length}</span>
              </button>
              {doneOpen && done.map(item => (
                <QueueCard
                  key={item.id}
                  item={item}
                  onClick={() => {}}
                  onFlipType={() => {}}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDiscard={() => discardOneMutation.mutate(item.id)}
                />
              ))}
            </div>
          )}

          {queue.length === 0 && !uploading && (
            <div className={styles.emptyQueue}>Drop PDFs above to get started.</div>
          )}
        </div>
      </div>
    </>
  );
}
