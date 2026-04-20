// Main app shell — orange sidebar, warm light content area.

function App() {
  const [user, setUser] = React.useState(null);
  const [bootstrapping, setBootstrapping] = React.useState(true);
  const [project, setProject] = React.useState(null);
  const [view, setView] = React.useState('projects');
  const [projectTab, setProjectTab] = React.useState('dashboard');

  // Drop screen state
  // pendingProject: project waiting to open after the animation completes
  const [showDrop, setShowDrop] = React.useState(false);
  const [dropLabel, setDropLabel] = React.useState(null);
  const [pendingProject, setPendingProject] = React.useState(null);

  React.useEffect(() => {
    api.me()
      .then(u => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setBootstrapping(false));
  }, []);

  async function logout() {
    try { await api.logout(); } catch {}
    setUser(null); setProject(null); setView('projects');
    setShowDrop(false); setPendingProject(null);
  }

  // Opening a project always goes through the drop screen
  function openProject(p) {
    setPendingProject(p);
    setDropLabel(p.name.toUpperCase());
    setShowDrop(true);
  }

  // Called when drop animation completes
  function onDropComplete() {
    if (pendingProject) {
      setProject(pendingProject);
      setProjectTab('dashboard');
      setView('project');
      setPendingProject(null);
    }
    setDropLabel(null);
    setShowDrop(false);
  }

  // Manual trigger from the sidebar DROP IT button
  function triggerDrop() {
    setPendingProject(null);
    setDropLabel('SMASH THESE INVOICES IN');
    setShowDrop(true);
  }

  if (bootstrapping) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--bg)', color:'var(--text-3)' }}>
      Loading…
    </div>
  );

  if (!user) return <Login onLoggedIn={u => { setUser(u); setDropLabel(null); setShowDrop(true); }} />;

  // Drop screen — shown on fresh login, on every project open, or manual trigger
  if (showDrop) return <DropScreen onEnter={onDropComplete} label={dropLabel} />;

  const initials = user.name ? user.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '?';

  const projectNavItems = [
    { k: 'dashboard', label: 'Dashboard',  icon: '◈' },
    { k: 'budget',    label: 'Budget',     icon: '◎' },
    { k: 'contracts', label: 'Contracts',  icon: '◻' },
    { k: 'invoices',  label: 'Invoices',   icon: '◈' },
  ];

  return (
    <>
      <ToastContainer />
      <ConfirmDialog />
      <RejectDialog />
      <div className="app-shell">

        {/* ── Sidebar ── */}
        <aside className="sidebar">
          {/* Logo */}
          <div className="sidebar-logo">
            <div className="wordmark">
              <span className="wordmark-active">Active</span>
              <span className="wordmark-sub">— Acquisitions —</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            {view === 'project' && project ? (
              <>
                <button className="sidebar-item ghost" onClick={() => { setView('projects'); setProject(null); }}
                  style={{ marginBottom: 4 }}>
                  <span className="icon">←</span> All Projects
                </button>
                <div className="sidebar-divider" />
                <div style={{ padding: '6px 10px 8px', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {project.name}
                </div>
                {projectNavItems.map(item => (
                  <button key={item.k}
                    className={`sidebar-item ${projectTab === item.k ? 'active' : ''}`}
                    onClick={() => setProjectTab(item.k)}>
                    <span className="icon">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
                <div className="sidebar-divider" />
              </>
            ) : (
              <>
                <button className={`sidebar-item ${view === 'projects' ? 'active' : ''}`}
                  onClick={() => { setView('projects'); setProject(null); }}>
                  <span className="icon">⊞</span> Projects
                </button>
              </>
            )}

            {user.role === 'admin' && (
              <button className={`sidebar-item ${view === 'admin' ? 'active' : ''}`}
                onClick={() => { setView('admin'); setProject(null); }}>
                <span className="icon">⚙</span> Admin
              </button>
            )}
          </nav>

          {/* User footer */}
          <div className="sidebar-footer">
            {/* DROP IT — manual trigger button */}
            <button className="sidebar-drop-btn" onClick={triggerDrop}
              title="Drop it">
              <span className="sidebar-drop-icon">⬇</span>
              DROP IT
            </button>

            <div className="sidebar-user">
              <div className="sidebar-avatar">{initials}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-role">{user.role}</div>
              </div>
            </div>
            <button className="sidebar-item ghost" style={{ width: '100%', marginTop: 4 }} onClick={logout}>
              <span className="icon">→</span> Sign out
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="main-content">
          {view === 'admin' && <Admin onClose={() => setView('projects')} />}
          {view === 'projects' && <ProjectList onOpen={openProject} />}
          {view === 'project' && project && (
            <ProjectView
              project={project}
              tab={projectTab}
              onTabChange={setProjectTab}
              onProjectUpdate={p => setProject(p)}
            />
          )}
        </main>
      </div>
    </>
  );
}

function ProjectView({ project, tab, onTabChange, onProjectUpdate }) {
  return (
    <Project
      project={project}
      tab={tab}
      onTabChange={onTabChange}
      onProjectUpdate={onProjectUpdate}
    />
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
