// ProjectList — portfolio table. Dense, sortable, drill-down to QB code breakdown.

const HEALTH = {
  ok:      { border: '#16a34a', bg: 'rgba(22,163,74,0.03)',  label: 'OK',        text: '#166534' },
  caution: { border: '#d97706', bg: 'rgba(217,119,6,0.04)',  label: 'CAUTION',   text: '#92400e' },
  warning: { border: '#c4522a', bg: 'rgba(196,82,42,0.04)',  label: 'WARNING',   text: '#9a3412' },
  danger:  { border: '#dc2626', bg: 'rgba(220,38,38,0.05)',  label: 'DANGER',    text: '#991b1b' },
  none:    { border: '#cbd5e1', bg: 'transparent',           label: 'NO BUDGET', text: '#64748b' },
};

window.ProjectList = function ProjectList({ onOpen }) {
  const [projects, setProjects]   = React.useState([]);
  const [loading, setLoading]     = React.useState(true);
  const [err, setErr]             = React.useState(null);
  const [showNew, setShowNew]     = React.useState(false);
  const [newName, setNewName]     = React.useState('');
  const [newDesc, setNewDesc]     = React.useState('');
  const [formErr, setFormErr]     = React.useState(null);
  const [sortCol, setSortCol]     = React.useState('updated_at');
  const [sortDir, setSortDir]     = React.useState('desc');
  const [expanded, setExpanded]   = React.useState({});
  const [treeCache, setTreeCache] = React.useState({});

  async function load() {
    setLoading(true); setErr(null);
    try {
      setProjects(await api.getProjectsHealth());
    } catch (e) {
      try { setProjects(await api.listProjects()); setErr('Health data unavailable — showing basic list.'); }
      catch (e2) { setErr(e2.message); }
    } finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, []);

  async function createProject(e) {
    e.preventDefault(); setFormErr(null);
    try {
      const p = await api.createProject({ name: newName, description: newDesc });
      setShowNew(false); setNewName(''); setNewDesc('');
      onOpen(p);
    } catch (e) { setFormErr(e.message); }
  }

  function toggleExpand(id) {
    const opening = !expanded[id];
    setExpanded(prev => ({ ...prev, [id]: opening }));
    if (opening && !treeCache[id]) {
      setTreeCache(prev => ({ ...prev, [id]: 'loading' }));
      api.getBudgetTree(id)
        .then(t  => setTreeCache(prev => ({ ...prev, [id]: t })))
        .catch(() => setTreeCache(prev => ({ ...prev, [id]: 'error' })));
    }
  }

  function handleSort(col) {
    setSortDir(d => sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'desc');
    setSortCol(col);
  }

  const sorted = React.useMemo(() => [...projects].sort((a, b) => {
    let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    av = Number(av) || 0; bv = Number(bv) || 0;
    return sortDir === 'asc' ? av - bv : bv - av;
  }), [projects, sortCol, sortDir]);

  const firmTotals = React.useMemo(() => projects.reduce((acc, p) => ({
    budget:     acc.budget     + (Number(p.total_earmarked)      || 0),
    contracted: acc.contracted + (Number(p.total_contract_value) || 0),
    co:         acc.co         + (Number(p.co_approved)          || 0),
    tm_exp:     acc.tm_exp     + (Number(p.tm_approved)          || 0) + (Number(p.exp_approved) || 0),
    exposure:   acc.exposure   + (Number(p.total_exposure)       || 0),
    invoiced:   acc.invoiced   + (Number(p.invoiced_fixed)       || 0),
    paid:       acc.paid       + (Number(p.paid)                 || 0),
  }), { budget:0, contracted:0, co:0, tm_exp:0, exposure:0, invoiced:0, paid:0 }), [projects]);

  const totalPending = projects.reduce((s, p) =>
    s + (Number(p.pending_invoices)||0) + (Number(p.pending_cos)||0), 0);

  if (loading) return <div className="empty" style={{ paddingTop: 80 }}>Loading projects…</div>;

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 3, letterSpacing: '-0.02em' }}>Projects</h1>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            {projects.length} project{projects.length !== 1 ? 's' : ''}
            {totalPending > 0 && (
              <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 10, background: '#dc2626', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                {totalPending} pending
              </span>
            )}
          </div>
        </div>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Project</button>
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      {projects.length === 0 ? (
        <div className="empty">No projects yet. Create one to get started.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <PLH left onClick={() => handleSort('name')} active={sortCol==='name'} dir={sortDir}>Project</PLH>
                <PLH onClick={() => handleSort('total_earmarked')} active={sortCol==='total_earmarked'} dir={sortDir} tip="Sum of earmarked amounts on active contracts">Budget</PLH>
                <PLH onClick={() => handleSort('total_contract_value')} active={sortCol==='total_contract_value'} dir={sortDir} tip="Original signed contract value (excluding COs)">Contracted</PLH>
                <PLH onClick={() => handleSort('co_approved')} active={sortCol==='co_approved'} dir={sortDir} tip="Approved change orders">COs</PLH>
                <PLH tip="Approved T&M + expense invoices above fixed contract scope">{"T&M+Exp"}</PLH>
                <PLH onClick={() => handleSort('total_exposure')} active={sortCol==='total_exposure'} dir={sortDir} tip="Contracted + COs + T&M + Expenses = total projected cost">Exposure</PLH>
                <PLH onClick={() => handleSort('budget_used_pct')} active={sortCol==='budget_used_pct'} dir={sortDir} tip="Exposure ÷ internal budget">% Used</PLH>
                <PLH onClick={() => handleSort('invoiced_fixed')} active={sortCol==='invoiced_fixed'} dir={sortDir} tip="Approved fixed invoices billed against contracts">Invoiced</PLH>
                <PLH onClick={() => handleSort('paid')} active={sortCol==='paid'} dir={sortDir} tip="Invoices marked as paid">Paid</PLH>
                <PLH onClick={() => handleSort('buffer')} active={sortCol==='buffer'} dir={sortDir} tip="Budget minus exposure — negative means over budget">Buffer</PLH>
              </tr>
            </thead>
            <tbody>
              {/* Firm-wide totals */}
              <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>
                <td style={{ padding: '9px 10px 9px 34px', fontWeight: 700, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                  All Projects · {projects.length}
                </td>
                <PLM val={firmTotals.budget}     bold muted={firmTotals.budget === 0} />
                <PLM val={firmTotals.contracted} bold />
                <PLM val={firmTotals.co}         bold muted={firmTotals.co === 0} />
                <PLM val={firmTotals.tm_exp}     bold color={firmTotals.tm_exp > 0 ? '#6d28d9' : null} muted={firmTotals.tm_exp === 0} />
                <PLM val={firmTotals.exposure}   bold />
                <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--text-3)' }}>—</td>
                <PLM val={firmTotals.invoiced}   bold />
                <PLM val={firmTotals.paid}       bold color={firmTotals.paid > 0 ? '#16a34a' : null} muted={firmTotals.paid === 0} />
                <td style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--text-3)' }}>—</td>
              </tr>

              {sorted.map(p => (
                <React.Fragment key={p.id}>
                  <PortfolioRow
                    p={p}
                    isExpanded={!!expanded[p.id]}
                    onToggle={() => toggleExpand(p.id)}
                    onOpen={onOpen}
                  />
                  {expanded[p.id] && (
                    <tr>
                      <td colSpan={10} style={{ padding: 0, borderBottom: '2px solid var(--border)' }}>
                        <ExpandedTree tree={treeCache[p.id]} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
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
                    <SmartSearch value={newName} onChange={v => setNewName(v)}
                      fetcher={q => api.searchCustomers(q)}
                      placeholder="Type to search QB customers, or enter a new name" />
                  </div>
                  <div className="full">
                    <label>Description</label>
                    <textarea rows={3} value={newDesc} onChange={e => setNewDesc(e.target.value)} />
                  </div>
                </div>
                {formErr && <div className="error" style={{ marginTop: 10 }}>{formErr}</div>}
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

// ─── Project row ──────────────────────────────────────────────────────────────

function PortfolioRow({ p, isExpanded, onToggle, onOpen }) {
  const h          = HEALTH[p.health] || HEALTH.none;
  const hasBudget  = (Number(p.total_earmarked) || 0) > 0;
  const earmarked  = Number(p.total_earmarked)      || 0;
  const contracted = Number(p.total_contract_value) || 0;
  const co         = Number(p.co_approved)          || 0;
  const tmExp      = (Number(p.tm_approved)||0) + (Number(p.exp_approved)||0);
  const exposure   = Number(p.total_exposure)       || 0;
  const invoiced   = Number(p.invoiced_fixed)       || 0;
  const paid       = Number(p.paid)                 || 0;
  const buffer     = Number(p.buffer);
  const pct        = Number(p.budget_used_pct);
  const pending    = (Number(p.pending_invoices)||0) + (Number(p.pending_cos)||0);

  const rowBg = isExpanded ? '#f5f4f1' : h.bg;

  return (
    <tr style={{
      borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
      borderLeft: `3px solid ${h.border}`,
      background: rowBg,
    }}>
      {/* Name */}
      <td style={{ padding: '8px 10px 8px 10px', minWidth: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <button
            onClick={e => { e.stopPropagation(); onToggle(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', color: 'var(--text-3)', fontSize: 9, lineHeight: 1, flexShrink: 0, borderRadius: 3 }}
            title={isExpanded ? 'Collapse' : 'Expand QB breakdown'}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'nowrap' }}>
              <span
                onClick={() => onOpen(p)}
                style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', cursor: 'pointer', whiteSpace: 'nowrap' }}
                onMouseEnter={e => { e.target.style.color = 'var(--accent)'; e.target.style.textDecoration = 'underline'; }}
                onMouseLeave={e => { e.target.style.color = 'var(--text-1)'; e.target.style.textDecoration = 'none'; }}
              >
                {p.name}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                background: p.status === 'active' ? 'rgba(22,163,74,0.08)' : 'rgba(148,163,184,0.15)',
                color: p.status === 'active' ? '#166534' : '#64748b',
              }}>{p.status}</span>
              {pending > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, background: '#dc2626', color: '#fff', flexShrink: 0 }}>
                  {pending}
                </span>
              )}
            </div>
            {p.description && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 230, marginTop: 1 }}>
                {p.description}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Budget */}
      {hasBudget
        ? <PLM val={earmarked} />
        : <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 11 }}>—</td>}

      {/* Contracted */}
      <PLM val={contracted} muted={contracted === 0} />

      {/* COs */}
      {co > 0
        ? <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: '#92400e', fontWeight: 500, whiteSpace: 'nowrap' }}>+{fmt.money(co)}</td>
        : <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 11 }}>—</td>}

      {/* T&M + Exp */}
      {tmExp > 0
        ? <PLM val={tmExp} color="#6d28d9" />
        : <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 11 }}>—</td>}

      {/* Exposure */}
      <PLM val={exposure} color={hasBudget && exposure > earmarked ? 'var(--danger)' : 'var(--text-1)'} />

      {/* % Used */}
      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {hasBudget && pct != null && !isNaN(pct) ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, color: h.text }}>
              {pct.toFixed(0)}%
            </span>
            <div style={{ width: 48, height: 3, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: h.border, borderRadius: 2 }} />
            </div>
          </div>
        ) : <span style={{ color: 'var(--text-3)', fontSize: 11 }}>—</span>}
      </td>

      {/* Invoiced */}
      <PLM val={invoiced} muted={invoiced === 0} />

      {/* Paid */}
      {paid > 0
        ? <PLM val={paid} color="#16a34a" />
        : <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 11 }}>—</td>}

      {/* Buffer */}
      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {hasBudget ? (
          buffer >= 0
            ? <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#16a34a', fontWeight: 500 }}>{fmt.money(buffer)}</span>
            : <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--danger)', fontWeight: 700 }}>({fmt.money(Math.abs(buffer))})</span>
        ) : <span style={{ color: 'var(--text-3)', fontSize: 11 }}>—</span>}
      </td>
    </tr>
  );
}

