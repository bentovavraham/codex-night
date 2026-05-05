import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import { api } from '../api/client';
import styles from './ProjectDetail.module.css';

export default function ProjectDetail() {
  const { projectId } = useParams();
  const id = Number(projectId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { setActivePhase } = useAppStore();

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', notes: '' });
  const [err, setErr] = useState('');

  // Inline rename state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.getProject(id),
    enabled: !!id,
  });

  const { data: phases = [], isLoading: loadingPhases } = useQuery({
    queryKey: ['phases', id],
    queryFn: () => api.listPhases(id),
    enabled: !!id,
  });

  const create = useMutation({
    mutationFn: () => api.createPhase(id, { ...form, phase_number: (phases as any[]).length + 1 }),
    onSuccess: (phase: any) => {
      qc.invalidateQueries({ queryKey: ['phases', id] });
      setActivePhase(phase.id);
      navigate(`/projects/${id}/phases/${phase.id}/budget`);
    },
    onError: (e: any) => setErr(e.message),
  });

  const rename = useMutation({
    mutationFn: ({ phaseId, name }: { phaseId: number; name: string }) =>
      api.updatePhase(phaseId, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['phases', id] });
      setEditingId(null);
    },
  });

  const del = useMutation({
    mutationFn: (phaseId: number) => api.deletePhase(phaseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['phases', id] }),
  });

  function startRename(ph: any, e: React.MouseEvent) {
    e.stopPropagation();
    setEditingId(ph.id);
    setEditingName(ph.name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }

  function commitRename(phaseId: number) {
    const trimmed = editingName.trim();
    if (!trimmed) { setEditingId(null); return; }
    rename.mutate({ phaseId, name: trimmed });
  }

  function deletePhase(ph: any, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${ph.name}"? This cannot be undone.`)) return;
    del.mutate(ph.id);
  }

  function openPhase(phaseId: number) {
    setActivePhase(phaseId);
    navigate(`/projects/${id}/phases/${phaseId}/budget`);
  }

  if (loadingProject) return <div className={styles.loading}>Loading…</div>;

  const p = project as any;

  return (
    <div className={styles.page}>
      {/* Project header */}
      <div className={styles.projectHeader}>
        <div className={styles.projectMeta}>
          <span className={`${styles.typeBadge} ${p?.project_type === 'industrial' ? styles.industrial : styles.residential}`}>
            {p?.project_type}
          </span>
          <h1 className={styles.projectName}>{p?.name}</h1>
          {p?.address && <span className={styles.address}>{p.address}</span>}
        </div>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.sectionLabel}>Phases</span>
          <span className={styles.count}>{(phases as any[]).length} phase{(phases as any[]).length !== 1 ? 's' : ''}</span>
        </div>
        <button className={styles.btnPrimary} onClick={() => setShowNew(true)}>+ New Phase</button>
      </div>

      {/* Phase table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>#</th>
              <th className={styles.th}>Phase Name</th>
              <th className={styles.th}>Status</th>
              <th className={styles.th}>Start</th>
              <th className={styles.th}>End</th>
              <th className={styles.th}>Budgeted</th>
              <th className={styles.th}>Invoiced</th>
              <th className={styles.th}>% Used</th>
              <th className={styles.th} />
            </tr>
          </thead>
          <tbody>
            {(loadingPhases) && (
              <tr><td colSpan={9} className={styles.empty}>Loading…</td></tr>
            )}
            {!loadingPhases && (phases as any[]).length === 0 && (
              <tr><td colSpan={9} className={styles.empty}>
                No phases yet. <button className={styles.inlineBtn} onClick={() => setShowNew(true)}>Add Phase 1 →</button>
              </td></tr>
            )}
            {(phases as any[]).map((ph: any) => {
              const pct = ph.budgeted_total > 0
                ? Math.round((ph.invoiced_total || 0) / ph.budgeted_total * 100)
                : null;
              const isEditing = editingId === ph.id;
              return (
                <tr
                  key={ph.id}
                  className={styles.row}
                  onClick={() => !isEditing && openPhase(ph.id)}
                >
                  <td className={`${styles.td} ${styles.num} ${styles.muted}`}>{ph.phase_number ?? '—'}</td>
                  <td className={styles.td} onClick={e => !isEditing && startRename(ph, e)}>
                    {isEditing ? (
                      <input
                        ref={renameInputRef}
                        className={styles.renameInput}
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={() => commitRename(ph.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitRename(ph.id); }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className={styles.phaseName} title="Click to rename">{ph.name}</span>
                    )}
                  </td>
                  <td className={styles.td}>
                    <span className={`${styles.statusDot} ${styles[`dot_${ph.status}`]}`} />
                    {ph.status}
                  </td>
                  <td className={`${styles.td} ${styles.muted}`}>{ph.start_date ? ph.start_date.slice(0, 10) : '—'}</td>
                  <td className={`${styles.td} ${styles.muted}`}>{ph.end_date ? ph.end_date.slice(0, 10) : '—'}</td>
                  <td className={`${styles.td} ${styles.num} ${styles.right}`}>
                    {ph.budgeted_total ? `$${Number(ph.budgeted_total).toLocaleString('en-US', { minimumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.num} ${styles.right}`}>
                    {ph.invoiced_total ? `$${Number(ph.invoiced_total).toLocaleString('en-US', { minimumFractionDigits: 0 })}` : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.num} ${styles.right} ${pct !== null && pct >= 100 ? styles.over : pct !== null && pct >= 75 ? styles.warn : ''}`}>
                    {pct !== null ? `${pct}%` : '—'}
                  </td>
                  <td className={`${styles.td} ${styles.actionsTd}`}>
                    <button
                      className={styles.deleteBtn}
                      onClick={e => deletePhase(ph, e)}
                      title="Delete phase"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* New Phase panel */}
      {showNew && (
        <div className={styles.overlay} onClick={() => setShowNew(false)}>
          <div className={styles.panel} onClick={e => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>New Phase</span>
              <button className={styles.closeBtn} onClick={() => setShowNew(false)}>×</button>
            </div>
            <div className={styles.panelBody}>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Phase Name</label>
                <input
                  className={styles.input}
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder={`e.g. Phase ${(phases as any[]).length + 1} — Entitlement`}
                  autoFocus
                />
              </div>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Notes</label>
                <textarea
                  className={styles.input}
                  rows={2}
                  value={form.notes}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              {err && <div className={styles.error}>{err}</div>}
            </div>
            <div className={styles.panelFooter}>
              <button className={styles.btnGhost} onClick={() => setShowNew(false)}>Cancel</button>
              <button
                className={styles.btnPrimary}
                onClick={() => create.mutate()}
                disabled={!form.name.trim() || create.isPending}
              >
                {create.isPending ? 'Creating…' : 'Create Phase →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
