// Budget tab: editable current_amount with required note, history per line,
// initialize-from-codes modal, and Compare-to-Original toggle.

window.Budget = function Budget({ projectId }) {
  const [rows, setRows] = React.useState([]);
  const [codes, setCodes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showInit, setShowInit] = React.useState(false);
  const [compareOriginal, setCompareOriginal] = React.useState(false);
  const [editing, setEditing] = React.useState(null); // { line, value, note }
  const [historyOpen, setHistoryOpen] = React.useState({}); // lineId -> history[]
  const [err, setErr] = React.useState(null);

  async function load() {
    setLoading(true);
    try {
      const [budget, qb] = await Promise.all([api.getBudget(projectId), api.getQbCodes()]);
      setRows(budget);
      setCodes(qb.flat || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  React.useEffect(() => { load(); }, [projectId]);

  async function toggleHistory(lineId) {
    if (historyOpen[lineId]) {
      const clone = { ...historyOpen }; delete clone[lineId]; setHistoryOpen(clone);
      return;
    }
    try {
      const history = await api.getBudgetHistory(projectId, lineId);
      setHistoryOpen({ ...historyOpen, [lineId]: history });
    } catch (e) { setErr(e.message); }
  }

  async function saveEdit() {
    if (!editing) return;
    const amt = Number(editing.value);
    if (!Number.isFinite(amt)) { setErr('Invalid amount'); return; }
    if (!editing.note || !editing.note.trim()) { setErr('Note required'); return; }
    try {
      await api.updateBudgetLine(projectId, editing.line.id, {
        current_amount: amt, note: editing.note,
      });
      setEditing(null);
      await load();
    } catch (e) { setErr(e.message); }
  }

  if (loading) return <div className="empty">Loading budget…</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Budget</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ width:'auto', display:'flex', alignItems:'center', gap:6 }}>
            <input type="checkbox" style={{ width:'auto' }} checked={compareOriginal}
                   onChange={(e)=>setCompareOriginal(e.target.checked)} />
            <span className="hint">Compare to Original</span>
          </label>
          <button onClick={() => setShowInit(true)}>+ Add/Update Codes</button>
        </div>
      </div>

      {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}

      {rows.length === 0 ? (
        <div className="empty">
          No budget lines yet. <a onClick={() => setShowInit(true)}>Select QB codes</a> to initialize.
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>QB Code</th>
              {compareOriginal && <th className="num">Original</th>}
              <th className="num">Current Amount</th>
              {compareOriginal && <th className="num">Delta</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEditing = editing?.line.id === r.id;
              const delta = Number(r.current_amount) - Number(r.original_amount);
              return (
                <React.Fragment key={r.id}>
                  <tr>
                    <td><span className="code">{r.code}</span> — {r.name}</td>
                    {compareOriginal && <td className="num">{fmt.moneyPrecise(r.original_amount)}</td>}
                    <td className="num">
                      {isEditing ? (
                        <input type="number" step="0.01"
                               value={editing.value}
                               onChange={(e)=>setEditing({...editing, value: e.target.value})}
                               style={{ textAlign:'right', maxWidth: 140, display:'inline-block' }} />
                      ) : fmt.moneyPrecise(r.current_amount)}
                    </td>
                    {compareOriginal && (
                      <td className="num" style={{ color: delta > 0 ? 'var(--ok)' : delta < 0 ? 'var(--danger)' : 'inherit' }}>
                        {delta === 0 ? '—' : (delta > 0 ? '+' : '') + fmt.moneyPrecise(delta)}
                      </td>
                    )}
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <input placeholder="Reason for change (required)"
                                 value={editing.note}
                                 onChange={(e)=>setEditing({...editing, note: e.target.value})}
                                 style={{ maxWidth: 260, display: 'inline-block', marginRight: 8 }} />
                          <button className="primary" onClick={saveEdit}>Save</button>
                          <button onClick={()=>setEditing(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditing({ line: r, value: String(r.current_amount), note: '' })}>Edit</button>
                          <button onClick={() => toggleHistory(r.id)} style={{ marginLeft: 6 }}>
                            {historyOpen[r.id] ? 'Hide history' : 'History'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {historyOpen[r.id] && (
                    <tr>
                      <td colSpan={compareOriginal ? 5 : 3}>
                        <div className="history">
                          {historyOpen[r.id].length === 0 ? (
                            <div className="hint">No changes recorded.</div>
                          ) : historyOpen[r.id].map((h) => (
                            <div key={h.id} className="history-row">
                              <span className="ts">{fmt.datetime(h.changed_at)}</span>
                              <span>
                                <strong>{h.changed_by_name}</strong>
                                &nbsp;changed <em>{fmt.moneyPrecise(h.old_amount)}</em>
                                &nbsp;→ <strong>{fmt.moneyPrecise(h.new_amount)}</strong>
                                {h.note ? <> — {h.note}</> : null}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {showInit && <InitBudgetModal
        projectId={projectId}
        codes={codes}
        existing={rows}
        onClose={() => setShowInit(false)}
        onSaved={async () => { setShowInit(false); await load(); }}
      />}
    </div>
  );
};

function InitBudgetModal({ projectId, codes, existing, onClose, onSaved }) {
  // Pre-populate amounts with existing current_amounts; user can add new codes too.
  const existingByCode = new Map(existing.map((r) => [r.qb_code_id, r.current_amount]));
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
      <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ width: 640 }}>
        <div className="modal-header">
          <strong>Initialize / update budget lines</strong>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="hint">
            Enter a budget amount next to each QB code you want to track. Leave blank to skip.
            First-time entries set the <em>original</em> amount; updates change the <em>current</em> amount.
          </p>
          <table className="data">
            <thead>
              <tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.id}>
                  <td style={{ paddingLeft: 8 + (c.level || 0) * 16 }} className="code">{c.code}</td>
                  <td>{c.name}</td>
                  <td className="num">
                    <input type="number" step="0.01"
                           value={amounts[c.id] ?? ''}
                           onChange={(e)=>setAmounts({ ...amounts, [c.id]: e.target.value })}
                           style={{ textAlign: 'right', maxWidth: 140, display:'inline-block' }} />
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