// ─── Expanded QB breakdown ────────────────────────────────────────────────────

const PL_COLS = '1fr 82px 88px 82px 88px';

function ExpandedTree({ tree }) {
  if (tree === 'loading') return (
    <div style={{ padding: '14px 24px 14px 36px', fontSize: 12, color: 'var(--text-3)', background: '#f5f4f1' }}>
      Loading QB breakdown…
    </div>
  );
  if (tree === 'error') return (
    <div style={{ padding: '14px 24px 14px 36px', fontSize: 12, color: 'var(--danger)', background: '#f5f4f1' }}>
      Could not load breakdown.
    </div>
  );
  if (!tree || tree.codes.length === 0) return (
    <div style={{ padding: '14px 24px 14px 36px', fontSize: 12, color: 'var(--text-3)', background: '#f5f4f1' }}>
      No QB code data for this project.
    </div>
  );

  const sections = plBuildSections(tree.codes);

  return (
    <div style={{ background: '#f5f4f1', borderTop: '1px solid var(--border)' }}>
      {/* Sub-header */}
      <div style={{ display: 'grid', gridTemplateColumns: PL_COLS, padding: '5px 12px 5px 52px', borderBottom: '1px solid var(--border)' }}>
        {['QB Code', 'Budget', 'Contracted', 'T&M+Exp', 'Spent'].map((h, i) => (
          <span key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i > 0 ? 'right' : 'left' }}>{h}</span>
        ))}
      </div>

      {sections.map(s =>
        s.type === 'section'
          ? <PLSectionBlock key={`s-${s.parentId}`} section={s} />
          : <PLQBBlock key={s.data.qb_code_id} row={s.data} indent={52} />
      )}
    </div>
  );
}

