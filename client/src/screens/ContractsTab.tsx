import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './ContractsTab.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QbAccount { id: number; account_number: string; full_name: string; short_name: string; }

interface ContractLine {
  billing_type: 'fixed' | 'tm' | 'expense';
  description: string;
  budgeted_amount: string;
  qb_account_id: number | null;
  suggested_qb_account_id: number | null;
  qb_suggestion_confidence: string | null;
  phase_budget_line_id: number | null;
  differs_from_primary?: boolean;
  budget_line_confidence?: string | null;
}

interface ContractForm {
  vendor_name: string;
  reference_number: string;
  contract_date: string;
  description: string;
  status: string;
  line_items: ContractLine[];
  reviewed: boolean;
}

const EMPTY_FORM: ContractForm = {
  vendor_name: '', reference_number: '', contract_date: '',
  description: '', status: 'draft',
  line_items: [], reviewed: false,
};

type Stage = 'drop' | 'extracting' | 'review';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', active: 'Active',
  completed: 'Completed', voided: 'Voided',
};
const STATUS_CSS: Record<string, string> = {
  draft: 'sDraft', pending: 'sPending', active: 'sActive',
  completed: 'sCompleted', voided: 'sVoided',
};

function ConfDot({ level }: { level?: string | null }) {
  const bg = level === 'high' ? '#22c55e' : level === 'medium' ? '#f59e0b' : '#ef4444';
  if (!level) return null;
  return <span className={styles.confDot} style={{ background: bg }} title={`AI confidence: ${level}`} />;
}

// ─── QB Code picker ───────────────────────────────────────────────────────────

