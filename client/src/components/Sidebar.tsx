import { NavLink, useLocation } from 'react-router-dom';
import styles from './Sidebar.module.css';

const NAV = [
  { to: '/',          label: 'Dashboard',  icon: '▦' },
  { to: '/projects',  label: 'Projects',   icon: '◫' },
  { to: '/invoices',  label: 'Invoices',   icon: '≡' },
  { to: '/by-trade',  label: 'By Trade',   icon: '⊞' },
  { to: '/alerts',    label: 'Alerts',     icon: '⚠' },
];

const ADMIN = [
  { to: '/admin',     label: 'Admin',      icon: '⚙' },
];

export default function Sidebar() {
  const location = useLocation();

  function isActive(to: string) {
    if (to === '/') return location.pathname === '/';
    return location.pathname.startsWith(to);
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.logoMark}>AA</span>
        <span className={styles.logoText}>Active Acq</span>
      </div>

      <nav className={styles.nav}>
        <div className={styles.section}>
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={isActive(item.to) ? `${styles.item} ${styles.active}` : styles.item}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span className={styles.itemLabel}>{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className={styles.divider} />

        <div className={styles.sectionLabel}>Admin</div>
        <div className={styles.section}>
          {ADMIN.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={isActive(item.to) ? `${styles.item} ${styles.active}` : styles.item}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span className={styles.itemLabel}>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </aside>
  );
}