function PLSectionBlock({ section }) {
  const [open, setOpen] = React.useState(true);
  const invoicedFixed = section.total_spent - section.tm_exp_total;
  return (
    <>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'grid', gridTemplateColumns: PL_COLS, padding: '6px 12px 6px 36px', cursor: 'pointer', borderTop: '1px solid var(--border)', background: 'rgba(0,0,0,0.025)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: 'var(--text-3)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)', marginRight: 4, flexShrink: 0 }}>{section.code}</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--text-1)' }}>{section.name}</span>
          <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4 }}>
            · {section.children.length} code{section.children.length !== 1 ? 's' : ''}
            {section.children.reduce((s,r) => s + r.contracts.length, 0) > 0 &&
              ` · ${section.children.reduce((s,r) => s + r.contracts.length, 0)} contract${section.children.reduce((s,r) => s + r.contracts.length, 0) !== 1 ? 's' : ''}`}
          </span>
        </div>
        <PLG val={section.budget}      notSet={section.budget_not_set} bold />
        <PLG val={section.contracted}  bold />
        <PLG val={section.tm_exp_total} color={section.tm_exp_total > 0 ? '#6d28d9' : null} bold />
        <PLG val={section.total_spent}  bold />
      </div>
      {open && section.children.map(row => (
        <PLQBBlock key={row.qb_code_id} row={row} indent={52} />
      ))}
    </>
  );
}

