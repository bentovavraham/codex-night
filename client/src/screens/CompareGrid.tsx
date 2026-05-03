import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './CompareGrid.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompareRow {
  id: number;
  task_name: string;
  qb_account_id: number | null;
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

  // GL-code-level groupings within each parent. A parent (e.g. "1720 Engineering")
  // can contain multiple GL codes (1720.01, 1720.02 …); each GL code can have
  // multiple PM tasks (the shared-code case). For shared codes the QB amount is
  // the same on every leaf (backend duplicates it), so leaves are deduped to ONE
  // representative for the QB side and a "GL Total" row displays the comparison.
  const grouped = useMemo(() => {
    type GlGroup = {
      qb_account_id: number | null;
      qb_account_number: string | null;
      qb_short_name: string | null;
      tasks: CompareRow[];           // PM tasks under this code
      qbBilled: number;              // GL-code-level QB amount (one number)
      qbPaid: number;
      qbAmountDue: number;
    };
    type ParentGroup = {
      parent: { number: string | null; name: string | null };
      glGroups: GlGroup[];
    };

    const out: ParentGroup[] = [];
    let currentParent = '__none__';
    let currentGlAccountId: number | null = -999;

    rows.forEach(r => {
      const parentKey = r.qb_parent_number || r.qb_account_number || '__none__';
      if (parentKey !== currentParent) {
        out.push({ parent: { number: r.qb_parent_number, name: r.qb_parent_name }, glGroups: [] });
        currentParent = parentKey;
        currentGlAccountId = -999;
      }
      const lastParent = out[out.length - 1];
      if (r.qb_account_id !== currentGlAccountId) {
        lastParent.glGroups.push({
          qb_account_id:     r.qb_account_id,
          qb_account_number: r.qb_account_number,
          qb_short_name:     r.qb_short_name,
          tasks: [],
          qbBilled:    r.qb_billed,     // same on every leaf — take the first
          qbPaid:      r.qb_paid,
          qbAmountDue: r.qb_amount_due,
        });
        currentGlAccountId = r.qb_account_id;
      }
      lastParent.glGroups[lastParent.glGroups.length - 1].tasks.push(r);
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
            {grouped.map((parentGrp, gi) => (
              <RenderParent
                key={gi}
                parent={parentGrp.parent}
                glGroups={parentGrp.glGroups}
                showBreakdownDelta={showBreakdownDelta}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RenderParent({
  parent, glGroups, showBreakdownDelta,
}: {
  parent: { number: string | null; name: string | null };
  glGroups: {
    qb_account_id: number | null;
    qb_account_number: string | null;
    qb_short_name: string | null;
    tasks: CompareRow[];
    qbBilled: number;
    qbPaid: number;
    qbAmountDue: number;
  }[];
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
      {glGroups.map(g => (
        <RenderGlGroup key={`${g.qb_account_id}-${g.qb_account_number}`} group={g} showBreakdownDelta={showBreakdownDelta} />
      ))}
    </>
  );
}

function RenderGlGroup({
  group, showBreakdownDelta,
}: {
  group: {
    qb_account_id: number | null;
    qb_account_number: string | null;
    qb_short_name: string | null;
    tasks: CompareRow[];
    qbBilled: number;
    qbPaid: number;
    qbAmountDue: number;
  };
  showBreakdownDelta: boolean;
}) {
  const isShared = group.tasks.length > 1;

  // Sum of PM-side actuals across all tasks under this GL code
  const pmTotals = group.tasks.reduce((acc, t) => ({
    fixed:  acc.fixed  + t.pm_fixed_charges,
    tm:     acc.tm     + t.pm_tm_charges,
    expense:acc.expense+ t.pm_expense_charges,
    billed: acc.billed + t.pm_billed,
    paid:   acc.paid   + t.pm_paid,
    amtDue: acc.amtDue + t.pm_amount_due,
  }), { fixed: 0, tm: 0, expense: 0, billed: 0, paid: 0, amtDue: 0 });

  // Aggregated PM/budget at GL-code level (for shared groups)
  const groupBudgeted   = group.tasks.reduce((s, t) => s + t.budgeted_amount, 0);
  const groupCommitted  = group.tasks.reduce((s, t) => s + t.committed, 0);
  const groupCoValue    = group.tasks.reduce((s, t) => s + t.co_value, 0);
  const groupTotalCommit= group.tasks.reduce((s, t) => s + t.total_commitment, 0);
  const groupRemBudget  = groupBudgeted - pmTotals.billed;

  return (
    <>
      {/* GL-Code Total row first when shared — leads with the comparison
          (the question users come here to answer); leaves follow as detail. */}
      {isShared && (
        <tr className={styles.glTotalRow}>
          <td className={styles.tdAcct}>
            <span className={styles.glTotalLabel}>{group.qb_account_number}</span>
          </td>
          <td className={styles.tdTask}>
            <span className={styles.glTotalLabel}>GL Total</span>
            <span className={styles.glTotalLabelSmall}>
              {group.qb_short_name} · {group.tasks.length} tasks
            </span>
          </td>
          <td className={styles.tdMoney}>{money(groupBudgeted)}</td>
          <td className={styles.tdMoney}>{money(groupRemBudget)}</td>
          <td className={styles.tdMoneyMuted}>{remPct(pmTotals.billed, groupBudgeted)}</td>
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(groupCommitted)}</td>
          <td className={styles.tdMoney}>{money(groupCoValue)}</td>
          <td className={styles.tdMoney}>{money(groupTotalCommit)}</td>

          {showBreakdownDelta ? (
            <>
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(pmTotals.fixed)}</td>
              <DeltaCell pm={pmTotals.fixed} qb={0} structurallyBlank />
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(pmTotals.tm)}</td>
              <DeltaCell pm={pmTotals.tm} qb={0} structurallyBlank />
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(pmTotals.expense)}</td>
              <DeltaCell pm={pmTotals.expense} qb={0} structurallyBlank />
            </>
          ) : (
            <>
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(pmTotals.fixed)}</td>
              <td className={styles.tdMoney}>{money(pmTotals.tm)}</td>
              <td className={styles.tdMoney}>{money(pmTotals.expense)}</td>
            </>
          )}

          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(pmTotals.billed)}</td>
          <DeltaCell pm={pmTotals.billed} qb={group.qbBilled} />
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(pmTotals.amtDue)}</td>
          <DeltaCell pm={pmTotals.amtDue} qb={group.qbAmountDue} />
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(pmTotals.paid)}</td>
          <DeltaCell pm={pmTotals.paid} qb={group.qbPaid} />
        </tr>
      )}

      {/* Individual task rows. For shared groups, leaf-level Δ cells are
          left empty (the comparison lives on the GL Total row above). */}
      {group.tasks.map(r => (
        <tr key={r.id} className={`${styles.dataRow} ${isShared ? styles.sharedLeaf : ''}`}>
          <td className={styles.tdAcct}>{r.qb_account_number || ''}</td>
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
              {isShared
                ? <td className={styles.tdDelta} />
                : <DeltaCell pm={r.pm_fixed_charges} qb={r.qb_fixed_charges} structurallyBlank />}
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_tm_charges)}</td>
              {isShared
                ? <td className={styles.tdDelta} />
                : <DeltaCell pm={r.pm_tm_charges} qb={r.qb_tm_charges} structurallyBlank />}
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_expense_charges)}</td>
              {isShared
                ? <td className={styles.tdDelta} />
                : <DeltaCell pm={r.pm_expense_charges} qb={r.qb_expense_charges} structurallyBlank />}
            </>
          ) : (
            <>
              <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_fixed_charges)}</td>
              <td className={styles.tdMoney}>{money(r.pm_tm_charges)}</td>
              <td className={styles.tdMoney}>{money(r.pm_expense_charges)}</td>
            </>
          )}

          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_billed)}</td>
          {isShared
            ? <td className={styles.tdDelta} />
            : <DeltaCell pm={r.pm_billed} qb={r.qb_billed} />}
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_amount_due)}</td>
          {isShared
            ? <td className={styles.tdDelta} />
            : <DeltaCell pm={r.pm_amount_due} qb={r.qb_amount_due} />}
          <td className={`${styles.tdMoney} ${styles.groupStart}`}>{money(r.pm_paid)}</td>
          {isShared
            ? <td className={styles.tdDelta} />
            : <DeltaCell pm={r.pm_paid} qb={r.qb_paid} />}
        </tr>
      ))}
    </>
  );
}
