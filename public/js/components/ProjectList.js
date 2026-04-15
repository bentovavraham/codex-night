window.ProjectList = function ProjectList({ onOpen }) {
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showNew, setShowNew] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [err, setErr] = React.useState(null);

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  React.useEffect(() => { load(); }, []);

  async function createProject(e) {
    e.preventDefault();
    setErr(null);
    try {
      const p = await api.createProject({ name, description });
      setShowNew(false);
      setName(''); setDescription('');
      onOpen(p);
    } catch (e) { setErr(e.message); }
  }

  if (loading) return <div className="empty">Loading projects…</div>;

  return (
    <div className="container">
      <div className="panel">
        <div className="panel-header">
          <h2>Projects</h2>
          <button className="primary" onClick={() => setShowNew(true)}>+ New Project</button>
        </div>
        {projects.length === 0 ? (
          <div className="empty">No projects yet. Create one to get started.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(p)}>
                  <td><strong>{p.name}</strong>{p.description ? <div className="hint">{p.description}</div> : null}</td>
                  <td><span className={`badge ${p.status}`}>{p.status}</span></td>
                  <td>{fmt.date(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={(e)=>e.stopPropagation()}>
            <form onSubmit={createProject}>
              <div className="modal-header">
                <strong>New project</strong>
                <button type="button" onClick={() => setShowNew(false)}>×</button>
              </div>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="full">
                    <label>Name</label>
                    <SmartSearch
                      value={name}
                      onChange={(v) => setName(v)}
                      fetcher={(q) => api.searchCustomers(q)}
                      placeholder="Type to search QB customers, or enter a new project name"
                    />
                  </div>
                  <div className="full">
                    <label>Description</label>
                    <textarea rows={3} value={description} onChange={(e)=>setDescription(e.target.value)} />
                  </div>
                </div>
                {err && <div className="error" style={{marginTop:10}}>{err}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setShowNew(false)}>Cancel</button>
                <button type="submit" className="primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