function QbPicker({ accounts, value, suggestedId, suggestionConfidence, onChange }: {
  accounts: QbAccount[];
  value: number | null;
  suggestedId: number | null;
  suggestionConfidence: string | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected  = accounts.find(a => a.id === value) ?? null;
  const suggested = accounts.find(a => a.id === suggestedId) ?? null;
  const display   = selected ?? suggested;
  const isAi      = !selected && !!suggested;

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts;
    const q = query.toLowerCase();
    return accounts.filter(a =>
      a.account_number.toLowerCase().includes(q) ||
      a.full_name.toLowerCase().includes(q) ||
      a.short_name.toLowerCase().includes(q)
    );
  }, [accounts, query]);

  useEffect(() => {
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  function openDropdown() { setQuery(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 30); }
  function pick(a: QbAccount) { onChange(a.id); setOpen(false); setQuery(''); }
  function clear(e: React.MouseEvent) { e.stopPropagation(); onChange(null); }

  return (
    <div className={styles.qbPicker} ref={ref}>
      <div className={`${styles.qbDisplay} ${isAi ? styles.qbAi : ''} ${!display ? styles.qbEmpty : ''}`}
        onClick={openDropdown} title={display?.full_name}>
        {display ? (
          <>
            <span className={styles.qbNum}>{display.account_number}</span>
            <span className={styles.qbName}>{display.full_name}</span>
            {isAi && <ConfDot level={suggestionConfidence} />}
            <button className={styles.qbClear} onClick={clear} title="Clear">✕</button>
          </>
        ) : <span className={styles.qbPlaceholder}>Select account…</span>}
      </div>
      {open && (
        <div className={styles.qbDropdown}>
          <input ref={inputRef} className={styles.qbSearch} value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Search by number or name…" />
          <div className={styles.qbList}>
            {filtered.map(a => (
              <div key={a.id}
                className={`${styles.qbOption} ${a.id === (value ?? suggestedId) ? styles.qbOptionSelected : ''}`}
                onMouseDown={() => pick(a)}>
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

// ─── Budget line autocomplete picker ─────────────────────────────────────────

function BudgetLinePicker({ lines, value, onChange }: {
  lines: any[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = lines.find(l => l.id === value) ?? null;

  const filtered = useMemo(() => {
    if (!query.trim()) return lines;
    const q = query.toLowerCase();
    return lines.filter(l =>
      l.task_name.toLowerCase().includes(q) ||
      (l.discipline && l.discipline.toLowerCase().includes(q))
    );
  }, [lines, query]);

  useEffect(() => {
    function onOut(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  function openDropdown() { setQuery(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 30); }
  function pick(l: any) { onChange(l.id); setOpen(false); setQuery(''); }
  function clear(e: React.MouseEvent) { e.stopPropagation(); onChange(null); }

  const label = selected ? `${selected.task_name}${selected.discipline ? ` · ${selected.discipline}` : ''}` : null;

  return (
    <div className={styles.qbPicker} ref={ref}>
      <div className={`${styles.qbDisplay} ${!selected ? styles.qbEmpty : ''}`} onClick={openDropdown}>
        {selected ? (
          <>
            <span className={styles.qbName}>{label}</span>
            <button className={styles.qbClear} onClick={clear} title="Clear">✕</button>
          </>
        ) : <span className={styles.qbPlaceholder}>Search tasks…</span>}
      </div>
      {open && (
        <div className={styles.qbDropdown}>
          <input ref={inputRef} className={styles.qbSearch} value={query}
            onChange={e => setQuery(e.target.value)} placeholder="Type task name or discipline…" />
          <div className={styles.qbList}>
            {filtered.map(l => (
              <div key={l.id}
                className={`${styles.qbOption} ${l.id === value ? styles.qbOptionSelected : ''}`}
                onMouseDown={() => pick(l)}>
                <span className={styles.qbOptName}>{l.task_name}{l.discipline ? ` · ${l.discipline}` : ''}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.qbNoMatch}>No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Inline budget line picker for task table rows (portal-based) ─────────────

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

// ─── Contract list ────────────────────────────────────────────────────────────

function ContractList({ contracts, phaseId, onEdit }: {
  contracts: any[];
  phaseId: number;
  onEdit: (id: number) => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteContract(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phaseContracts', phaseId] });
      qc.invalidateQueries({ queryKey: ['budget',         phaseId] });
      setConfirmDeleteId(null);
    },
  });

  return (
    <div className={styles.listWrap} onClick={() => setConfirmDeleteId(null)}>
      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>Contracts</span>
      </div>
      {contracts.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No contracts yet. Use <strong>↑ Import Contract</strong> in the Audit tab to add one.</p>
        </div>
      ) : (
        <div className={styles.scrollArea}>
          <table className={styles.listTable}>
            <thead>
              <tr className={styles.listThead}>
                <th className={`${styles.lth} ${styles.left}`}>Vendor</th>
                <th className={`${styles.lth} ${styles.left}`}>GL Account</th>
                <th className={`${styles.lth} ${styles.left}`}>Contract #</th>
                <th className={`${styles.lth} ${styles.right}`}>Date</th>
                <th className={`${styles.lth} ${styles.right}`}>Fixed Value</th>
                <th className={`${styles.lth} ${styles.center}`}>Status</th>
                <th className={styles.lth} />
              </tr>
            </thead>
            <tbody>
              {contracts.map((c: any) => (
                <tr key={c.id} className={styles.listRow}>
                  <td className={styles.ltd}>{c.vendor_name}</td>
                  <td className={`${styles.ltd} ${styles.mono}`}>{c.gl_account_number ?? c.budget_line_name ?? '—'}</td>
                  <td className={`${styles.ltd} ${styles.mono}`}>{c.reference_number || '—'}</td>
                  <td className={`${styles.ltd} ${styles.mono} ${styles.right}`}>
                    {c.contract_date ? String(c.contract_date).slice(0, 10) : '—'}
                  </td>
                  <td className={`${styles.ltd} ${styles.mono} ${styles.right}`}>
                    {Number(c.total_value) > 0 ? usd.format(Number(c.total_value)) : <span className={styles.dim}>T&amp;M</span>}
                  </td>
                  <td className={`${styles.ltd} ${styles.center}`}>
                    <span className={`${styles.badge} ${styles[STATUS_CSS[c.status] ?? 'sDraft']}`}>
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className={styles.ltd}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {c.file_reference && (
                        <button className={styles.pdfBtn} onClick={() => onEdit(c.id)} title="View PDF">
                          PDF
                        </button>
                      )}
                      <button className={styles.editBtn} onClick={() => onEdit(c.id)} title="Edit contract">
                        Edit
                      </button>
                      {confirmDeleteId === c.id ? (
                        <button className={styles.confirmDeleteBtn}
                          onClick={e => { e.stopPropagation(); deleteMutation.mutate(c.id); }}
                          disabled={deleteMutation.isPending}>
                          Confirm?
                        </button>
                      ) : (
                        <button className={styles.deleteBtn} onClick={e => { e.stopPropagation(); setConfirmDeleteId(c.id); }} title="Delete contract">
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(() => {
                const active = contracts.filter((c: any) => c.status !== 'voided');
                const totalCommit = active.reduce((s: number, c: any) => s + Number(c.total_commitment ?? c.total_value), 0);
                const hasCos = active.some((c: any) => Number(c.co_value) > 0);
                return (
                  <tr className={styles.totalRow}>
                    <td colSpan={4} className={styles.totalLabel}>
                      {active.length} contract{active.length !== 1 ? 's' : ''}{hasCos ? ' + COs' : ''}
                    </td>
                    <td className={`${styles.ltd} ${styles.mono} ${styles.right} ${styles.totalCell}`}>
                      {usd.format(totalCommit)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Upload + review panel ────────────────────────────────────────────────────

export function UploadPanel({ qbAccounts, projectId, phaseId, onClose, onSaved, editId }: {
  qbAccounts: QbAccount[];
  projectId: number;
  phaseId: number;
  onClose: () => void;
  onSaved: () => void;
  editId?: number;
}) {
  const [stage,        setStage]        = useState<Stage>(editId ? 'extracting' : 'drop');
  const [pdfUrl,       setPdfUrl]       = useState<string | null>(null);
  const [fileRef,      setFileRef]      = useState<string | null>(null);
  const [extracted,    setExtracted]    = useState<any>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [form,         setForm]         = useState<ContractForm>(EMPTY_FORM);
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState<string | null>(null);
  const [dragOver,     setDragOver]     = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Only revoke blob URLs, not server URLs
  useEffect(() => () => { if (pdfUrl?.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  // Load existing contract when in edit mode
  useEffect(() => {
    if (!editId) return;
    api.getContract(editId).then(c => {
      if (c.file_reference) {
        setPdfUrl(`/api/files/${encodeURIComponent(c.file_reference)}`);
      }
      setFileRef(c.file_reference ?? null);
      setForm({
        vendor_name:      c.vendor_name ?? '',
        reference_number: c.reference_number ?? '',
        contract_date:    c.contract_date ? String(c.contract_date).slice(0, 10) : '',
        description:      c.description ?? '',
        status:           c.status ?? 'draft',
        line_items: (c.task_items ?? []).map((li: any) => ({
          billing_type:             li.billing_type ?? 'fixed',
          description:              li.description ?? '',
          budgeted_amount:          li.budgeted_amount != null ? String(li.budgeted_amount) : '',
          qb_account_id:            li.qb_account_id ?? null,
          suggested_qb_account_id:  null,
          qb_suggestion_confidence: null,
          phase_budget_line_id:     li.phase_budget_line_id ?? null,
        })),
        reviewed: true,
      });
      setStage('review');
    }).catch(err => {
      setExtractError(err.message ?? 'Failed to load contract');
      setStage('review');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file);
    setPdfUrl(url);
    setStage('extracting');
    setExtractError(null);
    try {
      const result = await api.extractContract(file, phaseId);
      setFileRef(result.file_reference ?? null);
      if (result.extracted) {
        const e = result.extracted;
        setExtracted(e);
        const items: ContractLine[] = (e.line_items ?? []).map((li: any) => ({
          billing_type:             li.billing_type ?? 'fixed',
          description:              li.description  ?? '',
          budgeted_amount:          li.budgeted_amount != null ? String(li.budgeted_amount) : '',
          qb_account_id:            null,
          suggested_qb_account_id:  li.suggested_qb_account_id  ?? null,
          qb_suggestion_confidence: li.qb_suggestion_confidence ?? null,
          phase_budget_line_id:     li.suggested_budget_line_id ?? null,
          differs_from_primary:     li.differs_from_primary ?? false,
          budget_line_confidence:   li.budget_line_confidence ?? null,
        }));
        setForm({
          vendor_name:      e.vendor_name      ?? '',
          reference_number: e.reference_number ?? '',
          contract_date:    e.contract_date    ?? '',
          description:      e.description      ?? '',
          status:           'draft',
          line_items:       items,
          reviewed:         false,
        });
      }
      if (result.extract_error) setExtractError(result.extract_error);
    } catch (err: any) {
      setExtractError(err.message ?? 'Extraction failed');
    } finally {
      setStage('review');
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') handleFile(file);
  }, [handleFile]);

  function setF<K extends keyof ContractForm>(key: K, val: ContractForm[K]) {
    setForm(f => ({ ...f, [key]: val }));
  }
  function setLine(idx: number, patch: Partial<ContractLine>) {
    setForm(f => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], ...patch };
      return { ...f, line_items: items };
    });
  }
  function addLine() {
    setForm(f => ({
      ...f,
      line_items: [...f.line_items, {
        billing_type: 'fixed', description: '', budgeted_amount: '',
        qb_account_id: null, suggested_qb_account_id: null, qb_suggestion_confidence: null,
        phase_budget_line_id: null,
      }],
    }));
  }
  function removeLine(idx: number) {
    setForm(f => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  }
  function clearLines() { setForm(f => ({ ...f, line_items: [] })); }

  const fixedTotal = form.line_items
    .filter(li => li.billing_type === 'fixed')
    .reduce((s, li) => s + (Number(li.budgeted_amount) || 0), 0);
  const hasTm = form.line_items.some(li => li.billing_type === 'tm');

  const hasLineItems = form.line_items.length > 0;

  async function handleSave() {
    setSaveError(null);
    if (!form.vendor_name.trim()) return setSaveError('Vendor name is required.');
    if (!form.reviewed)           return setSaveError('Please check the review confirmation.');

    setSaving(true);
    try {
      const payload = {
        project_id:          projectId,
        phase_id:            phaseId,
        vendor_name:         form.vendor_name.trim(),
        reference_number:    form.reference_number || null,
        contract_date:       form.contract_date    || null,
        description:         form.description      || null,
        total_value:         fixedTotal,
        status:              form.status,
        file_reference:      fileRef               || null,
        contract_line_items: form.line_items
          .filter(li => li.description.trim())
          .map((li, i) => ({
            billing_type:    li.billing_type,
            description:     li.description,
            budgeted_amount: Number(li.budgeted_amount) || 0,
            qb_account_id:   li.qb_account_id ?? li.suggested_qb_account_id ?? null,
            sort_order:      i,
          })),
      };
      if (editId) {
        await api.updateContract(editId, payload);
      } else {
        await api.createContract(payload);
      }
      onSaved();
    } catch (err: any) {
      setSaveError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const conf = extracted?.confidence ?? {};
  const canSave = form.reviewed && !!form.vendor_name.trim();

  return (
    <div className={styles.uploadLayout}>

      {/* ── Left: PDF pane ── */}
      <div className={styles.pdfPane}>
        {stage === 'drop' ? (
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
          >
            <input ref={fileInput} type="file" accept="application/pdf" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <div className={styles.dropIcon}>📋</div>
            <p className={styles.dropText}>Drop contract PDF here</p>
            <p className={styles.dropSub}>or click to browse</p>
          </div>
        ) : pdfUrl ? (
          <iframe src={pdfUrl} className={styles.pdfFrame} title="Contract PDF" />
        ) : null}
      </div>

      {/* ── Right: form pane ── */}
      <div className={styles.formPane}>
        <div className={styles.formBar}>
          <span className={styles.formBarTitle}>
            {stage === 'extracting'
              ? (editId ? 'Loading contract…' : 'Reading contract…')
              : stage === 'drop' ? 'New Contract'
              : `${editId ? 'Edit ' : ''}Contract${form.vendor_name ? ` · ${form.vendor_name}` : ''}`}
          </span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {stage === 'extracting' && (
          <div className={styles.extractingWrap}>
            <div className={styles.spinner} />
            <p>{editId ? 'Loading contract…' : 'Claude is reading your contract…'}</p>
            {!editId && <p className={styles.extractingSub}>Extracting tasks and suggesting QB codes</p>}
          </div>
        )}

        {stage === 'review' && (
          <div className={styles.formScroll}>

            {extractError && (
              <div className={styles.warnBanner}>
                ⚠ AI extraction had issues — please fill fields manually.
                <span className={styles.warnDetail}> {extractError}</span>
              </div>
            )}

            {/* Header fields */}
            <div className={styles.headerFields}>
              <div className={styles.hfGroup}>
                <label className={styles.hfLabel}>Vendor / Payee <ConfDot level={conf.vendor_name} /></label>
                <input className={styles.hfInput} value={form.vendor_name}
                  onChange={e => setF('vendor_name', e.target.value)} placeholder="Who is this contract with?" />
              </div>

              <div className={styles.hfRow}>
                <div className={styles.hfGroup}>
                  <label className={styles.hfLabel}>Contract Date <ConfDot level={conf.contract_date} /></label>
                  <input className={styles.hfInput} type="date" value={form.contract_date}
                    onChange={e => setF('contract_date', e.target.value)} />
                </div>
                <div className={styles.hfGroup}>
                  <label className={styles.hfLabel}>Contract # <ConfDot level={conf.reference_number} /></label>
                  <input className={styles.hfInput} value={form.reference_number}
                    onChange={e => setF('reference_number', e.target.value)} placeholder="e.g. 203010-2024Sat" />
                </div>
                <div className={styles.hfGroup}>
                  <label className={styles.hfLabel}>Status</label>
                  <select className={styles.hfSelect} value={form.status}
                    onChange={e => setF('status', e.target.value)}>
                    <option value="draft">Draft</option>
                    <option value="pending">Pending</option>
                    <option value="active">Active</option>
                  </select>
                </div>
              </div>

              <div className={styles.hfGroup}>
                <label className={styles.hfLabel}>Scope / Description</label>
                <textarea className={styles.hfTextarea} value={form.description}
                  onChange={e => setF('description', e.target.value)} rows={3}
                  placeholder="Brief description of the work scope…" />
              </div>
            </div>

            {/* Contract tasks table */}
            <div className={styles.catSection}>
              <div className={styles.catTitle}>Contract Tasks</div>
              <table className={styles.catTable}>
                <thead>
                  <tr className={styles.catThead}>
                    <th className={styles.colHash}>#</th>
                    <th className={styles.colCat}>GL ACCOUNT</th>
                    <th className={styles.colType}>TYPE</th>
                    <th className={styles.colDesc}>DESCRIPTION</th>
                    <th className={`${styles.colAmt} ${styles.right}`}>AMOUNT</th>
                    <th className={styles.colDel} />
                  </tr>
                </thead>
                <tbody>
                  {form.line_items.map((li, i) => (
                    <tr key={i} className={`${styles.catRow} ${li.differs_from_primary ? styles.catRowFlagged : ''}`}>
                      <td className={styles.colHash}>{i + 1}</td>
                      <td className={styles.colCat}>
                        <QbPicker
                          accounts={qbAccounts}
                          value={li.qb_account_id}
                          suggestedId={li.suggested_qb_account_id}
                          suggestionConfidence={li.qb_suggestion_confidence}
                          onChange={id => setLine(i, { qb_account_id: id })}
                        />
                      </td>
                      <td className={styles.colType}>
                        <select className={styles.typeSelect} value={li.billing_type}
                          onChange={e => setLine(i, { billing_type: e.target.value as ContractLine['billing_type'] })}>
                          <option value="fixed">Fixed</option>
                          <option value="tm">T&amp;M</option>
                          <option value="expense">Expense</option>
                        </select>
                      </td>
                      <td className={styles.colDesc}>
                        <input className={styles.descInput} value={li.description}
                          onChange={e => setLine(i, { description: e.target.value })}
                          placeholder="Task description"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }} />
                      </td>
                      <td className={`${styles.colAmt} ${styles.right}`}>
                        {li.billing_type === 'tm' ? (
                          <span className={styles.tmTag}>T&amp;M</span>
                        ) : (
                          <input className={`${styles.amtInput} ${styles.mono}`}
                            value={li.budgeted_amount}
                            onChange={e => setLine(i, { budgeted_amount: e.target.value })}
                            placeholder="0.00"
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine(); } }} />
                        )}
                      </td>
                      <td className={styles.colDel}>
                        <button className={styles.delBtn} onClick={() => removeLine(i)} title="Remove">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={styles.catFooter}>
                <div className={styles.catFooterLeft}>
                  <button className={styles.addLineBtn} onClick={addLine}>Add task</button>
                  {form.line_items.length > 0 && (
                    <button className={styles.clearLinesBtn} onClick={clearLines}>Clear all</button>
                  )}
                  {form.line_items.some(li => li.differs_from_primary) && (
                    <button className={styles.clearLinesBtn} onClick={() =>
                      setForm(f => ({ ...f, line_items: f.line_items.map(li => ({ ...li, differs_from_primary: false, phase_budget_line_id: null })) }))
                    }>Clear overrides</button>
                  )}
                </div>
                <div className={styles.lineTotal}>
                  {fixedTotal > 0 && (
                    <span className={styles.mono}>{usd.format(fixedTotal)} fixed</span>
                  )}
                  {hasTm && <span className={styles.tmTotalTag}>+ T&amp;M</span>}
                </div>
              </div>
            </div>

          </div>
        )}

        {stage === 'review' && (
          <div className={styles.formFooter}>
            <label className={styles.reviewCheck}>
              <input type="checkbox" checked={form.reviewed}
                onChange={e => setF('reviewed', e.target.checked)} />
              <span>I have reviewed this contract and confirm all details are correct</span>
            </label>

            {saveError && <div className={styles.saveError}>{saveError}</div>}

            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button className={styles.saveBtn} onClick={handleSave} disabled={saving || !canSave}>
                {saving ? 'Saving…' : editId ? 'Save Changes' : 'Save & Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function ContractsTab() {
  const { projectId, phaseId } = useParams<{ projectId: string; phaseId: string }>();
  const phaseIdNum   = Number(phaseId);
  const projectIdNum = Number(projectId);
  const qc = useQueryClient();
  const [uploadOpen,     setUploadOpen]     = useState(false);
  const [editContractId, setEditContractId] = useState<number | null>(null);

  const { data: contracts = [], isLoading } = useQuery<any[]>({
    queryKey: ['phaseContracts', phaseIdNum],
    queryFn:  () => api.listContracts(phaseIdNum),
    enabled:  !!phaseIdNum,
  });

  const { data: qbAccounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qbAccounts'],
    queryFn:  () => api.listQbAccounts(),
    staleTime: Infinity,
  });

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['phaseContracts', phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['budget',         phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['contractDetail', editContractId] });
    setUploadOpen(false);
    setEditContractId(null);
  }

  function handleClose() {
    setUploadOpen(false);
    setEditContractId(null);
  }

  function handleEdit(id: number) {
    setEditContractId(id);
    setUploadOpen(true);
  }

  if (isLoading) return <div className={styles.splash}>Loading…</div>;

  if (uploadOpen) {
    return (
      <UploadPanel
        qbAccounts={qbAccounts}
        projectId={projectIdNum}
        phaseId={phaseIdNum}
        editId={editContractId ?? undefined}
        onClose={handleClose}
        onSaved={handleSaved}
      />
    );
  }

  return (
    <ContractList
      contracts={contracts}
      phaseId={phaseIdNum}
      onEdit={handleEdit}
    />
  );
}
