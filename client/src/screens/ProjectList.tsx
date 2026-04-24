import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { api } from '../api/client';
import styles from './ProjectList.module.css';

export default function ProjectList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { projectType, setActiveProject } = useAppStore();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', notes: '' });
  const [err, setErr] = useState('');

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', projectType],
    queryFn: () => api.listProjects(),
  });

  const filtered = (projects as any[]).filter(p =>
    !projectType || p.project_type === projectType
  );

  const create = useMutation({
    mutationFn: () => api.createProject({ ...form, project_type: projectType }),
    onSuccess: (p: any) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setActiveProject(p.id);
      navigate(`/projects/${p.id}`);
    },
    onError: (e: any) => setErr(e.message),
  });

  function open(id: number) {
    setActiveProject(id);
    navigate(`/projects/${id}`);
  }

  const typeLabel = projectType === 'industrial' ? 'Industrial' : projectType === 'residential' ? 'Residential' : 'All';

  return (
    <div className={styles.page}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.typeTag}>{typeLabel}</span>
          <span className={styles.count}>{filtered.length} project{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        <button className={styles.btnPrimary} onClick={() => setShowNew(true)}>+ New Project</button>
      </div>

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>Project Name</th>
              <th className={styles.th}>Type</th>
              <th className={styles.th}>Address</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Phases</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className={styles.empty}>Loading…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>
                No projects yet. <button className={styles.inlineBtn} onClick={() => setShowNew(true)}>Create the first one →</button>
              </td></tr>
            )}
            {filtered.map((p: any) => (
              <tr key={p.id} className={styles.row} onClick={() => open(p.id)}>
                <td className={styles.td}>
                  <span className={styles.projectName}>{p.name}</span>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.typeBadge} ${p.project_type === 'industrial' ? styles.industrial : styles.residential}`}>
                    {p.project_type}
                  </span>
                </td>
                <td className={`${styles.td} ${styles.muted}`}>{p.address || '—'}</td>
                <td className={styles.td}>
                  <span className={`${styles.statusDot} ${p.status === 'active' ? styles.dotActive : styles.dotInactive}`} />
                  {p.status}
                </td>
                <td className={`${styles.td} ${styles.muted}`}>{p.phase_count ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New project panel */}
      {showNew && (
        <div className={styles.overlay} onClick={() => setShowNew(false)}>
          <div className={styles.panel} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>New Project</span>
              <button className={styles.closeBtn} onClick={() => setShowNew(false)}>×</button>
            </div>
            <div className={styles.panelBody}>
              <label className={styles.fieldLabel}>Project Name</label>
              <input
                className={styles.input}
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. 203010 — Riverside"
                autoFocus
              />
              <label className={styles.fieldLabel}>Address</label>
              <input
                className={styles.input}
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder="Street, City, State"
              />
              <label className={styles.fieldLabel}>Notes</label>
              <textarea
                className={styles.input}
                rows={3}
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional"
              />
              {err && <div className={styles.error}>{err}</div>}
            </div>
            <div className={styles.panelFooter}>
              <button className={styles.btnGhost} onClick={() => setShowNew(false)}>Cancel</button>
              <button
                className={styles.btnPrimary}
                onClick={() => create.mutate()}
                disabled={!form.name.trim() || create.isPending}
              >
                {create.isPending ? 'Creating…' : 'Create Project →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
