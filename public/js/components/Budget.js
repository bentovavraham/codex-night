// Budget tree view: QB code → contracts → invoices
// Columns: Budget / Contracted / Expected Overage / Uncommitted / Total Exposure

window.Budget = function Budget({ projectId }) {
  const [tree, setTree] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [expanded, setExpanded] = React.useState({});          // qb_code_id → bool
  const [editingUncommitted, setEditingUncommitted] = React.useState(null); // { budget_line_id, value }
  const [showInit, setShowInit] = React.useState(false);
  const [qbCodes, setQbCodes] = React.useState([]);

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

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  async function saveUncommitted(row) {
    const val = Number(editingUncommitted.value);
    if (!Number.isFinite(val)) return;
    try {
      await api.updateUncommitted(projectId, row.budget_line_id, val);
      setEditingUncommitted(null);
      await load();
    } catch (e) { setErr(e.message); }
  }

  if (loading) return <div className="empty">Loading budget…</div>;
  if (err) return <div className="error">{err}</div>;

  if (!tree || tree.codes.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <h2>Budget</h2>
          <button onClick={() => setShowInit(true)}>+ Set Budgets</button>
        </div>
        <div className="empty">
          No budget data yet. Create contracts with QB code allocations and they will appear here automatically. Use <a onClick={() => setShowInit(true)}>Set Budgets</a> to add target amounts.
        </div>
        {showInit && <InitBudgetModal projectId={projectId} codes={qbCodes} existing={[]}
          onClose={() => setShowInit(false)} onSaved={async () => { setShowInit(false); await load(); }} />}
      </div>
    );
  }

  const { codes, totals } = tree;

  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <div className="panel-header" style={{ marginBottom: 0 }}>
        <h2>Budget</h2>
        <button onClick={() => setShowInit(true)}>+ Set Budgets</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 0 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600, color: 'var(--text-2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>QB Code</th>
            <BudgetTH>Budget</BudgetTH>
            <BudgetTH tip="Sum of contract amounts attributed to this QB code">Contracted</BudgetTH>
            <BudgetTH tip="Contracted minus Budget — positive means over budget">Expected Overage</BudgetTH>
            <BudgetTH tip="PM estimate: additional spend not yet under contract (click to edit)">Uncommitted</BudgetTH>
            <BudgetTH tip="Contracted + Uncommitted">Total Exposure</BudgetTH>
          </tr>
        </thead>
        <tbody>
          <TotalsRow totals={totals} />
          {codes.map(row => (
            <React.Fragment key={row.qb_code_id}>
              <QBCodeRow
                row={row}
                isExpanded={!!expanded[row.qb_code_id]}
                onToggle={() => toggleExpand(row.qb_code_id)}
                editingUncommitted={editingUncommitted}
                onEditUncommitted={v => setEditingUncommitted({ budget_line_id: row.budget_line_id, value: String(v) })}
                onUncommittedChange={v => setEditingUncommitted(prev => ({ ...prev, value: v }))}
                onSaveUncommitted={() => saveUncommitted(row)}
                onCancelUncommitted={() => setEditingUncommitted(null)}
                onSetBudget={() => setShowInit(true)}
              />
              {expanded[row.qb_code_id] && row.contracts.map(c => (
                <ContractSubRow key={c.contract_id} contract={c} />
              ))}
              {expanded[row.qb_code_id] && row.contracts.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '6px 12px 6px 40px', color: 'var(--text-3)', fontSize: 12 }}>
                    No contracts linked to this QB code
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      {showInit && <InitBudgetModal projectId={projectId} codes={qbCodes} existing={codes}
        onClose={() => setShowInit(false)} onSaved={async () => { setShowInit(false); await load(); }} />}
    </div>
  );
};

