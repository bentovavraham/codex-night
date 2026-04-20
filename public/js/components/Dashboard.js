window.Dashboard = function Dashboard({ projectId }) {
  const [summary, setSummary] = React.useState(null);
  const [qbData, setQbData] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [showQB, setShowQB] = React.useState(false);
  const [expanded, setExpanded] = React.useState({});
  const [showAllQB, setShowAllQB] = React.useState(false);

  async function load() {
    try {
      const [s, q] = await Promise.all([
        api.getCostSummary(projectId),
        api.getDashboard(projectId),
      ]);
      setSummary(s); setQbData(q);
    } catch (e) { setErr(e.message); }
  }
  React.useEffect(() => { load(); }, [projectId]);

  if (err) return <div className="error" style={{ padding: 24 }}>{err}</div>;
  if (!summary) return <div className="empty">Loading…</div>;

  const s = summary;
  const hasEarmark = s.earmarked_total > 0;
  const earmarkPct = hasEarmark ? Math.round((s.commitment / s.earmarked_total) * 100) : 0;
  const invoicedPct = s.commitment > 0 ? Math.round((s.invoiced / s.commitment) * 100) : 0;
  const paidPct = s.invoiced > 0 ? Math.round((s.paid / s.invoiced) * 100) : 0;

  // Alert messages
  const alerts = [];
  if (s.cost_creep) alerts.push({ level: 'danger', msg: `Cost creep: commitment ${fmt.money(s.commitment)} exceeds earmark ${fmt.money(s.earmarked_total)} by ${fmt.money(s.commitment - s.earmarked_total)}` });
  if (s.overrun) alerts.push({ level: 'danger', msg: `Overrun: invoiced ${fmt.money(s.invoiced)} exceeds commitment ${fmt.money(s.commitment)}` });
  if (s.pending_co_count > 0) alerts.push({ level: 'warn', msg: `${s.pending_co_count} change order${s.pending_co_count > 1 ? 's' : ''} pending approval — ${fmt.money(s.pending_cos)} at risk` });
  if (s.pending_invoice_count > 0) alerts.push({ level: 'warn', msg: `${s.pending_invoice_count} invoice${s.pending_invoice_count > 1 ? 's' : ''} pending approval — ${fmt.money(s.pending_invoice_amount)}` });

  return (
    <>
      {/* Alert strip */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {alerts.map((a, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 16px', marginBottom: 6, borderRadius: 6,
              background: a.level === 'danger' ? 'rgba(220,55,55,0.12)' : 'rgba(230,160,30,0.12)',
              border: `1px solid ${a.level === 'danger' ? 'rgba(220,55,55,0.4)' : 'rgba(230,160,30,0.4)'}`,
              fontSize: 13,
            }}>
              <span style={{ fontSize: 16 }}>{a.level === 'danger' ? '🔴' : '⚠️'}</span>
              <span style={{ color: a.level === 'danger' ? 'var(--danger)' : 'var(--warn)' }}>{a.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* KPI row */}
      <div className="kpi-row" style={{ marginBottom: 20 }}>
        {hasEarmark && (
          <div className={`kpi-card ${s.cost_creep ? 'danger' : ''}`}>
            <div className="kpi-label">Earmarked</div>
            <div className={`kpi-value ${s.cost_creep ? 'danger' : ''}`}>{fmt.money(s.earmarked_total)}</div>
            <div className="kpi-sub" style={{ color: s.earmark_remaining < 0 ? 'var(--danger)' : 'var(--ok)' }}>
              {s.earmark_remaining >= 0
                ? `${fmt.money(s.earmark_remaining)} remaining`
                : `${fmt.money(Math.abs(s.earmark_remaining))} over`}
            </div>
          </div>
        )}
        <div className={`kpi-card ${s.cost_creep ? 'warn' : ''}`}>
          <div className="kpi-label">Commitment</div>
          <div className={`kpi-value ${s.cost_creep ? 'warn' : ''}`}>{fmt.money(s.commitment)}</div>
          <div className="kpi-sub" style={{ color: 'var(--text-3)' }}>
            {s.contracts_total > 0 && `Contracts ${fmt.money(s.contracts_total)}`}
            {s.approved_cos > 0 && ` + COs ${fmt.money(s.approved_cos)}`}
          </div>
        </div>
        <div className={`kpi-card ${s.overrun ? 'danger' : ''}`}>
          <div className="kpi-label">Invoiced</div>
          <div className={`kpi-value ${s.overrun ? 'danger' : ''}`}>{fmt.money(s.invoiced)}</div>
          <div className="kpi-sub" style={{ color: 'var(--text-3)' }}>
            {s.commitment > 0 ? `${invoicedPct}% of commitment` : ''}
          </div>
        </div>
        <div className="kpi-card ok">
          <div className="kpi-label">Paid</div>
          <div className="kpi-value ok">{fmt.money(s.paid)}</div>
          <div className="kpi-sub" style={{ color: 'var(--text-3)' }}>
            {s.invoiced > 0 ? `${paidPct}% of invoiced` : ''}
          </div>
        </div>
      </div>

      {/* Earmark burn bar */}
      {hasEarmark && (
        <div className="panel" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Earmark Burn</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {earmarkPct}% committed of {fmt.money(s.earmarked_total)} earmarked
            </div>
          </div>
          <BurnBar
            segments={[
              { label: 'Paid', value: s.paid, color: 'var(--ok)' },
              { label: 'Invoiced', value: s.invoiced - s.paid, color: '#4a9eff' },
              { label: 'Committed', value: s.commitment - s.invoiced, color: 'var(--accent)' },
            ]}
            total={s.earmarked_total}
          />
          <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
            {[
              { label: 'Paid', val: s.paid, color: 'var(--ok)' },
              { label: 'Invoiced', val: s.invoiced - s.paid, color: '#4a9eff' },
              { label: 'Committed (uninvoiced)', val: s.commitment - s.invoiced, color: 'var(--accent)' },
              { label: 'Remaining earmark', val: Math.max(0, s.earmark_remaining || 0), color: 'var(--border)' },
            ].map(item => item.val > 0 && (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-2)' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, display: 'inline-block', flexShrink: 0 }} />
                {item.label}: {fmt.money(item.val)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost breakdown */}
      <div className="panel" style={{ padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-2)' }}>Cost Breakdown</div>
        <CostBreakdownRow label="Original contracts" value={s.contracts_total} />
        <CostBreakdownRow label="Approved change orders" value={s.approved_cos}
          sub={s.pending_co_count > 0 ? `+ ${fmt.money(s.pending_cos)} pending` : null} subColor="var(--warn)" />
        <CostBreakdownRow label="T&M (approved)" value={s.tm_approved}
          sub={s.tm_pending > 0 ? `+ ${fmt.money(s.tm_pending)} pending` : null} subColor="var(--warn)" />
        <CostBreakdownRow label="Expenses (approved)" value={s.expense_approved}
          sub={s.expense_pending > 0 ? `+ ${fmt.money(s.expense_pending)} pending` : null} subColor="var(--warn)" />
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>Total Commitment</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: s.cost_creep ? 'var(--danger)' : 'var(--text-1)' }}>{fmt.money(s.commitment)}</span>
        </div>
      </div>

      {/* QB Code Breakdown (collapsible) */}
      {qbData && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <button
            onClick={() => setShowQB(v => !v)}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 18px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderBottom: showQB ? '1px solid var(--border)' : 'none',
            }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>QB Code Breakdown</h2>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{showQB ? '▲ collapse' : '▼ expand'}</span>
          </button>
          {showQB && <QBBreakdown data={qbData} expanded={expanded} setExpanded={setExpanded} showAll={showAllQB} setShowAll={setShowAllQB} />}
        </div>
      )}
    </>
  );
};

function BurnBar({ segments, total }) {
  if (!total) return null;
  const filled = segments.reduce((s, seg) => s + seg.value, 0);
  const overflow = filled > total;
  const base = overflow ? filled : total;
  return (
    <div style={{ height: 18, borderRadius: 4, background: 'var(--border)', overflow: 'hidden', position: 'relative', display: 'flex' }}>
      {segments.map((seg, i) => (
        seg.value > 0 && <div key={i} style={{
          width: `${Math.min((seg.value / base) * 100, 100)}%`,
          background: seg.color, height: '100%',
          transition: 'width 0.4s ease',
        }} title={`${seg.label}: ${fmt.money(seg.value)}`} />
      ))}
    </div>
  );
}

function CostBreakdownRow({ label, value, sub, subColor }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{label}</span>
        {sub && <span style={{ fontSize: 11, color: subColor || 'var(--text-3)', marginLeft: 8 }}>{sub}</span>}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', fontFamily: 'var(--mono)' }}>{fmt.money(value)}</span>
    </div>
  );
}

function QBBreakdown({ data, expanded, setExpanded, showAll, setShowAll }) {
  function toggle(id) { setExpanded(s => ({ ...s, [id]: !s[id] })); }

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
    const open = expanded[node.id] !== false;
    const r = node.rollup;
    const rowClass = classifyRow(r);
    return (
      <React.Fragment key={node.id}>
        <tr className={`${isParent ? 'parent-row' : ''} ${rowClass}`}>
          <td style={{ paddingLeft: 10 + depth * 20 }}>
            {isParent
              ? <span className="tree-toggle" onClick={() => toggle(node.id)}>{open ? '▾' : '▸'}</span>
              : <span className="tree-toggle" style={{ opacity: 0.2 }}>·</span>}
            <span className="code">{node.code}</span>
            <span style={{ color: 'var(--text-2)', marginLeft: 6 }}>{node.name}</span>
          </td>
          <td className="num">{r.budget_current > 0 ? fmt.money(r.budget_current) : <span style={{color:'var(--text-3)'}}>—</span>}</td>
          <td className={`num ${rowClass === 'row-warn' ? 'num-warn' : ''}`}>
            {r.contracted > 0 ? fmt.money(r.contracted) : <span style={{color:'var(--text-3)'}}>—</span>}
          </td>
          <td className={`num ${rowClass === 'row-over' ? 'num-over' : ''}`}>
            {r.approved > 0 ? fmt.money(r.approved) : <span style={{color:'var(--text-3)'}}>—</span>}
          </td>
          <td className="num" style={{ color: r.paid > 0 ? 'var(--ok)' : undefined }}>
            {r.paid > 0 ? fmt.money(r.paid) : <span style={{color:'var(--text-3)'}}>—</span>}
          </td>
        </tr>
        {isParent && open && node.children.map(c => renderRow(c, depth + 1))}
      </React.Fragment>
    );
  }

  const totals = data.roots.reduce((acc, n) => {
    const r = n.rollup;
    acc.budget_current  += r.budget_current;
    acc.contracted      += r.contracted;
    acc.approved        += r.approved;
    acc.paid            += r.paid;
    return acc;
  }, { budget_current: 0, contracted: 0, approved: 0, paid: 0 });

  return (
    <>
      <div style={{ padding: '8px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', fontSize: 12 }}>
          <input type="checkbox" style={{ width: 'auto', accentColor: 'var(--accent)' }}
            checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show all codes
        </label>
      </div>
      <table className="data">
        <thead>
          <tr>
            <th>QB Code</th>
            <th className="num">Budget</th>
            <th className="num">Contracted</th>
            <th className="num">Approved</th>
            <th className="num">Paid</th>
          </tr>
        </thead>
        <tbody>{data.roots.map(n => renderRow(n, 0))}</tbody>
        <tfoot>
          <tr className="parent-row">
            <td style={{ padding: '10px 12px' }}>Totals</td>
            <td className="num">{fmt.money(totals.budget_current)}</td>
            <td className="num">{fmt.money(totals.contracted)}</td>
            <td className="num">{fmt.money(totals.approved)}</td>
            <td className="num" style={{color:'var(--ok)'}}>{fmt.money(totals.paid)}</td>
          </tr>
        </tfoot>
      </table>
    </>
  );
}
