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
  calc_hint: string | null;
  budgeted_amount: number;
  consultant: string | null;
  notes: string | null;
  qb_account_id: number | null;
  qb_account_number: string | null;
  sort_order: number;
  // computed
  amount_due: number;
  invoiced: number;
  paid: number;
  remaining: number;
  pct_used: number | null;
}

interface QbAccount { id: number; account_number: string; full_name: string; short_name: string | null; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt = (n: number) => n === 0 ? '' : usd.format(n);
const fmtOrDash = (n: number) => n === 0 ? '—' : usd.format(n);

function pctClass(pct: number | null) {
  if (pct === null || pct === 0) return '';
  if (pct >= 1.0) return styles.danger;
  if (pct >= 0.75) return styles.warn;
  return '';
}

const SECTIONS = [
  { key: 'professional_fees', label: 'Professional Fees' },
  { key: 'application_fees',  label: 'Application & Other Fees' },
  { key: 'construction',      label: 'Estimated Extraordinary Construction Costs' },
] as const;

// ─── Editable cell ────────────────────────────────────────────────────────────

interface EditCellProps {
  value: string | number | null;
  placeholder?: string;
  rowId: number;
  field: string;
  numeric?: boolean;
  isActive: boolean;
  onActivate: (rowId: number, field: string) => void;
  onCommit: (rowId: number, field: string, val: string) => void;
  onTabNext: (rowId: number, field: string) => void;
  className?: string;
}

function EditCell({ value, placeholder, rowId, field, numeric, isActive, onActivate, onCommit, onTabNext, className }: EditCellProps) {
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
        <input
          ref={ref}
          className={styles.editInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          autoFocus
        />
      </td>
    );
  }

