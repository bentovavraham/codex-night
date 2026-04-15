// Main app shell: handles auth state and top-level routing between
// the project list and an individual project view.

function App() {
  const [user, setUser] = React.useState(null);
  const [bootstrapping, setBootstrapping] = React.useState(true);
  const [project, setProject] = React.useState(null);

  React.useEffect(() => {
    api.me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setBootstrapping(false));
  }, []);

  async function logout() {
    try { await api.logout(); } catch {}
    setUser(null); setProject(null);
  }

  if (bootstrapping) return <div className="empty" style={{ paddingTop: 120 }}>Loading…</div>;
  if (!user) return <Login onLoggedIn={setUser} />;

  return (
    <>
      <header className="app-header">
        <h1>ActiveAcq</h1>
        <div className="user-info">
          {user.name} · <span className="hint">{user.role}</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </header>
      {project
        ? <Project project={project} onBack={() => setProject(null)} />
        : <ProjectList onOpen={setProject} />}
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
