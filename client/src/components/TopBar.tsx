import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../store/appStore';
import type { ProjectType } from '../store/appStore';
import { useUserStore } from '../store/userStore';
import { api } from '../api/client';
import styles from './TopBar.module.css';

export default function TopBar() {
  const navigate = useNavigate();
  const { projectType, activeProjectId, activePhaseId, setProjectType, setActiveProject, setActivePhase } = useAppStore();
  const { user } = useUserStore();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', projectType],
    queryFn: () => api.listProjects(),
    enabled: !!projectType,
  });

  const filteredProjects = projects.filter((p: any) =>
    !projectType || p.project_type === projectType
  );

  const activeProject = filteredProjects.find((p: any) => p.id === activeProjectId);

  const { data: phases = [] } = useQuery({
    queryKey: ['phases', activeProjectId],
    queryFn: () => api.listPhases(activeProjectId!),
    enabled: !!activeProjectId,
  });

  const activePhase = phases.find((p: any) => p.id === activePhaseId);

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value as ProjectType;
    setProjectType(val || null);
    navigate('/projects');
  }

  function handleProjectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = Number(e.target.value);
    if (!id) return;
    setActiveProject(id);
    setActivePhase(null);
    navigate(`/projects/${id}`);
  }

  function handlePhaseChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = Number(e.target.value);
    if (!id) { navigate(`/projects/${activeProjectId}`); return; }
    setActivePhase(id);
    navigate(`/projects/${activeProjectId}/phases/${id}/budget`);
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        {/* Project type */}
        <select
          className={`${styles.ctx} ${styles.ctxType}`}
          value={projectType || ''}
          onChange={handleTypeChange}
        >
          <option value="">Project Type</option>
          <option value="industrial">Industrial</option>
          <option value="residential">Residential</option>
        </select>

        {projectType && (
          <>
            <span className={styles.sep}>›</span>
            <select
              className={styles.ctx}
              value={activeProjectId || ''}
              onChange={handleProjectChange}
            >
              <option value="">{activeProject ? activeProject.name : 'Select project'}</option>
              {filteredProjects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="__new__">+ New project</option>
            </select>
          </>
        )}

        {activeProjectId && (
          <>
            <span className={styles.sep}>›</span>
            <select
              className={styles.ctx}
              value={activePhaseId || ''}
              onChange={handlePhaseChange}
            >
              <option value="">{activePhase ? activePhase.name : 'Select phase'}</option>
              {phases.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="__new__">+ New phase</option>
            </select>
          </>
        )}
      </div>

      <div className={styles.right}>
        <button className={styles.iconBtn} title="Search (⌘K)">⌘K</button>
        <button className={styles.iconBtn} title="Alerts">🔔</button>
        {user && (
          <div className={styles.userChip}>
            <span className={styles.userAvatar}>{user.name[0].toUpperCase()}</span>
            <span className={styles.userName}>{user.name}</span>
          </div>
        )}
      </div>
    </header>
  );
}
