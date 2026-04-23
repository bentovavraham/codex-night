// Budget tab — drill-down view: sections → QB codes → contracts → invoices/COs
// Columns: Budget / Contracted / Expected Overage / Future Commitments / Total Spent

window.Budget = function Budget({ projectId }) {
  const [tree, setTree]         = React.useState(null);
  const [loading, setLoading]   = React.useState(true);
  const [err, setErr]           = React.useState(null);
  const [sectOpen, setSectOpen] = React.useState({});  // parentId → bool (default open)
  const [rowOpen, setRowOpen]   = React.useState({});  // qb_code_id → bool
  const [showInit, setShowInit] = React.useState(false);
  const [qbCodes, setQbCodes]   = React.useState([]);

  async function load() {
    setLoading(true);
    try {
      const [t, qb] = await Promise.all([api.getBudgetTree(projectId), api.getQbCodes()]);
      setTree(t);
      setQbCodes(qb.flat || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  React.useEffect(() => { load(); }, [projectId]);

  if (loading) return <div className="empty">Loading budget…</div>;
  if (err)     return <div className="error">{err}</div>;

  if (!tree || tree.codes.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Budget</h2>
          <button onClick={() => setShowInit(true)}>+ Set Budgets</button>
        </div>
        <div className="empty">
          No budget data yet. Create contracts with QB code allocations to populate this view.
          Use <a onClick={() => setShowInit(true)} style={{ cursor: 'pointer' }}>Set Budgets</a> to add target amounts.
        </div>
        {showInit && <InitBudgetModal projectId={projectId} codes={qbCodes} existing={[]}
          onClose={() => setShowInit(false)} onSaved={async () => { setShowInit(false); await load(); }} />}
      </div>
    );
  }

  const { codes, totals } = tree;
  const sections = buildSections(codes);

  const isSectOpen = id => sectOpen[id] !== false;
  const isRowOpen  = id => !!rowOpen[id];

  function toggleSection(id) {
    setSectOpen(prev => ({ ...prev, [id]: prev[id] === false ? true : false }));
  }
  function toggleRow(id) {
    setRowOpen(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <div className="panel-header" style={{ marginBottom: 8 }}>
        <h2>Budget</h2>
        <button onClick={() => setShowInit(true)}>+ Set Budgets</button>
      </div>

      <SummaryCards totals={totals} />

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <BudgetTH left>Line Item</BudgetTH>
            <BudgetTH tip="Target budget amount for this QB code">Budget</BudgetTH>
            <BudgetTH tip="Signed contract value + approved change orders">Contracted</BudgetTH>
            <BudgetTH tip="Approved T&M + expense invoices above the fixed contract scope">Expected Overage</BudgetTH>
            <BudgetTH tip="PM estimate: additional work not yet under contract">Future Commitments</BudgetTH>
            <BudgetTH tip="Total invoiced to date across all invoice types">Total Spent</BudgetTH>
          </tr>
        </thead>
        <tbody>
          <TotalsRow totals={totals} />
          {sections.map(section => {
            if (section.type === 'section') {
              const sOpen = isSectOpen(section.parentId);
              return (
                <React.Fragment key={`sect-${section.parentId}`}>
                  <SectionHeaderRow
                    section={section}
                    isOpen={sOpen}
                    onToggle={() => toggleSection(section.parentId)}
                    onSetBudget={() => setShowInit(true)}
                  />
                  {sOpen && section.children.map(row => (
                    <React.Fragment key={row.qb_code_id}>
                      <QBCodeRow
                        row={row}
                        isOpen={isRowOpen(row.qb_code_id)}
                        onToggle={() => toggleRow(row.qb_code_id)}
                        onSetBudget={() => setShowInit(true)}
                        projectId={projectId}
                        onReload={load}
                      />
                      {isRowOpen(row.qb_code_id) && row.contracts.map(c => (
                        <ContractRow key={c.contract_id} contract={c} projectId={projectId} />
                      ))}
                      {isRowOpen(row.qb_code_id) && row.contracts.length === 0 && (
                        <tr style={{ background: 'var(--surface-2)' }}>
                          <td colSpan={6} style={{ padding: '6px 12px 6px 64px', color: 'var(--text-3)', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
                            No contracts linked to this QB code
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            }
            const row = section.data;
            return (
              <React.Fragment key={row.qb_code_id}>
                <QBCodeRow
                  row={row}
                  isOpen={isRowOpen(row.qb_code_id)}
                  onToggle={() => toggleRow(row.qb_code_id)}
                  onSetBudget={() => setShowInit(true)}
                  projectId={projectId}
                  onReload={load}
                />
                {isRowOpen(row.qb_code_id) && row.contracts.map(c => (
                  <ContractRow key={c.contract_id} contract={c} projectId={projectId} />
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {showInit && <InitBudgetModal projectId={projectId} codes={qbCodes} existing={codes}
        onClose={() => setShowInit(false)} onSaved={async () => { setShowInit(false); await load(); }} />}
    </div>
  );
};

// ─── Hierarchy builder ────────────────────────────────────────────────────────

function buildSections(codes) {
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
    result.push({
      type:                 'section',
      parentId,
      code:                 f.parent_code || `#${parentId}`,
      name:                 f.parent_name || '',
      budget:               children.reduce((s, r) => s + r.budget, 0),
      contracted:           children.reduce((s, r) => s + r.contracted, 0),
      tm_exp_total:         children.reduce((s, r) => s + r.tm_exp_total, 0),
      uncommitted_estimate: children.reduce((s, r) => s + r.uncommitted_estimate, 0),
      total_exposure:       children.reduce((s, r) => s + r.total_exposure, 0),
      total_spent:          children.reduce((s, r) => s + r.total_spent, 0),
      budget_not_set:       children.every(r => r.budget_not_set),
      budget_delta:         children.reduce((s, r) => s + r.contracted, 0) - children.reduce((s, r) => s + r.budget, 0),
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

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({ totals }) {
  const hasBudget = totals.budget > 0;
  const overBudget = hasBudget && totals.total_exposure > totals.budget;
  const cards = [
    {
      label: 'Total Budget',
      val:   hasBudget ? fmt.money(totals.budget) : '—',
      sub:   hasBudget ? 'original baseline' : 'not yet set',
      color: 'var(--text-1)',
    },
    {
      label: 'Contracted',
      val:   fmt.money(totals.contracted),
      sub:   'signed contracts + approved COs',
      color: 'var(--text-1)',
    },
    {
      label: 'Expected Overage',
      val:   fmt.money(totals.tm_exp_total),
      sub:   'T&M + expenses above contract',
      color: totals.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)',
    },
    {
      label: 'Future Commitments',
      val:   fmt.money(totals.uncommitted),
      sub:   'work not yet contracted',
      color: totals.uncommitted > 0 ? 'var(--accent)' : 'var(--text-3)',
    },
    {
      label: 'Total Exposure',
      val:   fmt.money(totals.total_exposure),
      sub:   hasBudget
        ? (overBudget ? `▲ over by ${fmt.money(totals.total_exposure - totals.budget)}` : `▼ under by ${fmt.money(totals.budget - totals.total_exposure)}`)
        : null,
      color: overBudget ? 'var(--danger)' : hasBudget ? 'var(--ok)' : 'var(--text-1)',
    },
  ];
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
      {cards.map(c => (
        <div key={c.label} style={{ flex: '1 1 140px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: c.color }}>{c.val}</div>
          {c.sub && <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── Table header ─────────────────────────────────────────────────────────────

function BudgetTH({ children, tip, left }) {
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

// ─── Totals row ───────────────────────────────────────────────────────────────

function TotalsRow({ totals }) {
  const hasBudget = totals.budget > 0;
  const spentOver = hasBudget && totals.total_spent > totals.budget;
  return (
    <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>
      <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13 }}>Project Total</td>
      <BCell val={totals.budget} bold placeholder={!hasBudget ? '—' : null} />
      <BCell val={totals.contracted} bold />
      <BCell val={totals.tm_exp_total} bold color={totals.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)'} />
      <BCell val={totals.uncommitted} bold />
      <BCell val={totals.total_spent} bold color={spentOver ? 'var(--danger)' : 'var(--text-1)'} />
    </tr>
  );
}

// ─── Section header row ───────────────────────────────────────────────────────

function SectionHeaderRow({ section, isOpen, onToggle, onSetBudget }) {
  const totalContracts = section.children.reduce((s, r) => s + r.contracts.length, 0);
  const spentOver = !section.budget_not_set && section.total_spent > section.budget;
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
            {totalContracts > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>
                {totalContracts} contract{totalContracts !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </td>
      <BudgetCell val={section.budget} delta={section.budget_delta} notSet={section.budget_not_set}
        onSetBudget={e => { e.stopPropagation(); onSetBudget(); }} bold />
      <BCell val={section.contracted} bold />
      <BCell val={section.tm_exp_total} bold color={section.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)'} />
      <BCell val={section.uncommitted_estimate} bold />
      <BCell val={section.total_spent} bold color={spentOver ? 'var(--danger)' : 'var(--text-1)'} />
    </tr>
  );
}

// ─── QB code row ──────────────────────────────────────────────────────────────

function QBCodeRow({ row, isOpen, onToggle, onSetBudget, projectId, onReload }) {
  const [editing, setEditing]     = React.useState(false);
  const [editVal, setEditVal]     = React.useState(String(row.uncommitted_estimate));
  const [savingUnc, setSavingUnc] = React.useState(false);

  async function saveUncommitted() {
    const val = Number(editVal);
    if (!Number.isFinite(val) || !row.budget_line_id) return;
    setSavingUnc(true);
    try {
      await api.updateUncommitted(projectId, row.budget_line_id, val);
      setEditing(false);
      await onReload();
    } catch (e) { /* silent */ }
    finally { setSavingUnc(false); }
  }

  function handleRowClick(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
    if (row.contracts.length > 0) onToggle();
  }

  const spentOver = !row.budget_not_set && row.total_spent > row.budget;

  return (
    <tr
      onClick={handleRowClick}
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', cursor: row.contracts.length > 0 ? 'pointer' : 'default' }}
    >
      <td style={{ padding: '8px 12px 8px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--text-3)', flexShrink: 0, userSelect: 'none', visibility: row.contracts.length > 0 ? 'visible' : 'hidden' }}>
            {isOpen ? '▾' : '▸'}
          </span>
          <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-3)', marginRight: 5 }}>{row.code}</span>
            <span style={{ fontWeight: 500, color: 'var(--text-1)' }}>{row.name}</span>
            {row.contracts.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>
                {row.contracts.length} contract{row.contracts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </td>

      <BudgetCell val={row.budget} delta={row.budget_delta} notSet={row.budget_not_set} onSetBudget={onSetBudget} />
      <BCell val={row.contracted} />
      <BCell val={row.tm_exp_total} color={row.tm_exp_total > 0 ? '#6d28d9' : 'var(--text-3)'} />

      {/* Future commitments — click to edit */}
      <td style={{ textAlign: 'right', padding: '8px 12px', whiteSpace: 'nowrap' }}>
        {editing ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number" step="0.01"
              value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveUncommitted(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
              style={{ width: 100, textAlign: 'right', fontSize: 12, padding: '2px 5px' }}
            />
            <button className="primary" disabled={savingUnc} onClick={saveUncommitted} style={{ fontSize: 11, padding: '2px 7px' }}>✓</button>
            <button onClick={() => setEditing(false)} style={{ fontSize: 11, padding: '2px 7px' }}>✕</button>
          </span>
        ) : (
          <span
            onClick={e => { e.stopPropagation(); setEditVal(String(row.uncommitted_estimate)); setEditing(true); }}
            data-tip="Click to edit PM estimate of future uncommitted work"
            style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 13, color: row.uncommitted_estimate > 0 ? 'var(--text-1)' : 'var(--text-3)', borderBottom: '1px dashed var(--border)' }}
          >
            {fmt.money(row.uncommitted_estimate)}
          </span>
        )}
      </td>

      <BCell val={row.total_spent} color={spentOver ? 'var(--danger)' : 'var(--text-1)'} />
    </tr>
  );
}

// ─── Contract row (lazy-loads invoices when expanded) ─────────────────────────

function ContractRow({ contract, projectId }) {
  const [open, setOpen]         = React.useState(false);
  const [invoices, setInvoices] = React.useState(null);
  const [loading, setLoading]   = React.useState(false);

  const effective   = contract.commitment;
  const remaining   = Math.max(0, effective - (Number(contract.invoiced_fixed) || 0));
  const totalSpent  = contract.total_spent;
  const hasCharges  = contract.cos.length > 0 || totalSpent > 0;

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
        style={{ background: 'var(--surface-2)', borderBottom: open ? 'none' : '1px solid var(--border)', cursor: 'pointer' }}
      >
        <td colSpan={6} style={{ padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px 9px 52px', gap: 12 }}>
            {/* Left */}
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
            </div>
            {/* Right: 4 stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 100px)', borderLeft: '1px solid var(--border)', flexShrink: 0 }}>
              <ContractStat label="Effective total" val={effective} />
              <ContractStat label="Invoiced against" val={contract.invoiced_fixed} />
              <ContractStat label="T&M posted" val={contract.tm_total} dim={contract.tm_total === 0} />
              <ContractStat label="Remaining" val={remaining} color={remaining > 0 ? '#16a34a' : 'var(--text-3)'} />
            </div>
          </div>
        </td>
      </tr>

      {open && (
        <>
          {/* Charge column headers */}
          <tr style={{ background: '#f9f9f7', borderBottom: '1px solid var(--border)' }}>
            <td colSpan={6} style={{ padding: 0 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 220px 90px', gap: 8, padding: '4px 16px 4px 84px' }}>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Item</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>Amount</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>What it does</span>
                <span style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'right' }}>Status</span>
              </div>
            </td>
          </tr>

          {/* Change order rows */}
          {contract.cos.map(co => (
            <ChargeRow key={`co-${co.id}`}
              badge={{ label: 'CO', bg: 'rgba(234,179,8,0.12)', color: '#92400e' }}
              name={co.co_number || `CO #${co.id}`}
              note={co.description}
              amount={co.amount}
              whatItDoes={co.status === 'approved' ? 'Modifies contract scope / value' : 'Pending approval'}
              whatColor={co.status === 'approved' ? '#92400e' : 'var(--text-3)'}
              status={co.status}
            />
          ))}

          {/* Invoice rows (lazy loaded) */}
          {loading && (
            <tr style={{ background: '#f9f9f7' }}>
              <td colSpan={6} style={{ padding: '8px 84px', fontSize: 12, color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                Loading invoices…
              </td>
            </tr>
          )}
          {invoices && invoices.map(inv => {
            const type = inv.invoice_type || 'fixed';
            const isFixed = type === 'fixed';
            const isTm    = type === 'tm';
            const badge = isFixed
              ? { label: 'invoice',  bg: 'rgba(22,163,74,0.09)',   color: '#166534' }
              : isTm
              ? { label: 'T&M',      bg: 'rgba(37,99,235,0.09)',   color: '#1d4ed8' }
              : { label: 'expense',  bg: 'rgba(124,58,237,0.09)',  color: '#6d28d9' };
            return (
              <ChargeRow key={inv.id}
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
          {invoices && invoices.length === 0 && contract.cos.length === 0 && (
            <tr style={{ background: '#f9f9f7' }}>
              <td colSpan={6} style={{ padding: '8px 84px', fontSize: 12, color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
                No charges recorded yet
              </td>
            </tr>
          )}

          {/* Bottom border */}
          <tr><td colSpan={6} style={{ height: 2, padding: 0, background: 'var(--border)' }} /></tr>
        </>
      )}
    </>
  );
}

// ─── Charge row (invoice or CO inside an expanded contract) ───────────────────

function ChargeRow({ badge, name, note, amount, whatItDoes, whatColor, status }) {
  return (
    <tr style={{ background: '#f9f9f7', borderBottom: '0.5px solid #f0f0ee' }}>
      <td colSpan={6} style={{ padding: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 220px 90px', gap: 8, padding: '7px 16px 7px 84px', alignItems: 'center' }}>
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
            <StatusPill status={status} />
          </div>
        </div>
      </td>
    </tr>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function ContractStat({ label, val, color, dim }) {
  return (
    <div style={{ padding: '3px 10px', borderRight: '1px solid var(--border)', textAlign: 'right' }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 500, color: color || (dim ? 'var(--text-3)' : 'var(--text-1)') }}>
        {fmt.money(Number(val) || 0)}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  const map = {
    paid:             { bg: 'rgba(22,163,74,0.09)',   color: '#166534'  },
    approved:         { bg: 'rgba(37,99,235,0.09)',   color: '#1e40af'  },
    pushed:           { bg: 'rgba(8,145,178,0.09)',   color: '#0e7490'  },
    pending:          { bg: 'rgba(234,179,8,0.10)',   color: '#854d0e'  },
    pm_approved:      { bg: 'rgba(234,179,8,0.10)',   color: '#854d0e'  },
    partner_approved: { bg: 'rgba(234,179,8,0.10)',   color: '#854d0e'  },
    rejected:         { bg: 'rgba(220,38,38,0.09)',   color: '#991b1b'  },
    on_hold:          { bg: 'rgba(124,58,237,0.09)',  color: '#5b21b6'  },
  };
  const s = map[status] || { bg: 'var(--surface-2)', color: 'var(--text-3)' };
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600, background: s.bg, color: s.color }}>
      {(status || '').replace(/_/g, ' ')}
    </span>
  );
}

// Budget cell with "Set budget →" link or amount + delta sub-line
function BudgetCell({ val, delta, notSet, onSetBudget, bold }) {
  const deltaColor = notSet ? 'var(--text-3)' : delta > 0 ? 'var(--danger)' : delta < 0 ? 'var(--ok)' : 'var(--text-3)';
  return (
    <td style={{ textAlign: 'right', padding: '8px 12px', whiteSpace: 'nowrap' }}>
      {notSet ? (
        <span onClick={onSetBudget} style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', borderBottom: '1px dashed var(--accent)' }}>
          Set budget →
        </span>
      ) : (
        <>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: bold ? 700 : 500, color: 'var(--text-1)' }}>
            {fmt.money(val)}
          </div>
          {delta !== 0 && (
            <div style={{ fontSize: 10, color: deltaColor, marginTop: 1 }}>
              {delta > 0 ? '+' : ''}{fmt.money(delta)}
            </div>
          )}
        </>
      )}
    </td>
  );
}

// Simple money cell
function BCell({ val, bold, color, placeholder }) {
  if (placeholder !== undefined && placeholder !== null) {
    return <td style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-3)', fontSize: 13 }}>{placeholder}</td>;
  }
  return (
    <td style={{ textAlign: 'right', padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: bold ? 700 : 500, color: color || 'var(--text-1)', whiteSpace: 'nowrap' }}>
      {fmt.money(Number(val) || 0)}
    </td>
  );
}

// ─── Init budget modal (unchanged) ────────────────────────────────────────────

function InitBudgetModal({ projectId, codes, existing, onClose, onSaved }) {
  const existingByCode = new Map((existing || []).map(r => [r.qb_code_id, r.budget]));
  const [amounts, setAmounts] = React.useState(() => {
    const o = {};
    for (const c of codes) {
      o[c.id] = existingByCode.has(c.id) ? String(existingByCode.get(c.id)) : '';
    }
    return o;
  });
  const [err, setErr] = React.useState(null);

  async function save() {
    const lines = [];
    for (const [id, v] of Object.entries(amounts)) {
      if (v === '' || v == null) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      lines.push({ qb_code_id: Number(id), amount: n });
    }
    if (lines.length === 0) { setErr('Enter at least one amount.'); return; }
    try {
      await api.initBudget(projectId, lines);
      onSaved();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 640 }}>
        <div className="modal-header">
          <strong>Initialize / update budget lines</strong>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="hint">Enter a budget amount for each QB code. Leave blank to skip.</p>
          <table className="data">
            <thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {codes.map(c => (
                <tr key={c.id}>
                  <td style={{ paddingLeft: 8 + (c.level || 0) * 16 }} className="code">{c.code}</td>
                  <td>{c.name}</td>
                  <td className="num">
                    <input type="number" step="0.01"
                      value={amounts[c.id] ?? ''}
                      onChange={e => setAmounts({ ...amounts, [c.id]: e.target.value })}
                      style={{ textAlign: 'right', maxWidth: 140, display: 'inline-block' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
