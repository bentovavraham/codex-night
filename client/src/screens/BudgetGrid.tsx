import { useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './BudgetGrid.module.css';
import { LineItemPanel } from './LineItemPanel';

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
  // invoice columns
  fixed_charges: number;
  tm_charges: number;
  expense_charges: number;
  billed: number;
  amount_due: number;
  paid: number;
  remaining_budget: number;
  // contract columns
  committed: number;
  co_count: number;
  co_value: number;
  total_commitment: number;
  remaining_commit: number;
  pct_billed: number | null;
  qb_codes_used: string;
  has_direct_invoices: boolean;
  source: 'template' | 'user';
  amount_modified: boolean;
  // QB account hierarchy
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd  = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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

const CATEGORY_LABEL: Record<string, string> = {
  land:              'Land',
  entitlement:       'Entitlement',
  construction:      'Construction & Land Development',
  professional_fees: 'Professional Fees',
  g_and_a:           'General & Administrative',
  closing:           'Closing Costs',
  finance:           'Finance',
  capital:           'Capital Cost',
};

const CATEGORY_ORDER: Record<string, number> = {
  land: 1, entitlement: 2, construction: 3, professional_fees: 4,
  g_and_a: 5, closing: 6, finance: 7, capital: 8,
};

// Categories collapsed by default (no active budget lines expected)
const DEFAULT_COLLAPSED = new Set(['cat:land', 'cat:g_and_a', 'cat:closing', 'cat:finance', 'cat:capital']);

const TAB_FIELDS = ['task_name', 'discipline', 'budgeted_amount', 'consultant', 'calculation_method', 'notes'];

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

function DrillPanel({ phaseId, target, onClose }: {
  phaseId: number; target: DrillTarget; onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['drill', phaseId, target.rowId],
    queryFn: () => api.drillBudgetLine(phaseId, target.rowId),
    staleTime: 0,
  });
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
                  </tr></thead>
                  <tbody>
                    {contracts.map((c: any) => (
                      <tr key={c.id} className={styles.drillRow}>
                        <td className={styles.drillVendor}>{c.vendor_name}</td>
                        <td className={styles.drillRef}>{c.reference_number || '—'}</td>
                        <td>
                          <span className={styles.drillBadge}
                            style={{ background: (STATUS_COLOR[c.status] ?? '#888') + '22', color: STATUS_COLOR[c.status] ?? '#555' }}>
                            {c.status}
                          </span>
                          {!c.is_primary && <span className={styles.drillPartial}>partial</span>}
                        </td>
                        <td className={`${styles.drillAmt} ${styles.drillAmtBold}`}>{usd.format(Number(c.allocated_amount))}</td>
                        <td className={`${styles.drillAmt} ${styles.drillAmtDim}`}>{usd.format(Number(c.total_value))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className={styles.drillTotal}>
                    <td colSpan={3}>Total committed</td>
                    <td className={styles.drillAmt}>{usd.format(contractTotal)}</td><td />
                  </tr></tfoot>
                </table>
            }
          </div>
        )}
        {!isLoading && target.cell === 'billed' && (
          <div className={styles.drillBody}>
            {invoices.length === 0
              ? <div className={styles.drillEmpty}>No invoices billed against this line.</div>
              : <table className={styles.drillTable}>
                  <thead><tr>
                    <th>Invoice #</th>
                    <th>Vendor</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Contract</th>
                    <th>Status</th>
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
                      return (
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
                          <td>
                            {inv.file_reference && (
                              <button className={styles.drillPdfBtn}
                                onClick={() => window.open(`/api/files/${encodeURIComponent(inv.file_reference)}`, '_blank')}
                                title="View PDF">
                                PDF
                              </button>
                            )}
                          </td>
                        </tr>
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
const addRow = (t: Totals, r: BudgetRow): Totals => ({
  budgeted:          t.budgeted          + r.budgeted_amount,
  committed:         t.committed         + r.committed,
  co_value:          t.co_value          + r.co_value,
  total_commitment:  t.total_commitment  + r.total_commitment,
  remaining_commit:  t.remaining_commit  + r.remaining_commit,
  fixed:             t.fixed             + r.fixed_charges,
  tm:                t.tm               + r.tm_charges,
  expenses:          t.expenses          + r.expense_charges,
  billed:            t.billed            + r.billed,
  paid:              t.paid              + r.paid,
  rem_budget:        t.rem_budget        + r.remaining_budget,
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function BudgetGrid() {
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

  const [collapsed,    setCollapsed]    = useState<Set<string>>(new Set(DEFAULT_COLLAPSED));
  const [active,       setActive]       = useState<{ rowId: number; field: string }>({ rowId: -1, field: '' });
  const [showDetails,  setShowDetails]  = useState(false);
  const [hideUnused,   setHideUnused]   = useState(false);
  const [panelRow,     setPanelRow]     = useState<BudgetRow | null>(null);
  const [drillTarget,  setDrillTarget]  = useState<DrillTarget | null>(null);

  const { data: rows = [], isLoading, error } = useQuery<BudgetRow[]>({
    queryKey: ['budget', phaseIdNum],
    queryFn: () => api.getBudget(phaseIdNum),
    enabled: !!phaseIdNum,
  });

  const initMutation = useMutation({
    mutationFn: () => api.initBudget(phaseIdNum, 'default'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget', phaseIdNum] }),
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

  // A row is "unused" when it has no contracted amount and no billed invoices.
  // User-added rows are always shown even if empty.
  const filteredRows = useMemo(() =>
    hideUnused
      ? rows.filter(r => r.committed > 0 || r.billed > 0 || r.source === 'user')
      : rows,
    [rows, hideUnused]
  );

  // QB-hierarchy tree: category → parent_account → leaf_account → rows
  const tree = useMemo(() => {
    const catOrder: string[] = [];
    const catMeta: Record<string, { label: string; sort: number }> = {};
    const catParents: Record<string, string[]> = {};

    const parentMeta: Record<string, { label: string; sort: number; category: string }> = {};
    const leafOrder: Record<string, string[]> = {};
    const leafMeta: Record<string, { label: string; number: string; sort: number }> = {};
    const leafRows: Record<string, BudgetRow[]> = {};

    for (const r of filteredRows) {
      const ck = r.qb_category ?? 'other';
      const pk = r.qb_parent_number ?? r.qb_account_number ?? 'unclassified';
      const lk = r.qb_account_number ?? 'unclassified';

      if (!catMeta[ck]) {
        catOrder.push(ck);
        catMeta[ck] = { label: CATEGORY_LABEL[ck] ?? ck, sort: CATEGORY_ORDER[ck] ?? 99 };
        catParents[ck] = [];
      }
      if (!parentMeta[pk]) {
        catParents[ck].push(pk);
        parentMeta[pk] = {
          label: r.qb_parent_name ?? r.qb_short_name ?? 'Unclassified',
          sort:  r.qb_parent_sort ?? r.qb_sort_order ?? 9999,
          category: ck,
        };
        leafOrder[pk] = [];
      }
      if (!leafRows[lk]) {
        leafRows[lk] = [];
        leafMeta[lk] = {
          label:  r.qb_short_name ?? lk,
          number: r.qb_account_number ?? lk,
          sort:   r.qb_sort_order ?? 9999,
        };
        leafOrder[pk].push(lk);
      }
      leafRows[lk].push(r);
    }

    catOrder.sort((a, b) => catMeta[a].sort - catMeta[b].sort);
    for (const ck of catOrder) {
      catParents[ck].sort((a, b) => parentMeta[a].sort - parentMeta[b].sort);
      for (const pk of catParents[ck]) {
        leafOrder[pk].sort((a, b) => leafMeta[a].sort - leafMeta[b].sort);
      }
    }

    return { catOrder, catMeta, catParents, parentMeta, leafOrder, leafMeta, leafRows };
  }, [filteredRows]);

  // Totals by broad category
  const categoryTotals = useMemo(() => {
    const t: Record<string, Totals> = {};
    for (const r of filteredRows) {
      const ck = r.qb_category ?? 'other';
      if (!t[ck]) t[ck] = zero();
      t[ck] = addRow(t[ck], r);
    }
    return t;
  }, [filteredRows]);

  // Totals by parent account key
  const parentTotals = useMemo(() => {
    const t: Record<string, Totals> = {};
    for (const r of filteredRows) {
      const pk = r.qb_parent_number ?? r.qb_account_number ?? 'unclassified';
      if (!t[pk]) t[pk] = zero();
      t[pk] = addRow(t[pk], r);
    }
    return t;
  }, [filteredRows]);

  // Totals by leaf account key
  const leafTotals = useMemo(() => {
    const t: Record<string, Totals> = {};
    for (const r of filteredRows) {
      const lk = r.qb_account_number ?? 'unclassified';
      if (!t[lk]) t[lk] = zero();
      t[lk] = addRow(t[lk], r);
    }
    return t;
  }, [filteredRows]);

  const grand = useMemo(() => filteredRows.reduce((a, r) => addRow(a, r), zero()), [filteredRows]);

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
      <p className={styles.splashMsg}>No budget lines yet.</p>
      <button className={styles.initBtn} onClick={() => initMutation.mutate()} disabled={initMutation.isPending}>
        {initMutation.isPending ? 'Initializing…' : 'Initialize from budget template'}
      </button>
    </div>
  );

  const dc = showDetails ? '' : styles.detailHidden;

  const SumCells = ({ t, variant }: { t: Totals; variant: 'sec' | 'sg' | 'hdr' }) => {
    const cls = variant === 'sec' ? styles.secSubNum : variant === 'sg' ? styles.sgSubNum : styles.sn;
    const amtDue = t.billed - t.paid;
    return <>
      <td className={cls}>{moneyD(t.budgeted)}</td>
      <td className={`${cls} ${t.rem_budget < 0 ? styles.danger : ''}`}>{moneyD(t.rem_budget)}</td>
      <td className={cls}>{t.budgeted > 0 ? remPct(t.billed, t.budgeted) : '—'}</td>
      <td className={cls}>{money(t.committed)}</td>
      <td className={cls}>{t.co_value > 0 ? money(t.co_value) : '—'}</td>
      <td className={`${cls} ${t.total_commitment > t.budgeted && t.budgeted > 0 ? styles.danger : ''}`}>{money(t.total_commitment)}</td>
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

  return (
    <div className={styles.wrapper}>
      {panelRow    && <LineItemPanel row={panelRow} onClose={() => setPanelRow(null)} />}
      {drillTarget && <DrillPanel phaseId={phaseIdNum} target={drillTarget} onClose={() => setDrillTarget(null)} />}

      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>Budget</span>
        {drillTarget && (
          <span className={styles.drillHint}>
            <strong>{drillTarget.rowName}</strong> · {drillTarget.cell === 'committed' ? 'Commitments' : 'Billed'}
            <button className={styles.drillClearBtn} onClick={() => setDrillTarget(null)}>✕</button>
          </span>
        )}
        <div className={styles.toolActions}>
          <button className={`${styles.tbBtn} ${hideUnused ? styles.tbBtnActive : ''}`}
            onClick={() => setHideUnused(v => !v)}
            title="Hide rows with no contracts or invoices">
            {hideUnused ? `Active Only (${filteredRows.length}/${rows.length})` : 'Active Only'}
          </button>
          <button className={`${styles.tbBtn} ${showDetails ? styles.tbBtnActive : ''}`}
            onClick={() => setShowDetails(v => !v)}>
            {showDetails ? 'Hide Details' : 'Details'}
          </button>
        </div>
      </div>

      <div className={styles.scrollArea} onClick={() => setActive({ rowId: -1, field: '' })}>
        <table className={styles.table} onClick={e => e.stopPropagation()}>
          <colgroup><col style={{width:24}}/><col style={{width:70}}/><col style={{width:230}}/><col style={{width:90}}/><col style={{width:88}}/><col style={{width:50}}/><col style={{width:90}}/><col style={{width:76}}/><col style={{width:90}}/><col style={{width:80}}/><col style={{width:76}}/><col style={{width:76}}/><col style={{width:88}}/><col style={{width:80}}/><col style={{width:76}}/><col style={{width:64}}/><col style={{width:64}}/><col style={{width:130}}/><col style={{width:100}}/><col style={{width:110}}/><col style={{width:150}}/></colgroup>
          <thead>
            <tr className={styles.theadGroup}>
              <th colSpan={4} />
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={2}>Remaining</th>
              <th className={styles.thGroup} colSpan={3}>Contract Commitment</th>
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={4}>Invoiced</th>
              <th className={styles.thGroup} colSpan={2}>Payments</th>
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={2}>Unit Cost</th>
              <th className={`${styles.th} ${dc}`} colSpan={4} />
            </tr>
            <tr className={styles.thead}>
              <th className={styles.th} />
              <th className={`${styles.th} ${styles.thLeft}`}>Acct #</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Task / Description</th>
              <th className={`${styles.th} ${styles.thRight}`}>Budgeted</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. Budget</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. %</th>
              <th className={`${styles.th} ${styles.thRight} ${styles.drillHdr}`}>Contracted ↓</th>
              <th className={`${styles.th} ${styles.thRight}`}>COs</th>
              <th className={`${styles.th} ${styles.thRight}`}>Total Commit</th>
              <th className={`${styles.th} ${styles.thRight}`}>Fixed</th>
              <th className={`${styles.th} ${styles.thRight}`}>T&amp;M</th>
              <th className={`${styles.th} ${styles.thRight}`}>Expense</th>
              <th className={`${styles.th} ${styles.thRight} ${styles.drillHdr}`}>Billed ↓</th>
              <th className={`${styles.th} ${styles.thRight}`}>Amt Due</th>
              <th className={`${styles.th} ${styles.thRight}`}>Paid</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/SF</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/AC</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Calc Method</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Consultant</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>QB Account</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const renderRow = (row: BudgetRow) => {
                const isA = (f: string) => active.rowId === row.id && active.field === f;
                const isDrillActive = drillTarget?.rowId === row.id;
                return (
                  <tr key={row.id} className={`${styles.dataRow} ${row.source === 'user' ? styles.rowUserAdded : ''} ${isDrillActive ? styles.drillActiveRow : ''}`}>
                    <td className={styles.rowGutter} onClick={() => setPanelRow(row)} style={{ cursor: 'pointer' }}>
                      <span className={styles.rowArrow}>›</span>
                    </td>
                    <td className={`${styles.cell} ${styles.tdAcct} ${styles.ro}`} title={row.qb_short_name ?? undefined}>
                      {row.qb_account_number ?? '—'}
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
                    <EditCell value={row.calculation_method} rowId={row.id} field="calculation_method"
                      isActive={isA('calculation_method')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                      onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdCalc} ${dc}`} />
                    <EditCell value={row.consultant} rowId={row.id} field="consultant"
                      isActive={isA('consultant')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                      onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdText} ${dc}`} />
                    <td className={`${styles.cell} ${styles.tdQb} ${styles.ro} ${dc}`}>
                      {row.qb_account_number ?? ''}
                      {row.has_direct_invoices && <span className={styles.directBadge}>Direct</span>}
                    </td>
                    <EditCell value={row.notes} rowId={row.id} field="notes"
                      isActive={isA('notes')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                      onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdNotes} ${dc}`} />
                  </tr>
                );
              };

              return tree.catOrder.flatMap(ck => {
                const catOpen = !collapsed.has(`cat:${ck}`);
                const ct = categoryTotals[ck] ?? zero();
                const catLabel = tree.catMeta[ck]?.label ?? ck;
                const pks = tree.catParents[ck] ?? [];

                return [
                  <tr key={`cat:${ck}`} className={styles.catRow} onClick={() => toggle(`cat:${ck}`)}>
                    <td className={styles.catGutter}><span className={styles.chevron}>{catOpen ? '▼' : '▶'}</span></td>
                    <td className={styles.catLabel} colSpan={2}>{catLabel}</td>
                    <SumCells t={ct} variant="hdr" />
                  </tr>,

                  ...(catOpen ? pks.flatMap(pk => {
                    const grpOpen = !collapsed.has(`grp:${pk}`);
                    const gt = parentTotals[pk] ?? zero();
                    const grpLabel = tree.parentMeta[pk]?.label ?? pk;
                    const lks = tree.leafOrder[pk] ?? [];

                    return [
                      <tr key={`grp:${pk}`} className={styles.secRow} onClick={() => toggle(`grp:${pk}`)}>
                        <td className={styles.secGutter}><span className={styles.chevron}>{grpOpen ? '▼' : '▶'}</span></td>
                        <td className={styles.secLabel} colSpan={2}>{grpLabel}</td>
                        <SumCells t={gt} variant="hdr" />
                      </tr>,

                      ...(grpOpen ? [
                        ...lks.flatMap(lk => {
                          const lr = tree.leafRows[lk] ?? [];
                          const lt = leafTotals[lk] ?? zero();
                          const lm = tree.leafMeta[lk];
                          const multiTask = lr.length > 1;
                          return [
                            ...lr.map(renderRow),
                            ...(multiTask ? [
                              <tr key={`leaf:${lk}:sub`} className={styles.leafSubRow}>
                                <td />
                                <td className={styles.leafSubAcct}>{lm.number}</td>
                                <td className={styles.leafSubLabel}>{lm.label}</td>
                                <SumCells t={lt} variant="sg" />
                              </tr>
                            ] : []),
                          ];
                        }),
                        <tr key={`grp:${pk}:sub`} className={styles.secSubRow}>
                          <td /><td className={styles.secSubLabel} colSpan={2}>Total — {grpLabel}</td>
                          <SumCells t={gt} variant="sec" />
                        </tr>,
                      ] : []),
                    ];
                  }) : []),
                ];
              });
            })()}
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
    </div>
  );
}
