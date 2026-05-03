import { NavLink, Outlet } from 'react-router-dom';
import BudgetGrid from './BudgetGrid';
import CompareGrid from './CompareGrid';
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

// QB Source: same BudgetGrid, fed from qb_transactions instead of invoices.
// FIXED/T&M/EXPENSE will be 0 (blank in render) because QB has no breakdown.
export function QBSourceView() {
  return <BudgetGrid source="qb" />;
}

// Compare: dedicated grid with Δ columns next to every actuals sub-column.
export function CompareView() {
  return <CompareGrid />;
}
