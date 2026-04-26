import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { BudgetRow } from './BudgetGrid';
import styles from './BudgetGrid.module.css';
import cgStyles from './CommitmentsGrid.module.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money  = (n: number) => n === 0 ? '' : usd.format(n);
const moneyD = (n: number) => n === 0 ? '—' : usd.format(n);
const remPct = (committed: number, budget: number): string =>
  budget > 0 ? `${Math.round(((budget - committed) / budget) * 100)}%` : '—';
const perSF = (amount: number, sf: number | null): string =>
  sf && sf > 0 && amount > 0 ? `$${(amount / sf).toFixed(2)}` : '—';
const perAC = (amount: number, ac: number | null): string =>
  ac && ac > 0 && amount > 0 ? `$${Math.round(amount / ac).toLocaleString()}` : '—';

const SECTIONS = [
  { key: 'professional_fees', label: 'Professional Fees' },
  { key: 'application_fees',  label: 'Application & Other Fees' },
  { key: 'construction',      label: 'Estimated Extraordinary Construction Costs' },
] as const;

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', approved: 'Approved',
  rejected: 'Rejected', voided: 'Voided', active: 'Active',
};

// ─── Types ────────────────────────────────────────────────────────────────────

type Totals = { budgeted: number; committed: number; co_value: number; total_commitment: number; remaining_commit: number; };
const zero = (): Totals => ({ budgeted: 0, committed: 0, co_value: 0, total_commitment: 0, remaining_commit: 0 });
const addRow = (t: Totals, r: BudgetRow): Totals => ({
  budgeted:          t.budgeted          + r.budgeted_amount,
  committed:         t.committed         + r.committed,
  co_value:          t.co_value          + r.co_value,
  total_commitment:  t.total_commitment  + r.total_commitment,
  remaining_commit:  t.remaining_commit  + r.remaining_commit,
});