function PLQBBlock({ row, indent }) {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: PL_COLS, padding: `5px 12px 5px ${indent}px`, borderTop: '0.5px solid var(--border)', background: 'rgba(255,255,255,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>{row.code}</span>
          <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
          {row.contracts.length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
              · {row.contracts.length} contract{row.contracts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <PLG val={row.budget}      notSet={row.budget_not_set} />
        <PLG val={row.contracted} />
        <PLG val={row.tm_exp_total} color={row.tm_exp_total > 0 ? '#6d28d9' : null} />
        <PLG val={row.total_spent} />
      </div>
      {row.contracts.map(c => (
        <PLContractBlock key={c.contract_id} c={c} indent={indent + 18} />
      ))}
    </>
  );
}

function PLContractBlock({ c, indent }) {
  const tmExp  = (Number(c.tm_total)||0) + (Number(c.exp_total)||0);
  const dateStr = c.contract_date
    ? new Date(c.contract_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: PL_COLS, padding: `4px 12px 4px ${indent}px`, background: 'rgba(255,255,255,0.55)', borderTop: '0.5px solid rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 9, padding: '1px 4px', borderRadius: 3, background: 'rgba(37,99,235,0.08)', color: '#1e40af', fontWeight: 700, flexShrink: 0 }}>contract</span>
        <span style={{ fontSize: 11, color: 'var(--text-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.vendor_name}</span>
        {dateStr && <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>{dateStr}</span>}
        {c.co_total > 0 && (
          <span style={{ fontSize: 10, color: '#92400e', fontWeight: 600, flexShrink: 0 }}>+{fmt.money(c.co_total)} CO</span>
        )}
      </div>
      <PLG val={null} notSet />
      <PLG val={Number(c.cl_amount)||0} small />
      <PLG val={tmExp} color={tmExp > 0 ? '#6d28d9' : null} small />
      <PLG val={Number(c.total_spent)||0} small />
    </div>
  );
}

// ─── Section builder (mirrors Budget.js) ─────────────────────────────────────

function plBuildSections(codes) {
  const byParent = new Map();
  for (const r of codes) {
    if (r.parent_id) {
      if (!byParent.has(r.parent_id)) byParent.set(r.parent_id, []);
      byParent.get(r.parent_id).push(r);
    }
  }
  const grouped = new Set(codes.filter(r => r.parent_id).map(r => r.qb_code_id));
  const result  = [];

  for (const [parentId, children] of byParent) {
    children.sort((a, b) => (a.code||'').localeCompare(b.code||''));
    const f = children[0];
    result.push({
      type:         'section',
      parentId,
      code:         f.parent_code || `#${parentId}`,
      name:         f.parent_name || '',
      budget:       children.reduce((s, r) => s + r.budget, 0),
      contracted:   children.reduce((s, r) => s + r.contracted, 0),
      tm_exp_total: children.reduce((s, r) => s + r.tm_exp_total, 0),
      total_spent:  children.reduce((s, r) => s + r.total_spent, 0),
      budget_not_set: children.every(r => r.budget_not_set),
      children,
    });
  }
  for (const r of codes) {
    if (!grouped.has(r.qb_code_id) && !byParent.has(r.qb_code_id)) {
      result.push({ type: 'leaf', data: r });
    }
  }
  return result.sort((a, b) => {
    const ac = a.type === 'section' ? a.code : a.data.code;
    const bc = b.type === 'section' ? b.code : b.data.code;
    return (ac||'').localeCompare(bc||'');
  });
}

// ─── Shared primitives ────────────────────────────────────────────────────────

// Table header
function PLH({ children, onClick, tip, left, active, dir }) {
  return (
    <th
      data-tip={tip}
      onClick={onClick}
      style={{
        textAlign: left ? 'left' : 'right',
        padding: '8px 12px',
        fontWeight: 600, fontSize: 10, color: active ? 'var(--text-1)' : 'var(--text-2)',
        textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      {children}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

// Table money cell
function PLM({ val, bold, color, muted }) {
  return (
    <td style={{
      padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap',
      fontFamily: 'var(--mono)', fontSize: 12,
      fontWeight: bold ? 700 : 500,
      color: muted ? 'var(--text-3)' : color || 'var(--text-1)',
    }}>
      {fmt.money(Number(val) || 0)}
    </td>
  );
}

// Grid money cell (inside expanded tree)
function PLG({ val, bold, color, notSet, small }) {
  if (notSet || val === null) {
    return <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-3)', padding: '0 0 0 4px' }}>—</div>;
  }
  const n = Number(val) || 0;
  return (
    <div style={{
      textAlign: 'right', fontFamily: 'var(--mono)',
      fontSize: small ? 11 : 12, fontWeight: bold ? 700 : 500,
      color: color || (n === 0 ? 'var(--text-3)' : 'var(--text-1)'),
      padding: '0 0 0 4px',
    }}>
      {fmt.money(n)}
    </div>
  );
}
