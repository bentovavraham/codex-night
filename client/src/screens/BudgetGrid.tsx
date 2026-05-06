import { useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './BudgetGrid.module.css';
import { LineItemPanel } from './LineItemPanel';
import { UploadPanel as InvoicePanel } from './InvoicesTab';
import { UploadPanel as ContractPanel } from './ContractsTab';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BudgetRow {
  id: number;
  phase_id: number;
  task_name: string;
  discipline: string | null;
  section: string;
  sub_group: string | null;
  calculation_method: string | null;
  budgeted_amount: number;
  consultant: string | null;
  notes: string | null;
  sort_order: number;
  fixed_charges: number;
  tm_charges: number;
  expense_charges: number;
  billed: number;
  amount_due: number;
  paid: number;
  remaining_budget: number;
  committed: number;
  co_count: number;
  co_value: number;
  total_commitment: number;
  remaining_commit: number;
  pct_billed: number | null;
  qb_codes_used: string;
  has_direct_invoices: boolean;
  source: 'template' | 'user' | 'qb' | 'general';
  amount_modified: boolean;
  phantom_from_qb?: boolean;
  general_unassigned?: boolean;
  qb_account_id: number | null;
  qb_account_number: string | null;
  qb_short_name: string | null;
  qb_sort_order: number;
  qb_parent_id: number | null;
  qb_parent_number: string | null;
  qb_parent_name: string | null;
  qb_parent_sort: number;
  qb_category: string | null;
}

interface QbAccount {
  id: number;
  account_number: string;
  full_name: string;
  short_name: string;
  parent_id: number | null;
  category: string;
  sort_order: number;
  is_leaf: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd    = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money  = (n: number) => n === 0 ? '' : usd.format(n);
const moneyD = (n: number) => n === 0 ? '—' : usd.format(n);
const remPct = (spent: number, budget: number) => budget > 0 ? `${Math.round(((budget - spent) / budget) * 100)}%` : '—';
const perSF  = (n: number, sf: number | null) => sf && sf > 0 && n > 0 ? `$${(n / sf).toFixed(2)}` : '—';
const perAC  = (n: number, ac: number | null) => ac && ac > 0 && n > 0 ? `$${Math.round(n / ac).toLocaleString()}` : '—';
const warnCls = (billed: number, budget: number) => budget > 0 && billed > 0 && billed / budget >= 1 ? styles.danger : '';

const STATUS_COLOR: Record<string, string> = {
  active: '#16a34a', pending: '#d97706', draft: '#6b7280',
  approved: '#2563eb', voided: '#9ca3af', rejected: '#dc2626',
};

const INV_TYPE: Record<string, { label: string; bg: string; text: string }> = {
  fixed:   { label: 'Fixed',   bg: '#dbeafe', text: '#1d4ed8' },
  tm:      { label: 'T&M',     bg: '#fef3c7', text: '#92400e' },
  expense: { label: 'Expense', bg: '#dcfce7', text: '#166534' },
};

// Root account numbers collapsed by default
const DEFAULT_COLLAPSED = new Set(['1600', '1880', '1920', '1950', '1999']);

const TAB_FIELDS = ['task_name', 'budgeted_amount', 'consultant', 'calculation_method', 'notes'];

// ─── Editable cell ────────────────────────────────────────────────────────────

function EditCell({ value, rowId, field, numeric, isActive, onActivate, onCommit, onTabNext, className }: {
  value: string | number | null; rowId: number; field: string; numeric?: boolean;
  isActive: boolean; onActivate: (rowId: number, field: string) => void;
  onCommit: (rowId: number, field: string, val: string) => void;
  onTabNext: (rowId: number, field: string) => void; className?: string;
}) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const display = numeric
    ? (value != null && Number(value) !== 0 ? usd.format(Number(value)) : '')
    : (value ?? '');
  function open() { setDraft(String(value ?? '')); onActivate(rowId, field); setTimeout(() => ref.current?.select(), 0); }
  function commit() { onCommit(rowId, field, draft); }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); commit(); onTabNext(rowId, field); }
    if (e.key === 'Escape') onActivate(-1, '');
  }
  if (isActive) return (
    <td className={`${styles.cell} ${styles.editing} ${className ?? ''}`}>
      <input ref={ref} className={styles.editInput} value={draft}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} autoFocus />
    </td>
  );
  return (
    <td className={`${styles.cell} ${styles.editableCell} ${className ?? ''} ${!display ? styles.cellEmpty : ''}`} onClick={open}>
      {display || null}
    </td>
  );
}

// ─── Drill panel ──────────────────────────────────────────────────────────────

type DrillCell = 'committed' | 'billed';
interface DrillTarget { rowId: number; rowName: string; cell: DrillCell; }

// ─── Inline History ────────────────────────────────────────────────────────────

