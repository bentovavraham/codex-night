import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './PhaseHome.module.css';

const TABS = [
  { to: 'budget',         label: 'Budget' },
  { to: 'contracts',      label: 'Contracts' },
  { to: 'invoices',       label: 'Invoices' },
  { to: 'change-orders',  label: 'Change Orders' },
  { to: 'alerts',         label: 'Alerts' },
  { to: 'history',        label: 'History' },
];

export default function PhaseHome() {
  const { projectId, phaseId } = useParams();

  const { data: project } = useQuery({
    queryKey: ['project', Number(projectId)],
    queryFn: () => api.getProject(Number(projectId)),
    enabled: !!projectId,
  });

  const { data: phases = [] } = useQuery({
    queryKey: ['phases', Number(projectId)],
    queryFn: () => api.listPhases(Number(projectId)),
    enabled: !!projectId,
  });

  const phase = (phases as any[]).find((p: any) => p.id === Number(phaseId));
  const p = project as any;

  return (
    <div className={styles.page}>
      {/* Phase header */}
      <div className={styles.phaseHeader}>
        <div className={styles.breadcrumb}>
          <span className={styles.breadProject}>{p?.name}</span>
          <span className={styles.breadSep}>›</span>
          <span className={styles.breadPhase}>{phase?.name || 'Loading…'}</span>
        </div>
        {phase && (
          <div className={styles.phaseMeta}>
            <span className={`${styles.statusDot} ${styles[`dot_${phase.status}`]}`} />
            <span className={styles.statusText}>{phase.status}</span>
            {phase.start_date && (
              <span className={styles.dates}>
                {phase.start_date.slice(0, 10)}{phase.end_date ? ` → ${phase.end_date.slice(0, 10)}` : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {TABS.map(tab => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* Tab content */}
      <div className={styles.tabContent}>
        <Outlet />
      </div>
    </div>
  );
}
