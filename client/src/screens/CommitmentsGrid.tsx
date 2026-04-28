import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { BudgetRow } from './BudgetGrid';
import styles from './BudgetGrid.module.css';
import cgStyles from './CommitmentsGrid.module.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd  = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmt  = (n: number) => n === 0 ? '—' : usd.format(n);
const fmtZ = (n: number) => n === 0 ? ''  : usd.format(n);
const pct  = (a: number, b: number) => b > 0 ? `${Math.round(((b - a) / b) * 100)}%` : '—';
const perSF = (n: number, sf: number | null) => sf && sf > 0 && n > 0 ? `$${(n / sf).toFixed(2)}` : '—';
const perAC = (n: number, ac: number | null) => ac && ac > 0 && n > 0 ? `$${Math.round(n / ac).toLocaleString()}` : '—';

const STATUS_COLOR: Record<string, string> = {
  active: '#16a34a', pending: '#d97706', draft: '#6b7280',
  approved: '#2563eb', voided: '#9ca3af', rejected: '#dc2626',
};

const SECTIONS = [
  { key: 'professional_fees', label: 'Professional Fees' },
  { key: 'application_fees',  label: 'Application & Other Fees' },
  { key: 'construction',      label: 'Estimated Extraordinary Construction Costs' },
] as const;

// ─── Drill Panel ──────────────────────────────────────────────────────────────

type DrillCell = 'committed' | 'billed';

interface DrillTarget { rowId: number; rowName: string; cell: DrillCell; }