  return (
    <td
      className={`${styles.cell} ${className ?? ''} ${!display ? styles.cellEmpty : ''}`}
      title={placeholder && !display ? placeholder : undefined}
      onDoubleClick={open}
    >
      {display || (placeholder ? <span className={styles.hint}>{placeholder}</span> : null)}
    </td>
  );
}

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

  const { data: qbAccounts = [] } = useQuery<QbAccount[]>({
    queryKey: ['qb-accounts'],
    queryFn: () => api.listQbAccounts(),
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
    if (fi < TAB_FIELDS.length - 1) {
      setActive({ rowId, field: TAB_FIELDS[fi + 1] });
    } else {
      const ri = rows.findIndex(r => r.id === rowId);
      if (ri < rows.length - 1) setActive({ rowId: rows[ri + 1].id, field: TAB_FIELDS[0] });
    }
  }, [rows]);

  function toggle(key: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  // Build section → sub_group → rows hierarchy
  const tree = useMemo(() => {
    type SubMap = Map<string, BudgetRow[]>;
    const sections = new Map<string, SubMap>();
    for (const s of SECTIONS) sections.set(s.key, new Map());

    for (const r of rows) {
      const secMap = sections.get(r.section);
      if (!secMap) continue;
      const sg = r.sub_group ?? '__none__';
      if (!secMap.has(sg)) secMap.set(sg, []);
      secMap.get(sg)!.push(r);
    }
    return sections;
  }, [rows]);

  // Totals by section
  const secTotals = useMemo(() => {
    const t: Record<string, { budgeted: number; amount_due: number; invoiced: number; paid: number; remaining: number }> = {};
    for (const r of rows) {
      if (!t[r.section]) t[r.section] = { budgeted: 0, amount_due: 0, invoiced: 0, paid: 0, remaining: 0 };
      t[r.section].budgeted    += r.budgeted_amount;
      t[r.section].amount_due  += r.amount_due;
      t[r.section].invoiced    += r.invoiced;
      t[r.section].paid        += r.paid;
      t[r.section].remaining   += r.remaining;
    }
    return t;
  }, [rows]);

  // Totals by sub_group
  const sgTotals = useMemo(() => {
    const t: Record<string, { budgeted: number; amount_due: number; invoiced: number; paid: number; remaining: number }> = {};
    for (const r of rows) {
      const key = r.sub_group ?? `${r.section}:__none__`;
      if (!t[key]) t[key] = { budgeted: 0, amount_due: 0, invoiced: 0, paid: 0, remaining: 0 };
      t[key].budgeted   += r.budgeted_amount;
      t[key].amount_due += r.amount_due;
      t[key].invoiced   += r.invoiced;
      t[key].paid       += r.paid;
      t[key].remaining  += r.remaining;
    }
    return t;
  }, [rows]);

  const grand = useMemo(() => rows.reduce(
    (a, r) => ({ budgeted: a.budgeted + r.budgeted_amount, amount_due: a.amount_due + r.amount_due, invoiced: a.invoiced + r.invoiced, paid: a.paid + r.paid, remaining: a.remaining + r.remaining }),
    { budgeted: 0, amount_due: 0, invoiced: 0, paid: 0, remaining: 0 }
  ), [rows]);

  if (isLoading) return <div className={styles.splash}>Loading budget…</div>;
  if (error)     return <div className={styles.splash}>Error loading budget.</div>;

  if (!rows.length) {
    return (
      <div className={styles.splash}>
        <p className={styles.splashMsg}>No budget lines yet.</p>
        <button className={styles.initBtn} onClick={() => initMutation.mutate()} disabled={initMutation.isPending}>
          {initMutation.isPending ? 'Initializing…' : 'Initialize from budget template'}
        </button>
        {initMutation.isError && <p className={styles.splashErr}>Failed — check console.</p>}
      </div>
    );
  }

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
            <col style={{ width: 28 }} />   {/* sub-group gutter */}
            <col style={{ width: 240 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 102 }} />
            <col style={{ width: 102 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 102 }} />
            <col style={{ width: 102 }} />
            <col style={{ width: 102 }} />
            <col style={{ width: 54 }} />
            <col style={{ width: 148 }} />
            <col style={{ width: 180 }} />
          </colgroup>
          <thead>
            <tr className={styles.thead}>
              <th className={styles.th} />
              <th className={`${styles.th} ${styles.thLeft}`}>Task</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Discipline</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Calc Method / Notes</th>
              <th className={`${styles.th} ${styles.thRight}`}>Amount</th>
              <th className={`${styles.th} ${styles.thRight}`}>Amount Due</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Consultant</th>
              <th className={`${styles.th} ${styles.thRight}`}>Paid to Date</th>
              <th className={`${styles.th} ${styles.thRight}`}>Billed to Date</th>
              <th className={`${styles.th} ${styles.thRight}`}>Remaining</th>
              <th className={`${styles.th} ${styles.thRight}`}>%</th>
              <th className={`${styles.th} ${styles.thLeft}`}>QB Code</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(sec => {
              const secOpen  = !collapsed.has(`sec:${sec.key}`);
              const sTotals  = secTotals[sec.key] ?? { budgeted: 0, amount_due: 0, invoiced: 0, paid: 0, remaining: 0 };
              const sPct     = sTotals.budgeted > 0 ? sTotals.invoiced / sTotals.budgeted : null;
              const subMap   = tree.get(sec.key) ?? new Map();

              return [
                // ── Section header ──────────────────────────────────────────
                <tr key={`sec:${sec.key}`} className={styles.secRow} onClick={() => toggle(`sec:${sec.key}`)}>
                  <td className={styles.secGutter}><span className={styles.chevron}>{secOpen ? '▼' : '▶'}</span></td>
                  <td className={styles.secLabel} colSpan={3}>{sec.label}</td>
                  <td className={`${styles.secNum}`}>{fmtOrDash(sTotals.budgeted)}</td>
                  <td className={`${styles.secNum}`}>{fmtOrDash(sTotals.amount_due)}</td>
                  <td className={styles.secCell} />
                  <td className={`${styles.secNum}`}>{fmtOrDash(sTotals.paid)}</td>
                  <td className={`${styles.secNum}`}>{fmtOrDash(sTotals.invoiced)}</td>
                  <td className={`${styles.secNum} ${sTotals.remaining < 0 ? styles.danger : ''}`}>{fmtOrDash(sTotals.remaining)}</td>
                  <td className={`${styles.secNum} ${pctClass(sPct)}`}>{sPct != null && sPct > 0 ? `${Math.round(sPct * 100)}%` : '—'}</td>
                  <td className={styles.secCell} colSpan={2} />
                </tr>,

                ...(secOpen ? Array.from(subMap.entries()).flatMap(([sgKey, sgRows]) => {
                  const hasSubGroup = sgKey !== '__none__';
                  const sgOpen = !collapsed.has(`sg:${sgKey}`);
                  const sgt = sgTotals[sgKey] ?? { budgeted: 0, amount_due: 0, invoiced: 0, paid: 0, remaining: 0 };

                  return [
                    // ── Sub-group header ──────────────────────────────────
                    ...(hasSubGroup ? [
                      <tr key={`sg:${sgKey}`} className={styles.sgRow} onClick={() => toggle(`sg:${sgKey}`)}>
                        <td className={styles.sgGutter}><span className={styles.chevron}>{sgOpen ? '▼' : '▶'}</span></td>
                        <td className={styles.sgLabel} colSpan={3}>{sgKey}</td>
                        <td className={`${styles.sgNum}`}>{fmt(sgt.budgeted)}</td>
                        <td className={`${styles.sgNum}`}>{fmt(sgt.amount_due)}</td>
                        <td className={styles.sgCell} />
                        <td className={`${styles.sgNum}`}>{fmt(sgt.paid)}</td>
                        <td className={`${styles.sgNum}`}>{fmt(sgt.invoiced)}</td>
                        <td className={`${styles.sgNum} ${sgt.remaining < 0 ? styles.danger : ''}`}>{fmt(sgt.remaining)}</td>
                        <td className={styles.sgCell} colSpan={3} />
                      </tr>
                    ] : []),

                    // ── Data rows ─────────────────────────────────────────
                    ...(sgOpen ? sgRows.map(row => {
                      const isA = (f: string) => active.rowId === row.id && active.field === f;
                      return (
                        <tr key={row.id} className={styles.dataRow}>
                          <td className={styles.rowGutter} />
                          <EditCell value={row.task_name} rowId={row.id} field="task_name"
                            isActive={isA('task_name')} onActivate={(id,f) => setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext}
                            className={styles.tdTask} />
                          <EditCell value={row.discipline} rowId={row.id} field="discipline"
                            isActive={isA('discipline')} onActivate={(id,f) => setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext}
                            className={styles.tdDisc} />
                          <EditCell value={row.calculation_method} placeholder={row.calc_hint ?? ''} rowId={row.id} field="calculation_method"
                            isActive={isA('calculation_method')} onActivate={(id,f) => setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext}
                            className={styles.tdCalc} />
                          <EditCell value={row.budgeted_amount} rowId={row.id} field="budgeted_amount" numeric
                            isActive={isA('budgeted_amount')} onActivate={(id,f) => setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext}
                            className={styles.tdMoney} />
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{fmtOrDash(row.amount_due)}</td>
                          <EditCell value={row.consultant} rowId={row.id} field="consultant"
                            isActive={isA('consultant')} onActivate={(id,f) => setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} />
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{fmtOrDash(row.paid)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{fmtOrDash(row.invoiced)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining < 0 ? styles.danger : ''}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.remaining) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro} ${pctClass(row.pct_used)}`}>
                            {row.pct_used != null && row.pct_used > 0 ? `${Math.round(row.pct_used * 100)}%` : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdQb}`}>
                            <select
                              className={styles.qbSelect}
                              value={row.qb_account_id ?? ''}
                              onChange={e => {
                                const val = e.target.value;
                                updateMutation.mutate({ id: row.id, data: { qb_account_id: val ? Number(val) : null } });
                              }}
                            >
                              <option value="">—</option>
                              {qbAccounts.map((a: QbAccount) => (
                                <option key={a.id} value={a.id}>
                                  {a.account_number} {a.short_name ?? a.full_name.split(':').pop()}
                                </option>
                              ))}
                            </select>
                          </td>
                          <EditCell value={row.notes} rowId={row.id} field="notes"
                            isActive={isA('notes')} onActivate={(id,f) => setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext}
                            className={styles.tdNotes} />
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
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{fmtOrDash(grand.amount_due)}</td>
              <td className={styles.totalCell} />
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{fmtOrDash(grand.paid)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{fmtOrDash(grand.invoiced)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.remaining < 0 ? styles.danger : ''}`}>{usd.format(grand.remaining)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>
                {grand.budgeted > 0 ? `${Math.round((grand.invoiced / grand.budgeted) * 100)}%` : '—'}
              </td>
              <td className={styles.totalCell} colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
