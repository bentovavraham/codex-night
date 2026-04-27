import { useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './BudgetGrid.module.css';
import cgStyles from './CommitmentsGrid.module.css';
import { ContractPanel } from './ContractPanel';

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
  // computed by backend
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
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money  = (n: number) => n === 0 ? '' : usd.format(n);
const moneyD = (n: number) => n === 0 ? '—' : usd.format(n);
const remPct = (spent: number, budget: number): string =>
  budget > 0 ? `${Math.round(((budget - spent) / budget) * 100)}%` : '—';
const perSF = (amount: number, sf: number | null): string =>
  sf && sf > 0 && amount > 0 ? `$${(amount / sf).toFixed(2)}` : '—';
const perAC = (amount: number, ac: number | null): string =>
  ac && ac > 0 && amount > 0 ? `$${Math.round(amount / ac).toLocaleString()}` : '—';

function warnClass(billed: number, budget: number) {
  if (budget <= 0 || billed <= 0) return '';
  const r = billed / budget;
  if (r >= 1.0) return styles.danger;
  if (r >= 0.75) return styles.warn;
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
    <td className={`${styles.cell} ${styles.editableCell} ${className ?? ''} ${!display ? styles.cellEmpty : ''}`} onDoubleClick={open}>
      {display || null}
    </td>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// Columns: Task | Discipline | Amount | Fixed | T&M | Expenses | Billed | Amount Due | Paid | Rem Budget | Rem % | Calc | Consultant | QB | Notes
const TAB_FIELDS = ['task_name', 'discipline', 'budgeted_amount', 'consultant', 'calculation_method', 'notes'];

type Totals = { budgeted: number; fixed: number; tm: number; expenses: number; billed: number; paid: number; rem_budget: number; };
const zero = (): Totals => ({ budgeted: 0, fixed: 0, tm: 0, expenses: 0, billed: 0, paid: 0, rem_budget: 0 });
const addRow = (t: Totals, r: BudgetRow): Totals => ({
  budgeted:    t.budgeted    + r.budgeted_amount,
  fixed:       t.fixed       + r.fixed_charges,
  tm:          t.tm          + r.tm_charges,
  expenses:    t.expenses    + r.expense_charges,
  billed:      t.billed      + r.billed,
  paid:        t.paid        + r.paid,
  rem_budget:  t.rem_budget  + r.remaining_budget,
});

export default function BudgetGrid() {
  const { projectId, phaseId } = useParams<{ projectId: string; phaseId: string }>();
  const phaseIdNum = Number(phaseId);
  const { data: project } = useQuery({
    queryKey: ['project', Number(projectId)],
    queryFn: () => api.getProject(Number(projectId)),
    enabled: !!projectId,
  });
  const gla_sf = (project as any)?.gla_sf ? Number((project as any).gla_sf) : null;
  const gla_ac = (project as any)?.gla_ac ? Number((project as any).gla_ac) : null;
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ rowId: number; field: string }>({ rowId: -1, field: '' });
  const [showDetails, setShowDetails] = useState(false);
  const [contractsOpen, setContractsOpen] = useState<Set<number>>(new Set());
  const [panelContractId, setPanelContractId] = useState<number | null>(null);

  const { data: rows = [], isLoading, error } = useQuery<BudgetRow[]>({
    queryKey: ['budget', phaseIdNum],
    queryFn: () => api.getBudget(phaseIdNum),
    enabled: !!phaseIdNum,
  });

  const { data: contracts = [] } = useQuery<any[]>({
    queryKey: ['phaseContracts', phaseIdNum],
    queryFn: () => api.listContracts(phaseIdNum),
    enabled: !!phaseIdNum,
  });

  const contractsByLine = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const c of contracts) {
      if (!m.has(c.phase_budget_line_id)) m.set(c.phase_budget_line_id, []);
      m.get(c.phase_budget_line_id)!.push(c);
    }
    return m;
  }, [contracts]);

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
  function toggleLine(id: number) {
    setContractsOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

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

  const dc = showDetails ? '' : styles.detailHidden; // detail col visibility

  // Section/sub-group summary cells
  const TotalsCells = ({ t }: { t: Totals }) => {
    const amtDue = t.billed - t.paid;
    return <>
      <td className={styles.sn}>{moneyD(t.budgeted)}</td>
      <td className={styles.sn}>{money(t.fixed)}</td>
      <td className={styles.sn}>{money(t.tm)}</td>
      <td className={styles.sn}>{money(t.expenses)}</td>
      <td className={styles.sn}>{moneyD(t.billed)}</td>
      <td className={`${styles.sn} ${amtDue > 0 ? styles.warn : ''}`}>{money(amtDue)}</td>
      <td className={styles.sn}>{money(t.paid)}</td>
      <td className={`${styles.sn} ${t.rem_budget < 0 ? styles.danger : ''}`}>{moneyD(t.rem_budget)}</td>
      <td className={styles.sn}>{remPct(t.billed, t.budgeted)}</td>
      <td className={styles.sn}>{perSF(t.billed, gla_sf)}</td>
      <td className={styles.sn}>{perAC(t.billed, gla_ac)}</td>
    </>;
  };

  return (
    <div className={styles.wrapper}>
      {panelContractId && (
        <ContractPanel contractId={panelContractId} onClose={() => setPanelContractId(null)} />
      )}
      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>Budget</span>
        <div className={styles.toolActions}>
          <button className={styles.tbBtn}>+ Add Line</button>
          <button className={styles.tbBtn}>Export CSV</button>
          <button
            className={`${styles.tbBtn} ${showDetails ? styles.tbBtnActive : ''}`}
            onClick={() => setShowDetails(v => !v)}
          >
            {showDetails ? 'Hide Details' : 'Details'}
          </button>
        </div>
      </div>

      <div className={styles.scrollArea} onClick={() => setActive({ rowId: -1, field: '' })}>
        <table className={styles.table} onClick={e => e.stopPropagation()}>
          <colgroup>
            <col style={{ width: 24 }} />    {/* gutter */}
            <col style={{ width: 230 }} />   {/* task */}
            <col style={{ width: 110 }} />   {/* discipline */}
            <col style={{ width: 96 }} />    {/* amount */}
            <col style={{ width: 88 }} />    {/* fixed */}
            <col style={{ width: 88 }} />    {/* t&m */}
            <col style={{ width: 88 }} />    {/* expenses */}
            <col style={{ width: 96 }} />    {/* billed to date */}
            <col style={{ width: 88 }} />    {/* amount due */}
            <col style={{ width: 88 }} />    {/* paid to date */}
            <col style={{ width: 96 }} />    {/* remaining budget */}
            <col style={{ width: 52 }} />    {/* rem % */}
            <col style={{ width: 72 }} />    {/* $/SF */}
            <col style={{ width: 72 }} />    {/* $/AC */}
            <col style={{ width: 140 }} />   {/* calc method */}
            <col style={{ width: 110 }} />   {/* consultant */}
            <col style={{ width: 120 }} />   {/* qb codes */}
            <col style={{ width: 160 }} />   {/* notes */}
          </colgroup>
          <thead>
            <tr className={styles.theadGroup}>
              <th className={styles.th} colSpan={3} />
              <th className={styles.th} />
              <th className={`${styles.thGroup} ${styles.thGroupAlt}`} colSpan={4}>Invoices</th>
              <th className={`${styles.thGroup}`} colSpan={4}>Balance</th>
              <th className={styles.th} colSpan={2} />
              <th className={`${styles.th} ${dc}`} />
              <th className={`${styles.th} ${dc}`} />
              <th className={`${styles.th} ${dc}`} />
              <th className={`${styles.th} ${dc}`} />
            </tr>
            <tr className={styles.thead}>
              <th className={styles.th} />
              <th className={`${styles.th} ${styles.thLeft}`}>Task</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Discipline</th>
              <th className={`${styles.th} ${styles.thRight}`}>Amount</th>
              <th className={`${styles.th} ${styles.thRight}`}>Fixed</th>
              <th className={`${styles.th} ${styles.thRight}`}>T&amp;M</th>
              <th className={`${styles.th} ${styles.thRight}`}>Expenses</th>
              <th className={`${styles.th} ${styles.thRight}`}>Billed to Date</th>
              <th className={`${styles.th} ${styles.thRight}`}>Amount Due</th>
              <th className={`${styles.th} ${styles.thRight}`}>Paid to Date</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. Budget</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. %</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/SF</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/AC</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Calc Method</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Consultant</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>QB Codes</th>
              <th className={`${styles.th} ${styles.thLeft} ${dc}`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map(sec => {
              const secOpen = !collapsed.has(`sec:${sec.key}`);
              const st = secTotals[sec.key] ?? zero();
              const subMap = tree.get(sec.key) ?? new Map();

              return [
                <tr key={`sec:${sec.key}`} className={styles.secRow} onClick={() => toggle(`sec:${sec.key}`)}>
                  <td className={styles.secGutter}><span className={styles.chevron}>{secOpen ? '▼' : '▶'}</span></td>
                  <td className={styles.secLabel} colSpan={2}>{sec.label}</td>
                  <TotalsCells t={st} />
                  <td className={`${styles.secCell} ${dc}`} />
                  <td className={`${styles.secCell} ${dc}`} />
                  <td className={`${styles.secCell} ${dc}`} />
                  <td className={`${styles.secCell} ${dc}`} />
                </tr>,

                ...(secOpen ? Array.from(subMap.entries()).flatMap(([sgKey, sgRows]) => {
                  const hasSg  = sgKey !== '__none__';
                  const sgOpen = !collapsed.has(`sg:${sgKey}`);
                  const sgt    = sgTotals[sgKey] ?? zero();

                  return [
                    ...(hasSg ? [
                      <tr key={`sg:${sgKey}`} className={styles.sgRow} onClick={() => toggle(`sg:${sgKey}`)}>
                        <td className={styles.sgGutter}><span className={styles.chevron}>{sgOpen ? '▼' : '▶'}</span></td>
                        <td className={styles.sgLabel} colSpan={2}>{sgKey}</td>
                        <TotalsCells t={sgt} />
                        <td className={`${styles.sgn} ${dc}`} />
                        <td className={`${styles.sgn} ${dc}`} />
                        <td className={`${styles.sgn} ${dc}`} />
                        <td className={`${styles.sgn} ${dc}`} />
                      </tr>
                    ] : []),

                    ...(sgOpen ? sgRows.flatMap((row: BudgetRow) => {
                      const isA = (f: string) => active.rowId === row.id && active.field === f;
                      const lineContracts = contractsByLine.get(row.id) ?? [];
                      const hasContracts  = lineContracts.length > 0;
                      const lineOpen      = contractsOpen.has(row.id);
                      return [
                        <tr key={row.id} className={`${styles.dataRow} ${hasContracts ? cgStyles.lineClickable : ''}`}
                            onClick={hasContracts ? (e) => { if ((e.target as HTMLElement).closest('input,select,button')) return; toggleLine(row.id); } : undefined}>
                          <td className={styles.rowGutter}>
                            {hasContracts && <span className={styles.chevron}>{lineOpen ? '▼' : '▶'}</span>}
                          </td>
                          <EditCell value={row.task_name} rowId={row.id} field="task_name"
                            isActive={isA('task_name')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdTask} />
                          <EditCell value={row.discipline} rowId={row.id} field="discipline"
                            isActive={isA('discipline')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdDisc} />
                          <EditCell value={row.budgeted_amount} rowId={row.id} field="budgeted_amount" numeric
                            isActive={isA('budgeted_amount')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={styles.tdMoney} />
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.fixed_charges)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.tm_charges)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.expense_charges)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${warnClass(row.billed, row.budgeted_amount)}`}>
                            {money(row.billed)}
                          </td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.amount_due > 0 ? styles.warn : ''}`}>
                            {money(row.amount_due)}
                          </td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.paid)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining_budget < 0 ? styles.danger : ''}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.remaining_budget) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro} ${warnClass(row.billed, row.budgeted_amount)}`}>
                            {row.budgeted_amount > 0 ? remPct(row.billed, row.budgeted_amount) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perSF(row.billed, gla_sf)}</td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perAC(row.billed, gla_ac)}</td>
                          <EditCell value={row.calculation_method} rowId={row.id} field="calculation_method"
                            isActive={isA('calculation_method')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdCalc} ${dc}`} />
                          <EditCell value={row.consultant} rowId={row.id} field="consultant"
                            isActive={isA('consultant')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdText} ${dc}`} />
                          <td className={`${styles.cell} ${styles.tdQb} ${styles.ro} ${dc}`} title={row.qb_codes_used || undefined}>
                            {row.qb_codes_used || ''}
                            {row.has_direct_invoices && (
                              <span className={styles.directBadge} title="Has direct invoices (no contract)">Direct</span>
                            )}
                          </td>
                          <EditCell value={row.notes} rowId={row.id} field="notes"
                            isActive={isA('notes')} onActivate={(id,f)=>setActive({rowId:id,field:f})}
                            onCommit={handleCommit} onTabNext={handleTabNext} className={`${styles.tdNotes} ${dc}`} />
                        </tr>,

                        // ── Contract drill-down rows ───────────────────────
                        ...(lineOpen ? lineContracts.map((c: any) => (
                          <tr key={`c:${c.id}`} className={cgStyles.contractRow}
                              style={{ cursor: 'pointer' }}
                              onClick={() => setPanelContractId(c.id)}>
                            <td className={cgStyles.contractGutter} />
                            <td className={`${styles.cell} ${cgStyles.vendorCell}`} colSpan={2}>
                              <span className={`${cgStyles.statusBadge} ${cgStyles[`status_${c.status}`]}`}>
                                {c.status}
                              </span>
                              {' '}{c.vendor_name}
                              {c.reference_number && <span className={cgStyles.refNum}> · {c.reference_number}</span>}
                              <span className={cgStyles.openHint}>→ details</span>
                            </td>
                            <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`} />
                            <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.contractNum}`} colSpan={3}>
                              {c.total_value > 0 ? usd.format(c.total_value) : <span style={{color:'var(--text-4)'}}>T&amp;M</span>}
                              {c.co_value > 0 && <span style={{color:'var(--text-3)',marginLeft:6}}>+{usd.format(c.co_value)} CO</span>}
                            </td>
                            <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.contractNum}`}>
                              {c.total_invoiced > 0 ? usd.format(c.total_invoiced) : '—'}
                            </td>
                            <td colSpan={10} />
                          </tr>
                        )) : []),
                      ];
                    }) : []),
                  ];
                }) : []),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td />
              <td className={styles.totalLabel} colSpan={2}>TOTAL</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{usd.format(grand.budgeted)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.fixed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.tm)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.expenses)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.billed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${(grand.billed - grand.paid) > 0 ? styles.warn : ''}`}>
                {moneyD(grand.billed - grand.paid)}
              </td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.paid)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.rem_budget < 0 ? styles.danger : ''}`}>
                {usd.format(grand.rem_budget)}
              </td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{remPct(grand.billed, grand.budgeted)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perSF(grand.billed, gla_sf)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perAC(grand.billed, gla_ac)}</td>
              <td className={`${styles.totalCell} ${dc}`} />
              <td className={`${styles.totalCell} ${dc}`} />
              <td className={`${styles.totalCell} ${dc}`} />
              <td className={`${styles.totalCell} ${dc}`} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
