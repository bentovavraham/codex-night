import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './CompareGrid.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompareRow {
  id: number;
  task_name: string;
  qb_account_number: string | null;
  qb_short_name: string | null;
  qb_parent_number: string | null;
  qb_parent_name: string | null;
  qb_parent_sort: number;
  qb_sort_order: number;
  sort_order: number;
  budgeted_amount: number;
  committed: number;
  co_value: number;
  total_commitment: number;
  remaining_budget: number;
  remaining_commit: number;
  pm_fixed_charges: number;
  pm_tm_charges: number;
  pm_expense_charges: number;
  pm_billed: number;
  pm_paid: number;
  pm_amount_due: number;
  qb_fixed_charges: number;
  qb_tm_charges: number;
  qb_expense_charges: number;
  qb_billed: number;
  qb_paid: number;
  qb_amount_due: number;
}

// ─── Formatting helpers ──────────────────────────────────────────────────────

const usd   = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n: number) => n === 0 ? '' : usd.format(n);
const remPct = (spent: number, budget: number) =>
  budget > 0 ? `${Math.round(((budget - spent) / budget) * 100)}%` : '—';

/** Variance threshold: ignore deltas below the larger of $100 or 2% of the larger value. */
function isMeaningful(pm: number, qb: number): boolean {
  const diff = Math.abs(qb - pm);
  if (diff < 100) return false;
  const base = Math.max(Math.abs(pm), Math.abs(qb));
  return base === 0 ? diff > 0 : diff / base >= 0.02;
}

