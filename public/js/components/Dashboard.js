// Renders the hierarchical budget vs contracted vs invoiced vs paid table.

window.Dashboard = function Dashboard({ projectId }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [expanded, setExpanded] = React.useState({}); // id -> bool
  const [showAll, setShowAll] = React.useState(false);

  async function load() {
    try { setData(await api.getDashboard(projectId)); }
    catch (e) { setErr(e.message); }
  }

  React.useEffect(() => { load(); }, [projectId]);

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="empty">Loading dashboard…</div>;

  function toggle(id) {
    setExpanded((s) => ({ ...s, [id]: !s[id] }));
  }

  // Determine if a subtree has ANY activity worth showing.
  function hasActivity(node) {
    const r = node.rollup;
    if (r.budget_original || r.budget_current || r.contracted || r.approved || r.paid) return true;
    return node.children.some(hasActivity);
  }

  function classifyRow(r) {
    if (r.contracted > 0 && r.approved > r.contracted + 0.01) return 'row-over';
    if (r.budget_current > 0 && r.contracted > r.budget_current + 0.01) return 'row-warn';
    return '';
  }

  function renderRow(node, depth) {
    if (!showAll && !hasActivity(node)) return null;
    const isParent = node.children.length > 0;
    const open = expanded[node.id] !== false; // default expanded
    const r = node.rollup;
    const rowClass = classifyRow(r);
    return (
      <React.Fragment key={node.id}>
        <tr className={`${isParent ? 'parent-row' : ''} ${rowClass}`}>
          <td style={{ paddingLeft: 8 + depth * 20 }}>
            {isParent ? (
              <span className="tree-toggle" onClick={() => toggle(node.id)}>
                {open ? '▾' : '▸'}
              </span>
            ) : <span className="tree-toggle">·</span>}
            <span className="code">{node.code}</span> — {node.name}
          </td>
          <td className="num">{fmt.money(r.budget_original)}</td>
          <td className="num">{fmt.money(r.budget_current)}</td>
          <td className="num">{fmt.money(r.contracted)}</td>
          <td className="num">{fmt.money(r.approved)}</td>
          <td className="num">{fmt.money(r.paid)}</td>
        </tr>
        {isParent && open && node.children.map((c) => renderRow(c, depth + 1))}
      </React.Fragment>
    );
  }

  const totals = data.roots.reduce((acc, n) => {
    const r = n.rollup;
    acc.budget_original += r.budget_original;
    acc.budget_current  += r.budget_current;
    acc.contracted      += r.contracted;
    acc.approved        += r.approved;
    acc.paid            += r.paid;
    return acc;
  }, { budget_original: 0, budget_current: 0, contracted: 0, approved: 0, paid: 0 });

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Project Dashboard</h2>
        <label style={{ width:'auto', display:'flex', alignItems:'center', gap:6 }}>
          <input type="checkbox" style={{ width:'auto' }} checked={showAll}
                 onChange={(e)=>setShowAll(e.target.checked)} />
          <span className="hint">Show all QB codes (including empty)</span>
        </label>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>QB Code</th>
            <th className="num">Budget (Orig)</th>
            <th className="num">Budget (Current)</th>
            <th className="num">Contracted</th>
            <th className="num">Approved</th>
            <th className="num">Paid</th>
          </tr>
        </thead>
        <tbody>
          {data.roots.map((n) => renderRow(n, 0))}
        </tbody>
        <tfoot>
          <tr className="parent-row">
            <td>Totals</td>
            <td className="num">{fmt.money(totals.budget_original)}</td>
            <td className="num">{fmt.money(totals.budget_current)}</td>
            <td className="num">{fmt.money(totals.contracted)}</td>
            <td className="num">{fmt.money(totals.approved)}</td>
            <td className="num">{fmt.money(totals.paid)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="hint" style={{ marginTop: 10 }}>
        Yellow rows = contracted exceeds current budget. Red rows = approved
        invoices exceed contracted. Approved/Paid totals are pro-rated across a
        contract's QB code allocation.
      </div>
    </div>
  );
};
