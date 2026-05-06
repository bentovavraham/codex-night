import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  description: '', status: 'pending',
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


// ─── Inline editable cell ─────────────────────────────────────────────────────

function InlineEdit({ value, placeholder, onSave, mono }: {
  value: string | null;
  placeholder: string;
  onSave: (v: string) => void;
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function open() { setDraft(value ?? ''); setEditing(true); setTimeout(() => inputRef.current?.focus(), 10); }
  function commit() { setEditing(false); if (draft !== (value ?? '')) onSave(draft); }
  function onKey(e: React.KeyboardEvent) { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${styles.inlineInput} ${mono ? styles.mono : ''}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        onClick={e => e.stopPropagation()}
      />
    );
  }
  return (
    <span
      className={`${styles.inlineDisplay} ${mono ? styles.mono : ''} ${!value ? styles.dim : ''}`}
      onClick={e => { e.stopPropagation(); open(); }}
      title="Click to edit"
    >
      {value || placeholder}
    </span>
  );
}

// ─── Contract list ────────────────────────────────────────────────────────────

// One contract row + (optional) expandable list of its change orders.
function ContractRow({ c, patchMutation, deleteMutation, onEdit, onEditCo, confirmDeleteId, setConfirmDeleteId }: {
  c: any;
  patchMutation: any;
  deleteMutation: any;
  onEdit: (id: number) => void;
  onEditCo?: (coId: number) => void;
  confirmDeleteId: number | null;
  setConfirmDeleteId: (id: number | null) => void;
}) {
  const [showCos, setShowCos] = useState(false);
  const { data: cos = [] } = useQuery<any[]>({
    queryKey: ['contractChangeOrders', c.id],
    queryFn:  () => api.listChangeOrders(c.id),
    enabled:  showCos,
    staleTime: 30_000,
  });
  const coCount = Number(c.co_count ?? 0);
  const coValue = Number(c.co_value ?? 0);
  return (
    <>
      <tr className={styles.listRow}>
        <td className={styles.ltd}>{c.vendor_name}</td>
        <td className={`${styles.ltd} ${styles.mono}`}>{c.gl_account_number ?? c.budget_line_name ?? '—'}</td>
        <td className={styles.ltd}>
          <InlineEdit value={c.reference_number || null} placeholder="—" mono
            onSave={v => patchMutation.mutate({ id: c.id, data: { reference_number: v || null } })} />
        </td>
        <td className={`${styles.ltd} ${styles.scopeCell}`}>
          <InlineEdit value={c.description || null} placeholder="Add scope…"
            onSave={v => patchMutation.mutate({ id: c.id, data: { description: v || null } })} />
          {coCount > 0 && (
            <button
              onClick={() => setShowCos(s => !s)}
              style={{
                marginLeft: 8, fontSize: 11, padding: '2px 8px',
                border: '1px solid var(--accent)', background: 'var(--accent-light)',
                color: 'var(--accent)', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
              }}
              title="Show / edit change orders on this contract"
            >
              {showCos ? '▾' : '▸'} {coCount} CO{coCount !== 1 ? 's' : ''} · ${coValue.toLocaleString()}
            </button>
          )}
        </td>
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
              <button className={styles.pdfBtn} onClick={() => onEdit(c.id)} title="View PDF">PDF</button>
            )}
            <button className={styles.editBtn} onClick={() => onEdit(c.id)} title="Edit contract">Edit</button>
            {confirmDeleteId === c.id ? (
              <button className={styles.confirmDeleteBtn}
                onClick={e => { e.stopPropagation(); deleteMutation.mutate(c.id); }}
                disabled={deleteMutation.isPending}>
                Confirm?
              </button>
            ) : (
              <button className={styles.deleteBtn} onClick={e => { e.stopPropagation(); setConfirmDeleteId(c.id); }} title="Delete contract">✕</button>
            )}
          </div>
        </td>
      </tr>
      {showCos && cos.map((co: any) => (
        <tr key={`co-${co.id}`} style={{ background: '#fef9f3' }}>
          <td className={styles.ltd} style={{ paddingLeft: 30, color: '#5f6368', fontStyle: 'italic' }}>
            ↳ Change Order
          </td>
          <td className={`${styles.ltd} ${styles.mono}`} style={{ color: '#5f6368' }}>
            (multiple lines — open to view)
          </td>
          <td className={`${styles.ltd} ${styles.mono}`}>{co.co_number || `CO-${co.id}`}</td>
          <td className={`${styles.ltd} ${styles.scopeCell}`} style={{ color: '#5f6368' }}>
            {co.description || '—'}
          </td>
          <td className={`${styles.ltd} ${styles.mono} ${styles.right}`}>
            {co.created_at ? String(co.created_at).slice(0, 10) : '—'}
          </td>
          <td className={`${styles.ltd} ${styles.mono} ${styles.right}`} style={{ fontWeight: 700, color: 'var(--accent)' }}>
            +{usd.format(Number(co.amount || 0))}
          </td>
          <td className={`${styles.ltd} ${styles.center}`}>
            <span className={`${styles.badge} ${styles[STATUS_CSS[co.status] ?? 'sDraft']}`}>
              {STATUS_LABEL[co.status] ?? co.status}
            </span>
          </td>
          <td className={styles.ltd}>
            {onEditCo && (
              <button className={styles.editBtn} onClick={() => onEditCo(co.id)} title="Edit change order — same flow as invoices">
                Edit CO
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}

function ContractList({ contracts, phaseId, onEdit, onEditCo }: {
  contracts: any[];
  phaseId: number;
  onEdit: (id: number) => void;
  onEditCo?: (coId: number) => void;
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

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.updateContract(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phaseContracts', phaseId] });
      qc.invalidateQueries({ queryKey: ['budget',         phaseId] });
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
                <th className={`${styles.lth} ${styles.left}`}>Scope</th>
                <th className={`${styles.lth} ${styles.right}`}>Date</th>
                <th className={`${styles.lth} ${styles.right}`}>Fixed Value</th>
                <th className={`${styles.lth} ${styles.center}`}>Status</th>
                <th className={styles.lth} />
              </tr>
            </thead>
            <tbody>
              {contracts.map((c: any) => (
                <ContractRow
                  key={c.id}
                  c={c}
                  patchMutation={patchMutation}
                  deleteMutation={deleteMutation}
                  onEdit={onEdit}
                  onEditCo={onEditCo}
                  confirmDeleteId={confirmDeleteId}
                  setConfirmDeleteId={setConfirmDeleteId}
                />
              ))}
              {/* legacy inline render — kept commented during the refactor; safe to remove */}
              {false && [].map((c: any) => (
                <tr key={c.id} className={styles.listRow}>
                  <td className={styles.ltd}>{c.vendor_name}</td>
                  <td className={`${styles.ltd} ${styles.mono}`}>{c.gl_account_number ?? c.budget_line_name ?? '—'}</td>
                  <td className={styles.ltd}>
                    <InlineEdit
                      value={c.reference_number || null}
                      placeholder="—"
                      mono
                      onSave={v => patchMutation.mutate({ id: c.id, data: { reference_number: v || null } })}
                    />
                  </td>
                  <td className={`${styles.ltd} ${styles.scopeCell}`}>
                    <InlineEdit
                      value={c.description || null}
                      placeholder="Add scope…"
                      onSave={v => patchMutation.mutate({ id: c.id, data: { description: v || null } })}
                    />
                  </td>
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
                    <td colSpan={5} className={styles.totalLabel}>
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

export function UploadPanel({ qbAccounts, projectId, phaseId, onClose, onSaved, editId, coEditId }: {
  qbAccounts: QbAccount[];
  projectId: number;
  phaseId: number;
  onClose: () => void;
  onSaved: () => void;
  editId?: number;
  coEditId?: number;
}) {
  const [stage,        setStage]        = useState<Stage>(editId || coEditId ? 'extracting' : 'drop');
  const [pdfUrl,       setPdfUrl]       = useState<string | null>(null);
  const [fileRef,      setFileRef]      = useState<string | null>(null);
  const [extracted,    setExtracted]    = useState<any>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [form,         setForm]         = useState<ContractForm>(EMPTY_FORM);
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState<string | null>(null);
  const [dragOver,     setDragOver]     = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Change Order mode — when ON, the upload writes to change_orders (with
  // line_items) rather than creating a new contract.
  const [isChangeOrder,    setIsChangeOrder]    = useState(false);
  const [parentContractId, setParentContractId] = useState<number | null>(null);

  // Existing contracts in this phase — used to populate the parent picker
  // when isChangeOrder is on.
  const { data: phaseContracts = [] } = useQuery<any[]>({
    queryKey: ['phaseContracts', phaseId],
    queryFn:  () => api.listContracts(phaseId),
    enabled:  !!phaseId,
    staleTime: 30_000,
  });
  // Filter to same vendor (with a fallback to all phase contracts when no
  // vendor matches — rare cross-vendor CO case).
  const sameVendorParents = (phaseContracts as any[]).filter(c =>
    form.vendor_name &&
    c.vendor_name &&
    c.vendor_name.trim().toLowerCase() === form.vendor_name.trim().toLowerCase() &&
    c.status !== 'voided' && c.status !== 'draft'
  );
  const parentChoices = sameVendorParents.length > 0
    ? sameVendorParents
    : (phaseContracts as any[]).filter(c => c.status !== 'voided' && c.status !== 'draft');

  // PM tasks for the per-line task picker (Option C)
  const { data: budgetLines = [] } = useQuery<any[]>({
    queryKey: ['budgetLines', phaseId],
    queryFn:  () => api.listBudgetLines(phaseId),
    enabled:  !!phaseId,
    staleTime: 60_000,
  });

  // Only revoke blob URLs, not server URLs
  useEffect(() => () => { if (pdfUrl?.startsWith('blob:')) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  // Load existing CHANGE ORDER when in CO-edit mode
  useEffect(() => {
    if (!coEditId) return;
    setIsChangeOrder(true);
    api.getChangeOrder(coEditId).then((co: any) => {
      setParentContractId(co.contract_id ?? null);
      if (co.file_reference) {
        setPdfUrl(`/api/files/${encodeURIComponent(co.file_reference)}`);
      }
      setFileRef(co.file_reference ?? null);
      setForm({
        vendor_name:      co.contract_vendor_name ?? '',
        reference_number: co.co_number ?? '',
        contract_date:    co.created_at ? String(co.created_at).slice(0, 10) : '',
        description:      co.description ?? '',
        status:           co.status ?? 'active',
        line_items: (co.line_items ?? []).map((li: any) => ({
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
      setExtractError(err.message ?? 'Failed to load change order');
      setStage('review');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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



  async function handleSave() {
    setSaveError(null);
    if (!form.vendor_name.trim()) return setSaveError('Vendor name is required.');
    if (!form.reviewed)           return setSaveError('Please check the review confirmation.');
    if (isChangeOrder && !parentContractId) {
      return setSaveError('Pick the parent contract that this change order modifies.');
    }

    setSaving(true);
    try {
      // Auto-resolve task before save: any line whose GL maps to exactly one
      // PM task gets that task assigned automatically. User can override later.
      const usableLines = form.line_items
        .filter(li => li.description.trim())
        .map(li => {
          if (li.phase_budget_line_id != null) return li;
          if (li.qb_account_id == null) return li;
          const matching = (budgetLines as any[]).filter(b => b.qb_account_id === li.qb_account_id);
          if (matching.length === 1) return { ...li, phase_budget_line_id: matching[0].id };
          return li;
        });
      if (isChangeOrder) {
        const coPayload = {
          co_number:      form.reference_number || null,
          description:    form.description || `Change Order — ${form.vendor_name.trim()}`,
          amount:         fixedTotal,
          file_reference: fileRef || null,
          status:         form.status || 'active',
          line_items: usableLines.map((li, i) => ({
            billing_type:         li.billing_type,
            description:          li.description,
            budgeted_amount:      Number(li.budgeted_amount) || 0,
            qb_account_id:        li.qb_account_id ?? li.suggested_qb_account_id ?? null,
            phase_budget_line_id: li.phase_budget_line_id ?? null,
            sort_order:           i,
          })),
        };
        if (coEditId) {
          await api.updateChangeOrder(coEditId, coPayload);
        } else {
          await api.createChangeOrder(parentContractId!, coPayload);
        }
      } else {
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
          contract_line_items: usableLines.map((li, i) => ({
            billing_type:         li.billing_type,
            description:          li.description,
            budgeted_amount:      Number(li.budgeted_amount) || 0,
            qb_account_id:        li.qb_account_id ?? li.suggested_qb_account_id ?? null,
            phase_budget_line_id: li.phase_budget_line_id ?? null,
            sort_order:           i,
          })),
        };
        if (editId) {
          await api.updateContract(editId, payload);
        } else {
          await api.createContract(payload);
        }
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
              ? (coEditId ? 'Loading change order…' : editId ? 'Loading contract…' : 'Reading contract…')
              : stage === 'drop' ? 'New Contract'
              : coEditId ? `Edit Change Order${form.reference_number ? ` · ${form.reference_number}` : ''}`
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

            {/* Change Order toggle — first thing in the form because it
                fundamentally changes what this upload becomes. Locked in
                edit mode (you can't convert between contract and CO). */}
            {(!editId) && (
              <div style={{
                margin: '12px 14px', padding: '12px 14px', borderRadius: 6,
                background: isChangeOrder ? 'var(--accent-light)' : '#f7f5f2',
                border: `2px solid ${isChangeOrder ? 'var(--accent)' : '#dadce0'}`,
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: coEditId ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={isChangeOrder}
                    disabled={!!coEditId}
                    onChange={e => {
                      setIsChangeOrder(e.target.checked);
                      if (!e.target.checked) setParentContractId(null);
                    }}
                    style={{ width: 18, height: 18, cursor: coEditId ? 'default' : 'pointer' }}
                  />
                  <span>This is a Change Order to an existing contract{coEditId ? ' (editing)' : ''}</span>
                </label>
                {isChangeOrder && (
                  <div style={{ marginTop: 10 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#5f6368', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                      Parent Contract <span style={{ color: '#dc2626' }}>required</span>
                    </label>
                    <select
                      value={parentContractId ?? ''}
                      onChange={e => setParentContractId(e.target.value ? Number(e.target.value) : null)}
                      style={{
                        width: '100%', padding: '8px 10px', fontSize: 13.5,
                        border: parentContractId ? '2px solid var(--accent)' : '2px solid #dc2626',
                        borderRadius: 4,
                        background: parentContractId ? '#fff' : '#fef2f2',
                        cursor: 'pointer', fontWeight: 500,
                      }}
                    >
                      <option value="">— Pick parent contract —</option>
                      {sameVendorParents.length > 0 && (
                        <optgroup label={`Same vendor (${form.vendor_name || ''})`}>
                          {sameVendorParents.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.reference_number || `Contract #${c.id}`} · ${Number(c.total_value || 0).toLocaleString()}
                              {c.task_name ? ` · ${c.task_name}` : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {sameVendorParents.length === 0 && parentChoices.length > 0 && (
                        <optgroup label="All contracts in this phase">
                          {parentChoices.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.vendor_name} · {c.reference_number || `Contract #${c.id}`} · ${Number(c.total_value || 0).toLocaleString()}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#5f6368', fontStyle: 'italic' }}>
                      The CO amount adds to TOTAL COMMIT on the parent contract's task lines (or wherever its line items are coded). Burns down via the budget grid's COS column.
                    </div>
                  </div>
                )}
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
                  {form.line_items.map((li, i) => {
                    const matching = li.qb_account_id != null
                      ? (budgetLines as any[]).filter(b => b.qb_account_id === li.qb_account_id)
                      : [];
                    const allTasks = (budgetLines as any[]);
                    const isAssigned = li.phase_budget_line_id != null;
                    const placeholder = matching.length > 0
                      ? `⚠ Pick task (${matching.length} match this GL)`
                      : `⚠ Pick any task`;
                    return (
                    <tr key={i} className={`${styles.catRow} ${li.differs_from_primary ? styles.catRowFlagged : ''}`}>
                      <td className={styles.colHash}>{i + 1}</td>
                      <td className={styles.colCat}>
                        <QbPicker
                          accounts={qbAccounts}
                          value={li.qb_account_id}
                          suggestedId={li.suggested_qb_account_id}
                          suggestionConfidence={li.qb_suggestion_confidence}
                          onChange={id => setLine(i, { qb_account_id: id, phase_budget_line_id: null })}
                        />
                        {/* Always-visible task picker (Option C, mirrors invoices) */}
                        <select
                          value={li.phase_budget_line_id ?? ''}
                          onChange={e => setLine(i, { phase_budget_line_id: e.target.value ? Number(e.target.value) : null })}
                          title="Pick a task. AI may suggest one, but you can override."
                          style={{
                            marginTop: 6, width: '100%', fontSize: 13,
                            fontWeight: isAssigned ? 600 : 500,
                            padding: '6px 8px',
                            border: `2px solid ${isAssigned ? '#16a34a' : '#dc2626'}`,
                            borderRadius: 4,
                            background: isAssigned ? '#f0fdf4' : '#fef2f2',
                            color: '#1a1714', cursor: 'pointer',
                          }}
                        >
                          <option value="">{placeholder}</option>
                          {matching.length > 0 && (
                            <optgroup label="✓ Match this GL code">
                              {matching.map(t => <option key={t.id} value={t.id}>{t.task_name}</option>)}
                            </optgroup>
                          )}
                          <optgroup label={matching.length > 0 ? '— Other tasks in this phase —' : '— All tasks in this phase —'}>
                            {allTasks.filter(t => !matching.find((m: any) => m.id === t.id)).map(t => (
                              <option key={t.id} value={t.id}>
                                {t.task_name}{t.discipline ? ` · ${t.discipline}` : ''}
                              </option>
                            ))}
                          </optgroup>
                        </select>
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
                    );
                  })}
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
  const [editCoId,       setEditCoId]       = useState<number | null>(null);

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
    // Invalidate everything that could have moved as a result of this save:
    // budget grid (every source variant), contract list, change orders for
    // every contract (we don't know which CO touched which contract from
    // here), and any open contract detail drawer.
    qc.invalidateQueries({ queryKey: ['phaseContracts',      phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['budget',              phaseIdNum] });
    qc.invalidateQueries({ queryKey: ['contractChangeOrders'] });
    qc.invalidateQueries({ queryKey: ['contractDetail'] });
    qc.invalidateQueries({ queryKey: ['drill',               phaseIdNum] });
    setUploadOpen(false);
    setEditContractId(null);
  }

  function handleClose() {
    setUploadOpen(false);
    setEditContractId(null);
    setEditCoId(null);
  }

  function handleEdit(id: number) {
    setEditContractId(id);
    setEditCoId(null);
    setUploadOpen(true);
  }

  function handleEditCo(coId: number) {
    setEditCoId(coId);
    setEditContractId(null);
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
        coEditId={editCoId ?? undefined}
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
      onEditCo={handleEditCo}
    />
  );
}
