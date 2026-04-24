import { useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './BudgetGrid.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BudgetRow {
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
  // computed
  committed: number;
  co_count: number;
  co_value: number;
  total_commitment: number;
  tm_charges: number;
  expense_charges: number;
  billed: number;
  paid: number;
  remaining_budget: number;
  remaining_commit: number;
  pct_billed: number | null;
  qb_codes_used: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n: number) => n === 0 ? '' : usd.format(n);
const moneyD = (n: number) => n === 0 ? '—' : usd.format(n);

function statusClass(val: number, budget: number) {
  if (budget <= 0 || val <= 0) return '';
  const r = val / budget;
  if (r >= 1.0) return styles.danger;
  if (r >= 0.75) return styles.warn;
  return '';
}

const remPct = (spent: number, budget: number): string =>
  budget > 0 ? `${Math.round(((budget - spent) / budget) * 100)}%` : '—';

const SECTIONS = [
  { key: 'professional_fees', label: 'Professional Fees' },
  { key: 'application_fees',  label: 'Application & Other Fees' },
  { key: 'construction',      label: 'Estimated Extraordinary Construction Costs' },
] as const;

// ─── Editable cell ────────────────────────────────────────────────────────────

interface EditCellProps {
  value: string | number | null;
  rowId: number;
  field: string;
  numeric?: boolean;
  isActive: boolean;
  onActivate: (rowId: number, field: string) => void;
  onCommit: (rowId: number, field: string, val: string) => void;
  onTabNext: (rowId: number, field: string) => void;
  className?: string;
}

function EditCell({ value, rowId, field, numeric, isActive, onActivate, onCommit, onTabNext, className }: EditCellProps) {
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const display = numeric
    ? (value != null && Number(value) !== 0 ? usd.format(Number(value)) : '')
    : (value ?? '');

  function open() {
    setDraft(String(value ?? ''));
    onActivate(rowId, field);
    setTimeout(() => ref.current?.select(), 0);
  }

  function commit() { onCommit(rowId, field, draft); }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); commit(); onTabNext(rowId, field); }
    if (e.key === 'Escape') onActivate(-1, '');
  }

  if (isActive) {
    return (
      <td className={`${styles.cell} ${styles.editing} ${className ?? ''}`}>
        <input ref={ref} className={styles.editInput} value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} autoFocus />
      </td>
    );
  }

  return (
    <td className={`${styles.cell} ${className ?? ''} ${!display ? styles.cellEmpty : ''}`} onDoubleClick={open}>
      {display || null}
    </td>
  );
}

// ─── Column header with group spanning ────────────────────────────────────────

// ─── Main component ───────────────────────────────────────────────────────────

const TAB_FIELDS = ['task_name', 'discipline', 'calculation_method', 'budgeted_amount', 'consultant', 'notes'];