interface PhaseContract {
  id: number;
  phase_budget_line_id: number;
  vendor_name: string;
  reference_number: string | null;
  total_value: number;
  status: string;
  contract_date: string | null;
  co_count: number;
  co_value: number;
  total_commitment: number;
  invoiced_fixed: number;
  invoiced_tm: number;
  invoiced_expense: number;
  total_invoiced: number;
  remaining_commitment: number;
  change_orders: Array<{
    id: number;
    co_number: string | null;
    description: string;
    amount: number;
    status: string;
  }>;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CommitmentsGrid() {
  const { projectId, phaseId } = useParams<{ projectId: string; phaseId: string }>();
  const phaseIdNum = Number(phaseId);

  const { data: project } = useQuery({
    queryKey: ['project', Number(projectId)],
    queryFn: () => api.getProject(Number(projectId)),
    enabled: !!projectId,
  });
  const gla_sf = (project as any)?.gla_sf ? Number((project as any).gla_sf) : null;
  const gla_ac = (project as any)?.gla_ac ? Number((project as any).gla_ac) : null;

  // collapsed: sec:key, sg:key, line:id
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // expanded contract drilldown: line:id
  const [contractsOpen, setContractsOpen] = useState<Set<number>>(new Set());
  // collapsed CO list under a contract: contract:id
  const [cosCollapsed, setCosCollapsed] = useState<Set<number>>(new Set());

  const { data: rows = [], isLoading, error } = useQuery<BudgetRow[]>({
    queryKey: ['budget', phaseIdNum],
    queryFn: () => api.getBudget(phaseIdNum),
    enabled: !!phaseIdNum,
  });

  const { data: contracts = [] } = useQuery<PhaseContract[]>({
    queryKey: ['phaseContracts', phaseIdNum],
    queryFn: () => api.listContracts(phaseIdNum),
    enabled: !!phaseIdNum,
  });

  // Map budget_line_id → contracts[]
  const contractsByLine = useMemo(() => {
    const m = new Map<number, PhaseContract[]>();
    for (const c of contracts) {
      if (!m.has(c.phase_budget_line_id)) m.set(c.phase_budget_line_id, []);
      m.get(c.phase_budget_line_id)!.push(c);
    }
    return m;
  }, [contracts]);

  function toggle(key: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }
  function toggleLine(id: number) {
    setContractsOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleCo(id: number) {
    setCosCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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

  if (isLoading) return <div className={styles.splash}>Loading…</div>;
  if (error)     return <div className={styles.splash}>Error loading data.</div>;
  if (!rows.length) {
    return (
      <div className={styles.splash}>
        <p className={styles.splashMsg}>No budget lines. Initialize the budget on the Budget tab first.</p>
      </div>
    );
  }

  const TotalsCells = ({ t }: { t: Totals }) => <>
    <td className={styles.sn}>{moneyD(t.budgeted)}</td>
    <td className={styles.sn}>{money(t.committed)}</td>
    <td className={styles.sn}>{t.co_value > 0 ? money(t.co_value) : '—'}</td>
    <td className={`${styles.sn} ${t.total_commitment > t.budgeted && t.budgeted > 0 ? styles.danger : ''}`}>
      {money(t.total_commitment)}
    </td>
    <td className={`${styles.sn} ${t.remaining_commit < 0 ? styles.danger : ''}`}>
      {moneyD(t.remaining_commit)}
    </td>
    <td className={styles.sn}>{remPct(t.total_commitment, t.budgeted)}</td>
    <td className={styles.sn}>{perSF(t.total_commitment, gla_sf)}</td>
    <td className={styles.sn}>{perAC(t.total_commitment, gla_ac)}</td>
  </>;

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>Commitments</span>
      </div>

      <div className={styles.scrollArea}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: 24 }} />    {/* gutter */}
            <col style={{ width: 230 }} />   {/* task / vendor */}
            <col style={{ width: 110 }} />   {/* discipline / ref# / status */}
            <col style={{ width: 96 }} />    {/* budget */}
            <col style={{ width: 96 }} />    {/* init. contract */}
            <col style={{ width: 88 }} />    {/* COs */}
            <col style={{ width: 96 }} />    {/* total commitment */}
            <col style={{ width: 96 }} />    {/* rem $ */}
            <col style={{ width: 52 }} />    {/* rem % */}
            <col style={{ width: 72 }} />    {/* $/SF */}
            <col style={{ width: 72 }} />    {/* $/AC */}
          </colgroup>
          <thead>
            <tr className={styles.theadGroup}>
              <th className={styles.th} colSpan={3} />
              <th className={styles.th} />
              <th className={`${styles.thGroup}`} colSpan={5}>Contract Commitment</th>
              <th className={styles.th} colSpan={2} />
            </tr>
            <tr className={styles.thead}>
              <th className={styles.th} />
              <th className={`${styles.th} ${styles.thLeft}`}>Task / Vendor</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Discipline / Ref #</th>
              <th className={`${styles.th} ${styles.thRight}`}>Budget</th>
              <th className={`${styles.th} ${styles.thRight}`}>Init. Contract</th>
              <th className={`${styles.th} ${styles.thRight}`}>COs</th>
              <th className={`${styles.th} ${styles.thRight}`}>Total Commitment</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. $</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem. %</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/SF</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/AC</th>
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
                      </tr>
                    ] : []),

                    ...(sgOpen ? sgRows.flatMap((row: BudgetRow) => {
                      const lineContracts = contractsByLine.get(row.id) ?? [];
                      const hasContracts  = lineContracts.length > 0;
                      const lineOpen      = contractsOpen.has(row.id);

                      return [
                        // ── Budget line row ────────────────────────────────
                        <tr
                          key={row.id}
                          className={`${styles.dataRow} ${hasContracts ? cgStyles.lineClickable : ''}`}
                          onClick={hasContracts ? () => toggleLine(row.id) : undefined}
                        >
                          <td className={styles.rowGutter}>
                            {hasContracts && (
                              <span className={styles.chevron}>{lineOpen ? '▼' : '▶'}</span>
                            )}
                          </td>
                          <td className={`${styles.cell} ${styles.tdTask}`}>{row.task_name}</td>
                          <td className={`${styles.cell} ${styles.tdDisc}`}>{row.discipline}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.budgeted_amount) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>{money(row.committed)}</td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>
                            {row.co_count > 0
                              ? <span title={`${row.co_count} CO${row.co_count > 1 ? 's' : ''}`}>{money(row.co_value)}</span>
                              : ''}
                          </td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.total_commitment > row.budgeted_amount && row.budgeted_amount > 0 ? styles.danger : ''}`}>
                            {money(row.total_commitment)}
                          </td>
                          <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining_commit < 0 ? styles.danger : ''}`}>
                            {row.budgeted_amount > 0 ? usd.format(row.remaining_commit) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>
                            {row.budgeted_amount > 0 ? remPct(row.total_commitment, row.budgeted_amount) : '—'}
                          </td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perSF(row.total_commitment, gla_sf)}</td>
                          <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perAC(row.total_commitment, gla_ac)}</td>
                        </tr>,

                        // ── Contract rows (drilldown) ──────────────────────
                        ...(lineOpen ? lineContracts.flatMap(c => {
                          const hasCos   = c.change_orders.length > 0;
                          const cosOpen  = !cosCollapsed.has(c.id);

                          return [
                            <tr key={`contract:${c.id}`} className={cgStyles.contractRow}
                                onClick={hasCos ? () => toggleCo(c.id) : undefined}
                                style={{ cursor: hasCos ? 'pointer' : 'default' }}>
                              <td className={cgStyles.contractGutter}>
                                {hasCos && <span className={styles.chevron}>{cosOpen ? '▼' : '▶'}</span>}
                              </td>
                              <td className={`${styles.cell} ${cgStyles.vendorCell}`}>
                                {c.vendor_name}
                              </td>
                              <td className={`${styles.cell} ${cgStyles.refCell}`}>
                                <span className={`${cgStyles.statusBadge} ${cgStyles[`status_${c.status}`]}`}>
                                  {STATUS_LABEL[c.status] ?? c.status}
                                </span>
                                {c.reference_number && (
                                  <span className={cgStyles.refNum}>{c.reference_number}</span>
                                )}
                              </td>
                              <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`} />
                              <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.contractNum}`}>
                                {usd.format(c.total_value)}
                              </td>
                              <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.contractNum}`}>
                                {c.co_value > 0 ? money(c.co_value) : ''}
                              </td>
                              <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.contractNum}`}>
                                {usd.format(c.total_commitment)}
                              </td>
                              <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.contractNum} ${c.remaining_commitment < 0 ? styles.danger : ''}`}>
                                {c.total_invoiced > 0 ? usd.format(c.remaining_commitment) : '—'}
                              </td>
                              <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`} />
                              <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`} />
                              <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`} />
                            </tr>,

                            // ── CO sub-rows ────────────────────────────────
                            ...(hasCos && cosOpen ? c.change_orders.map(co => (
                              <tr key={`co:${co.id}`} className={cgStyles.coRow}>
                                <td className={cgStyles.coGutter} />
                                <td className={`${styles.cell} ${cgStyles.coDesc}`} colSpan={2}>
                                  <span className={cgStyles.coLabel}>
                                    CO{co.co_number ? ` ${co.co_number}` : ''}
                                  </span>
                                  {' '}{co.description}
                                </td>
                                <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`} />
                                <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`} />
                                <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.coNum}`}>
                                  {usd.format(co.amount)}
                                </td>
                                <td className={`${styles.cell} ${styles.tdMoney} ${cgStyles.coNum}`}>
                                  {usd.format(co.amount)}
                                </td>
                                <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`} />
                                <td className={`${styles.cell} ${styles.tdPct}  ${styles.ro}`} />
                                <td className={`${styles.cell} ${styles.tdPct}  ${styles.ro}`} />
                                <td className={`${styles.cell} ${styles.tdPct}  ${styles.ro}`} />
                              </tr>
                            )) : []),
                          ];
                        }) : []),
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
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.committed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{moneyD(grand.co_value)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.total_commitment > grand.budgeted ? styles.danger : ''}`}>
                {moneyD(grand.total_commitment)}
              </td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.remaining_commit < 0 ? styles.danger : ''}`}>
                {usd.format(grand.remaining_commit)}
              </td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{remPct(grand.total_commitment, grand.budgeted)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perSF(grand.total_commitment, gla_sf)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perAC(grand.total_commitment, gla_ac)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
