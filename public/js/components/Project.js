// Top-level project view with tabbed navigation.

window.Project = function Project({ project, onBack }) {
  const [tab, setTab] = React.useState('dashboard');
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
        <h1 style={{ margin: 0, fontSize: 20 }}>{project.name}</h1>
        <span className={`badge ${project.status}`}>{project.status}</span>
      </div>
      {project.description && <div className="hint" style={{ marginBottom: 12 }}>{project.description}</div>}

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
