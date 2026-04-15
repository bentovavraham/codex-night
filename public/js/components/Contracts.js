window.Contracts = function Contracts({ projectId }) {
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [selected, setSelected] = React.useState(null);

  async function load() {
    setLoading(true);
    try { setContracts(await api.listContracts(projectId)); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [projectId]);

  if (selected) {
    return <ContractDetail contractId={selected}
                           onClose={() => { setSelected(null); load(); }} />;
  }

  if (loading) return <div className="empty">Loading contracts…</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Contracts</h2>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Contract</button>
      </div>
      {err && <div className="error">{err}</div>}
      {contracts.length === 0 ? (
        <div className="empty">No contracts yet.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Vendor</th><th>Description</th>
              <th>Date</th>
              <th className="num">Total</th>
              <th className="num">Invoiced</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} style={{ cursor:'pointer' }} onClick={() => setSelected(c.id)}>
                <td><strong>{c.vendor_name}</strong></td>
                <td>{c.description || <span className="hint">—</span>}</td>
                <td>{fmt.date(c.contract_date)}</td>
                <td className="num">{fmt.money(c.total_value)}</td>
                <td className="num">{fmt.money(c.invoiced_amount)}</td>
                <td><span className={`badge ${c.status}`}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && <NewContractModal projectId={projectId}
        onClose={() => setShowNew(false)}
        onSaved={async () => { setShowNew(false); await load(); }} />}
    </div>
  );
};

function NewContractModal({ projectId, onClose, onSaved }) {
  const [codes, setCodes] = React.useState([]);
  const [vendor, setVendor] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [total, setTotal] = React.useState('');
  const [date, setDate] = React.useState('');
  const [ref, setRef] = React.useState('');
  const [file, setFile] = React.useState('');
  const [status, setStatus] = React.useState('draft');
  const [lines, setLines] = React.useState([{ qb_code_id: '', amount: '' }]);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    api.getQbCodes().then((r) => setCodes(r.flat || [])).catch((e)=>setErr(e.message));
  }, []);

  function setLine(i, patch) {
    const n = lines.slice();
    n[i] = { ...n[i], ...patch };
    setLines(n);
  }

  const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const diff = (Number(total) || 0) - sum;

  async function save() {
    setErr(null);
    if (!vendor || !total) { setErr('Vendor and total required'); return; }
    const cleaned = lines
      .filter((l) => l.qb_code_id && l.amount !== '')
      .map((l) => ({ qb_code_id: Number(l.qb_code_id), amount: Number(l.amount) }));
    if (cleaned.length === 0) { setErr('At least one allocation line required'); return; }
    try {
      await api.createContract(projectId, {
        vendor_name: vendor, description, total_value: Number(total),
        contract_date: date || null, reference_number: ref || null, status,
        file_reference: file || null, lines: cleaned,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ width: 720 }}>
        <div className="modal-header">
          <strong>New contract</strong>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div>
              <label>Vendor</label>
              <input value={vendor} onChange={(e)=>setVendor(e.target.value)} />
            </div>
            <div>
              <label>Reference number</label>
              <input value={ref} onChange={(e)=>setRef(e.target.value)} />
            </div>
            <div>
              <label>Total value</label>
              <input type="number" step="0.01" value={total} onChange={(e)=>setTotal(e.target.value)} />
            </div>
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
            </div>
            <div>
              <label>Status</label>
              <select value={status} onChange={(e)=>setStatus(e.target.value)}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label>File reference (placeholder)</label>
              <input value={file} onChange={(e)=>setFile(e.target.value)} placeholder="SharePoint URL (future)" />
            </div>
            <div className="full">
              <label>Description</label>
              <textarea rows={2} value={description} onChange={(e)=>setDescription(e.target.value)} />
            </div>
          </div>

          <h3 style={{ marginTop: 16, fontSize: 14 }}>QB code allocation</h3>
          <table className="data">
            <thead>
              <tr>
                <th>QB Code</th><th className="num">Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select value={l.qb_code_id} onChange={(e)=>setLine(i, { qb_code_id: e.target.value })}>
                      <option value="">— Select —</option>
                      {codes.map((c) => (
                        <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <input type="number" step="0.01" value={l.amount}
                           onChange={(e)=>setLine(i, { amount: e.target.value })}
                           style={{ textAlign: 'right', maxWidth: 140 }} />
                  </td>
                  <td><button onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><button onClick={() => setLines([...lines, { qb_code_id: '', amount: '' }])}>+ Add line</button></td>
                <td className="num"><strong>{fmt.moneyPrecise(sum)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div className="hint" style={{ marginTop: 6 }}>
            Lines must sum to total value.
            {Math.abs(diff) > 0.01 && <span style={{ color: 'var(--danger)' }}> Off by {fmt.moneyPrecise(diff)}.</span>}
          </div>
          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={Math.abs(diff) > 0.01} onClick={save}>Create</button>
        </div>
      </div>
    </div>
  );
}

function ContractDetail({ contractId, onClose }) {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(null);

  async function load() {
    try { setData(await api.getContract(contractId)); }
    catch (e) { setErr(e.message); }
  }
  React.useEffect(() => { load(); }, [contractId]);

  if (err) return <div className="error">{err}</div>;
  if (!data) return <div className="empty">Loading contract…</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{data.vendor_name}</h2>
        <button onClick={onClose}>← Back to contracts</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div className="hint">Status</div>
          <div><span className={`badge ${data.status}`}>{data.status}</span></div>
          <div className="hint" style={{ marginTop: 10 }}>Date</div>
          <div>{fmt.date(data.contract_date)}</div>
          <div className="hint" style={{ marginTop: 10 }}>Reference #</div>
          <div>{data.reference_number || '—'}</div>
          {data.description && <>
            <div className="hint" style={{ marginTop: 10 }}>Description</div>
            <div>{data.description}</div>
          </>}
        </div>
        <div>
          <div className="hint">Total value</div>
          <div><strong>{fmt.moneyPrecise(data.total_value)}</strong></div>
          <div className="hint" style={{ marginTop: 10 }}>Invoiced (approved+)</div>
          <div>{fmt.moneyPrecise(data.invoiced_amount)}</div>
          <div className="hint" style={{ marginTop: 10 }}>Remaining</div>
          <div><strong>{fmt.moneyPrecise(data.remaining_amount)}</strong></div>
        </div>
      </div>

      <h3 style={{ marginTop: 20, fontSize: 14 }}>Allocation</h3>
      <table className="data">
        <thead>
          <tr><th>QB Code</th><th>Name</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.id}>
              <td className="code">{l.code}</td>
              <td>{l.name}</td>
              <td className="num">{fmt.moneyPrecise(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 20, fontSize: 14 }}>Invoices</h3>
      {data.invoices.length === 0 ? (
        <div className="empty" style={{ padding: 20 }}>No invoices against this contract yet.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Invoice #</th><th>Date</th>
              <th className="num">Amount</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((i) => (
              <tr key={i.id}>
                <td>{i.invoice_number}</td>
                <td>{fmt.date(i.invoice_date)}</td>
                <td className="num">{fmt.moneyPrecise(i.amount)}</td>
                <td><span className={`badge ${i.status}`}>{i.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
