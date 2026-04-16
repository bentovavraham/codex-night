window.Invoices = function Invoices({ projectId }) {
  const [invoices, setInvoices] = React.useState([]);
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  const [view, setView] = React.useState('all');
  const [filter, setFilter] = React.useState({ status: '', contract_id: '', vendor: '', sort: '' });
  const [selected, setSelected] = React.useState(new Set());
  const [busy, setBusy] = React.useState({}); // id -> true

  async function load() {
    setLoading(true);
    try {
      const f = view === 'pending' ? { ...filter, status: 'pending' } : filter;
      const [inv, con] = await Promise.all([api.listInvoices(projectId, f), api.listContracts(projectId)]);
      setInvoices(inv); setContracts(con); setSelected(new Set());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [projectId, filter.status, filter.contract_id, filter.vendor, filter.sort, view]);

  async function doAction(label, fn, id, ...args) {
    setBusy(b => ({ ...b, [id]: true }));
    try { await fn(id, ...args); toast(label); await load(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(b => { const n = { ...b }; delete n[id]; return n; }); }
  }

  async function handleReject(inv) {
    const note = await rejectDialog(inv.invoice_number);
    if (!note) return;
    await doAction(`${inv.invoice_number} rejected`, api.rejectInvoice, inv.id, note);
  }

  async function handleApprove(inv) {
    const ok = await confirmDialog('Approve invoice?',
      `Approve ${inv.invoice_number} for ${fmt.moneyPrecise(inv.amount)} from ${inv.vendor_name}?`);
    if (!ok) return;
    await doAction(`${inv.invoice_number} approved`, api.approveInvoice, inv.id);
  }

  async function handleBulkApprove() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirmDialog(`Approve ${ids.length} invoices?`,
      `This will approve ${ids.length} pending invoice(s). Continue?`);
    if (!ok) return;
    setBusy(b => ({ ...b, bulk: true }));
    try {
      const result = await api.bulkApprove(ids);
      toast(`${result.approved} invoice(s) approved`);
      await load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(b => { const n = { ...b }; delete n.bulk; return n; }); }
  }

  function toggleSelect(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() {
    const pending = invoices.filter(i => i.status === 'pending').map(i => i.id);
    setSelected(new Set(pending));
  }

  if (editingId) {
    return <InvoiceEdit invoiceId={editingId} projectId={projectId} contracts={contracts}
                        onClose={() => { setEditingId(null); load(); }} />;
  }

  // Summary stats
  const pendingCount = invoices.filter(i => i.status === 'pending').length;
  const totalPending = invoices.filter(i => i.status === 'pending').reduce((s, i) => s + Number(i.amount), 0);
  const totalApproved = invoices.filter(i => ['approved', 'pushed', 'paid'].includes(i.status)).reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Invoices</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`/api/projects/${projectId}/invoices/export`} target="_blank" className="btn" style={{ fontSize: 12 }}>Export CSV</a>
          <button className="primary" onClick={() => setShowNew(true)}>+ New Invoice</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="summary-cards">
        <div className="summary-card"><div className="label">Pending</div><div className="value">{pendingCount}</div><div className="hint">{fmt.money(totalPending)}</div></div>
        <div className="summary-card"><div className="label">Approved+</div><div className="value">{fmt.money(totalApproved)}</div></div>
        <div className="summary-card"><div className="label">Paid</div><div className="value">{fmt.money(totalPaid)}</div></div>
        <div className="summary-card"><div className="label">Total</div><div className="value">{invoices.length}</div></div>
      </div>

      {/* View toggle */}
      <div className="tabs" style={{ marginBottom: 8 }}>
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All invoices</button>
        <button className={view === 'pending' ? 'active' : ''} onClick={() => setView('pending')}>
          Needs approval ({pendingCount})
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
            <option value="none">Standalone only</option>
            {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)}</option>)}
          </select>
          <input placeholder="Search vendor" value={filter.vendor} onChange={e => setFilter({ ...filter, vendor: e.target.value })} style={{ width: 160 }} />
          <select value={filter.sort} onChange={e => setFilter({ ...filter, sort: e.target.value })} style={{ width: 130 }}>
            <option value="">Sort: Date</option><option value="vendor">Vendor</option>
            <option value="amount">Amount</option><option value="status">Status</option>
          </select>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="primary" disabled={busy.bulk} onClick={handleBulkApprove}>
            {busy.bulk ? <><span className="spinner"></span>Approving…</> : `Approve ${selected.size}`}
          </button>
          <button onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {err && <div className="error">{err}</div>}
      {loading ? <div className="empty">Loading invoices…</div>
       : invoices.length === 0 ? <div className="empty">No invoices match these filters.</div>
       : (
        <table className="data">
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" style={{ width: 'auto' }}
              checked={selected.size > 0 && selected.size === invoices.filter(i => i.status === 'pending').length}
              onChange={e => e.target.checked ? selectAll() : setSelected(new Set())} /></th>
            <th>Invoice #</th><th>Vendor</th><th>Contract</th><th>Date</th>
            <th className="num">Amount</th><th>Status</th><th>Created by</th><th></th>
          </tr></thead>
          <tbody>
            {invoices.map(i => (
              <React.Fragment key={i.id}>
                <tr className={i.status === 'rejected' ? 'row-over' : ''}>
                  <td><input type="checkbox" style={{ width: 'auto' }} disabled={i.status !== 'pending'}
                    checked={selected.has(i.id)} onChange={() => toggleSelect(i.id)} /></td>
                  <td>
                    {i.invoice_number}
                    {i.file_reference && <> · <a href={`/api/files/${encodeURIComponent(i.file_reference)}`} target="_blank" title="View PDF">📄</a></>}
                  </td>
                  <td>{i.vendor_name}</td>
                  <td>{i.contract_id ? (i.contract_vendor || `#${i.contract_id}`) : <span className="hint">standalone</span>}</td>
                  <td>{fmt.date(i.invoice_date)}</td>
                  <td className="num">{fmt.moneyPrecise(i.amount)}</td>
                  <td><span className={`badge ${i.status}`}>{i.status}</span></td>
                  <td className="hint">{i.created_by_name || ''}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditingId(i.id)} style={{ marginRight: 4 }}>Edit</button>
                    {i.status === 'pending' && <>
                      <button className="primary" disabled={busy[i.id]} onClick={() => handleApprove(i)}>
                        {busy[i.id] ? <span className="spinner"></span> : null}Approve</button>
                      <button className="danger" style={{ marginLeft: 4 }} disabled={busy[i.id]}
                        onClick={() => handleReject(i)}>Reject</button>
                    </>}
                    {i.status === 'approved' && <button disabled={busy[i.id]}
                      onClick={() => doAction(`${i.invoice_number} pushed`, api.markPushed, i.id)}>Push</button>}
                    {(i.status === 'approved' || i.status === 'pushed') &&
                      <button style={{ marginLeft: 4 }} disabled={busy[i.id]}
                        onClick={() => doAction(`${i.invoice_number} marked paid`, api.markPaid, i.id, null)}>Paid</button>}
                  </td>
                </tr>
                {i.rejection_note && (
                  <tr><td></td><td colSpan={8}>
                    <div className="rejection-note"><strong>Rejected:</strong> {i.rejection_note}</div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {showNew && <NewInvoiceModal projectId={projectId} contracts={contracts}
        onClose={() => setShowNew(false)} onSaved={async () => { setShowNew(false); toast('Invoice created'); await load(); }} />}
    </div>
  );
};

// --- Invoice Edit with activity log ---
function InvoiceEdit({ invoiceId, projectId, contracts, onClose }) {
  const [inv, setInv] = React.useState(null);
  const [form, setForm] = React.useState({});
  const [history, setHistory] = React.useState([]);
  const [err, setErr] = React.useState(null);
  const locked = inv && ['pushed', 'paid'].includes(inv.status);

  async function load() {
    try {
      const [data, hist] = await Promise.all([api.getInvoice(invoiceId), api.getInvoiceHistory(invoiceId)]);
      setInv(data); setHistory(hist);
      setForm({
        invoice_number: data.invoice_number, vendor_name: data.vendor_name,
        amount: String(data.amount), invoice_date: data.invoice_date ? data.invoice_date.slice(0, 10) : '',
        description: data.description || '', status: data.status,
      });
    } catch (e) { setErr(e.message); }
  }
  React.useEffect(() => { load(); }, [invoiceId]);

  async function save() {
    setErr(null);
    try {
      await api.updateInvoice(invoiceId, { ...form, amount: Number(form.amount), invoice_date: form.invoice_date || null });
      toast('Invoice updated');
      onClose();
    } catch (e) { setErr(e.message); toast(e.message, 'error'); }
  }

  if (!inv) return <div className="empty">Loading…</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Invoice: {inv.invoice_number}</h2>
        <button onClick={onClose}>← Back to list</button>
      </div>
      {locked && <div className="rejection-note" style={{ marginBottom: 12, background: '#ddeafd', borderColor: '#1b4ab4' }}>
        This invoice has been {inv.status}. Editing is locked. Revert status to make changes.
      </div>}
      {inv.rejection_note && <div className="rejection-note" style={{ marginBottom: 12 }}>
        <strong>Rejection reason:</strong> {inv.rejection_note}
      </div>}
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      {inv.file_reference && <div style={{ marginBottom: 12 }}>
        <a href={`/api/files/${encodeURIComponent(inv.file_reference)}`} target="_blank">View attached PDF</a>
      </div>}
      <div className="form-grid">
        <div><label>Invoice number</label><input value={form.invoice_number} disabled={locked} onChange={e => setForm({ ...form, invoice_number: e.target.value })} /></div>
        <div><label>Vendor</label><SmartSearch value={form.vendor_name} onChange={v => setForm({ ...form, vendor_name: v })} fetcher={q => api.searchVendors(q)} placeholder="Vendor" /></div>
        <div><label>Amount</label><input type="number" step="0.01" value={form.amount} disabled={locked} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
        <div><label>Date</label><input type="date" value={form.invoice_date} disabled={locked} onChange={e => setForm({ ...form, invoice_date: e.target.value })} /></div>
        <div className="full"><label>Description / notes</label><textarea rows={4} value={form.description} disabled={locked} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        {!locked && <div className="full"><button className="primary" onClick={save}>Save changes</button></div>}
      </div>

      {/* Activity log */}
      {history.length > 0 && <>
        <h3 style={{ marginTop: 20, fontSize: 14 }}>Activity log</h3>
        <div className="activity-log">
          {history.map(h => (
            <div key={h.id} className="activity-item">
              <span className={`activity-action ${h.action}`}>{h.action}</span>
              <span style={{ flex: 1 }}>{h.detail}</span>
              <span className="hint">{h.changed_by_name} · {fmt.datetime(h.changed_at)}</span>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

// --- New invoice modal ---
function NewInvoiceModal({ projectId, contracts, onClose, onSaved }) {
  const [mode, setMode] = React.useState('contract');
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
  const [saving, setSaving] = React.useState(false);

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
      if (resp.extract_error) { setExtractNote(`PDF saved. Extraction failed: ${resp.extract_error}`); }
      else if (resp.extracted) {
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

  async function save() {
    setErr(null);
    if (!invoiceNumber || !amount) { setErr('Invoice number and amount are required.'); return; }
    if (mode === 'contract' && !contractId) { setErr('Select a contract or use standalone mode.'); return; }
    setSaving(true);
    try {
      await api.createInvoice({
        contract_id: mode === 'contract' ? Number(contractId) : null,
        project_id: projectId, invoice_number: invoiceNumber, vendor_name: vendor,
        amount: Number(amount), invoice_date: date || null,
        description: description || null, file_reference: fileRef?.file_reference || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const overspend = mode === 'contract' && context && Number(amount) > context.remaining;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 600 }}>
        <div className="modal-header"><strong>New Invoice</strong><button onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="tabs" style={{ marginBottom: 12 }}>
            <button className={mode === 'contract' ? 'active' : ''} onClick={() => setMode('contract')}>Against a contract</button>
            <button className={mode === 'standalone' ? 'active' : ''} onClick={() => setMode('standalone')}>Standalone (no contract)</button>
          </div>
          <div className="form-grid">
            {mode === 'contract' && <>
              <div className="full"><label>Contract</label>
                <select value={contractId} onChange={e => setContractId(e.target.value)}>
                  <option value="">— Select a contract —</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)} ({c.status})</option>)}
                </select></div>
              {context && <div className="full hint">
                Total: <strong>{fmt.money(context.total)}</strong> · Invoiced: <strong>{fmt.money(context.invoiced)}</strong> · Remaining: <strong>{fmt.money(context.remaining)}</strong>
              </div>}
            </>}
            <div className="full"><label>Invoice PDF — auto-fills fields via AI</label>
              <Dropzone file={fileRef ? { filename: fileRef.filename, download_url: fileRef.download_url } : null}
                onFile={onFile} onClear={() => setFileRef(null)} busy={uploading} accept="application/pdf"
                label={uploading ? 'Analyzing with Claude AI…' : 'Drop invoice PDF here — fields will auto-fill'} />
              {extractNote && <div className="hint" style={{ marginTop: 6 }}>{extractNote}</div>}
            </div>
            <div><label>Invoice number</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-001" /></div>
            <div><label>Amount ($)</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
            <div><label>Invoice date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
            <div><label>Vendor</label><SmartSearch value={vendor} onChange={v => setVendor(v)} fetcher={q => api.searchVendors(q)} placeholder="Start typing vendor name" /></div>
            <div className="full"><label>Notes / description</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="AI will generate a summary when you upload a PDF" /></div>
          </div>
          {overspend && <div className="error" style={{ marginTop: 10 }}>
            This amount exceeds the remaining contract balance ({fmt.moneyPrecise(context.remaining)}). The server will block this — reduce the amount or update the contract.
          </div>}
          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving} onClick={save}>
            {saving ? <><span className="spinner"></span>Creating…</> : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