function InlineHistory({ source, id }: { source: 'contract' | 'invoice'; id: number }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['itemHistory', source, id],
    queryFn: () => source === 'contract' ? api.getContractHistory(id) : api.getInvoiceHistory(id),
    staleTime: 60_000,
  });

  if (isLoading) return <div className={styles.historyLoading}>Loading…</div>;
  if ((data as any[]).length === 0) return <div className={styles.historyEmpty}>No history yet.</div>;

  return (
    <div className={styles.historyList}>
      {(data as any[]).map((e: any) => (
        <div key={e.id} className={styles.historyEntry}>
          <span className={styles.historyDot} />
          <div className={styles.historyContent}>
            <span className={styles.historyAction}>{e.action}</span>
            {e.detail && <span className={styles.historyDetail}> — {e.detail}</span>}
            <span className={styles.historyMeta}> · {e.changed_by_name} · {new Date(e.changed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DrillPanel({ phaseId, projectId, target, onClose, onEditContract }: {
  phaseId: number; projectId: number | string | undefined; target: DrillTarget; onClose: () => void;
  onEditContract: (id: number) => void;
}) {
  const navigate = useNavigate();
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  function toggleHistory(key: string) {
    setExpandedHistory(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  const { data, isLoading } = useQuery({
    queryKey: ['drill', phaseId, target.rowId],
    queryFn: () => api.drillBudgetLine(phaseId, target.rowId),
    staleTime: 0,
  });
  const isGeneralUnassigned = (data as any)?.is_general_unassigned;
  function openEdit(invoiceId: number) {
    onClose();
    navigate(`/projects/${projectId}/phases/${phaseId}/invoices?edit=${invoiceId}`);
  }
  function openEditContract(contractId: number) {
    onClose();
    onEditContract(contractId);
  }
  const contracts: any[] = data?.contracts ?? [];
  const invoices:  any[] = data?.invoices  ?? [];
  const contractTotal = contracts.reduce((s: number, c: any) => s + Number(c.allocated_amount), 0);
  const invoiceTotal  = invoices.reduce( (s: number, i: any) => s + Number(i.amount), 0);

  return (
    <div className={styles.drillOverlay} onClick={onClose}>
      <div className={styles.drillPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.drillHeader}>
          <div>
            <div className={styles.drillTitle}>{target.rowName}</div>
            <div className={styles.drillSub}>{target.cell === 'committed' ? 'Contract Commitments' : 'Invoiced / Billed'}</div>
          </div>
          <button className={styles.drillClose} onClick={onClose}>✕</button>
        </div>
        {isLoading && <div className={styles.drillLoading}>Loading…</div>}
        {!isLoading && target.cell === 'committed' && (
          <div className={styles.drillBody}>
            {contracts.length === 0
              ? <div className={styles.drillEmpty}>No contracts committed to this line.</div>
              : <table className={styles.drillTable}>
                  <thead><tr>
                    <th>Vendor</th><th>Ref #</th><th>Status</th>
                    <th className={styles.drillAmt}>Allocated</th>
                    <th className={styles.drillAmt}>Contract Total</th>
                    <th />
                  </tr></thead>
                  <tbody>
                    {contracts.map((c: any) => {
                      const hKey = `contract-${c.id}`;
                      const hOpen = expandedHistory.has(hKey);
                      const tasks: any[] = c.line_items ?? [];
                      const isMultiTask = tasks.length > 1;
                      return (
                        <>
                          <tr key={c.id} className={styles.drillRow}>
                            <td className={styles.drillVendor}>{c.vendor_name}</td>
                            <td className={styles.drillRef}>{c.reference_number || '—'}</td>
                            <td>
                              <span className={styles.drillBadge}
                                style={{ background: (STATUS_COLOR[c.status] ?? '#888') + '22', color: STATUS_COLOR[c.status] ?? '#555' }}>
                                {c.status}
                              </span>
                              {isMultiTask && <span className={styles.drillPartial}>split</span>}
                            </td>
                            <td className={`${styles.drillAmt} ${styles.drillAmtBold}`}>{usd.format(Number(c.allocated_amount))}</td>
                            <td className={`${styles.drillAmt} ${styles.drillAmtDim}`}>{usd.format(Number(c.total_value))}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button className={styles.drillPdfBtn}
                                onClick={() => openEditContract(c.id)}
                                style={{ background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 700 }}>
                                Edit
                              </button>
                              <button className={styles.drillHistoryBtn} onClick={() => toggleHistory(hKey)}>
                                {hOpen ? '▲' : '▼'} History
                              </button>
                            </td>
                          </tr>
                          {/* Task breakdown for multi-task contracts */}
                          {isMultiTask && tasks.map((task: any, ti: number) => (
                            <tr key={`${c.id}-task-${ti}`} className={styles.drillTaskRow}>
                              <td />
                              <td colSpan={2} className={styles.drillTaskName}>
                                {task.budget_line_name || task.description || '—'}
                                {task.billing_type === 'tm' && <span className={styles.drillPartial}>T&M</span>}
                              </td>
                              <td className={`${styles.drillAmt} ${styles.drillAmtDim}`}>
                                {task.billing_type === 'tm' ? <span className={styles.drillPartial}>T&M</span> : usd.format(Number(task.budgeted_amount))}
                              </td>
                              <td className={styles.drillAmtDim} style={{ fontSize: 11, color: '#9aa0a6' }}>
                                {task.phase_budget_line_id ? '→ ' + (task.budget_line_name || 'line') : <span className={styles.drillPartial}>unassigned</span>}
                              </td>
                              <td />
                            </tr>
                          ))}
                          {hOpen && (
                            <tr key={`${hKey}-history`} className={styles.drillHistoryRow}>
                              <td colSpan={6}><InlineHistory source="contract" id={c.id} /></td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                  <tfoot><tr className={styles.drillTotal}>
                    <td colSpan={3}>Total committed</td>
                    <td className={styles.drillAmt}>{usd.format(contractTotal)}</td><td /><td />
                  </tr></tfoot>
                </table>
            }
          </div>
        )}
        {!isLoading && target.cell === 'billed' && (
          <div className={styles.drillBody}>
            {isGeneralUnassigned && invoices.length > 0 && (
              <div style={{
                margin: '8px 12px', padding: '8px 12px', borderRadius: 4,
                background: 'var(--accent-light)', border: '1px solid var(--accent)',
                fontSize: 12, color: '#6b3e1e',
              }}>
                These invoices have line items GL-coded to this account but not yet
                assigned to a specific PM task. <strong>Click "Edit" on any row</strong> to
                pick the right task — the General amount will burn down as you do.
              </div>
            )}
            {invoices.length === 0
              ? <div className={styles.drillEmpty}>{isGeneralUnassigned
                  ? 'No unassigned line items on this GL code.'
                  : 'No invoices billed against this line.'}</div>
              : <table className={styles.drillTable}>
                  <thead><tr>
                    <th>Invoice #</th><th>Vendor</th><th>Date</th><th>Type</th>
                    <th>Contract</th><th>Status</th>
                    <th className={styles.drillAmt}>Allocated</th>
                    <th className={styles.drillAmt}>Inv. Total</th>
                    <th />
                  </tr></thead>
                  <tbody>
                    {invoices.map((inv: any) => {
                      const t = INV_TYPE[inv.invoice_type];
                      const allocated = Number(inv.amount);
                      const total = Number(inv.total_amount);
                      const isPartial = Math.abs(allocated - total) > 0.01;
                      const hKey = `invoice-${inv.id}`;
                      const hOpen = expandedHistory.has(hKey);
                      return (
                        <>
                          <tr key={inv.id} className={styles.drillRow}>
                          <td className={styles.drillRef}>{inv.invoice_number || '—'}</td>
                          <td className={styles.drillVendor}>{inv.vendor_name}</td>
                          <td className={styles.drillRef}>{inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '—'}</td>
                          <td>
                            {t
                              ? <span className={styles.drillBadge} style={{ background: t.bg, color: t.text }}>{t.label}</span>
                              : <span className={styles.drillRef}>{inv.invoice_type || '—'}</span>
                            }
                          </td>
                          <td>
                            {inv.contract_ref
                              ? <span className={styles.drillContractRef}>#{inv.contract_ref}</span>
                              : <span className={styles.drillDirectBadge}>Direct</span>
                            }
                          </td>
                          <td>
                            <span className={styles.drillBadge}
                              style={{ background: (STATUS_COLOR[inv.status] ?? '#888') + '22', color: STATUS_COLOR[inv.status] ?? '#555' }}>
                              {inv.status}
                            </span>
                            {isPartial && <span className={styles.drillPartial}>split</span>}
                          </td>
                          <td className={`${styles.drillAmt} ${styles.drillAmtBold}`}>{usd.format(allocated)}</td>
                          <td className={`${styles.drillAmt} ${styles.drillAmtDim}`}>{isPartial ? usd.format(total) : '—'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className={styles.drillPdfBtn}
                              onClick={() => openEdit(inv.id)}
                              title="Open Edit Invoice — assign GL codes and tasks"
                              style={{ marginRight: 4, background: 'var(--accent-light)', color: 'var(--accent)', border: '1px solid var(--accent)', fontWeight: 700 }}>
                              Edit
                            </button>
                            {inv.file_reference && (
                              <button className={styles.drillPdfBtn}
                                onClick={() => window.open(`/api/files/${encodeURIComponent(inv.file_reference)}`, '_blank')}
                                title="View PDF">
                                PDF
                              </button>
                            )}
                            <button className={styles.drillHistoryBtn} onClick={() => toggleHistory(hKey)}>
                              {hOpen ? '▲' : '▼'} History
                            </button>
                          </td>
                        </tr>
                        {hOpen && (
                          <tr key={`${hKey}-history`} className={styles.drillHistoryRow}>
                            <td colSpan={9}><InlineHistory source="invoice" id={inv.id} /></td>
                          </tr>
                        )}
                        </>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {(['fixed', 'tm', 'expense'] as const).map(type => {
                      const sub = invoices.filter((i: any) => i.invoice_type === type).reduce((s: number, i: any) => s + Number(i.amount), 0);
                      if (sub === 0) return null;
                      return (
                        <tr key={type} className={styles.drillSubtotalRow}>
                          <td colSpan={7} className={styles.drillSubtotalLabel}>{INV_TYPE[type].label}</td>
                          <td className={`${styles.drillAmt} ${styles.drillAmtDim}`}>{usd.format(sub)}</td>
                          <td />
                        </tr>
                      );
                    })}
                    <tr className={styles.drillTotal}>
                      <td colSpan={7}>Total billed to this line</td>
                      <td className={styles.drillAmt}>{usd.format(invoiceTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Drillable read-only cell ──────────────────────────────────────────────────

function DC({ value, row, cell, active, onDrill, className }: {
  value: number; row: BudgetRow; cell: DrillCell;
  active: boolean; onDrill: (t: DrillTarget) => void; className?: string;
}) {
  const has = value !== 0;
  return (
    <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${className ?? ''} ${has ? styles.drillable : ''} ${active ? styles.drillActive : ''}`}
      onClick={has ? () => onDrill({ rowId: row.id, rowName: row.task_name, cell }) : undefined}
      title={has ? 'Click to see breakdown' : undefined}>
      {value === 0 ? '' : usd.format(value)}
    </td>
  );
}

// ─── Totals helpers ────────────────────────────────────────────────────────────

type Totals = {
  budgeted: number; committed: number; co_value: number; total_commitment: number; remaining_commit: number;
  fixed: number; tm: number; expenses: number; billed: number; paid: number; rem_budget: number;
};
const zero = (): Totals => ({
  budgeted: 0, committed: 0, co_value: 0, total_commitment: 0, remaining_commit: 0,
  fixed: 0, tm: 0, expenses: 0, billed: 0, paid: 0, rem_budget: 0,
});
// `skipActualsSum` skips the QB-derived actuals fields. Used in QB Source mode
// where multiple pbls share one qb_account_id: each leaf gets the FULL GL-code
// total from the backend (because QB has no task-level granularity), so we sum
// the actuals only ONCE per unique qb_account_id when rolling up into ancestors.
const addRow = (t: Totals, r: BudgetRow, skipActualsSum = false): Totals => ({
  budgeted:          t.budgeted          + r.budgeted_amount,
  committed:         t.committed         + r.committed,
  co_value:          t.co_value          + r.co_value,
  total_commitment:  t.total_commitment  + r.total_commitment,
  remaining_commit:  t.remaining_commit  + r.remaining_commit,
  fixed:             t.fixed             + (skipActualsSum ? 0 : r.fixed_charges),
  tm:                t.tm                + (skipActualsSum ? 0 : r.tm_charges),
  expenses:          t.expenses          + (skipActualsSum ? 0 : r.expense_charges),
  billed:            t.billed            + (skipActualsSum ? 0 : r.billed),
  paid:              t.paid              + (skipActualsSum ? 0 : r.paid),
  rem_budget:        t.rem_budget        + (skipActualsSum ? 0 : r.remaining_budget),
});

// ─── Main component ───────────────────────────────────────────────────────────

type BudgetSource = 'pm' | 'qb';

export default function BudgetGrid({ source = 'pm' }: { source?: BudgetSource } = {}) {
  const { projectId, phaseId } = useParams<{ projectId: string; phaseId: string }>();
  const phaseIdNum = Number(phaseId);
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ['project', Number(projectId)],
    queryFn: () => api.getProject(Number(projectId)),
    enabled: !!projectId,
  });
  const gla_sf = (project as any)?.gla_sf ? Number((project as any).gla_sf) : null;
  const gla_ac = (project as any)?.gla_ac ? Number((project as any).gla_ac) : null;

  const [collapsed,        setCollapsed]        = useState<Set<string>>(new Set(DEFAULT_COLLAPSED));
  const [active,           setActive]           = useState<{ rowId: number; field: string }>({ rowId: -1, field: '' });
  const [showDetails,      setShowDetails]      = useState(false);
  const [hideUnused,       setHideUnused]       = useState(false);
  const [panelRow,         setPanelRow]         = useState<BudgetRow | null>(null);
  const [drillTarget,      setDrillTarget]      = useState<DrillTarget | null>(null);
  const [viewMode,         setViewMode]         = useState<'budget' | 'variance'>('budget');
  const [trayOpen,         setTrayOpen]         = useState(true);
  const [editInvoiceId,    setEditInvoiceId]    = useState<number | null>(null);
  const [editContractId,   setEditContractId]   = useState<number | null>(null);

  const { data: rows = [], isLoading, error } = useQuery<BudgetRow[]>({
    queryKey: ['budget', phaseIdNum, source],
    queryFn: () => api.getBudget(phaseIdNum, source),
    enabled: !!phaseIdNum,
    refetchOnWindowFocus: true,
  });

  const { data: qbAccounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qb-accounts'],
    queryFn: () => api.listQbAccounts(),
    staleTime: Infinity,
  });

  const { data: contracts = [] } = useQuery<any[]>({
    queryKey: ['contracts', phaseIdNum],
    queryFn: () => api.listContracts(phaseIdNum),
    enabled: !!phaseIdNum,
  });

  const { data: unassigned, refetch: refetchUnassigned } = useQuery<{ contracts: any[]; invoices: any[] }>({
    queryKey: ['unassigned', phaseIdNum],
    queryFn: () => api.getUnassigned(phaseIdNum),
    enabled: !!phaseIdNum,
  });
  const unassignedContracts = unassigned?.contracts ?? [];
  const unassignedInvoices  = unassigned?.invoices  ?? [];
  const unassignedCount     = unassignedContracts.length + unassignedInvoices.length;

  function handleUnassignedSaved() {
    setEditInvoiceId(null);
    setEditContractId(null);
    refetchUnassigned();
    qc.invalidateQueries({ queryKey: ['budget', phaseIdNum] });
  }

  const [showAddRow, setShowAddRow] = useState(false);
  const [newRowName, setNewRowName] = useState('');
  const [newRowAmt,  setNewRowAmt]  = useState('');

  const initMutation = useMutation({
    mutationFn: (template: 'default' | 'blank') => api.initBudget(phaseIdNum, template),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget', phaseIdNum] }),
  });

  const addRowMutation = useMutation({
    mutationFn: (data: { task_name: string; budgeted_amount: number }) =>
      api.addBudgetLine(phaseIdNum, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget', phaseIdNum] });
      setNewRowName('');
      setNewRowAmt('');
      setShowAddRow(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => api.updateBudgetLine(id, data),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ['budget', phaseIdNum] });
      const prev = qc.getQueryData<BudgetRow[]>(['budget', phaseIdNum]);
      qc.setQueryData<BudgetRow[]>(['budget', phaseIdNum], old => old?.map(r => r.id === id ? { ...r, ...data } : r) ?? []);
      return { prev };
    },
    onError: (_e, _v, ctx: any) => qc.setQueryData(['budget', phaseIdNum], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['budget', phaseIdNum] }),
  });

  function handleCommit(rowId: number, field: string, raw: string) {
    setActive({ rowId: -1, field: '' });
    let value: any = raw.trim();
    if (field === 'budgeted_amount') value = parseFloat(raw.replace(/[^0-9.-]/g, '')) || 0;
    updateMutation.mutate({ id: rowId, data: { [field]: value } });
  }

  function toggle(key: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function drill(t: DrillTarget) {
    setDrillTarget(prev => prev?.rowId === t.rowId && prev?.cell === t.cell ? null : t);
  }

  const filteredRows = useMemo(() =>
    hideUnused
      ? rows.filter(r => r.committed > 0 || r.billed > 0 || r.source === 'user')
      : rows,
    [rows, hideUnused]
  );

  // Rows with no QB account (manually added, no GL link yet) — rendered in their own section
  const freeRows = useMemo(
    () => filteredRows.filter(r => r.qb_account_id == null && !(r as any).phantom_from_qb),
    [filteredRows]
  );
  const freeTotals = useMemo(
    () => freeRows.reduce((a, r) => addRow(a, r), zero()),
    [freeRows]
  );

  // QB account tree structures
  const qbById = useMemo(() =>
    new Map<number, QbAccount>(qbAccounts.map(a => [a.id, a])),
    [qbAccounts]
  );

  const qbChildrenOf = useMemo(() => {
    const m = new Map<number, QbAccount[]>();
    for (const a of qbAccounts) {
      if (a.parent_id !== null) {
        if (!m.has(a.parent_id)) m.set(a.parent_id, []);
        m.get(a.parent_id)!.push(a);
      }
    }
    for (const children of m.values()) children.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [qbAccounts]);

  const qbRoots = useMemo(() =>
    qbAccounts.filter(a => a.parent_id === null).sort((a, b) => a.sort_order - b.sort_order),
    [qbAccounts]
  );

  // Rows by qb_account_id (for leaf slots)
  const rowsByLeafId = useMemo(() => {
    const m = new Map<number, BudgetRow[]>();
    for (const r of filteredRows) {
      if (r.qb_account_id != null) {
        if (!m.has(r.qb_account_id)) m.set(r.qb_account_id, []);
        m.get(r.qb_account_id)!.push(r);
      }
    }
    return m;
  }, [filteredRows]);

  // Totals per account, rolled up to all ancestors
  // SHARED-GL DEDUP — only applies in QB Source mode.
  // In QB Source, qb_transactions are coded at GL-account level. When N pbls
  // share one qb_account_id, each leaf gets the FULL GL-code total credited,
  // so we dedup at the rollup to count it once.
  // In PM Source, the SQL Path 2 only fires for unique-GL pbls; shared-GL
  // unassigned amounts come back as synthetic "General — Unassigned" rows
  // (with their own row, not multiplied across siblings), so dedup is NOT
  // needed and would in fact be wrong (it would suppress real per-task data).
  const isQbSourced = source === 'qb';
  const acctTotals = useMemo(() => {
    const t = new Map<number, Totals>();
    const counted = new Map<number, Set<number>>();
    for (const r of filteredRows) {
      if (r.qb_account_id == null) continue;
      let cur: QbAccount | undefined = qbById.get(r.qb_account_id);
      while (cur) {
        if (!t.has(cur.id)) t.set(cur.id, zero());
        if (!counted.has(cur.id)) counted.set(cur.id, new Set());
        const seen = counted.get(cur.id)!;
        const skip = isQbSourced && seen.has(r.qb_account_id);
        seen.add(r.qb_account_id);
        t.set(cur.id, addRow(t.get(cur.id)!, r, skip));
        cur = cur.parent_id != null ? qbById.get(cur.parent_id) : undefined;
      }
    }
    return t;
  }, [filteredRows, qbById, isQbSourced]);

  const grand = useMemo(() => {
    const seen = new Set<number>();
    return filteredRows.reduce((a, r) => {
      const skip = isQbSourced && r.qb_account_id != null && seen.has(r.qb_account_id);
      if (r.qb_account_id != null) seen.add(r.qb_account_id);
      return addRow(a, r, skip);
    }, zero());
  }, [filteredRows, isQbSourced]);

  // Phantom QB rows (qb_account_id is null, source='qb' only). Their own section.
  const phantomRows = useMemo(
    () => filteredRows.filter(r => (r as any).phantom_from_qb),
    [filteredRows]
  );
  const phantomTotals = useMemo(
    () => phantomRows.reduce((a, r) => addRow(a, r), zero()),
    [phantomRows]
  );

  // Leaves to blank: only shared-GL leaves in QB Source view (where each leaf
  // gets the full GL total). PM Source's "General — Unassigned" synthetic rows
  // don't need blanking — they're their own row carrying the unassigned amount.
  const sharedQbAccountIds = useMemo(() => {
    if (!isQbSourced) return new Set<number>();
    const counts = new Map<number, number>();
    for (const r of filteredRows) {
      if (r.qb_account_id == null) continue;
      // Don't count synthetic "general" rows when measuring sharing
      if ((r as any).general_unassigned) continue;
      counts.set(r.qb_account_id, (counts.get(r.qb_account_id) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([id]) => id));
  }, [filteredRows, isQbSourced]);

  const blankActualsForShared = (r: BudgetRow): BudgetRow => {
    if (r.qb_account_id == null || !sharedQbAccountIds.has(r.qb_account_id)) {
      return r;
    }
    if ((r as any).general_unassigned) return r; // never blank the General row itself
    return { ...r, fixed_charges: 0, tm_charges: 0, expense_charges: 0,
             billed: 0, paid: 0, amount_due: 0, remaining_budget: r.budgeted_amount };
  };

  const handleTabNext = useCallback((rowId: number, field: string) => {
    const fi = TAB_FIELDS.indexOf(field);
    if (fi < TAB_FIELDS.length - 1) { setActive({ rowId, field: TAB_FIELDS[fi + 1] }); return; }
    const ri = filteredRows.findIndex(r => r.id === rowId);
    if (ri < filteredRows.length - 1) setActive({ rowId: filteredRows[ri + 1].id, field: TAB_FIELDS[0] });
  }, [filteredRows]);

  if (isLoading) return <div className={styles.splash}>Loading budget…</div>;
  if (error)     return <div className={styles.splash}>Error loading budget.</div>;
  if (!rows.length) return (
    <div className={styles.splash}>
      <p className={styles.splashMsg}>No budget lines yet. Choose how to start:</p>
      <div className={styles.splashOptions}>
        <div className={styles.splashCard}>
          <div className={styles.splashCardTitle}>Full Template</div>
          <div className={styles.splashCardDesc}>Load all standard line items from the master budget template. Best for a complete project setup.</div>
          <button className={styles.initBtn} onClick={() => initMutation.mutate('default')}
            disabled={initMutation.isPending}>
            {initMutation.isPending ? 'Loading…' : 'Load Full Template'}
          </button>
        </div>
        <div className={styles.splashCard}>
          <div className={styles.splashCardTitle}>Start Blank</div>
          <div className={styles.splashCardDesc}>Start with one empty row and add lines manually. Good for testing or a simplified budget.</div>
          <button className={`${styles.initBtn} ${styles.initBtnOutline}`}
            onClick={() => initMutation.mutate('blank')}
            disabled={initMutation.isPending}>
            {initMutation.isPending ? 'Creating…' : 'Start with One Blank Row'}
          </button>
        </div>
      </div>
    </div>
  );

  const dc = showDetails ? '' : styles.detailHidden;

  const SumCells = ({ t, variant, blank }: { t: Totals; variant: 'root' | 'grp' | 'sub' | 'leaf'; blank?: boolean }) => {
    const cls =
      variant === 'root' ? styles.rootNum :
      variant === 'sub'  ? styles.secSubNum :
      variant === 'leaf' ? styles.sgSubNum :
      styles.grpNum;
    if (blank) return <>
      <td className={cls}/><td className={cls}/><td className={cls}/>
      <td className={cls}/><td className={cls}/><td className={cls}/>
      <td className={cls}/><td className={cls}/><td className={cls}/>
      <td className={cls}/><td className={cls}/><td className={cls}/>
      <td className={cls}/><td className={cls}/><td className={cls}/>
      <td className={`${cls} ${dc}`}/><td className={`${cls} ${dc}`}/>
      <td className={`${cls} ${dc}`}/><td className={`${cls} ${dc}`}/>
    </>;
    const amtDue = t.billed - t.paid;
    return <>
      <td className={cls}>{moneyD(t.budgeted)}</td>
      <td className={`${cls} ${t.rem_budget < 0 ? styles.danger : ''}`}>{moneyD(t.rem_budget)}</td>
      <td className={cls}>{t.budgeted > 0 ? remPct(t.billed, t.budgeted) : '—'}</td>
      <td className={cls}>{money(t.committed)}</td>
      <td className={cls}>{t.co_value > 0 ? money(t.co_value) : '—'}</td>
      <td className={`${cls} ${t.total_commitment > t.budgeted && t.budgeted > 0 ? styles.danger : ''}`}>{money(t.total_commitment)}</td>
      <td className={cls}>{t.total_commitment > 0 ? remPct(t.billed, t.total_commitment) : '—'}</td>
      <td className={cls}>{money(t.fixed)}</td>
      <td className={cls}>{money(t.tm)}</td>
      <td className={cls}>{money(t.expenses)}</td>
      <td className={cls}>{moneyD(t.billed)}</td>
      <td className={cls}>{money(amtDue)}</td>
      <td className={cls}>{money(t.paid)}</td>
      <td className={cls}>{perSF(t.billed, gla_sf)}</td>
      <td className={cls}>{perAC(t.billed, gla_ac)}</td>
      <td className={`${cls} ${dc}`} /><td className={`${cls} ${dc}`} />
      <td className={`${cls} ${dc}`} /><td className={`${cls} ${dc}`} />
    </>;
  };

  const renderRow = (row: BudgetRow) => {
    const isA = (f: string) => active.rowId === row.id && active.field === f;
    const isDrillActive = drillTarget?.rowId === row.id;
    return (
      <tr key={row.id} className={`${styles.dataRow} ${row.source === 'user' ? styles.rowUserAdded : ''} ${isDrillActive ? styles.drillActiveRow : ''}`}
        style={(row as any).general_unassigned ? { background: '#fef9f3', fontStyle: 'italic' } : undefined}>
        <td className={styles.rowGutter} onClick={() => setPanelRow(row)} style={{ cursor: 'pointer' }}
          title={row.has_direct_invoices ? 'Has invoices billed directly (no contract)' : undefined}>
          <span className={`${styles.rowArrow} ${row.has_direct_invoices ? styles.rowArrowDirect : ''}`}>›</span>
        </td>
        <td className={`${styles.cell} ${styles.tdAcct} ${styles.ro}`}>
          <span className={styles.tdAcctNum}>{row.qb_account_number ?? '—'}</span>
          {row.qb_short_name && <span className={styles.tdAcctDesc}>{row.qb_short_name}</span>}
        </td>
        <EditCell value={row.task_name} rowId={row.id} field="task_name"
          isActive={isA('task_name')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
          onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdTask} />
        <EditCell value={row.budgeted_amount} rowId={row.id} field="budgeted_amount" numeric
          isActive={isA('budgeted_amount')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
          onCommit={handleCommit} onTabNext={handleTabNext}
          className={`${styles.tdMoney} ${(row.source ?? 'template') === 'template' && !row.amount_modified ? styles.amtTemplate : styles.amtModified}`} />
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.budgeted_amount > 0 && row.remaining_budget < 0 ? styles.danger : ''}`}>
          {row.budgeted_amount > 0 ? usd.format(row.remaining_budget) : '—'}
        </td>
        <td className={`${styles.cell} ${styles.tdPct} ${styles.ro} ${warnCls(row.billed, row.budgeted_amount)}`}>
          {row.budgeted_amount > 0 ? remPct(row.billed, row.budgeted_amount) : '—'}
        </td>
        <DC value={row.committed} row={row} cell="committed"
          active={isDrillActive && drillTarget?.cell === 'committed'} onDrill={drill} />
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>
          {row.co_count > 0 ? <span title={`${row.co_count} CO${row.co_count > 1 ? 's' : ''}`}>{money(row.co_value)}</span> : ''}
        </td>
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.total_commitment > row.budgeted_amount && row.budgeted_amount > 0 ? styles.danger : ''}`}>
          {money(row.total_commitment)}
        </td>
        <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>
          {row.total_commitment > 0 ? remPct(row.billed, row.total_commitment) : '—'}
        </td>
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.fixed_charges)}</td>
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.tm_charges)}</td>
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.expense_charges)}</td>
        <DC value={row.billed} row={row} cell="billed"
          active={isDrillActive && drillTarget?.cell === 'billed'} onDrill={drill}
          className={warnCls(row.billed, row.budgeted_amount)} />
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.amount_due)}</td>
        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.paid)}</td>
        <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perSF(row.billed, gla_sf)}</td>
        <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perAC(row.billed, gla_ac)}</td>
        <td className={`${styles.cell} ${styles.tdQb} ${styles.ro} ${dc}`}>
          {row.qb_codes_used || '—'}
        </td>
        <EditCell value={row.calculation_method} rowId={row.id} field="calculation_method"
          isActive={isA('calculation_method')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
          onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdCalc} ${dc}`} />
        <EditCell value={row.consultant} rowId={row.id} field="consultant"
          isActive={isA('consultant')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
          onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdText} ${dc}`} />
        <EditCell value={row.notes} rowId={row.id} field="notes"
          isActive={isA('notes')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
          onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdNotes} ${dc}`} />
      </tr>
    );
  };

  // Recursive account tree renderer
  // depth 0 = root accounts (1600, 1700…), depth 1 = sub-groups (1710, 1720…), depth 2 = leaf nodes
  const renderAccts = (accounts: QbAccount[], depth: number): React.ReactNode[] => {
    return accounts.flatMap(acct => {
      const children = qbChildrenOf.get(acct.id) ?? [];
      const leafRowsRaw = rowsByLeafId.get(acct.id) ?? [];
      // Place "General — Unassigned" synthetic rows first within each shared GL group,
      // so the eye sees the bucket-to-burn-down before the specific tasks.
      const leafRows = [...leafRowsRaw].sort((a, b) => {
        const aGen = (a as any).general_unassigned ? 0 : 1;
        const bGen = (b as any).general_unassigned ? 0 : 1;
        if (aGen !== bGen) return aGen - bGen;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
      const t = acctTotals.get(acct.id) ?? zero();
      const key = acct.account_number;
      const isOpen = !collapsed.has(key);
      const label = acct.short_name;
      const acctTag = (
        <span className={styles.acctNum}>{acct.account_number}</span>
      );

      if (depth === 0) {
        // Root: category band — numbers shown only when collapsed; subtotal row at bottom when expanded
        return [
          <tr key={`root:${key}`} className={styles.catRow} onClick={() => toggle(key)}>
            <td className={styles.catGutter}><span className={styles.chevron}>{isOpen ? '▾' : '▸'}</span></td>
            <td className={styles.catLabel} colSpan={2}>{acctTag}{label}</td>
            <SumCells t={t} variant="root" blank={isOpen} />
          </tr>,
          ...(isOpen ? [
            ...renderAccts(children, 1),
            <tr key={`root:${key}:sub`} className={styles.catSubRow}>
              <td /><td className={styles.catSubLabel} colSpan={2}>{acct.account_number} — Total</td>
              <SumCells t={t} variant="root" />
            </tr>,
          ] : []),
        ];
      }

      if (children.length > 0) {
        // Sub-group: collapsible group row — numbers shown only when collapsed
        return [
          <tr key={`grp:${key}`} className={styles.secRow} onClick={() => toggle(key)}>
            <td className={styles.secGutter}><span className={styles.chevron}>{isOpen ? '▾' : '▸'}</span></td>
            <td className={styles.secLabel} colSpan={2}>{acctTag}{label}</td>
            <SumCells t={t} variant="grp" blank={isOpen} />
          </tr>,
          ...(isOpen ? [
            ...renderAccts(children, depth + 1),
            <tr key={`grp:${key}:sub`} className={styles.secSubRow}>
              <td /><td className={styles.secSubLabel} colSpan={2}>{acct.account_number} — Total</td>
              <SumCells t={t} variant="sub" />
            </tr>,
          ] : []),
        ];
      }

      // Leaf account: task rows only
      return leafRows.map(r => renderRow(blankActualsForShared(r)));
    });
  };

  const vrPct = (num: number, den: number) => den > 0 ? `${Math.round((num / den) * 100)}%` : '—';

  const renderVarianceAccts = (accounts: QbAccount[], depth: number): React.ReactNode[] =>
    accounts.flatMap(acct => {
      const t = acctTotals.get(acct.id);
      const children = qbChildrenOf.get(acct.id) ?? [];
      if (!t || (t.budgeted === 0 && t.total_commitment === 0 && t.billed === 0)) return [];
      const isOver = t.total_commitment > t.budgeted && t.budgeted > 0;
      const label  = acct.full_name.split(':').pop()?.trim() ?? acct.account_number;
      const rowCls = depth === 0 ? styles.vrRoot : depth === 1 ? styles.vrGroup : styles.vrLeaf;
      return [
        <tr key={acct.id} className={`${styles.vrRow} ${rowCls} ${isOver ? styles.vrRowOver : ''}`}>
          <td className={styles.vrCode}>{acct.account_number}</td>
          <td className={styles.vrName} style={{ paddingLeft: `${10 + depth * 18}px` }}>{label}</td>
          <td className={`${styles.vrNum} ${isOver ? styles.vrOver : ''}`}>{moneyD(t.budgeted)}</td>
          <td className={styles.vrPct}>{vrPct(t.billed, t.budgeted)}</td>
          <td className={`${styles.vrNum} ${isOver ? styles.vrOver : ''}`}>{moneyD(t.total_commitment)}</td>
          <td className={styles.vrPct}>{vrPct(t.billed, t.total_commitment)}</td>
          <td className={styles.vrNum}>{moneyD(t.billed)}</td>
          <td className={`${styles.vrNum} ${t.remaining_commit < 0 ? styles.vrNeg : ''}`}>{moneyD(t.remaining_commit)}</td>
        </tr>,
        ...renderVarianceAccts(children, depth + 1),
      ];
    });

  return (
    <div className={styles.wrapper}>
      {panelRow    && <LineItemPanel row={panelRow} onClose={() => setPanelRow(null)} source={source} />}
      {drillTarget && <DrillPanel phaseId={phaseIdNum} projectId={projectId} target={drillTarget} onClose={() => setDrillTarget(null)} onEditContract={id => { setDrillTarget(null); setEditContractId(id); }} />}

      {/* Full invoice / contract editors opened from unassigned tray */}
      {editInvoiceId !== null && (
        <InvoicePanel
          contracts={contracts}
          budgetLines={rows}
          qbAccounts={qbAccounts}
          projectId={Number(projectId)}
          phaseIdNum={phaseIdNum}
          editId={editInvoiceId}
          onClose={() => setEditInvoiceId(null)}
          onSaved={handleUnassignedSaved}
        />
      )}
      {editContractId !== null && (
        <ContractPanel
          qbAccounts={qbAccounts}
          projectId={Number(projectId)}
          phaseId={phaseIdNum}
          editId={editContractId}
          onClose={() => setEditContractId(null)}
          onSaved={handleUnassignedSaved}
        />
      )}

      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>{viewMode === 'variance' ? 'Variance Report' : 'Budget'}</span>
        {drillTarget && viewMode === 'budget' && (
          <span className={styles.drillHint}>
            <strong>{drillTarget.rowName}</strong> · {drillTarget.cell === 'committed' ? 'Commitments' : 'Billed'}
            <button className={styles.drillClearBtn} onClick={() => setDrillTarget(null)}>✕</button>
          </span>
        )}
        <div className={styles.toolActions}>
          <button className={`${styles.tbBtn} ${viewMode === 'variance' ? styles.tbBtnActive : ''}`}
            onClick={() => setViewMode(v => v === 'budget' ? 'variance' : 'budget')}>
            {viewMode === 'variance' ? '← Budget View' : 'Variance Report'}
          </button>
          {viewMode === 'budget' && <>
            <button className={`${styles.tbBtn} ${hideUnused ? styles.tbBtnActive : ''}`}
              onClick={() => setHideUnused(v => !v)}
              title="Hide rows with no contracts or invoices">
              {hideUnused ? `Active Only (${filteredRows.length}/${rows.length})` : 'Active Only'}
            </button>
            <button className={`${styles.tbBtn} ${showDetails ? styles.tbBtnActive : ''}`}
              onClick={() => setShowDetails(v => !v)}>
              {showDetails ? 'Hide Details' : 'Details'}
            </button>
          </>}
          <button className={`${styles.tbBtn} ${styles.tbBtnAdd}`} onClick={() => setShowAddRow(v => !v)}
            title="Add a custom budget line">
            + Row
          </button>
          <button className={styles.tbBtn} onClick={() => api.downloadBudgetExcel(phaseIdNum)}
            title="Download Excel — includes Variance Report + Budget Detail tabs">
            ↓ Excel
          </button>
          {unassignedCount > 0 && (
            <button
              className={`${styles.tbBtn} ${styles.tbBtnWarn}`}
              onClick={() => setTrayOpen(v => !v)}
              title="Items with no task assignment — click to review"
            >
              ⚠ {unassignedCount} unassigned
            </button>
          )}
        </div>
      </div>

      {viewMode === 'variance' && (
        <div className={styles.vrWrap}>
          <table className={styles.vrTable}>
            <thead>
              <tr className={styles.vrHead}>
                <th className={styles.vrThCode}>GL Code</th>
                <th className={styles.vrThName}>Description</th>
                <th className={styles.vrThNum}>Budget</th>
                <th className={styles.vrThPct}>% of Budget</th>
                <th className={styles.vrThNum}>Committed</th>
                <th className={styles.vrThPct}>% of Committed</th>
                <th className={styles.vrThNum}>Actual (Billed)</th>
                <th className={styles.vrThNum}>Variance<br/><span className={styles.vrThSub}>Committed − Actual</span></th>
              </tr>
            </thead>
            <tbody>
              {renderVarianceAccts(qbRoots, 0)}
            </tbody>
            <tfoot>
              <tr className={styles.vrTotal}>
                <td />
                <td className={styles.vrTotalLabel}>TOTAL</td>
                <td className={styles.vrNum}>{moneyD(grand.budgeted)}</td>
                <td className={styles.vrPct}>{vrPct(grand.billed, grand.budgeted)}</td>
                <td className={`${styles.vrNum} ${grand.total_commitment > grand.budgeted ? styles.vrOver : ''}`}>{moneyD(grand.total_commitment)}</td>
                <td className={styles.vrPct}>{vrPct(grand.billed, grand.total_commitment)}</td>
                <td className={styles.vrNum}>{moneyD(grand.billed)}</td>
                <td className={`${styles.vrNum} ${grand.remaining_commit < 0 ? styles.vrNeg : ''}`}>{moneyD(grand.remaining_commit)}</td>
              </tr>
            </tfoot>
          </table>
          <div className={styles.vrLegend}>
            <span className={styles.vrLegOver}>■ Over budget at commitment stage</span>
            <span className={styles.vrLegNeg}>■ Negative variance (billed exceeds committed)</span>
          </div>
        </div>
      )}

      {/* ── Add Row inline form ── */}
      {showAddRow && viewMode === 'budget' && (
        <form className={styles.addRowForm}
          onSubmit={e => {
            e.preventDefault();
            const name = newRowName.trim();
            if (!name) return;
            const amt = parseFloat(newRowAmt.replace(/[^0-9.-]/g, '')) || 0;
            addRowMutation.mutate({ task_name: name, budgeted_amount: amt });
          }}>
          <input
            autoFocus
            className={styles.addRowInput}
            placeholder="Task / description…"
            value={newRowName}
            onChange={e => setNewRowName(e.target.value)}
          />
          <input
            className={`${styles.addRowInput} ${styles.addRowInputAmt}`}
            placeholder="$0"
            value={newRowAmt}
            onChange={e => setNewRowAmt(e.target.value)}
          />
          <button className={styles.addRowSubmit} type="submit" disabled={addRowMutation.isPending}>
            {addRowMutation.isPending ? 'Adding…' : 'Add'}
          </button>
          <button className={styles.addRowCancel} type="button" onClick={() => setShowAddRow(false)}>✕</button>
        </form>
      )}

      {/* ── Reconcile strip ── always visible; turns amber when unallocated money exists */}
      {viewMode === 'budget' && (() => {
        const unallocContractAmt = unassignedContracts.reduce((s: number, c: any) => s + Number(c.total_value || 0), 0);
        const unallocInvoiceAmt  = unassignedInvoices.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
        const unallocTotal       = unallocContractAmt + unallocInvoiceAmt;
        const ok                 = unallocTotal === 0;
        return (
          <div className={`${styles.reconStrip} ${ok ? styles.reconOk : styles.reconWarn}`}>
            <span className={styles.reconStatus}>{ok ? '✓ Reconciled' : '⚠ Unallocated'}</span>
            <span className={styles.reconDivider} />
            <span className={styles.reconStat}><span className={styles.reconLabel}>Budgeted</span>{usd.format(grand.budgeted)}</span>
            <span className={styles.reconStat}><span className={styles.reconLabel}>Committed</span>{usd.format(grand.total_commitment)}</span>
            <span className={styles.reconStat}><span className={styles.reconLabel}>Billed</span>{usd.format(grand.billed)}</span>
            <span className={styles.reconStat}><span className={styles.reconLabel}>Paid</span>{usd.format(grand.paid)}</span>
            <span className={styles.reconDivider} />
            {ok
              ? <span className={styles.reconOkNote}>All contracts &amp; invoices assigned to budget lines</span>
              : <span className={styles.reconWarnNote}>
                  {usd.format(unallocTotal)} outside budget lines
                  {unallocContractAmt > 0 && ` · ${unassignedContracts.length} contract${unassignedContracts.length !== 1 ? 's' : ''} ${usd.format(unallocContractAmt)}`}
                  {unallocInvoiceAmt  > 0 && ` · ${unassignedInvoices.length} invoice${unassignedInvoices.length !== 1 ? 's' : ''} ${usd.format(unallocInvoiceAmt)}`}
                </span>}
          </div>
        );
      })()}

      <div className={styles.scrollArea} style={{ display: viewMode === 'variance' ? 'none' : undefined }}
        onClick={() => setActive({ rowId: -1, field: '' })}>
        <table className={styles.table} onClick={e => e.stopPropagation()}>
          <colgroup><col style={{width:24}}/><col style={{width:200}}/><col style={{width:210}}/><col style={{width:90}}/><col style={{width:88}}/><col style={{width:64}}/><col style={{width:90}}/><col style={{width:76}}/><col style={{width:90}}/><col style={{width:80}}/><col style={{width:76}}/><col style={{width:76}}/><col style={{width:88}}/><col style={{width:80}}/><col style={{width:76}}/><col style={{width:64}}/><col style={{width:64}}/><col style={{width:130}}/><col style={{width:100}}/><col style={{width:110}}/><col style={{width:150}}/></colgroup>
          <thead>
            <tr className={styles.theadGroup}>
              <th colSpan={4} />
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={2}>Remaining</th>
              <th className={styles.thGroup} colSpan={4}>Contract Commitment</th>
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={4}>Invoiced</th>
              <th className={styles.thGroup} colSpan={2}>Payments</th>
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={2}>Unit Cost</th>
              <th className={`${styles.th} ${dc}`} colSpan={4} />
            </tr>
            <tr className={styles.thead}>
              <th className={styles.th} />
              <th className={`${styles.th} ${styles.thLeft}`}>Acct #</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Task / Description</th>
              <th className={`${styles.th} ${styles.thRight}`}>Budgeted<div className={styles.thFormula}>PM input</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. Budget<div className={styles.thFormula}>Budgeted − Billed</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. %<div className={styles.thFormula}>Rem ÷ Budgeted</div></th>
              <th className={`${styles.th} ${styles.thRight} ${styles.drillHdr}`}>Contracted ↓<div className={styles.thFormula}>Σ contract line items</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>COs<div className={styles.thFormula}>Σ change orders</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Total Commit<div className={styles.thFormula}>Contracted + COs</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. %<div className={styles.thFormula}>Rem ÷ Total Commit</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Fixed<div className={styles.thFormula}>Σ fixed invoices</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>T&amp;M<div className={styles.thFormula}>Σ T&amp;M invoices</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Expense<div className={styles.thFormula}>Σ expense invoices</div></th>
              <th className={`${styles.th} ${styles.thRight} ${styles.drillHdr}`}>Billed ↓<div className={styles.thFormula}>Fixed + T&amp;M + Expense</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Amt Due<div className={styles.thFormula}>Billed − Paid</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>Paid<div className={styles.thFormula}>Σ paid invoices</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>$/SF<div className={styles.thFormula}>Billed ÷ GLA sf</div></th>
              <th className={`${styles.th} ${styles.thRight}`}>$/AC<div className={styles.thFormula}>Billed ÷ GLA ac</div></th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>QB Codes Used</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Calc Method</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Consultant</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {qbRoots.length > 0 ? renderAccts(qbRoots, 0) : null}
            {/* Phantom QB rows: GL codes that exist in qb_transactions but not
                in this phase's budget template. Surfaced so QB Source totals
                match the Audit tab (no silent drops). */}
            {/* Freeform rows: manually added rows with no GL account link */}
            {freeRows.length > 0 && (
              <>
                <tr className={styles.catRow}>
                  <td className={styles.catGutter} />
                  <td className={styles.catLabel} colSpan={2}>
                    Custom Lines ({freeRows.length}) — no GL account assigned
                  </td>
                  <SumCells t={freeTotals} variant="root" />
                </tr>
                {freeRows.map(renderRow)}
              </>
            )}
            {phantomRows.length > 0 && (
              <>
                <tr className={styles.catRow}>
                  <td className={styles.catGutter} />
                  <td className={styles.catLabel} colSpan={2}>
                    Auto-added from QB ({phantomRows.length}) — GL codes not in budget template
                  </td>
                  <SumCells t={phantomTotals} variant="root" />
                </tr>
                {phantomRows.map(renderRow)}
              </>
            )}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td /><td className={styles.totalLabel} colSpan={2}>TOTAL</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{usd.format(grand.budgeted)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.rem_budget < 0 ? styles.danger : ''}`}>{moneyD(grand.rem_budget)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{grand.budgeted > 0 ? remPct(grand.billed, grand.budgeted) : '—'}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.committed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{grand.co_value > 0 ? usd.format(grand.co_value) : '—'}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.total_commitment > grand.budgeted ? styles.danger : ''}`}>{usd.format(grand.total_commitment)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{grand.total_commitment > 0 ? remPct(grand.billed, grand.total_commitment) : '—'}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.fixed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.tm)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.expenses)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.billed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.billed - grand.paid)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.paid)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perSF(grand.billed, gla_sf)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perAC(grand.billed, gla_ac)}</td>
              <td className={`${styles.totalCell} ${dc}`} /><td className={`${styles.totalCell} ${dc}`} />
              <td className={`${styles.totalCell} ${dc}`} /><td className={`${styles.totalCell} ${dc}`} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Unassigned tray ─────────────────────────────────────────── */}
      {unassignedCount > 0 && trayOpen && (
        <div className={styles.unassignedTray}>
          <div className={styles.unassignedHeader}>
            <span className={styles.unassignedTitle}>⚠ Unassigned — {unassignedCount} item{unassignedCount !== 1 ? 's' : ''} need task assignment</span>
            <button className={styles.unassignedClose} onClick={() => setTrayOpen(false)}>✕</button>
          </div>

          {unassignedContracts.length > 0 && (
            <div className={styles.unassignedSection}>
              <div className={styles.unassignedSectionLabel}>Contracts ({unassignedContracts.length})</div>
              {unassignedContracts.map((c: any) => (
                <div key={c.id} className={styles.unassignedRow}>
                  <span className={styles.unassignedVendor}>{c.vendor_name || '—'}</span>
                  <span className={styles.unassignedRef}>{c.reference_number || 'No ref'}</span>
                  <span className={styles.unassignedAmt}>{usd.format(Number(c.total_value))}</span>
                  <span className={`${styles.unassignedStatus} ${styles[`status_${c.status}`] ?? ''}`}>{c.status}</span>
                  <button className={styles.unassignedAssignBtn} onClick={() => setEditContractId(c.id)}>
                    Assign →
                  </button>
                </div>
              ))}
            </div>
          )}

          {unassignedInvoices.length > 0 && (
            <div className={styles.unassignedSection}>
              <div className={styles.unassignedSectionLabel}>Invoices ({unassignedInvoices.length})</div>
              {unassignedInvoices.map((inv: any) => (
                <div key={inv.id} className={styles.unassignedRow}>
                  <span className={styles.unassignedVendor}>{inv.vendor_name || '—'}</span>
                  <span className={styles.unassignedRef}>#{inv.invoice_number || '—'}</span>
                  <span className={styles.unassignedAmt}>{usd.format(Number(inv.amount))}</span>
                  <span className={styles.unassignedType}>{inv.invoice_type}</span>
                  <button className={styles.unassignedAssignBtn} onClick={() => setEditInvoiceId(inv.id)}>
                    Assign →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
