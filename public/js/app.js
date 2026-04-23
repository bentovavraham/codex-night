// Main app shell — orange sidebar, warm light content area.

function App() {
  const [user, setUser] = React.useState(null);
  const [bootstrapping, setBootstrapping] = React.useState(true);
  const [project, setProject] = React.useState(null);
  const [view, setView] = React.useState('projects');
  const [projectTab, setProjectTab] = React.useState('dashboard');

  // Glossary drawer
  const [glossaryOpen, setGlossaryOpen] = React.useState(false);

  // Alerts drawer
  const [alertsOpen, setAlertsOpen] = React.useState(false);
  const [alertCount, setAlertCount] = React.useState(0);
  const [pendingContractId, setPendingContractId] = React.useState(null);

  React.useEffect(() => {
    if (!user) return;
    api.getAlerts()
      .then(d => setAlertCount((d.contract_flags || []).length))
      .catch(() => {});
  }, [user]);

  // Drop screen state
  const [showDrop, setShowDrop] = React.useState(false);
  const [dropLabel, setDropLabel] = React.useState(null);
  const [dropAutoFire, setDropAutoFire] = React.useState(false);
  const [pendingProject, setPendingProject] = React.useState(null);

  // Animations toggle — persisted in localStorage
  const [animsOn, setAnimsOn] = React.useState(() => {
    try { return localStorage.getItem('activeacq_anims') !== 'off'; } catch { return true; }
  });
  function toggleAnims() {
    setAnimsOn(v => {
      const next = !v;
      try { localStorage.setItem('activeacq_anims', next ? 'on' : 'off'); } catch {}
      return next;
    });
  }

  React.useEffect(() => {
    api.me()
      .then(u => { setUser(u); window.__userRole = u?.role || 'pm'; })
      .catch(() => { setUser(null); window.__userRole = null; })
      .finally(() => setBootstrapping(false));
  }, []);

  async function logout() {
    try { await api.logout(); } catch {}
    setUser(null); setProject(null); setView('projects');
    setShowDrop(false); setPendingProject(null);
  }

  // Opening a project: always navigate directly — animation is manual-only via the sidebar button
  function openProject(p) {
    setProject(p); setProjectTab('dashboard'); setView('project');
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
    setDropAutoFire(false);
    setShowDrop(false);
  }

  // Manual trigger from the sidebar circle — manual mode (big button, no auto-fire)
  function triggerDrop() {
    setPendingProject(null);
    setDropLabel(null);
    setDropAutoFire(false);
    setShowDrop(true);
  }

  if (bootstrapping) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'var(--bg)', color:'var(--text-3)' }}>
      Loading…
    </div>
  );

  if (!user) return <Login onLoggedIn={u => { setUser(u); setDropAutoFire(false); setDropLabel(null); setShowDrop(true); }} />;

  // Drop screen — login (manual), project open (auto), or sidebar circle (manual)
  if (showDrop) return <DropScreen onEnter={onDropComplete} label={dropLabel} autoFire={dropAutoFire} />;

  const initials = user.name ? user.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '?';

  const projectNavItems = [
    { k: 'dashboard', label: 'Dashboard',  icon: '◈' },
    { k: 'budget',    label: 'Budget',     icon: '◎' },
    { k: 'contracts', label: 'Contracts',  icon: '◻' },
    { k: 'invoices',  label: 'Invoices',   icon: '◈' },
  ];

  function handleGoToContract(projectId, contractId) {
    setAlertsOpen(false);
    api.getProject(projectId).then(proj => {
      setProject(proj);
      setPendingContractId(contractId);
      setProjectTab('contracts');
      setView('project');
    }).catch(() => {});
  }

  return (
    <>
      <ToastContainer />
      <ConfirmDialog />
      <RejectDialog />
      <AlertsDrawer
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        onGoToContract={handleGoToContract}
      />
      <GlossaryDrawer
        open={glossaryOpen}
        onClose={() => setGlossaryOpen(false)}
      />
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

            {/* Alerts */}
            <button className="sidebar-item" onClick={() => setAlertsOpen(true)}
              style={{ position: 'relative' }}>
              <span className="icon">⚠</span> Alerts
              {alertCount > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  minWidth: 20, height: 20, borderRadius: 10,
                  background: '#dc2626', color: '#fff',
                  fontSize: 11, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 5px',
                }}>{alertCount}</span>
              )}
            </button>

            <button className={`sidebar-item ${view === 'by-trade' ? 'active' : ''}`}
              onClick={() => { setView('by-trade'); setProject(null); }}>
              <span className="icon">⊟</span> By Trade
            </button>

            {user.role === 'admin' && (
              <button className={`sidebar-item ${view === 'admin' ? 'active' : ''}`}
                onClick={() => { setView('admin'); setProject(null); }}>
                <span className="icon">⚙</span> Admin
              </button>
            )}
          </nav>

          {/* User footer */}
          <div className="sidebar-footer">
            {/* Animations toggle */}
            <div className="sidebar-anim-toggle" onClick={toggleAnims} title={animsOn ? 'Turn animations off' : 'Turn animations on'}>
              <span className={`sidebar-anim-label${animsOn ? '' : ' off'}`}>
                {animsOn ? 'Animations on' : 'Animations off'}
              </span>
              <div className={`toggle-pill${animsOn ? ' on' : ''}`} />
            </div>

            {/* DROP IT — big circle, only shown when animations are on */}
            {animsOn && (
              <button className="sidebar-drop-circle" onClick={triggerDrop}
                title="Drop it" aria-label="Drop the container">
                <span className="ds-btn-icon">⬇</span>
                <span className="ds-btn-label">DROP IT</span>
              </button>
            )}

            <div className="sidebar-user">
              <div className="sidebar-avatar">{initials}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-role">{user.role}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button className="sidebar-item ghost" style={{ flex: 1 }} onClick={logout}>
                <span className="icon">→</span> Sign out
              </button>
              <button
                onClick={() => setGlossaryOpen(true)}
                title="Financial terms glossary"
                style={{
                  flexShrink: 0,
                  width: 34, height: 34,
                  borderRadius: 7,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(0,0,0,0.15)',
                  color: 'rgba(255,255,255,0.6)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, fontStyle: 'italic',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.28)'; e.currentTarget.style.color = '#fff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.15)'; e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
              >
                ?
              </button>
            </div>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="main-content">
          {view === 'admin' && <Admin onClose={() => setView('projects')} />}
          {view === 'by-trade' && <ByTrade />}
          {view === 'projects' && <ProjectList onOpen={openProject} />}
          {view === 'project' && project && (
            <ProjectView
              project={project}
              tab={projectTab}
              onTabChange={setProjectTab}
              onProjectUpdate={p => setProject(p)}
              initialContractId={pendingContractId}
              onContractOpened={() => setPendingContractId(null)}
            />
          )}
        </main>
      </div>
    </>
  );
}

function ProjectView({ project, tab, onTabChange, onProjectUpdate, initialContractId, onContractOpened }) {
  return (
    <Project
      project={project}
      tab={tab}
      onTabChange={onTabChange}
      onProjectUpdate={onProjectUpdate}
      initialContractId={initialContractId}
      onContractOpened={onContractOpened}
    />
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