function BudgetTH({ children, tip }) {
  return (
    <th data-tip={tip} style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600, color: 'var(--text-2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}

function TotalsRow({ totals }) {
  const hasBudget = totals.budget > 0;
  const overageColor = !hasBudget ? 'var(--text-3)' : totals.expected_overage > 0 ? 'var(--danger)' : totals.expected_overage < 0 ? 'var(--ok)' : 'var(--text-2)';
  const exposureColor = hasBudget && totals.total_exposure > totals.budget ? 'var(--danger)' : 'var(--text-1)';
  return (
    <tr style={{ background: 'var(--surface-2)', borderBottom: '2px solid var(--border)' }}>
      <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>
        Project Total
      </td>
      <MoneyCell val={totals.budget} bold />
      <MoneyCell val={totals.contracted} bold />
      <MoneyCell val={totals.expected_overage} bold color={overageColor} signed />
      <MoneyCell val={totals.uncommitted} bold />
      <MoneyCell val={totals.total_exposure} bold color={exposureColor} />
    </tr>
  );
}

function QBCodeRow({ row, isExpanded, onToggle, editingUncommitted, onEditUncommitted, onUncommittedChange, onSaveUncommitted, onCancelUncommitted, onSetBudget }) {
  const isEditingThis = editingUncommitted?.budget_line_id === row.budget_line_id;
  const overageColor = row.budget_not_set ? 'var(--text-3)' : row.expected_overage > 0 ? 'var(--danger)' : row.expected_overage < 0 ? 'var(--ok)' : 'var(--text-3)';
  const exposureColor = (!row.budget_not_set && row.total_exposure > row.budget) ? 'var(--danger)' : 'var(--text-1)';
  const indent = (Number(row.level) || 0) * 16;

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <td style={{ padding: '9px 12px', paddingLeft: 12 + indent }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {row.contracts.length > 0 ? (
            <button onClick={onToggle} style={{ fontSize: 11, padding: '2px 6px', lineHeight: 1, minWidth: 24, flexShrink: 0, fontFamily: 'var(--mono)' }}>
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span style={{ width: 30, flexShrink: 0 }} />
          )}
          <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-3)', marginRight: 6 }}>{row.code}</span>
            <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{row.name}</span>
            {row.contracts.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>
                {row.contracts.length} contract{row.contracts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </td>
      {row.budget_not_set ? (
        <td style={{ textAlign: 'right', padding: '9px 12px' }}>
          <span onClick={onSetBudget} style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', borderBottom: '1px dashed var(--accent)', whiteSpace: 'nowrap' }}>
            Set budget →
          </span>
        </td>
      ) : (
        <MoneyCell val={row.budget} />
      )}
      <MoneyCell val={row.contracted} />
      <MoneyCell val={row.expected_overage} color={overageColor} signed />
      <td style={{ textAlign: 'right', padding: '9px 12px', whiteSpace: 'nowrap' }}>
        {isEditingThis ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number" step="0.01"
              value={editingUncommitted.value}
              onChange={e => onUncommittedChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onSaveUncommitted(); if (e.key === 'Escape') onCancelUncommitted(); }}
              autoFocus
              style={{ width: 100, textAlign: 'right', fontSize: 12, padding: '3px 6px' }}
            />
            <button className="primary" onClick={onSaveUncommitted} style={{ fontSize: 11, padding: '3px 8px' }}>✓</button>
            <button onClick={onCancelUncommitted} style={{ fontSize: 11, padding: '3px 8px' }}>✕</button>
          </span>
        ) : (
          <span
            onClick={() => onEditUncommitted(row.uncommitted_estimate)}
            style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 13, color: row.uncommitted_estimate > 0 ? 'var(--text-1)' : 'var(--text-3)', borderBottom: '1px dashed var(--border)' }}
            data-tip="Click to edit PM uncommitted estimate"
          >
            {fmt.money(row.uncommitted_estimate)}
          </span>
        )}
      </td>
      <MoneyCell val={row.total_exposure} color={exposureColor} />
    </tr>
  );
}

function ContractSubRow({ contract }) {
  const earmarked = Number(contract.earmarked_amount) || 0;
  const overageColor = contract.expected_overage > 0 ? 'var(--danger)' : contract.expected_overage < 0 ? 'var(--ok)' : 'var(--text-3)';
  const exposureColor = contract.total_exposure > earmarked && earmarked > 0 ? 'var(--danger)' : 'var(--text-2)';

  return (
    <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
      <td style={{ padding: '7px 12px 7px 56px' }}>
        <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>{contract.vendor_name}</div>
        {contract.description && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{contract.description}</div>
        )}
        {contract.co_total > 0 && (
          <div style={{ fontSize: 11, color: 'var(--accent-2)', marginTop: 1 }}>
            +{fmt.money(contract.co_total)} in approved COs → commitment {fmt.money(contract.commitment)}
          </div>
        )}
        {(contract.tm_total > 0 || contract.exp_total > 0) && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
            T&M {fmt.money(contract.tm_total)} · Expenses {fmt.money(contract.exp_total)}
          </div>
        )}
      </td>
      <MoneyCell val={earmarked} dim />
      <MoneyCell val={contract.total_value} dim />
      <MoneyCell val={contract.expected_overage} color={overageColor} signed dim />
      <td style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 12 }}>—</td>
      <MoneyCell val={contract.total_exposure} color={exposureColor} dim />
    </tr>
  );
}

function MoneyCell({ val, bold, color, signed, dim }) {
  const n = Number(val) || 0;
  const displayColor = color || (dim ? 'var(--text-2)' : 'var(--text-1)');
  const prefix = signed && n > 0 ? '+' : '';
  return (
    <td style={{
      textAlign: 'right',
      padding: '9px 12px',
      fontFamily: 'var(--mono)',
      fontSize: 13,
      fontWeight: bold ? 700 : 500,
      color: displayColor,
      whiteSpace: 'nowrap',
    }}>
      {prefix}{fmt.money(n)}
    </td>
  );
}

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
          <p className="hint">
            Enter a budget amount for each QB code. Leave blank to skip.
            First-time entries set the original amount; updates change the current amount.
          </p>
          <table className="data">
            <thead>
              <tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr>
            </thead>
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
