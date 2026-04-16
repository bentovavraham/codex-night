// Top-level project view with tabbed navigation + inline editing.

window.Project = function Project({ project, onBack, onProjectUpdate }) {
  const [tab, setTab] = React.useState('dashboard');
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({ name: project.name, description: project.description || '', status: project.status });
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateProject(project.id, form);
      toast('Project updated');
      setEditing(false);
      if (onProjectUpdate) onProjectUpdate(updated);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  const tabs = [
    { k: 'dashboard', label: 'Dashboard' },
    { k: 'budget',    label: 'Budget' },
    { k: 'contracts', label: 'Contracts' },
    { k: 'invoices',  label: 'Invoices' },
  ];

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
        <a onClick={onBack}>← All projects</a>
        {editing ? (
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            style={{ fontSize: 20, fontWeight: 700, flex: 1 }} autoFocus />
        ) : (
          <h1 style={{ margin: 0, fontSize: 20 }}>{project.name}</h1>
        )}
        {editing ? (
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        ) : (
          <span className={`badge ${project.status}`}>{project.status}</span>
        )}
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => { setEditing(false); setForm({ name: project.name, description: project.description || '', status: project.status }); }}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} style={{ fontSize: 12 }}>Edit</button>
        )}
      </div>

      {editing ? (
        <textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="Project description" style={{ marginBottom: 12, width: '100%' }} />
      ) : (
        project.description && <div className="hint" style={{ marginBottom: 12 }}>{project.description}</div>
      )}

      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.k} className={tab === t.k ? 'active' : ''} onClick={() => setTab(t.k)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <Dashboard projectId={project.id} />}
      {tab === 'budget'    && <Budget    projectId={project.id} />}
      {tab === 'contracts' && <Contracts projectId={project.id} />}
      {tab === 'invoices'  && <Invoices  projectId={project.id} />}
    </div>
  );
};