function DeltaCell({ pm, qb, structurallyBlank }: { pm: number; qb: number; structurallyBlank?: boolean }) {
  // When QB side is structurally blank (FIXED/T&M/EXPENSE), Δ would just equal -PM
  // which isn't a "records mismatch" — it's an "info QB doesn't carry." Render muted.
  if (structurallyBlank) {
    if (pm === 0) return <td className={styles.tdDelta}>—</td>;
    return (
      <td className={`${styles.tdDelta} ${styles.deltaNeutral}`}>
        n/a
      </td>
    );
  }

  if (pm === 0 && qb === 0) {
    return <td className={styles.tdDelta}>—</td>;
  }

  const diff = qb - pm;
  if (!isMeaningful(pm, qb)) {
    return <td className={`${styles.tdDelta} ${styles.deltaNeutral}`}>≈</td>;
  }
  const cls = diff >= 0 ? styles.deltaPos : styles.deltaNeg;
  const base = Math.max(Math.abs(pm), Math.abs(qb));
  const pct = base > 0 ? Math.round((diff / base) * 100) : 0;
  return (
    <td className={`${styles.tdDelta} ${cls}`}>
      {diff > 0 ? '+' : ''}{usd.format(diff)}
      <span className={styles.deltaPct}>{pct > 0 ? '+' : ''}{pct}%</span>
    </td>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompareGrid() {
  const { phaseId } = useParams<{ phaseId: string }>();
  const phaseIdNum = Number(phaseId);
  const [activeOnly, setActiveOnly] = useState(true);

  const { data: rows = [], isLoading, error } = useQuery<CompareRow[]>({
    queryKey: ['budget', phaseIdNum, 'compare'],
    queryFn: () => api.getBudget(phaseIdNum, 'compare') as Promise<CompareRow[]>,
    enabled: !!phaseIdNum,
  });

  // Group rows by qb_parent_number for visual section breaks (matches BudgetGrid)
  const grouped = useMemo(() => {
    const out: { parent: { number: string | null; name: string | null }; rows: CompareRow[] }[] = [];
    let currentParent = '__none__';
    rows.forEach(r => {
      const key = r.qb_parent_number || r.qb_account_number || '__none__';
      if (key !== currentParent) {
        out.push({ parent: { number: r.qb_parent_number, name: r.qb_parent_name }, rows: [] });
        currentParent = key;
      }
      out[out.length - 1].rows.push(r);
    });
    return out;
  }, [rows]);

  // Total counts
  const counts = useMemo(() => {
    let qbHasData = 0;
    let pmHasData = 0;
    let mismatch = 0;
    rows.forEach(r => {
      if (r.qb_billed > 0) qbHasData++;
      if (r.pm_billed > 0) pmHasData++;
      if (isMeaningful(r.pm_billed, r.qb_billed) ||
          isMeaningful(r.pm_paid, r.qb_paid) ||
          isMeaningful(r.pm_amount_due, r.qb_amount_due)) mismatch++;
    });
    return { qbHasData, pmHasData, mismatch };
  }, [rows]);

  if (isLoading) {
    return <div className={styles.empty}>Loading…</div>;
  }
  if (error) {
    return <div className={styles.empty}>Error: {String((error as Error).message)}</div>;
  }
  if (rows.length === 0) {
    return <div className={styles.empty}>No budget lines for this phase yet.</div>;
  }

  // Active Only hides the FIXED/T&M/EXPENSE Δ columns (always structurally blank on QB side).
  const showBreakdownDelta = !activeOnly;
  const noQbData = counts.qbHasData === 0;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>Compare</span>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={e => setActiveOnly(e.target.checked)}
          />
          Active Only
        </label>
        <div className={styles.legend}>
          <span><span className={styles.legendDot} style={{ background: '#16a34a' }} />QB ≥ PM</span>
          <span><span className={styles.legendDot} style={{ background: '#dc2626' }} />QB &lt; PM</span>
          <span><span className={styles.legendDot} style={{ background: '#9aa0a6' }} />within 2% / $100</span>
        </div>
      </div>

      {noQbData && (
        <div className={styles.warn}>
          No QuickBooks transactions loaded for this phase yet — Δ columns will be empty.
          Upload a QB Transaction Report from the Audit tab.
        </div>
      )}

      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            {/* Group header */}
            <tr>
              <th className={styles.headerGroup} colSpan={2}>Account</th>
              <th className={styles.headerGroup} colSpan={3}>Budget</th>
              <th className={`${styles.headerGroup} ${styles.groupStart}`} colSpan={3}>Contract Commitment</th>
              {showBreakdownDelta ? (
                <>
                  <th className={`${styles.headerGroup} ${styles.groupStart}`} colSpan={2}>Fixed</th>
                  <th className={styles.headerGroup} colSpan={2}>T&amp;M</th>
                  <th className={styles.headerGroup} colSpan={2}>Expense</th>
                </>
              ) : (
                <th className={`${styles.headerGroup} ${styles.groupStart}`} colSpan={3}>Invoiced (PM)</th>
              )}
              <th className={`${styles.headerGroup} ${styles.groupStart}`} colSpan={2}>Billed</th>
              <th className={styles.headerGroup} colSpan={2}>Amt Due</th>
              <th className={styles.headerGroup} colSpan={2}>Paid</th>
            </tr>
            {/* Sub header */}
            <tr>
              <th className={`${styles.headerSub} ${styles.left}`}>Acct #</th>
              <th className={`${styles.headerSub} ${styles.left}`}>Task / Description</th>
              <th className={styles.headerSub}>Budgeted</th>
              <th className={styles.headerSub}>Rem. Budget</th>
              <th className={styles.headerSub}>Rem. %</th>
              <th className={`${styles.headerSub} ${styles.groupStart}`}>Contracted</th>
              <th className={styles.headerSub}>COS</th>
              <th className={styles.headerSub}>Total Commit</th>
              {showBreakdownDelta ? (
                <>
                  <th className={`${styles.headerSub} ${styles.groupStart}`}>PM</th>
                  <th className={styles.headerSub}>Δ vs QB</th>
                  <th className={`${styles.headerSub} ${styles.groupStart}`}>PM</th>
                  <th className={styles.headerSub}>Δ vs QB</th>
                  <th className={`${styles.headerSub} ${styles.groupStart}`}>PM</th>
                  <th className={styles.headerSub}>Δ vs QB</th>
                </>
              ) : (
                <>
                  <th className={`${styles.headerSub} ${styles.groupStart}`}>Fixed</th>
                  <th className={styles.headerSub}>T&amp;M</th>
                  <th className={styles.headerSub}>Expense</th>
                </>
              )}
              <th className={`${styles.headerSub} ${styles.groupStart}`}>PM</th>
              <th className={styles.headerSub}>Δ vs QB</th>
              <th className={`${styles.headerSub} ${styles.groupStart}`}>PM</th>
              <th className={styles.headerSub}>Δ vs QB</th>
              <th className={`${styles.headerSub} ${styles.groupStart}`}>PM</th>
              <th className={styles.headerSub}>Δ vs QB</th>
            </tr>
          </thead>

          <tbody>
            {grouped.map((group, gi) => (
              <RenderGroup
                key={gi}
                parent={group.parent}
                rows={group.rows}
                showBreakdownDelta={showBreakdownDelta}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenderGroup({
  parent, rows, showBreakdownDelta,
}: {
  parent: { number: string | null; name: string | null };
  rows: CompareRow[];
  showBreakdownDelta: boolean;
}) {
  const colSpan = showBreakdownDelta ? 19 : 16;
  return (
    <>
      {parent.number && (
        <tr className={styles.secRow}>
          <td colSpan={colSpan}>
            <span style={{ fontFamily: 'var(--font-mono, ui-monospace, Menlo)', marginRight: 10 }}>{parent.number}</span>
            {parent.name}
          </td>
        </tr>
      )}
      {rows.map(r => (
        <tr key={r.id} className={styles.dataRow}>
          <td className={styles.tdAcct}>{r.qb_account_number || '—'}</td>
          <td className={styles.tdTask}>{r.task_name}</td>
          <td className={styles.tdMoney}>{money(r.budgeted_amount)}</td>
          <td className={styles.tdMoney}>{money(r.remaining_budget)}</td>
          <td className={styles.tdMoneyMuted}>{remPct(r.pm_billed, r.budgeted_amount)}</td>
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.committed)}</td>
          <td className={styles.tdMoney}>{money(r.co_value)}</td>
          <td className={styles.tdMoney}>{money(r.total_commitment)}</td>

          {showBreakdownDelta ? (
            <>
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_fixed_charges)}</td>
              <DeltaCell pm={r.pm_fixed_charges} qb={r.qb_fixed_charges} structurallyBlank />
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_tm_charges)}</td>
              <DeltaCell pm={r.pm_tm_charges} qb={r.qb_tm_charges} structurallyBlank />
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_expense_charges)}</td>
              <DeltaCell pm={r.pm_expense_charges} qb={r.qb_expense_charges} structurallyBlank />
            </>
          ) : (
            <>
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_fixed_charges)}</td>
              <td className={styles.tdMoney}>{money(r.pm_tm_charges)}</td>
              <td className={styles.tdMoney}>{money(r.pm_expense_charges)}</td>
            </>
          )}

          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_billed)}</td>
          <DeltaCell pm={r.pm_billed} qb={r.qb_billed} />
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_amount_due)}</td>
          <DeltaCell pm={r.pm_amount_due} qb={r.qb_amount_due} />
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_paid)}</td>
          <DeltaCell pm={r.pm_paid} qb={r.qb_paid} />
        </tr>
      ))}
    </>
  );
}
