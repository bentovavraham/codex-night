// Main app shell: handles auth state and top-level routing between
// the project list and an individual project view.

function App() {
  const [user, setUser] = React.useState(null);
  const [bootstrapping, setBootstrapping] = React.useState(true);
  const [project, setProject] = React.useState(null);
  const [view, setView] = React.useState('projects'); // 'projects' | 'admin'

  React.useEffect(() => {
    api.me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setBootstrapping(false));
  }, []);

  async function logout() {
    try { await api.logout(); } catch {}
    setUser(null); setProject(null); setView('projects');
  }

  if (bootstrapping) return <div className="empty" style={{ paddingTop: 120 }}>Loading…</div>;
  if (!user) return <Login onLoggedIn={setUser} />;

  let body;
  if (view === 'admin') {
    body = <Admin onClose={() => setView('projects')} />;
  } else if (project) {
    body = <Project project={project} onBack={() => setProject(null)} />;
  } else {
    body = <ProjectList onOpen={setProject} />;
  }

  return (
    <>
      <ToastContainer />
      <ConfirmDialog />
      <RejectDialog />
      <header className="app-header">
        <h1>ActiveAcq</h1>
        <div className="user-info">
          {user.name} · <span className="hint">{user.role}</span>
          {user.role === 'admin' && view !== 'admin' && (
            <button onClick={() => { setProject(null); setView('admin'); }} style={{ marginLeft: 10 }}>Admin</button>
          )}
          <button onClick={logout}>Sign out</button>
        </div>
      </header>
      {body}
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
