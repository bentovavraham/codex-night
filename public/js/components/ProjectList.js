// ProjectList — health dashboard. Each project card shows budget bar,
// health indicator, key financials, and pending counts.

const HEALTH_COLORS = {
  ok:      { dot: '#16a34a', bar: '#16a34a', label: 'OK',      text: '#14532d', bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.25)'  },
  caution: { dot: '#d97706', bar: '#d97706', label: 'CAUTION', text: '#78350f', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.25)'  },
  warning: { dot: '#c4522a', bar: '#c4522a', label: 'WARNING', text: '#7c2d12', bg: 'rgba(196,82,42,0.1)',   border: 'rgba(196,82,42,0.3)'   },
  danger:  { dot: '#dc2626', bar: '#dc2626', label: 'DANGER',  text: '#7f1d1d', bg: 'rgba(220,38,38,0.1)',   border: 'rgba(220,38,38,0.3)'   },
  none:    { dot: '#94a3b8', bar: '#94a3b8', label: 'NO BUDGET', text: '#475569', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' },
};

window.ProjectList = function ProjectList({ onOpen }) {
  const [projects, setProjects] = React.useState([]);
  const [loading, setLoading]   = React.useState(true);
  const [showNew, setShowNew]   = React.useState(false);
  const [name, setName]         = React.useState('');
  const [description, setDescription] = React.useState('');
  const [err, setErr]           = React.useState(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.getProjectsHealth();
      setProjects(data);
    } catch (e) {
      // Fall back to basic list so projects are always visible
      try {
        const data = await api.listProjects();
        setProjects(data);
        setErr('Health data unavailable — showing basic list. (' + e.message + ')');
      } catch (e2) {
        setErr(e2.message);
      }
    } finally { setLoading(false); }
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

  if (loading) return <div className="empty" style={{ paddingTop: 80 }}>Loading projects…</div>;

  const totalPending = projects.reduce((s, p) => s + (Number(p.pending_invoices) || 0) + (Number(p.pending_cos) || 0), 0);

  return (
    <div className="container">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 3, letterSpacing: '-0.02em' }}>Projects</h1>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''}
            {totalPending > 0 && (
              <span style={{
                marginLeft: 10, padding: '1px 7px', borderRadius: 10,
                background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700,
              }}>{totalPending} pending</span>
            )}
          </div>
        </div>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Project</button>
      </div>

      {err && <div className="error" style={{ marginBottom: 16 }}>{err}</div>}

      {projects.length === 0 ? (
        <div className="empty">No projects yet. Create one to get started.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {projects.map(p => <ProjectHealthCard key={p.id} project={p} onOpen={onOpen} />)}
        </div>
      )}

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <form onSubmit={createProject}>
              <div className="modal-header">
                <strong>New project</strong>
                <button type="button" onClick={() => setShowNew(false)}>×</button>
              </div>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="full">
                    <label>Name</label>
                    <SmartSearch value={name} onChange={v => setName(v)}
                      fetcher={q => api.searchCustomers(q)}
                      placeholder="Type to search QB customers, or enter a new name" />
                  </div>
                  <div className="full">
                    <label>Description</label>
                    <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} />
                  </div>
                </div>
                {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
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

function ProjectHealthCard({ project: p, onOpen }) {
  const h = HEALTH_COLORS[p.health] || HEALTH_COLORS.none;
  const earmarked   = Number(p.total_earmarked)   || 0;
  const invoiced    = Number(p.invoiced)           || 0;
  const paid        = Number(p.paid)               || 0;
  const exposure    = Number(p.total_exposure)     || 0;
  const commitment  = Number(p.commitment)         || 0;
  const buffer      = Number(p.buffer);
  const pct         = Number(p.budget_used_pct);

  // Bar segments (as % of earmarked)
  const paidPct       = earmarked > 0 ? Math.min((paid / earmarked) * 100, 100) : 0;
  const invoicedPct   = earmarked > 0 ? Math.min(((invoiced - paid) / earmarked) * 100, 100 - paidPct) : 0;
  const committedPct  = earmarked > 0 ? Math.min(((commitment - invoiced) / earmarked) * 100, 100 - paidPct - invoicedPct) : 0;
  const overflowPct   = earmarked > 0 && exposure > earmarked ? Math.min(((exposure - earmarked) / earmarked) * 100, 15) : 0;

  const pendingTotal = (Number(p.pending_invoices) || 0) + (Number(p.pending_cos) || 0);

  return (
    <div
      onClick={() => onOpen(p)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${h.dot}`,
        borderRadius: 10,
        padding: '18px 22px 16px',
        cursor: 'pointer',
        transition: 'box-shadow 0.14s, border-color 0.14s',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 3px 16px rgba(0,0,0,0.12)'; e.currentTarget.style.borderColor = h.dot; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.borderLeftColor = h.dot; }}
    >
      {/* Top row: health pill + name + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
          padding: '2px 7px', borderRadius: 4,
          background: h.bg, color: h.dot, border: `1px solid ${h.border}`,
          flexShrink: 0,
        }}>{h.label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-1)', flex: 1 }}>
          {p.name}
        </span>
        {pendingTotal > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            background: '#dc2626', color: '#fff', flexShrink: 0,
          }}>{pendingTotal} pending</span>
        )}
        <span className={`badge ${p.status}`} style={{ flexShrink: 0 }}>{p.status}</span>
      </div>

      {p.description && (
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.description}
        </div>
      )}

      {/* Budget bar */}
      {earmarked > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'visible', background: 'var(--border)', position: 'relative' }}>
            {/* Paid — green */}
            {paidPct > 0 && <div style={{ width: `${paidPct}%`, background: '#16a34a', borderRadius: '4px 0 0 4px', transition: 'width 0.4s' }} />}
            {/* Outstanding invoiced — amber */}
            {invoicedPct > 0 && <div style={{ width: `${invoicedPct}%`, background: '#d97706', borderRadius: paidPct === 0 ? '4px 0 0 4px' : 0 }} />}
            {/* Committed not invoiced — terracotta */}
            {committedPct > 0 && <div style={{ width: `${committedPct}%`, background: '#c4522a', opacity: 0.7 }} />}
            {/* Overflow beyond earmark — danger red, extends bar slightly */}
            {overflowPct > 0 && <div style={{
              width: `${overflowPct}%`, background: '#dc2626',
              borderRadius: '0 4px 4px 0',
              boxShadow: '0 0 6px rgba(220,38,38,0.5)',
            }} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--text-3)' }}>
            <span>
              {pct !== null && !isNaN(pct) ? (
                <span style={{ fontWeight: 600, color: h.dot }}>{pct.toFixed(0)}% of budget used</span>
              ) : '—'}
            </span>
            <span>
              {buffer !== null && !isNaN(buffer) ? (
                buffer >= 0
                  ? <span>Buffer: <strong style={{ color: 'var(--ok)' }}>{fmt.money(buffer)}</strong></span>
                  : <span style={{ color: 'var(--danger)', fontWeight: 700 }}>OVER by {fmt.money(Math.abs(buffer))}</span>
              ) : 'No budget set'}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', marginBottom: 14, opacity: 0.5 }} />
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 4 }}>
        {earmarked > 0 && <Stat label="Budget" value={fmt.money(earmarked)} />}
        {exposure > 0  && <Stat label="Total Exposure" value={fmt.money(exposure)} highlight={h.dot} />}
        {invoiced > 0  && <Stat label="Invoiced" value={fmt.money(invoiced)} />}
        {Number(p.active_contracts) > 0 && <Stat label="Contracts" value={p.active_contracts} />}
        {Number(p.pending_invoices) > 0 && <Stat label="Pending inv." value={p.pending_invoices} warn />}
        {Number(p.pending_cos) > 0      && <Stat label="Pending COs" value={p.pending_cos} warn />}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
        Updated {fmt.date(p.updated_at)}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight, warn }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: warn ? 'var(--danger)' : highlight || 'var(--text-1)' }}>{value}</span>
    </div>
  );
}