export default function BudgetGrid() {
  const { phaseId } = useParams<{ phaseId: string }>();
  const phaseIdNum = Number(phaseId);
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ rowId: number; field: string }>({ rowId: -1, field: '' });

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
      qc.setQueryData<BudgetRow[]>(['budget', phaseIdNum], old =>
        old?.map(r => r.id === id ? { ...r, ...data } : r) ?? []
      );
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

  const handleTabNext = useCallback((rowId: number, field: string) => {
    const fi = TAB_FIELDS.indexOf(field);
    if (fi < TAB_FIELDS.length - 1) { setActive({ rowId, field: TAB_FIELDS[fi + 1] }); return; }
    const ri = rows.findIndex(r => r.id === rowId);
    if (ri < rows.length - 1) setActive({ rowId: rows[ri + 1].id, field: TAB_FIELDS[0] });
  }, [rows]);

  function toggle(key: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // Build tree: section → sub_group → rows
  const tree = useMemo(() => {
    const m = new Map<string, Map<string, BudgetRow[]>>();
    for (const s of SECTIONS) m.set(s.key, new Map());
    for (const r of rows) {
      const sm = m.get(r.section); if (!sm) continue;
      const sg = r.sub_group ?? '__none__';
      if (!sm.has(sg)) sm.set(sg, []);
      sm.get(sg)!.push(r);
    }
    return m;
  }, [rows]);

  type Totals = { budgeted: number; committed: number; co_value: number; total_commitment: number; tm: number; expenses: number; billed: number; paid: number; rem_budget: number; rem_commit: number };
  const zero = (): Totals => ({ budgeted: 0, committed: 0, co_value: 0, total_commitment: 0, tm: 0, expenses: 0, billed: 0, paid: 0, rem_budget: 0, rem_commit: 0 });
  const addRow = (t: Totals, r: BudgetRow): Totals => ({
    budgeted:          t.budgeted          + r.budgeted_amount,
    committed:         t.committed         + r.committed,
    co_value:          t.co_value          + r.co_value,
    total_commitment:  t.total_commitment  + r.total_commitment,
    tm:                t.tm                + r.tm_charges,
    expenses:          t.expenses          + r.expense_charges,
    billed:            t.billed            + r.billed,
    paid:              t.paid              + r.paid,
    rem_budget:        t.rem_budget        + r.remaining_budget,
    rem_commit:        t.rem_commit        + r.remaining_commit,
  });

  const secTotals = useMemo(() => {
    const t: Record<string, Totals> = {};
    for (const r of rows) { if (!t[r.section]) t[r.section] = zero(); t[r.section] = addRow(t[r.section], r); }
    return t;
  }, [rows]);

  const sgTotals = useMemo(() => {
    const t: Record<string, Totals> = {};
    for (const r of rows) {
      const k = r.sub_group ?? `${r.section}:none`;
      if (!t[k]) t[k] = zero(); t[k] = addRow(t[k], r);
    }
    return t;
  }, [rows]);

  const grand = useMemo(() => rows.reduce((a, r) => addRow(a, r), zero()), [rows]);

  if (isLoading) return <div className={styles.splash}>Loading budget…</div>;
  if (error)     return <div className={styles.splash}>Error loading budget.</div>;

  if (!rows.length) {
    return (
      <div className={styles.splash}>
        <p className={styles.splashMsg}>No budget lines yet.</p>
        <button className={styles.initBtn} onClick={() => initMutation.mutate()} disabled={initMutation.isPending}>
          {initMutation.isPending ? 'Initializing…' : 'Initialize from budget template'}
        </button>
      </div>
    );
  }

  const TotalsCells = ({ t, budget }: { t: Totals; budget: number }) => <>
    <td className={`${styles.sn}`}>{moneyD(t.budgeted)}</td>
    <td className={`${styles.sn}`}>{moneyD(t.committed)}</td>
    <td className={`${styles.sn}`}>{t.co_value > 0 ? moneyD(t.co_value) : '—'}</td>
    <td className={`${styles.sn} ${t.total_commitment > t.budgeted && t.budgeted > 0 ? styles.danger : ''}`}>{moneyD(t.total_commitment)}</td>
    <td className={`${styles.sn}`}>{moneyD(t.tm)}</td>
    <td className={`${styles.sn}`}>{moneyD(t.expenses)}</td>
    <td className={`${styles.sn}`}>{moneyD(t.billed)}</td>
    <td className={`${styles.sn}`}>{moneyD(t.paid)}</td>
    <td className={`${styles.sn} ${t.rem_budget < 0 ? styles.danger : ''}`}>{moneyD(t.rem_budget)}</td>
    <td className={`${styles.sn} ${t.rem_commit < 0 ? styles.danger : ''}`}>{moneyD(t.rem_commit)}</td>
    <td className={`${styles.sn} ${statusClass(t.billed, budget)}`}>
      {budget > 0 && t.billed > 0 ? `${Math.round((t.billed / budget) * 100)}%` : '—'}
    </td>
    {/* Invoice Burn */}
    <td className={`${styles.sn}`}>{moneyD(t.billed)}</td>
    <td className={`${styles.sn}`}>{moneyD(t.paid)}</td>
    <td className={`${styles.sn} ${t.rem_budget < 0 ? styles.danger : ''}`}>{moneyD(t.rem_budget)}</td>
    <td className={`${styles.sn}`}>{remPct(t.billed, t.budgeted)}</td>
    {/* Contract Burn */}
    <td className={`${styles.sn}`}>{moneyD(t.committed)}</td>
    <td className={`${styles.sn}`}>{t.co_value > 0 ? moneyD(t.co_value) : '—'}</td>
    <td className={`${styles.sn} ${t.total_commitment > t.budgeted && t.budgeted > 0 ? styles.danger : ''}`}>{moneyD(t.total_commitment)}</td>
    <td className={`${styles.sn} ${t.rem_commit < 0 ? styles.danger : ''}`}>{moneyD(t.rem_commit)}</td>
    <td className={`${styles.sn}`}>{remPct(t.total_commitment, t.budgeted)}</td>
  </>;

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>Budget</span>
        <div className={styles.toolActions}>
          <button className={styles.tbBtn}>+ Add Line</button>
          <button className={styles.tbBtn}>Export CSV</button>
        </div>
      </div>

      <div className={styles.scrollArea} onClick={() => setActive({ rowId: -1, field: '' })}>
        <table className={styles.table} onClick={e => e.stopPropagation()}>
          <colgroup>
            <col style={{ width: 24 }} />    {/* indent gutter */}
            <col style={{ width: 230 }} />   {/* task */}
            <col style={{ width: 110 }} />   {/* discipline */}
            <col style={{ width: 140 }} />   {/* calc method */}
            <col style={{ width: 96 }} />    {/* amount */}
            <col style={{ width: 96 }} />    {/* committed */}
            <col style={{ width: 88 }} />    {/* co value */}
            <col style={{ width: 96 }} />    {/* total commitment */}
            <col style={{ width: 88 }} />    {/* T&M */}
            <col style={{ width: 88 }} />    {/* expenses */}
            <col style={{ width: 96 }} />    {/* billed */}
            <col style={{ width: 88 }} />    {/* paid */}
            <col style={{ width: 96 }} />    {/* rem budget */}
            <col style={{ width: 96 }} />    {/* rem commit */}
            <col style={{ width: 52 }} />    {/* % */}
            <col style={{ width: 110 }} />   {/* consultant */}
            <col style={{ width: 120 }} />   {/* QB codes */}
            <col style={{ width: 160 }} />   {/* notes */}
            {/* ── Invoice Burn ── */}
            <col style={{ width: 96 }} />    {/* inv invoiced */}
            <col style={{ width: 88 }} />    {/* inv paid */}
            <col style={{ width: 96 }} />    {/* inv rem $ */}
            <col style={{ width: 52 }} />    {/* inv rem % */}
            {/* ── Contract Burn ── */}
            <col style={{ width: 96 }} />    {/* con init contract */}
            <col style={{ width: 88 }} />    {/* con cos */}
            <col style={{ width: 96 }} />    {/* con total commit */}
            <col style={{ width: 96 }} />    {/* con rem $ */}
            <col style={{ width: 52 }} />    {/* con rem % */}
          </colgroup>
          <thead>
            {/* Group header row */}
            <tr className={styles.theadGroup}>
              <th className={styles.th} colSpan={4} />
              <th className={`${styles.thGroup}`} colSpan={3}>Contract</th>
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={3}>Invoices by Type</th>
              <th className={`${styles.thGroup}`} colSpan={4}>Totals</th>
              <th className={styles.th} colSpan={4} />
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={4}>Invoice Burn</th>
              <th className={`${styles.thGroup}`} colSpan={5}>Contract Burn</th>
            </tr>
            {/* Column header row */}
            <tr className={styles.thead}>
              <th className={styles.th} />
              <th className={`${styles.th} ${styles.thLeft}`}>Task</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Discipline</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Calc Method</th>
              <th className={`${styles.th} ${styles.thRight}`}>Amount</th>
              <th className={`${styles.th} ${styles.thRight}`}>Committed</th>
              <th className={`${styles.th} ${styles.thRight}`}>CO Value</th>
              <th className={`${styles.th} ${styles.thRight}`}>Total Commit</th>
              <th className={`${styles.th} ${styles.thRight}`}>T&amp;M</th>
              <th className={`${styles.th} ${styles.thRight}`}>Expenses</th>
              <th className={`${styles.th} ${styles.thRight}`}>Billed</th>
              <th className={`${styles.th} ${styles.thRight}`}>Paid</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. Budget</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. Commit</th>
              <th className={`${styles.th} ${styles.thRight}`}>%</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Consultant</th>
              <th className={`${styles.th} ${styles.thLeft}`}>QB Codes</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Notes</th>
              <th className={`${styles.th} ${styles.thRight}`}>Invoiced</th>
              <th className={`${styles.th} ${styles.thRight}`}>Paid to Date</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. $</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. %</th>
              <th className={`${styles.th} ${styles.thRight}`}>Init. Contract</th>
              <th className={`${styles.th} ${styles.thRight}`}>COs</th>
              <th className={`${styles.th} ${styles.thRight}`}>Total Commit</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. $</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. %</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(sec => {
              const secOpen = !collapsed.has(`sec:${sec.key}`);
              const st = secTotals[sec.key] ?? zero();
              const subMap = tree.get(sec.key) ?? new Map();

              return [
                // Section header
                <tr key={`sec:${sec.key}`} className={styles.secRow} onClick={() => toggle(`sec:${sec.key}`)}>
                  <td className={styles.secGutter}><span className={styles.chevron}>{secOpen ? '▼' : '▶'}</span></td>
                  <td className={styles.secLabel} colSpan={3}>{sec.label}</td>
                  <TotalsCells t={st} budget={st.budgeted} />
                  <td className={styles.secCell} colSpan={3} />  {/* consultant, QB, notes */}
                </tr>,

                ...(secOpen ? Array.from(subMap.entries()).flatMap(([sgKey, sgRows]) => {
                  const hasSg   = sgKey !== '__none__';
                  const sgOpen  = !collapsed.has(`sg:${sgKey}`);
                  const sgt     = sgTotals[sgKey] ?? zero();

                  return [
                    ...(hasSg ? [
                      <tr key={`sg:${sgKey}`} className={styles.sgRow} onClick={() => toggle(`sg:${sgKey}`)}>
                        <td className={styles.sgGutter}><span className={styles.chevron}>{sgOpen ? '▼' : '▶'}</span></td>
                        <td className={styles.sgLabel} colSpan={3}>{sgKey}</td>
                        <td className={styles.sgn}>{money(sgt.budgeted)}</td>
                        <td className={styles.sgn}>{money(sgt.committed)}</td>
                        <td className={styles.sgn}>{money(sgt.co_value)}</td>
                        <td className={styles.sgn}>{money(sgt.total_commitment)}</td>
                        <td className={styles.sgn}>{money(sgt.tm)}</td>
                        <td className={styles.sgn}>{money(sgt.expenses)}</td>
                        <td className={styles.sgn}>{money(sgt.billed)}</td>
                        <td className={styles.sgn}>{money(sgt.paid)}</td>
                        <td className={`${styles.sgn} ${sgt.rem_budget < 0 ? styles.danger : ''}`}>{money(sgt.rem_budget)}</td>
                        <td className={`${styles.sgn} ${sgt.rem_commit < 0 ? styles.danger : ''}`}>{money(sgt.rem_commit)}</td>
                        <td className={styles.sgn} colSpan={4} />  {/* %, consultant, QB, notes */}
                        {/* Invoice Burn */}
                        <td className={styles.sgn}>{money(sgt.billed)}</td>
                        <td className={styles.sgn}>{money(sgt.paid)}</td>
                        <td className={`${styles.sgn} ${sgt.rem_budget < 0 ? styles.danger : ''}`}>{money(sgt.rem_budget)}</td>
                        <td className={styles.sgn}>{remPct(sgt.billed, sgt.budgeted)}</td>
                        {/* Contract Burn */}
                        <td className={styles.sgn}>{money(sgt.committed)}</td>
                        <td className={styles.sgn}>{money(sgt.co_value)}</td>
                        <td className={styles.sgn}>{money(sgt.total_commitment)}</td>
                        <td className={`${styles.sgn} ${sgt.rem_commit < 0 ? styles.danger : ''}`}>{money(sgt.rem_commit)}</td>
                        <td className={styles.sgn}>{remPct(sgt.total_commitment, sgt.budgeted)}</td>
                      </tr>
                    ] : []),

                    ...(sgOpen ? sgRows.map((row: BudgetRow) => {
                      const isA = (f: string) => active.rowId === row.id && active.field === f;
                      return (
                        <tr key={row.id} className={styles.dataRow}>
                          <td className={styles.rowGutter} />
                          <EditCell value={row.task_name} rowId={row.id} field="task_name"
                            isActive={isA('task_name')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdTask} />
                          <EditCell value={row.discipline} rowId={row.id} field="discipline"
                            isActive={isA('discipline')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdDisc} />
                          <EditCell value={row.calculation_method} rowId={row.id} field="calculation_method"
                            isActive={isA('calculation_method')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdCalc} />
                          {/* Amount — editable */}
                          <EditCell value={row.budgeted_amount} rowId={row.id} field="budgeted_amount" numeric
                            isActive={isA('budgeted_amount')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdMoney} />
                          {/* Committed */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.committed)}</td>
                          {/* CO Value */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>
                            {row.co_count > 0 ? <span title={`${row.co_count} CO${row.co_count > 1 ? 's' : ''}`}>{money(row.co_value)}</span> : ''}
                          </td>
                          {/* Total Commitment */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.total_commitment > row.budgeted_amount && row.budgeted_amount > 0 ? styles.warn : ''}`}>
                            {money(row.total_commitment)}
                          </td>
                          {/* T&M */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.tm_charges)}</td>
                          {/* Expenses */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.expense_charges)}</td>
                          {/* Billed */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.billed)}</td>
                          {/* Paid */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.paid)}</td>
                          {/* Remaining budget */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining_budget < 0 ? styles.danger : ''}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.remaining_budget) : '—'}
                          </td>
                          {/* Remaining to commit */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining_commit < 0 ? styles.danger : ''}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.remaining_commit) : '—'}
                          </td>
                          {/* % */}
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro} ${statusClass(row.billed, row.budgeted_amount)}`}>
                            {row.pct_billed != null && row.pct_billed > 0 ? `${Math.round(row.pct_billed * 100)}%` : '—'}
                          </td>
                          {/* Consultant */}
                          <EditCell value={row.consultant} rowId={row.id} field="consultant"
                            isActive={isA('consultant')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdText} />
                          {/* QB codes (read-only, rolled up from invoices) */}
                          <td className={`${styles.cell} ${styles.tdQb} ${styles.ro}`} title={row.qb_codes_used || undefined}>
                            {row.qb_codes_used || ''}
                          </td>
                          {/* Notes */}
                          <EditCell value={row.notes} rowId={row.id} field="notes"
                            isActive={isA('notes')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdNotes} />
                          {/* Invoice Burn */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.billed)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.paid)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining_budget < 0 ? styles.danger : ''}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.remaining_budget) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro} ${statusClass(row.billed, row.budgeted_amount)}`}>
                            {row.budgeted_amount > 0 ? remPct(row.billed, row.budgeted_amount) : '—'}
                          </td>
                          {/* Contract Burn */}
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.committed)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>
                            {row.co_count > 0 ? money(row.co_value) : ''}
                          </td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.total_commitment > row.budgeted_amount && row.budgeted_amount > 0 ? styles.warn : ''}`}>
                            {money(row.total_commitment)}
                          </td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining_commit < 0 ? styles.danger : ''}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.remaining_commit) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro} ${statusClass(row.total_commitment, row.budgeted_amount)}`}>
                            {row.budgeted_amount > 0 ? remPct(row.total_commitment, row.budgeted_amount) : '—'}
                          </td>
                        </tr>
                      );
                    }) : []),
                  ];
                }) : []),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td />
              <td className={styles.totalLabel} colSpan={3}>TOTAL</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{usd.format(grand.budgeted)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.committed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.co_value)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.total_commitment)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.tm)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.expenses)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.billed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.paid)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.rem_budget < 0 ? styles.danger : ''}`}>{usd.format(grand.rem_budget)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.rem_commit < 0 ? styles.danger : ''}`}>{usd.format(grand.rem_commit)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>
                {grand.budgeted > 0 ? `${Math.round((grand.billed / grand.budgeted) * 100)}%` : '—'}
              </td>
              <td className={styles.totalCell} colSpan={3} />
              {/* Invoice Burn totals */}
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.billed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.paid)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.rem_budget < 0 ? styles.danger : ''}`}>{usd.format(grand.rem_budget)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{remPct(grand.billed, grand.budgeted)}</td>
              {/* Contract Burn totals */}
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.committed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.co_value)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.total_commitment > grand.budgeted ? styles.danger : ''}`}>{moneyD(grand.total_commitment)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.rem_commit < 0 ? styles.danger : ''}`}>{usd.format(grand.rem_commit)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{remPct(grand.total_commitment, grand.budgeted)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
