import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import styles from './PhaseHome.module.css';
import { UploadPanel as ContractUploadPanel } from './ContractsTab';
import { ImportDrawer } from './ImportDrawer';

const TABS = [
  { to: 'budget',      label: 'Budget' },
  { to: 'contracts',   label: 'Contracts' },
  { to: 'invoices',    label: 'Invoices' },
  { to: 'audit',       label: 'Audit' },
  { to: 'alerts',      label: 'Alerts' },
  { to: 'history',     label: 'History' },
];

export default function PhaseHome() {
  const { projectId, phaseId } = useParams();
  const qc = useQueryClient();
  const pid = Number(phaseId);
  const proj = Number(projectId);

  const [showContractUpload, setShowContractUpload] = useState(false);
  const [showInvoiceUpload,  setShowInvoiceUpload]  = useState(false);

  const { data: project } = useQuery({
    queryKey: ['project', proj],
    queryFn: () => api.getProject(proj),
    enabled: !!projectId,
  });

  const { data: phases = [] } = useQuery({
    queryKey: ['phases', proj],
    queryFn: () => api.listPhases(proj),
    enabled: !!projectId,
  });

  const { data: qbAccounts = [] } = useQuery({
    queryKey: ['qbAccounts'],
    queryFn: () => api.listQbAccounts(),
    staleTime: 300_000,
  });

  const phase = (phases as any[]).find((p: any) => p.id === pid);
  const p = project as any;

  function invalidateAfterUpload() {
    qc.invalidateQueries({ queryKey: ['budget', pid] });
    qc.invalidateQueries({ queryKey: ['phaseContracts', pid] });
    qc.invalidateQueries({ queryKey: ['invoices', pid] });
  }

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
        <div className={styles.tabBarSpacer} />
        <button className={styles.importBtn} onClick={() => setShowInvoiceUpload(true)}>
          ↑ Invoice
        </button>
        <button className={styles.importBtn} onClick={() => setShowContractUpload(true)}>
          ↑ Contract
        </button>
      </div>

      {/* Tab content */}
      <div className={styles.tabContent}>
        <Outlet />
      </div>

      {/* Global contract upload panel */}
      {showContractUpload && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--bg)' }}>
          <ContractUploadPanel
            qbAccounts={qbAccounts as any[]}
            projectId={proj}
            phaseId={pid}
            onClose={() => setShowContractUpload(false)}
            onSaved={() => { setShowContractUpload(false); invalidateAfterUpload(); }}
          />
        </div>
      )}

      {/* Global invoice import drawer */}
      {showInvoiceUpload && (
        <ImportDrawer
          phaseId={pid}
          onClose={() => setShowInvoiceUpload(false)}
          onConfirmed={() => { setShowInvoiceUpload(false); invalidateAfterUpload(); }}
        />
      )}
    </div>
  );
}
