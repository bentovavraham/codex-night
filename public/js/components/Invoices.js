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

  async function handleHold(inv) {
    const note = prompt('Reason for hold (optional):');
    if (note === null) return; // cancelled
    await doAction(`${inv.invoice_number} on hold`, api.holdInvoice, inv.id, note);
  }

  async function handleRevert(inv) {
    const ok = await confirmDialog('Revert to pending?',
      `This will revert ${inv.invoice_number} from "${inv.status}" back to "pending". Continue?`);
    if (!ok) return;
    await doAction(`${inv.invoice_number} reverted to pending`, api.revertInvoice, inv.id);
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
            <option value="on_hold">On Hold</option><option value="rejected">Rejected</option>
            <option value="pushed">Pushed</option><option value="paid">Paid</option>
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
            <th data-tip="Vendor's invoice reference number">Invoice #</th>
            <th data-tip="Vendor or subcontractor who submitted this invoice">Vendor</th>
            <th data-tip="The contract this invoice is billed against">Contract</th>
            <th data-tip="Date on the invoice from the vendor">Date</th>
            <th className="num" data-tip="Total billed amount on this invoice">Amount</th>
            <th data-tip="pending = awaiting approval · approved = ready to pay · paid = check sent · rejected = sent back to vendor">Status</th>
            <th data-tip="Team member who entered this invoice">Created by</th>
            <th></th>
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
                  <td>{i.alloc_count > 1
                    ? <span className="badge" style={{ background: '#e8daff', color: '#5b21b6' }}>split ({i.alloc_count})</span>
                    : i.contract_id ? (i.contract_vendor || `#${i.contract_id}`) : <span className="hint">standalone</span>}</td>
                  <td>{fmt.date(i.invoice_date)}</td>
                  <td className="num">{fmt.moneyPrecise(i.amount)}</td>
                  <td><span className={`badge ${i.status}`}>{i.status}</span></td>
                  <td className="hint">{i.created_by_name || ''}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditingId(i.id)} style={{ marginRight: 4 }}>Edit</button>
                    {i.status === 'pending' && <>
                      <button className="primary" disabled={busy[i.id]} onClick={() => handleApprove(i)}>
                        {busy[i.id] ? <span className="spinner"></span> : null}Approve</button>
                      <button style={{ marginLeft: 4 }} disabled={busy[i.id]}
                        onClick={() => handleHold(i)}>Hold</button>
                      <button className="danger" style={{ marginLeft: 4 }} disabled={busy[i.id]}
                        onClick={() => handleReject(i)}>Reject</button>
                    </>}
                    {i.status === 'on_hold' && <>
                      <button className="primary" disabled={busy[i.id]} onClick={() => handleApprove(i)}>Approve</button>
                      <button style={{ marginLeft: 4 }} disabled={busy[i.id]}
                        onClick={() => handleRevert(i)}>Release</button>
                    </>}
                    {['approved', 'rejected', 'pushed', 'paid'].includes(i.status) &&
                      <button style={{ marginLeft: 4 }} disabled={busy[i.id]}
                        onClick={() => handleRevert(i)}>Revert</button>}
                    {i.status === 'approved' && <button style={{ marginLeft: 4 }} disabled={busy[i.id]}
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
      {inv.contract_allocations && inv.contract_allocations.length > 1 && <div style={{ marginBottom: 12 }}>
        <strong style={{ fontSize: 13 }}>Split across contracts:</strong>
        <table className="data" style={{ marginTop: 6 }}>
          <thead><tr><th>Contract</th><th className="num">Amount</th></tr></thead>
          <tbody>{inv.contract_allocations.map((a, i) => (
            <tr key={i}><td>{a.vendor_name}</td><td className="num">{fmt.moneyPrecise(a.amount)}</td></tr>
          ))}</tbody>
        </table>
      </div>}
      <div className="form-grid">
        <div><label data-tip="The invoice number from the vendor's document — used for duplicate detection">Invoice number</label><input value={form.invoice_number} disabled={locked} onChange={e => setForm({ ...form, invoice_number: e.target.value })} /></div>
        <div><label data-tip="Vendor or subcontractor submitting this invoice">Vendor</label><SmartSearch value={form.vendor_name} onChange={v => setForm({ ...form, vendor_name: v })} fetcher={q => api.searchVendors(q)} placeholder="Vendor" /></div>
        <div><label data-tip="Total dollar amount billed on this invoice">Amount</label><input type="number" step="0.01" value={form.amount} disabled={locked} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
        <div><label data-tip="Date printed on the vendor's invoice — may differ from the date it was received">Date</label><input type="date" value={form.invoice_date} disabled={locked} onChange={e => setForm({ ...form, invoice_date: e.target.value })} /></div>
        <div className="full"><label data-tip="Internal notes about what this invoice covers — not visible to the vendor">Description / notes</label><textarea rows={4} value={form.description} disabled={locked} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
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

// Expose InvoiceEdit globally so ContractDetail can use it without duplication.
window.InvoiceEdit = InvoiceEdit;

// --- New invoice modal ---
// defaultContractId: pre-selects and locks the contract (used when entering from ContractDetail)
// lockedContract: { id, vendor_name, total_value, remaining_amount } — display info when locked
window.NewInvoiceModal = function NewInvoiceModal({ projectId, contracts, onClose, onSaved, defaultContractId, lockedContract }) {
  const [mode, setMode] = React.useState(defaultContractId ? 'contract' : 'contract');
  const [contractId, setContractId] = React.useState(defaultContractId || '');
  const [context, setContext] = React.useState(lockedContract ? {
    total: Number(lockedContract.total_value),
    invoiced: Number(lockedContract.invoiced_amount || 0),
    remaining: Number(lockedContract.remaining_amount || lockedContract.total_value),
    vendor: lockedContract.vendor_name,
  } : null);
  const [allocs, setAllocs] = React.useState([{ contract_id: '', amount: '' }]);
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
    if (mode !== 'contract' || !contractId) { setContext(null); return; }
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

  function setAlloc(i, patch) { const n = allocs.slice(); n[i] = { ...n[i], ...patch }; setAllocs(n); }
  const allocSum = allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const allocDiff = (Number(amount) || 0) - allocSum;

  async function save() {
    setErr(null);
    if (!invoiceNumber || !amount) { setErr('Invoice number and amount are required.'); return; }
    if (mode === 'contract' && !contractId) { setErr('Select a contract or use standalone/multi mode.'); return; }
    if (mode === 'multi') {
      const cleaned = allocs.filter(a => a.contract_id && a.amount);
      if (cleaned.length < 2) { setErr('Add at least 2 contract allocations, or use single contract mode.'); return; }
      if (Math.abs(allocDiff) > 0.01) { setErr(`Allocations must sum to invoice amount. Off by ${fmt.moneyPrecise(allocDiff)}.`); return; }
    }
    setSaving(true);
    try {
      const body = {
        project_id: projectId, invoice_number: invoiceNumber, vendor_name: vendor,
        amount: Number(amount), invoice_date: date || null,
        description: description || null, file_reference: fileRef?.file_reference || null,
      };
      if (mode === 'contract') {
        body.contract_id = Number(contractId);
      } else if (mode === 'multi') {
        body.contracts = allocs.filter(a => a.contract_id && a.amount).map(a => ({
          contract_id: Number(a.contract_id), amount: Number(a.amount),
        }));
      }
      await api.createInvoice(body);
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  const overspend = mode === 'contract' && context && Number(amount) > context.remaining + 0.01;
  const pdfUrl = fileRef ? `/api/files/${encodeURIComponent(fileRef.file_reference)}` : null;
  const hasPdf = !!pdfUrl;
  const isLocked = !!defaultContractId; // contract context — locked to this contract

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', flexDirection: 'column',
    }} onClick={onClose}>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        margin: hasPdf ? '20px' : 'auto',
        width: hasPdf ? 'calc(100% - 40px)' : '660px',
        maxHeight: hasPdf ? 'calc(100% - 40px)' : 'calc(100% - 60px)',
        background: 'var(--surface)', borderRadius: 10,
        border: '1px solid var(--border)', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <strong style={{ fontSize: 15 }}>New Invoice</strong>
            {isLocked && context && (
              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-3)' }}>
                against <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{lockedContract?.vendor_name}</span>
                {' — '}{fmt.money(context.remaining)} remaining
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>

        {/* Mode tabs — only shown when not locked to a contract */}
        {!isLocked && (
          <div style={{ padding: '10px 20px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 0, flexShrink: 0 }}>
            {[
              { k: 'contract', label: 'Against a contract' },
              { k: 'multi',    label: 'Split across contracts' },
              { k: 'standalone', label: 'Standalone (no contract)' },
            ].map(t => (
              <button key={t.k} onClick={() => setMode(t.k)} style={{
                padding: '8px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: mode === t.k ? 600 : 400,
                color: mode === t.k ? 'var(--accent)' : 'var(--text-2)',
                borderBottom: mode === t.k ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}>{t.label}</button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* PDF viewer */}
          {hasPdf && (
            <div style={{ flex: '0 0 55%', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📄</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileRef.filename}</span>
                <a href={pdfUrl} target="_blank" style={{ fontSize: 11 }}>Open ↗</a>
                <button onClick={() => setFileRef(null)} style={{ fontSize: 11, color: 'var(--text-3)' }}>Remove</button>
              </div>
              <iframe src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} title="Invoice PDF" />
            </div>
          )}

          {/* Form */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

            {/* Drop zone */}
            {!hasPdf && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Invoice PDF — upload to view alongside form</label>
                <Dropzone file={null} onFile={onFile} onClear={() => setFileRef(null)} busy={uploading}
                  accept="application/pdf"
                  label={uploading ? 'Uploading…' : 'Drop invoice PDF — fields will auto-fill and PDF stays visible while you enter data'} />
              </div>
            )}
            {extractNote && (
              <div style={{ padding: '8px 12px', marginBottom: 14, borderRadius: 5, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', fontSize: 12, color: 'var(--ok)' }}>
                {extractNote}
              </div>
            )}

            {/* Contract selector — only when NOT locked */}
            {!isLocked && mode === 'contract' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>Contract</label>
                <select value={contractId} onChange={e => setContractId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">— Select a contract —</option>
                  {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)} ({c.status})</option>)}
                </select>
                {context && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-3)' }}>
                    Initial: <strong style={{ color: 'var(--text-2)' }}>{fmt.money(context.total)}</strong>
                    {' · '}Invoiced: <strong style={{ color: 'var(--text-2)' }}>{fmt.money(context.invoiced)}</strong>
                    {' · '}Remaining: <strong style={{ color: context.remaining < 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmt.money(context.remaining)}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Main fields */}
            <div className="form-grid">
              <div>
                <label data-tip="The invoice number from the vendor's document — used for duplicate detection">Invoice number</label>
                <input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="e.g. INV-001" autoFocus={!hasPdf} />
              </div>
              <div>
                <label data-tip="Total dollar amount billed on this invoice">Amount</label>
                <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label data-tip="Date printed on the vendor's invoice — may differ from today's date">Invoice date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div>
                <label data-tip="Vendor or subcontractor submitting this invoice">Vendor</label>
                <SmartSearch value={vendor} onChange={v => setVendor(v)} fetcher={q => api.searchVendors(q)} placeholder="Vendor name" />
              </div>
              <div className="full">
                <label data-tip="Internal notes about what this invoice covers — visible to the project team only">Description / notes</label>
                <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="What is this invoice for?" />
              </div>
            </div>

            {/* Multi-contract split */}
            {mode === 'multi' && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Split across contracts</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>Amounts must sum to {fmt.money(Number(amount) || 0)}</div>
                <table className="data">
                  <thead><tr><th>Contract</th><th className="num">Amount</th><th></th></tr></thead>
                  <tbody>
                    {allocs.map((a, i) => (
                      <tr key={i}>
                        <td>
                          <select value={a.contract_id} onChange={e => setAlloc(i, { contract_id: e.target.value })} style={{ minWidth: 260 }}>
                            <option value="">— Select —</option>
                            {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)}</option>)}
                          </select>
                        </td>
                        <td className="num">
                          <input type="number" step="0.01" value={a.amount}
                            onChange={e => setAlloc(i, { amount: e.target.value })} style={{ textAlign: 'right', maxWidth: 120 }} />
                        </td>
                        <td><button onClick={() => setAllocs(allocs.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td><button onClick={() => setAllocs([...allocs, { contract_id: '', amount: '' }])}>+ Add contract</button></td>
                    <td className="num"><strong style={{ color: Math.abs(allocDiff) > 0.01 ? 'var(--danger)' : 'var(--ok)' }}>{fmt.moneyPrecise(allocSum)}</strong></td>
                    <td></td>
                  </tr></tfoot>
                </table>
              </div>
            )}

            {overspend && (
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 5, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12, color: 'var(--warn)' }}>
                ⚠️ Amount exceeds remaining contract balance ({fmt.moneyPrecise(context.remaining)})
              </div>
            )}
            {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving} onClick={save}>
            {saving ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