function DrillPanel({ phaseId, target, onClose }: {
  phaseId: number;
  target: DrillTarget;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['drill', phaseId, target.rowId],
    queryFn: () => api.drillBudgetLine(phaseId, target.rowId),
    staleTime: 30_000,
  });

  const contracts: any[] = data?.contracts ?? [];
  const invoices:  any[] = data?.invoices  ?? [];

  const contractTotal = contracts.reduce((s: number, c: any) => s + Number(c.allocated_amount), 0);
  const invoiceTotal  = invoices.reduce( (s: number, i: any) => s + Number(i.amount), 0);

  return (
    <div className={cgStyles.drillOverlay} onClick={onClose}>
      <div className={cgStyles.drillPanel} onClick={e => e.stopPropagation()}>
        <div className={cgStyles.drillHeader}>
          <div>
            <div className={cgStyles.drillTitle}>{target.rowName}</div>
            <div className={cgStyles.drillSub}>{target.cell === 'committed' ? 'Contract Commitments' : 'Invoiced / Billed'}</div>
          </div>
          <button className={cgStyles.drillClose} onClick={onClose}>✕</button>
        </div>

        {isLoading && <div className={cgStyles.drillLoading}>Loading…</div>}

        {!isLoading && target.cell === 'committed' && (
          <div className={cgStyles.drillBody}>
            {contracts.length === 0 ? (
              <div className={cgStyles.drillEmpty}>No contracts committed to this line.</div>
            ) : (
              <table className={cgStyles.drillTable}>
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Ref #</th>
                    <th>Status</th>
                    <th className={cgStyles.drillAmt}>Allocated</th>
                    <th className={cgStyles.drillAmt}>Contract Total</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c: any) => (
                    <tr key={c.id} className={cgStyles.drillRow}>
                      <td className={cgStyles.drillVendor}>{c.vendor_name}</td>
                      <td className={cgStyles.drillRef}>{c.reference_number || '—'}</td>
                      <td>
                        <span className={cgStyles.drillBadge}
                          style={{ background: STATUS_COLOR[c.status] + '22', color: STATUS_COLOR[c.status] ?? '#555' }}>
                          {c.status}
                        </span>
                        {!c.is_primary && (
                          <span className={cgStyles.drillPartial} title="Multi-discipline contract — this is the portion allocated here">partial</span>
                        )}
                      </td>
                      <td className={`${cgStyles.drillAmt} ${cgStyles.drillAmtBold}`}>{usd.format(Number(c.allocated_amount))}</td>
                      <td className={`${cgStyles.drillAmt} ${cgStyles.drillAmtDim}`}>{usd.format(Number(c.total_value))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={cgStyles.drillTotal}>
                    <td colSpan={3}>Total committed</td>
                    <td className={cgStyles.drillAmt}>{usd.format(contractTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}

        {!isLoading && target.cell === 'billed' && (
          <div className={cgStyles.drillBody}>
            {invoices.length === 0 ? (
              <div className={cgStyles.drillEmpty}>No invoices billed against this line.</div>
            ) : (
              <table className={cgStyles.drillTable}>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Vendor</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className={cgStyles.drillAmt}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} className={cgStyles.drillRow}>
                      <td className={cgStyles.drillRef}>{inv.invoice_number || '—'}</td>
                      <td className={cgStyles.drillVendor}>{inv.vendor_name}</td>
                      <td className={cgStyles.drillRef}>{inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '—'}</td>
                      <td>
                        <span className={cgStyles.drillBadge}
                          style={{ background: STATUS_COLOR[inv.status] + '22', color: STATUS_COLOR[inv.status] ?? '#555' }}>
                          {inv.status}
                        </span>
                      </td>
                      <td className={`${cgStyles.drillAmt} ${cgStyles.drillAmtBold}`}>{usd.format(Number(inv.amount))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={cgStyles.drillTotal}>
                    <td colSpan={4}>Total billed</td>
                    <td className={cgStyles.drillAmt}>{usd.format(invoiceTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Drill cell ───────────────────────────────────────────────────────────────

function DC({ value, zero: zeroStr = '—', row, cell, active, onDrill, className }: {
  value: number;
  zero?: string;
  row: BudgetRow;
  cell: DrillCell;
  active: boolean;
  onDrill: (t: DrillTarget) => void;
  className?: string;
}) {
  const hasData = value !== 0;
  return (
    <td
      className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${className ?? ''} ${hasData ? cgStyles.drillable : ''} ${active ? cgStyles.drillActive : ''}`}
      onClick={hasData ? () => onDrill({ rowId: row.id, rowName: row.task_name, cell }) : undefined}
      title={hasData ? 'Click to see breakdown' : undefined}
    >
      {value === 0 ? zeroStr : usd.format(value)}
    </td>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CommitmentsGrid() {
  const { projectId, phaseId } = useParams<{ projectId: string; phaseId: string }>();
  const phaseIdNum = Number(phaseId);

  const [collapsed,   setCollapsed]   = useState<Set<string>>(new Set());
  const [drillTarget, setDrillTarget] = useState<DrillTarget | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', Number(projectId)],
    queryFn: () => api.getProject(Number(projectId)),
    enabled: !!projectId,
  });
  const gla_sf = (project as any)?.gla_sf ? Number((project as any).gla_sf) : null;
  const gla_ac = (project as any)?.gla_ac ? Number((project as any).gla_ac) : null;

  const { data: rows = [], isLoading, error } = useQuery<BudgetRow[]>({
    queryKey: ['budget', phaseIdNum],
    queryFn:  () => api.getBudget(phaseIdNum),
    enabled:  !!phaseIdNum,
  });

  function toggle(key: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function drill(t: DrillTarget) {
    setDrillTarget(prev => prev?.rowId === t.rowId && prev?.cell === t.cell ? null : t);
  }

  // Group rows into sections & sub-groups
  const sections = SECTIONS.map(sec => {
    const secRows = rows.filter(r => r.section === sec.key);
    const sgKeys  = [...new Set(secRows.map(r => r.sub_group ?? '__none__'))];
    const groups  = sgKeys.map(sg => ({
      key:  sg,
      label: sg === '__none__' ? null : sg,
      rows: secRows.filter(r => (r.sub_group ?? '__none__') === sg),
    }));
    const total = secRows.reduce((a, r) => ({
      budgeted:         a.budgeted         + r.budgeted_amount,
      committed:        a.committed        + r.committed,
      co_value:         a.co_value         + r.co_value,
      total_commitment: a.total_commitment + r.total_commitment,
      billed:           a.billed           + r.billed,
      remaining_commit: a.remaining_commit + r.remaining_commit,
    }), { budgeted: 0, committed: 0, co_value: 0, total_commitment: 0, billed: 0, remaining_commit: 0 });
    return { ...sec, groups, total };
  });

  const grand = rows.reduce((a, r) => ({
    budgeted:         a.budgeted         + r.budgeted_amount,
    committed:        a.committed        + r.committed,
    co_value:         a.co_value         + r.co_value,
    total_commitment: a.total_commitment + r.total_commitment,
    billed:           a.billed           + r.billed,
    remaining_commit: a.remaining_commit + r.remaining_commit,
  }), { budgeted: 0, committed: 0, co_value: 0, total_commitment: 0, billed: 0, remaining_commit: 0 });

  if (isLoading) return <div className={styles.splash}>Loading…</div>;
  if (error)     return <div className={styles.splash}>Error loading data.</div>;
  if (!rows.length) return (
    <div className={styles.splash}>
      <p className={styles.splashMsg}>No budget lines. Initialize the budget on the Budget tab first.</p>
    </div>
  );

  return (
    <div className={styles.wrapper}>
      {drillTarget && (
        <DrillPanel
          phaseId={phaseIdNum}
          target={drillTarget}
          onClose={() => setDrillTarget(null)}
        />
      )}

      <div className={styles.toolbar}>
        <span className={styles.toolLabel}>Commitments</span>
        {drillTarget && (
          <span className={cgStyles.drillHint}>
            Showing: <strong>{drillTarget.rowName}</strong> · {drillTarget.cell === 'committed' ? 'Commitments' : 'Billed'}
            <button className={cgStyles.drillClearBtn} onClick={() => setDrillTarget(null)}>✕ Close</button>
          </span>
        )}
      </div>

      <div className={styles.scrollArea}>
        <table className={styles.table}>
          <colgroup>
            <col style={{ width: 24 }} />
            <col style={{ width: 240 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 52 }} />
            <col style={{ width: 68 }} />
            <col style={{ width: 68 }} />
          </colgroup>
          <thead>
            <tr className={styles.theadGroup}>
              <th colSpan={4} />
              <th className={styles.thGroup} colSpan={3}>Contract Commitment</th>
              <th className={styles.thGroup} colSpan={2}>Invoice Burn</th>
              <th colSpan={3} />
            </tr>
            <tr className={styles.thead}>
              <th className={styles.th} />
              <th className={`${styles.th} ${styles.thLeft}`}>Task</th>
              <th className={`${styles.th} ${styles.thLeft}`}>Discipline</th>
              <th className={`${styles.th} ${styles.thRight}`}>Budget</th>
              <th className={`${styles.th} ${styles.thRight} ${cgStyles.drillHdr}`} title="Click any cell to see contracts">Contracted ↓</th>
              <th className={`${styles.th} ${styles.thRight}`}>COs</th>
              <th className={`${styles.th} ${styles.thRight}`}>Total Commit</th>
              <th className={`${styles.th} ${styles.thRight} ${cgStyles.drillHdr}`} title="Click any cell to see invoices">Billed ↓</th>
              <th className={`${styles.th} ${styles.thRight}`}>Remaining</th>
              <th className={`${styles.th} ${styles.thRight}`}>Rem %</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/SF</th>
              <th className={`${styles.th} ${styles.thRight}`}>$/AC</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(sec => {
              const secOpen = !collapsed.has(`sec:${sec.key}`);
              const st = sec.total;

              return [
                // Section header row
                <tr key={`sec:${sec.key}`} className={styles.secRow} onClick={() => toggle(`sec:${sec.key}`)}>
                  <td className={styles.secGutter}><span className={styles.chevron}>{secOpen ? '▼' : '▶'}</span></td>
                  <td className={styles.secLabel} colSpan={2}>{sec.label}</td>
                  <td className={styles.sn}>{fmt(st.budgeted)}</td>
                  <td className={styles.sn}>{fmtZ(st.committed)}</td>
                  <td className={styles.sn}>{st.co_value > 0 ? fmtZ(st.co_value) : '—'}</td>
                  <td className={`${styles.sn} ${st.total_commitment > st.budgeted && st.budgeted > 0 ? styles.danger : ''}`}>{fmtZ(st.total_commitment)}</td>
                  <td className={styles.sn}>{fmtZ(st.billed)}</td>
                  <td className={`${styles.sn} ${st.remaining_commit < 0 ? styles.danger : ''}`}>{fmt(st.remaining_commit)}</td>
                  <td className={styles.sn}>{pct(st.total_commitment, st.budgeted)}</td>
                  <td className={styles.sn}>{perSF(st.total_commitment, gla_sf)}</td>
                  <td className={styles.sn}>{perAC(st.total_commitment, gla_ac)}</td>
                </tr>,

                ...(secOpen ? sec.groups.flatMap(sg => [
                  // Sub-group header (if named)
                  ...(sg.label ? [
                    <tr key={`sg:${sg.key}`} className={styles.sgRow} onClick={() => toggle(`sg:${sg.key}`)}>
                      <td className={styles.sgGutter}><span className={styles.chevron}>{!collapsed.has(`sg:${sg.key}`) ? '▼' : '▶'}</span></td>
                      <td className={styles.sgLabel} colSpan={11}>{sg.label}</td>
                    </tr>
                  ] : []),

                  // Data rows
                  ...(!collapsed.has(`sg:${sg.key}`) ? sg.rows.map(row => {
                    const isActive = drillTarget?.rowId === row.id;
                    return (
                      <tr key={row.id} className={`${styles.dataRow} ${isActive ? cgStyles.activeRow : ''}`}>
                        <td className={styles.rowGutter} />
                        <td className={`${styles.cell} ${styles.tdTask}`}>{row.task_name}</td>
                        <td className={`${styles.cell} ${styles.tdDisc}`}>{row.discipline ?? '—'}</td>
                        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>
                          {row.budgeted_amount > 0 ? usd.format(row.budgeted_amount) : '—'}
                        </td>
                        <DC value={row.committed} zero="" row={row} cell="committed"
                            active={isActive && drillTarget?.cell === 'committed'} onDrill={drill} />
                        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro}`}>
                          {row.co_count > 0 ? <span title={`${row.co_count} CO${row.co_count > 1 ? 's' : ''}`}>{usd.format(row.co_value)}</span> : ''}
                        </td>
                        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.total_commitment > row.budgeted_amount && row.budgeted_amount > 0 ? styles.danger : ''}`}>
                          {fmtZ(row.total_commitment)}
                        </td>
                        <DC value={row.billed} zero="" row={row} cell="billed"
                            active={isActive && drillTarget?.cell === 'billed'} onDrill={drill} />
                        <td className={`${styles.cell} ${styles.tdMoney} ${styles.ro} ${row.remaining_commit < 0 ? styles.danger : ''}`}>
                          {row.budgeted_amount > 0 ? usd.format(row.remaining_commit) : '—'}
                        </td>
                        <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>
                          {row.budgeted_amount > 0 ? pct(row.total_commitment, row.budgeted_amount) : '—'}
                        </td>
                        <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perSF(row.total_commitment, gla_sf)}</td>
                        <td className={`${styles.cell} ${styles.tdPct} ${styles.ro}`}>{perAC(row.total_commitment, gla_ac)}</td>
                      </tr>
                    );
                  }) : []),
                ]) : []),
              ];
            })}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}>
              <td /><td className={styles.totalLabel} colSpan={2}>TOTAL</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{usd.format(grand.budgeted)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{fmt(grand.committed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{grand.co_value > 0 ? usd.format(grand.co_value) : '—'}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.total_commitment > grand.budgeted ? styles.danger : ''}`}>{usd.format(grand.total_commitment)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney}`}>{fmt(grand.billed)}</td>
              <td className={`${styles.totalCell} ${styles.tdMoney} ${grand.remaining_commit < 0 ? styles.danger : ''}`}>{usd.format(grand.remaining_commit)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{pct(grand.total_commitment, grand.budgeted)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perSF(grand.total_commitment, gla_sf)}</td>
              <td className={`${styles.totalCell} ${styles.tdPct}`}>{perAC(grand.total_commitment, gla_ac)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
