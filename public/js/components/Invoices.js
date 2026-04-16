window.Invoices = function Invoices({ projectId }) {
  const [invoices, setInvoices] = React.useState([]);
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  const [view, setView] = React.useState('all'); // 'all' | 'pending'
  const [filter, setFilter] = React.useState({ status: '', contract_id: '', vendor: '', sort: '' });

  async function load() {
    setLoading(true);
    try {
      const f = view === 'pending' ? { ...filter, status: 'pending' } : filter;
      const [inv, con] = await Promise.all([api.listInvoices(projectId, f), api.listContracts(projectId)]);
      setInvoices(inv); setContracts(con);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [projectId, filter.status, filter.contract_id, filter.vendor, filter.sort, view]);

  async function action(fn, id, ...args) {
    try { await fn(id, ...args); await load(); } catch (e) { setErr(e.message); }
  }

  if (editingId) {
    return <InvoiceEdit invoiceId={editingId} projectId={projectId} contracts={contracts}
                        onClose={() => { setEditingId(null); load(); }} />;
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Invoices</h2>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Invoice</button>
      </div>

      {/* View toggle */}
      <div className="tabs" style={{ marginBottom: 8 }}>
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All invoices</button>
        <button className={view === 'pending' ? 'active' : ''} onClick={() => setView('pending')}>
          Needs approval ({invoices.filter(i => i.status === 'pending').length || '…'})
        </button>
      </div>

      {view === 'all' && (
        <div className="toolbar">
          <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} style={{ width: 130 }}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option><option value="approved">Approved</option>
            <option value="rejected">Rejected</option><option value="pushed">Pushed</option><option value="paid">Paid</option>
          </select>
          <select value={filter.contract_id} onChange={e => setFilter({ ...filter, contract_id: e.target.value })} style={{ width: 220 }}>
            <option value="">All contracts</option>
            <option value="none">No contract (standalone)</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)}</option>)}
          </select>
          <input placeholder="Vendor search" value={filter.vendor} onChange={e => setFilter({ ...filter, vendor: e.target.value })} style={{ width: 180 }} />
          <select value={filter.sort} onChange={e => setFilter({ ...filter, sort: e.target.value })} style={{ width: 130 }}>
            <option value="">Sort: Date</option><option value="vendor">Sort: Vendor</option>
            <option value="amount">Sort: Amount</option><option value="status">Sort: Status</option>
          </select>
        </div>
      )}

      {err && <div className="error">{err}</div>}
      {loading ? <div className="empty">Loading…</div>
       : invoices.length === 0 ? <div className="empty">No invoices match these filters.</div>
       : (
        <table className="data">
          <thead><tr>
            <th>Invoice #</th><th>Vendor</th><th>Contract</th><th>Date</th>
            <th className="num">Amount</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            {invoices.map(i => (
              <tr key={i.id}>
                <td>
                  {i.invoice_number}
                  {i.file_reference && <> · <a href={`/api/files/${encodeURIComponent(i.file_reference)}`} target="_blank" title="View PDF">📄</a></>}
                </td>
                <td>{i.vendor_name}</td>
                <td>{i.contract_id ? (i.contract_vendor || `#${i.contract_id}`) : <span className="hint">standalone</span>}</td>
                <td>{fmt.date(i.invoice_date)}</td>
                <td className="num">{fmt.moneyPrecise(i.amount)}</td>
                <td><span className={`badge ${i.status}`}>{i.status}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => setEditingId(i.id)} style={{ marginRight: 6 }}>Edit</button>
                  {i.status === 'pending' && <>
                    <button className="primary" onClick={() => action(api.approveInvoice, i.id)}>Approve</button>
                    <button className="danger" style={{ marginLeft: 4 }} onClick={() => action(api.rejectInvoice, i.id)}>Reject</button>
                  </>}
                  {i.status === 'approved' && <button onClick={() => action(api.markPushed, i.id)}>Push</button>}
                  {(i.status === 'approved' || i.status === 'pushed') && <button style={{ marginLeft: 4 }} onClick={() => action(api.markPaid, i.id, null)}>Paid</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && <NewInvoiceModal projectId={projectId} contracts={contracts}
        onClose={() => setShowNew(false)} onSaved={async () => { setShowNew(false); await load(); }} />}
    </div>
  );
};

// --- Edit an existing invoice ---
function InvoiceEdit({ invoiceId, projectId, contracts, onClose }) {
  const [inv, setInv] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [err, setErr] = React.useState(null);

  async function load() {
    try {
      const data = await api.getInvoice(invoiceId);
      setInv(data);
      setForm({
        invoice_number: data.invoice_number,
        vendor_name: data.vendor_name,
        amount: String(data.amount),
        invoice_date: data.invoice_date ? data.invoice_date.slice(0, 10) : '',
        description: data.description || '',
        status: data.status,
      });
    } catch (e) { setErr(e.message); }
  }
  React.useEffect(() => { load(); }, [invoiceId]);

  async function save() {
    setErr(null);
    try {
      await api.updateInvoice(invoiceId, {
        ...form,
        amount: Number(form.amount),
        invoice_date: form.invoice_date || null,
      });
      onClose();
    } catch (e) { setErr(e.message); }
  }

  if (!inv) return <div className="empty">Loading…</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Edit Invoice {inv.invoice_number}</h2>
        <button onClick={onClose}>← Back</button>
      </div>
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      {inv.file_reference && <div style={{ marginBottom: 12 }}>
        <a href={`/api/files/${encodeURIComponent(inv.file_reference)}`} target="_blank">View attached PDF</a>
      </div>}
      <div className="form-grid">
        <div><label>Invoice number</label><input value={form.invoice_number} onChange={e => setForm({ ...form, invoice_number: e.target.value })} /></div>
        <div><label>Vendor</label><SmartSearch value={form.vendor_name} onChange={v => setForm({ ...form, vendor_name: v })} fetcher={q => api.searchVendors(q)} placeholder="Vendor" /></div>
        <div><label>Amount</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
        <div><label>Date</label><input type="date" value={form.invoice_date} onChange={e => setForm({ ...form, invoice_date: e.target.value })} /></div>
        <div><label>Status</label>
          <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="pending">Pending</option><option value="approved">Approved</option>
            <option value="rejected">Rejected</option><option value="pushed">Pushed</option><option value="paid">Paid</option>
          </select>
        </div>
        <div className="full"><label>Description / notes</label><textarea rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="full"><button className="primary" onClick={save}>Save changes</button></div>
      </div>
    </div>
  );
}

// --- New invoice modal — supports both contract-linked and standalone ---
function NewInvoiceModal({ projectId, contracts, onClose, onSaved }) {
  const [mode, setMode] = React.useState('contract'); // 'contract' | 'standalone'
  const [contractId, setContractId] = React.useState('');
  const [context, setContext] = React.useState(null);
  const [invoiceNumber, setInvoiceNumber] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState('');
  const [vendor, setVendor] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [fileRef, setFileRef] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [extractNote, setExtractNote] = React.useState(null);
  const [err, setErr] = React.useState(null);

  React.useEffect(() => {
    if (mode === 'standalone' || !contractId) { setContext(null); return; }
    api.getContract(contractId).then(c => {
      const remaining = Number(c.remaining_amount);
      setContext({ total: Number(c.total_value), invoiced: Number(c.invoiced_amount), remaining });
      if (!vendor) setVendor(c.vendor_name);
      if (!amount || Number(amount) === 0) setAmount(String(remaining));
    }).catch(e => setErr(e.message));
  }, [contractId, mode]);

  async function onFile(f) {
    setErr(null); setExtractNote(null); setUploading(true);
    try {
      const resp = await api.extractInvoice(f);
      setFileRef({ file_reference: resp.file_reference, filename: resp.filename, download_url: resp.download_url });
      if (resp.extract_error) {
        setExtractNote(`File saved, but extraction failed: ${resp.extract_error}`);
      } else if (resp.extracted) {
        const e = resp.extracted;
        if (e.invoice_number && !invoiceNumber) setInvoiceNumber(e.invoice_number);
        if (e.vendor_name && !vendor) setVendor(e.vendor_name);
        if (e.amount && (!amount || Number(amount) === 0)) setAmount(String(e.amount));
        if (e.invoice_date && !date) setDate(e.invoice_date);
        if (e.summary) setDescription(d => d ? `${d}\n\n${e.summary}` : e.summary);
        setExtractNote('Fields pre-filled from PDF — review before saving.');
      }
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); }
  }

  const overspend = mode === 'contract' && context && Number(amount) > context.remaining;

  async function save() {
    setErr(null);
    if (!invoiceNumber || !amount) { setErr('Invoice number and amount required.'); return; }
    if (mode === 'contract' && !contractId) { setErr('Select a contract or switch to standalone.'); return; }
    try {
      await api.createInvoice({
        contract_id: mode === 'contract' ? Number(contractId) : null,
        project_id: projectId,
        invoice_number: invoiceNumber,
        vendor_name: vendor,
        amount: Number(amount),
        invoice_date: date || null,
        description: description || null,
        file_reference: fileRef?.file_reference || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 600 }}>
        <div className="modal-header"><strong>New invoice</strong><button onClick={onClose}>×</button></div>
        <div className="modal-body">
          {/* Mode toggle */}
          <div className="tabs" style={{ marginBottom: 12 }}>
            <button className={mode === 'contract' ? 'active' : ''} onClick={() => setMode('contract')}>Under a contract</button>
            <button className={mode === 'standalone' ? 'active' : ''} onClick={() => setMode('standalone')}>Standalone (no contract)</button>
          </div>

          <div className="form-grid">
            {mode === 'contract' && <>
              <div className="full">
                <label>Contract</label>
                <select value={contractId} onChange={e => setContractId(e.target.value)}>
                  <option value="">— Select a contract —</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)}</option>)}
                </select>
              </div>
              {context && <div className="full hint">
                Total: <strong>{fmt.money(context.total)}</strong> · Invoiced: <strong>{fmt.money(context.invoiced)}</strong> · Remaining: <strong>{fmt.money(context.remaining)}</strong>
              </div>}
            </>}

            <div className="full">
              <label>Invoice PDF — drop to auto-fill fields</label>
              <Dropzone file={fileRef ? { filename: fileRef.filename, download_url: fileRef.download_url } : null}
                onFile={onFile} onClear={() => setFileRef(null)} busy={uploading} accept="application/pdf"
                label={uploading ? 'Extracting with Claude…' : 'Drop invoice PDF — Claude will pre-fill fields'} />
              {extractNote && <div className="hint" style={{ marginTop: 6 }}>{extractNote}</div>}
            </div>
            <div><label>Invoice number</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
            <div><label>Amount</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><label>Vendor</label><SmartSearch value={vendor} onChange={v => setVendor(v)} fetcher={q => api.searchVendors(q)} placeholder="Vendor" /></div>
            <div className="full"><label>Description / notes</label>
              <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Auto-generated from PDF" />
            </div>
          </div>
          {overspend && <div className="error" style={{ marginTop: 10 }}>Warning: exceeds remaining ({fmt.moneyPrecise(context.remaining)}).</div>}
          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>Create</button>
        </div>
      </div>
    </div>
  );
}
