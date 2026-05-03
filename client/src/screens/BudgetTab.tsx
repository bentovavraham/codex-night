import { NavLink, Outlet } from 'react-router-dom';
import styles from './BudgetTab.module.css';

const SUB_TABS = [
  { to: 'pm',      label: 'PM Source' },
  { to: 'qb',      label: 'QB Source' },
  { to: 'compare', label: 'Compare' },
];

export default function BudgetTab() {
  return (
    <div className={styles.wrap}>
      <div className={styles.subTabBar}>
        {SUB_TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              isActive ? `${styles.subTab} ${styles.subTabActive}` : styles.subTab
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className={styles.subTabContent}>
        <Outlet />
      </div>
    </div>
  );
}

export function QBSourceView() {
  return (
    <div className={styles.stub}>
      <div className={styles.stubBadge}>Phase 2 — Coming soon</div>
      <div className={styles.stubTitle}>QB Source</div>
      <div className={styles.stubBody}>
        Same Budget Grid populated from QuickBooks transactions instead of PDFs.
        BUDGETED / CONTRACTED / COS columns mirror PM Source (the plan is one fact).
        FIXED / T&amp;M / EXPENSE stay blank because QB doesn't carry that breakdown.
        BILLED / AMT DUE / PAID populate from <code>qb_transactions</code>.
      </div>
    </div>
  );
}

export function CompareView() {
  return (
    <div className={styles.stub}>
      <div className={styles.stubBadge}>Phase 3 — Coming soon</div>
      <div className={styles.stubTitle}>Compare</div>
      <div className={styles.stubBody}>
        Same Budget Grid plus a Δ column next to each actuals sub-column
        (FIXED, T&amp;M, EXPENSE, BILLED, AMT DUE, PAID). Active Only filter
        hides Δ columns where the QB side is structurally blank.
      </div>
    </div>
  );
}
