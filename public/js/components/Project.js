// Project view — tab navigation is driven by the sidebar in app.js.

window.Project = function Project({ project, tab, onTabChange, onProjectUpdate, initialContractId, onContractOpened }) {
  const [selectedContractId, setSelectedContractId] = React.useState(initialContractId || null);

  React.useEffect(() => {
    if (initialContractId) setSelectedContractId(initialContractId);
  }, [initialContractId]);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({
    name: project.name,
    description: project.description || '',
    status: project.status,
  });
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateProject(project.id, form);
      toast('Project updated');
      setEditing(false);
      if (onProjectUpdate) onProjectUpdate(updated);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              style={{ fontSize: 20, fontWeight: 700, flex: 1, minWidth: 200 }} autoFocus />
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={{ width: 140 }}>
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
            <button className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => {
              setEditing(false);
              setForm({ name: project.name, description: project.description || '', status: project.status });
            }}>Cancel</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{project.name}</h1>
            <span className={`badge ${project.status}`}>{project.status}</span>
            <button className="ghost" style={{ fontSize: 12, marginLeft: 4 }} onClick={() => setEditing(true)}>Edit</button>
          </div>
        )}

        {editing ? (
          <textarea rows={2} value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Project description"
            style={{ marginTop: 10, width: '100%', maxWidth: 600 }} />
        ) : (
          project.description && (
            <div style={{ marginTop: 6, color: 'var(--text-2)', fontSize: 13 }}>{project.description}</div>
          )
        )}
      </div>

      {/* Tab content */}
      {tab === 'dashboard' && <Dashboard projectId={project.id} onOpenContract={id => { setSelectedContractId(id); onTabChange('contracts'); }} />}
      {tab === 'budget'    && <Budget    projectId={project.id} />}
      {tab === 'contracts' && <Contracts projectId={project.id} initialContractId={selectedContractId} onContractOpened={() => { setSelectedContractId(null); if (onContractOpened) onContractOpened(); }} />}
      {tab === 'invoices'  && <Invoices  projectId={project.id} />}
    </div>
  );
};
