// By Trade — cross-project rollup: QB code → project → contract → invoices
// Columns: Line Item / Projects | Contracted / T&M + Expenses / Total Spent

window.ByTrade = function ByTrade() {
  const [data, setData]           = React.useState(null);
  const [loading, setLoading]     = React.useState(true);
  const [err, setErr]             = React.useState(null);
  const [statusFilter, setStatus] = React.useState('');   // '' = all
  const [sectOpen, setSectOpen]   = React.useState({});   // parentId → bool (default open)
  const [tradeOpen, setTradeOpen] = React.useState({});   // qb_code_id → bool
  const [projOpen, setProjOpen]   = React.useState({});   // `${qbId}-${projId}` → bool

  async function load(status) {
    setLoading(true);
    setErr(null);
    try {
      const filters = {};
      if (status) filters.status = status;
      const d = await api.getByTrade(filters);
      setData(d);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  React.useEffect(() => { load(statusFilter); }, [statusFilter]);

  const isSectOpen  = id  => sectOpen[id]  !== false;
  const isTradeOpen = id  => !!tradeOpen[id];
  const isProjOpen  = key => !!projOpen[key];

  function toggleSect(id)  { setSectOpen(p  => ({ ...p, [id]:  p[id]  === false ? true : false })); }
  function toggleTrade(id) { setTradeOpen(p => ({ ...p, [id]:  !p[id]  })); }
  function toggleProj(key) { setProjOpen(p  => ({ ...p, [key]: !p[key] })); }

  const statusOptions = React.useMemo(() => {
    if (!data) return [];
    return data.projectStatuses || [];
  }, [data]);

  if (err) return <div className="error">{err}</div>;

  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <div className="panel-header" style={{ marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
        <h2>By Trade</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <label style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Project status:</label>
          <select
            value={statusFilter}
            onChange={e => setStatus(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-1)' }}
          >
            <option value="">All projects</option>
            {statusOptions.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="empty">Loading…</div>
      ) : !data || data.codes.length === 0 ? (
        <div className="empty">No contract data found{statusFilter ? ` for status "${statusFilter}"` : ''}.</div>
      ) : (
        <>
          <BTSummaryCards totals={data.totals} />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <BTH left>Line Item</BTH>
                <BTH tip="Number of active projects under this trade">Projects</BTH>
                <BTH tip="Signed contract value + approved change orders">Contracted</BTH>
                <BTH tip="Approved T&M + expense invoices">T&amp;M + Expenses</BTH>
                <BTH tip="Total invoiced to date across all types">Total Spent</BTH>
              </tr>
            </thead>
            <tbody>
              <BTTotalsRow totals={data.totals} />
              {buildTradeSections(data.codes).map(section => {
                if (section.type === 'section') {
                  const sOpen = isSectOpen(section.parentId);
                  return (
                    <React.Fragment key={`sect-${section.parentId}`}>
                      <BTSectionRow
                        section={section}
                        isOpen={sOpen}
                        onToggle={() => toggleSect(section.parentId)}
                      />
                      {sOpen && section.children.map(trade => (
                        <TradeRows
                          key={trade.qb_code_id}
                          trade={trade}
                          isOpen={isTradeOpen(trade.qb_code_id)}
                          onToggleTrade={() => toggleTrade(trade.qb_code_id)}
                          isProjOpen={isProjOpen}
                          onToggleProj={toggleProj}
                          indent={32}
                        />
                      ))}
                    </React.Fragment>
                  );
                }
                const trade = section.data;
                return (
                  <TradeRows
                    key={trade.qb_code_id}
                    trade={trade}
                    isOpen={isTradeOpen(trade.qb_code_id)}
                    onToggleTrade={() => toggleTrade(trade.qb_code_id)}
                    isProjOpen={isProjOpen}
                    onToggleProj={toggleProj}
                    indent={12}
                  />
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

// ─── Hierarchy builder (mirrors Budget.js buildSections) ──────────────────────

function buildTradeSections(codes) {
  const childrenByParent = new Map();
  for (const row of codes) {
    if (row.parent_id) {
      if (!childrenByParent.has(row.parent_id)) childrenByParent.set(row.parent_id, []);
      childrenByParent.get(row.parent_id).push(row);
    }
  }
  const groupedIds = new Set(codes.filter(r => r.parent_id).map(r => r.qb_code_id));
  const result = [];

  for (const [parentId, children] of childrenByParent) {
    children.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    const f = children[0];
    const projectSet = new Set(children.flatMap(c => c.projects.map(p => p.project_id)));
    result.push({
      type:         'section',
      parentId,
      code:         f.parent_code || `#${parentId}`,
      name:         f.parent_name || '',
      project_count: projectSet.size,
      contracted:   children.reduce((s, r) => s + r.contracted,    0),
      tm_exp_total: children.reduce((s, r) => s + r.tm_exp_total,  0),
      total_spent:  children.reduce((s, r) => s + r.total_spent,   0),
      children,
    });
  }
  for (const row of codes) {
    if (!groupedIds.has(row.qb_code_id) && !childrenByParent.has(row.qb_code_id)) {
      result.push({ type: 'leaf', data: row });
    }
  }
  result.sort((a, b) => {
    const ac = a.type === 'section' ? a.code : a.data.code;
    const bc = b.type === 'section' ? b.code : b.data.code;
    return (ac || '').localeCompare(bc || '');
  });
  return result;
}

// ─── Trade row + its project/contract children ────────────────────────────────

function TradeRows({ trade, isOpen, onToggleTrade, isProjOpen, onToggleProj, indent }) {
  const projectCount = trade.projects.length;
  return (
    <>
      <tr
        onClick={onToggleTrade}
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', cursor: projectCount > 0 ? 'pointer' : 'default' }}
      >
        <td style={{ padding: `8px 12px 8px ${indent}px` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, userSelect: 'none', visibility: projectCount > 0 ? 'visible' : 'hidden' }}>
              {isOpen ? '▾' : '▸'}
            </span>
            <div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)', marginRight: 5 }}>{trade.code}</span>
              <span style={{ fontWeight: 500, color: 'var(--text-1)' }}>{trade.name}</span>
            </div>
          </div>
        </td>
        <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-3)', fontSize: 12 }}>
          {projectCount > 0 ? `${projectCount} project${projectCount !== 1 ? 's' : ''}` : '—'}
        </td>
        <BTMoney val={trade.contracted} />
        <BTMoney val={trade.tm_exp_total} color={trade.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)'} />
        <BTMoney val={trade.total_spent} />
      </tr>

      {isOpen && trade.projects.map(proj => {
        const projKey = `${trade.qb_code_id}-${proj.project_id}`;
        const pOpen   = isProjOpen(projKey);
        return (
          <React.Fragment key={projKey}>
            <BTProjectRow
              proj={proj}
              isOpen={pOpen}
              onToggle={() => onToggleProj(projKey)}
            />
            {pOpen && proj.contracts.map(c => (
              <BTContractRow key={c.contract_id} contract={c} projectId={proj.project_id} />
            ))}
            {pOpen && proj.contracts.length === 0 && (
              <tr style={{ background: 'var(--surface-2)' }}>
                <td colSpan={5} style={{ padding: '6px 12px 6px 96px', color: 'var(--text-3)', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
                  No contracts
                </td>
              </tr>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// ─── Project sub-row ──────────────────────────────────────────────────────────

function BTProjectRow({ proj, isOpen, onToggle }) {
  const contractCount = proj.contracts.length;
  return (
    <tr
      onClick={onToggle}
      style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
    >
      <td style={{ padding: '7px 12px 7px 52px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, userSelect: 'none' }}>
            {isOpen ? '▾' : '▸'}
          </span>
          <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: statusBg(proj.project_status), color: statusColor(proj.project_status), fontWeight: 700, flexShrink: 0 }}>
            {proj.project_status || 'unknown'}
          </span>
          <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-1)' }}>{proj.project_name}</span>
          {contractCount > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>
              · {contractCount} contract{contractCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </td>
      <td style={{ textAlign: 'right', padding: '7px 12px', color: 'var(--text-3)', fontSize: 12 }}>—</td>
      <BTMoney val={proj.contracted} />
      <BTMoney val={proj.tm_exp_total} color={proj.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)'} />
      <BTMoney val={proj.total_spent} />
    </tr>
  );
}

function statusBg(s) {
  if (s === 'active')   return 'rgba(22,163,74,0.09)';
  if (s === 'closed')   return 'rgba(148,163,184,0.15)';
  return 'rgba(234,179,8,0.10)';
}
function statusColor(s) {
  if (s === 'active')   return '#166534';
  if (s === 'closed')   return '#64748b';
  return '#854d0e';
}

// ─── Contract row (same lazy-load pattern as Budget.js) ───────────────────────

function BTContractRow({ contract, projectId }) {
  const [open, setOpen]         = React.useState(false);
  const [invoices, setInvoices] = React.useState(null);
  const [loading, setLoading]   = React.useState(false);

  const effective  = contract.commitment;
  const remaining  = Math.max(0, effective - (Number(contract.invoiced_fixed) || 0));

  async function toggle() {
    if (!open && invoices === null) {
      setLoading(true);
      try {
        const inv = await api.listInvoices(projectId, { contract_id: String(contract.contract_id) });
        setInvoices(inv);
      } catch (e) { setInvoices([]); }
      finally { setLoading(false); }
    }
    setOpen(o => !o);
  }

  const dateStr = contract.contract_date
    ? new Date(contract.contract_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <>
      <tr
        onClick={toggle}
        style={{ background: '#f4f4f2', borderBottom: open ? 'none' : '1px solid var(--border)', cursor: 'pointer' }}
      >
        <td colSpan={5} style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px 9px 72px', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, flexWrap: 'wrap', minWidth: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, userSelect: 'none' }}>{open ? '▾' : '▸'}</span>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(37,99,235,0.09)', color: '#1e40af', fontWeight: 700, flexShrink: 0 }}>contract</span>
              <strong style={{ fontSize: 12, color: 'var(--text-1)', flexShrink: 0 }}>{contract.vendor_name}</strong>
              {dateStr && <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>· signed {dateStr}</span>}
              <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>· original {fmt.money(contract.total_value)}</span>
              {contract.co_total > 0 && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(234,179,8,0.12)', color: '#92400e', fontWeight: 600, flexShrink: 0 }}>
                  +{fmt.money(contract.co_total)} CO
                </span>
              )}
              {contract.contract_status === 'closed' && (
                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(148,163,184,0.15)', color: '#64748b', fontWeight: 600, flexShrink: 0 }}>closed</span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 100px)', borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
              <BTStat label="Effective total" val={effective} />
              <BTStat label="Invoiced against" val={contract.invoiced_fixed} />
              <BTStat label="T&M posted" val={contract.tm_total} dim={contract.tm_total === 0} />
              <BTStat label="Remaining" val={remaining} color={remaining > 0 ? '#16a34a' : 'var(--text-3)'} />
            </div>
          </div>
        </td>
      </tr>

      {open && (
        <>
          <tr style={{ background: '#f9f9f7', borderBottom: '1px solid var(--border)' }}>
            <td colSpan={5} style={{ padding: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 220px 90px', gap: 8, padding: '4px 16px 4px 104px' }}>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Item</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>Amount</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>What it does</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>Status</span>
              </div>
            </td>
          </tr>

          {(contract.cos || []).map(co => (
            <BTChargeRow key={`co-${co.id}`}
              badge={{ label: 'CO', bg: 'rgba(234,179,8,0.12)', color: '#92400e' }}
              name={co.co_number || `CO #${co.id}`}
              note={co.description}
              amount={co.amount}
              whatItDoes={co.status === 'approved' ? 'Modifies contract scope / value' : 'Pending approval'}
              whatColor={co.status === 'approved' ? '#92400e' : 'var(--text-3)'}
              status={co.status}
            />
          ))}

          {loading && (
            <tr style={{ background: '#f9f9f7' }}>
              <td colSpan={5} style={{ padding: '8px 104px', fontSize: 12, color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                Loading invoices…
              </td>
            </tr>
          )}
          {invoices && invoices.map(inv => {
            const type    = inv.invoice_type || 'fixed';
            const isFixed = type === 'fixed';
            const isTm    = type === 'tm';
            const badge   = isFixed
              ? { label: 'invoice', bg: 'rgba(22,163,74,0.09)',  color: '#166534' }
              : isTm
              ? { label: 'T&M',    bg: 'rgba(37,99,235,0.09)',  color: '#1d4ed8' }
              : { label: 'expense',bg: 'rgba(124,58,237,0.09)', color: '#6d28d9' };
            return (
              <BTChargeRow key={inv.id}
                badge={badge}
                name={inv.invoice_number}
                note={!isFixed ? 'Additional charge, above contract scope' : null}
                amount={inv.amount}
                whatItDoes={isFixed ? 'Bills against contract amount' : isTm ? 'T&M — does not erode contract' : 'Expense — does not erode contract'}
                whatColor={isFixed ? '#16a34a' : '#94a3b8'}
                status={inv.status}
              />
            );
          })}
          {invoices && invoices.length === 0 && (contract.cos || []).length === 0 && (
            <tr style={{ background: '#f9f9f7' }}>
              <td colSpan={5} style={{ padding: '8px 104px', fontSize: 12, color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                No charges recorded yet
              </td>
            </tr>
          )}

          <tr><td colSpan={5} style={{ height: 2, padding: 0, background: 'var(--border)' }} /></tr>
        </>
      )}
    </>
  );
}

// ─── Charge row ───────────────────────────────────────────────────────────────

function BTChargeRow({ badge, name, note, amount, whatItDoes, whatColor, status }) {
  return (
    <tr style={{ background: '#f9f9f7', borderBottom: '0.5px solid #f0f0ee' }}>
      <td colSpan={5} style={{ padding: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 220px 90px', gap: 8, padding: '7px 16px 7px 104px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, fontWeight: 600, background: badge.bg, color: badge.color, flexShrink: 0 }}>
              {badge.label}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>{name}</span>
            {note && <span style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note}</span>}
          </div>
          <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>
            {fmt.money(Number(amount) || 0)}
          </div>
          <div style={{ textAlign: 'right', fontSize: 11, color: whatColor }}>
            {whatItDoes}
          </div>
          <div style={{ textAlign: 'right' }}>
            <BTStatusPill status={status} />
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function BTSummaryCards({ totals }) {
  const cards = [
    {
      label: 'Total Contracted',
      val:   fmt.money(totals.contracted),
      sub:   'across all projects + approved COs',
      color: 'var(--text-1)',
    },
    {
      label: 'T&M + Expenses',
      val:   fmt.money(totals.tm_exp_total),
      sub:   'approved, above fixed contract scope',
      color: totals.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)',
    },
    {
      label: 'Total Spent',
      val:   fmt.money(totals.total_spent),
      sub:   'all approved invoices to date',
      color: 'var(--text-1)',
    },
  ];
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
      {cards.map(c => (
        <div key={c.label} style={{ flex: '1 1 160px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: c.color }}>{c.val}</div>
          {c.sub && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Totals row ───────────────────────────────────────────────────────────────

function BTTotalsRow({ totals }) {
  return (
    <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>
      <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13 }}>All Trades</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)' }}>—</td>
      <BTMoney val={totals.contracted} bold />
      <BTMoney val={totals.tm_exp_total} bold color={totals.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)'} />
      <BTMoney val={totals.total_spent} bold />
    </tr>
  );
}

// ─── Section header row ───────────────────────────────────────────────────────

function BTSectionRow({ section, isOpen, onToggle }) {
  return (
    <tr
      onClick={onToggle}
      style={{ background: 'var(--surface-2)', borderTop: '2px solid var(--border)', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
    >
      <td style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, userSelect: 'none' }}>
            {isOpen ? '▾' : '▸'}
          </span>
          <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)', marginRight: 6 }}>{section.code}</span>
            <span style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 13 }}>{section.name}</span>
            {section.project_count > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>
                {section.project_count} project{section.project_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </td>
      <td style={{ textAlign: 'right', padding: '10px 12px', color: 'var(--text-3)', fontSize: 12 }}>
        {section.children.length} code{section.children.length !== 1 ? 's' : ''}
      </td>
      <BTMoney val={section.contracted} bold />
      <BTMoney val={section.tm_exp_total} bold color={section.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)'} />
      <BTMoney val={section.total_spent} bold />
    </tr>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function BTH({ children, tip, left }) {
  return (
    <th data-tip={tip} style={{
      textAlign: left ? 'left' : 'right', padding: '8px 12px',
      fontWeight: 600, color: 'var(--text-2)', fontSize: 11,
      textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function BTMoney({ val, bold, color }) {
  return (
    <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: bold ? 700 : 500, color: color || 'var(--text-1)', whiteSpace: 'nowrap' }}>
      {fmt.money(Number(val) || 0)}
    </td>
  );
}

function BTStat({ label, val, color, dim }) {
  return (
    <div style={{ padding: '3px 10px', borderRight: '1px solid var(--border)', textAlign: 'right' }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 500, color: color || (dim ? 'var(--text-3)' : 'var(--text-1)') }}>
        {fmt.money(Number(val) || 0)}
      </div>
    </div>
  );
}

function BTStatusPill({ status }) {
  const map = {
    paid:             { bg: 'rgba(22,163,74,0.09)',  color: '#166534' },
    approved:         { bg: 'rgba(37,99,235,0.09)',  color: '#1e40af' },
    pushed:           { bg: 'rgba(8,145,178,0.09)',  color: '#0e7490' },
    pending:          { bg: 'rgba(234,179,8,0.10)',  color: '#854d0e' },
    pm_approved:      { bg: 'rgba(234,179,8,0.10)',  color: '#854d0e' },
    partner_approved: { bg: 'rgba(234,179,8,0.10)',  color: '#854d0e' },
    rejected:         { bg: 'rgba(220,38,38,0.09)',  color: '#991b1b' },
    on_hold:          { bg: 'rgba(124,58,237,0.09)', color: '#5b21b6' },
  };
  const s = map[status] || { bg: 'var(--surface-2)', color: 'var(--text-3)' };
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600, background: s.bg, color: s.color }}>
      {(status || '').replace(/_/g, ' ')}
    </span>
  );
}
