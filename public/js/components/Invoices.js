window.Invoices = function Invoices({ projectId }) {
  const [invoices, setInvoices] = React.useState([]);
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [filter, setFilter] = React.useState({ status: '', contract_id: '', vendor: '' });

  async function load() {
    setLoading(true);
    try {
      const [inv, contracts] = await Promise.all([
        api.listInvoices(projectId, filter),
        api.listContracts(projectId),
      ]);
      setInvoices(inv);
      setContracts(contracts);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [projectId, filter.status, filter.contract_id, filter.vendor]);

  async function action(fn, id, ...args) {
    try {
      await fn(id, ...args);
      await load();
    } catch (e) { setErr(e.message); }
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Invoices</h2>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Invoice</button>
      </div>
      <div className="toolbar">
        <select value={filter.status} onChange={(e)=>setFilter({ ...filter, status: e.target.value })} style={{ width: 140 }}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="pushed">Pushed</option>
          <option value="paid">Paid</option>
        </select>
        <select value={filter.contract_id} onChange={(e)=>setFilter({ ...filter, contract_id: e.target.value })} style={{ width: 240 }}>
          <option value="">All contracts</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)}</option>)}
        </select>
        <input placeholder="Vendor search" value={filter.vendor}
               onChange={(e)=>setFilter({ ...filter, vendor: e.target.value })}
               style={{ width: 200 }} />
      </div>

      {err && <div className="error">{err}</div>}
      {loading ? <div className="empty">Loading…</div>
       : invoices.length === 0 ? <div className="empty">No invoices match these filters.</div>
       : (
        <table className="data">
          <thead>
            <tr>
              <th>Invoice #</th><th>Vendor</th><th>Date</th>
              <th className="num">Amount</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.invoice_number}
                  {i.file_reference && <> · <a href={`/api/files/${encodeURIComponent(i.file_reference)}`} target="_blank" title="View PDF">📄</a></>}
                </td>
                <td>{i.vendor_name}</td>
                <td>{fmt.date(i.invoice_date)}</td>
                <td className="num">{fmt.moneyPrecise(i.amount)}</td>
                <td><span className={`badge ${i.status}`}>{i.status}</span></td>
                <td style={{ textAlign:'right', whiteSpace:'nowrap' }}>
                  {i.status === 'pending' && (
                    <>
                      <button className="primary" onClick={() => action(api.approveInvoice, i.id)}>Approve</button>
                      <button className="danger" style={{ marginLeft: 6 }}
                              onClick={() => action(api.rejectInvoice, i.id)}>Reject</button>
                    </>
                  )}
                  {i.status === 'approved' && (
                    <button onClick={() => action(api.markPushed, i.id)}>Mark Pushed</button>
                  )}
                  {(i.status === 'approved' || i.status === 'pushed') && (
                    <button style={{ marginLeft: 6 }} onClick={() => action(api.markPaid, i.id, null)}>Mark Paid</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && <NewInvoiceModal projectId={projectId}
        contracts={contracts}
        onClose={() => setShowNew(false)}
        onSaved={async () => { setShowNew(false); await load(); }} />}
    </div>
  );
};

function NewInvoiceModal({ projectId, contracts, onClose, onSaved }) {
  const [contractId, setContractId] = React.useState('');
  const [context, setContext] = React.useState(null); // {total, invoiced, remaining}
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
    if (!contractId) { setContext(null); return; }
    api.getContract(contractId).then((c) => {
      const remaining = Number(c.remaining_amount);
      setContext({
        total: Number(c.total_value),
        invoiced: Number(c.invoiced_amount),
        remaining,
      });
      if (!vendor) setVendor(c.vendor_name);
      // Default invoice amount to the remaining contract balance on first
      // pick — the common case is a single-invoice contract.
      if (!amount || Number(amount) === 0) setAmount(String(remaining));
    }).catch((e)=>setErr(e.message));
  }, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFile(f) {
    setErr(null); setExtractNote(null); setUploading(true);
    try {
      const resp = await api.extractInvoice(f);
      setFileRef({
        file_reference: resp.file_reference,
        filename: resp.filename,
        download_url: resp.download_url,
      });
      if (resp.extract_error) {
        setExtractNote(`File saved, but extraction failed: ${resp.extract_error}. Please fill in the fields manually.`);
      } else if (resp.extracted) {
        const e = resp.extracted;
        if (e.invoice_number && !invoiceNumber) setInvoiceNumber(e.invoice_number);
        if (e.vendor_name && !vendor) setVendor(e.vendor_name);
        if (e.amount && (!amount || Number(amount) === 0 || Number(amount) === context?.remaining)) {
          setAmount(String(e.amount));
        }
        if (e.invoice_date && !date) setDate(e.invoice_date);
        if (e.summary) {
          // Append (don't overwrite) so user comments survive.
          setDescription((d) => d ? `${d}\n\n${e.summary}` : e.summary);
        }
        setExtractNote('Fields pre-filled from PDF — review before saving.');
      }
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); }
  }

  const overspend = context && Number(amount) > context.remaining;

  async function save() {
    setErr(null);
    if (!contractId || !invoiceNumber || !amount) {
      setErr('Contract, invoice number, and amount required.'); return;
    }
    try {
      await api.createInvoice({
        contract_id: Number(contractId),
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
      <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ width: 560 }}>
        <div className="modal-header">
          <strong>New invoice</strong><button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="full">
              <label>Contract</label>
              <select value={contractId} onChange={(e)=>setContractId(e.target.value)}>
                <option value="">— Select a contract —</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)}</option>
                ))}
              </select>
            </div>
            {context && (
              <div className="full hint">
                Contract total: <strong>{fmt.money(context.total)}</strong>&nbsp;•
                Already invoiced: <strong>{fmt.money(context.invoiced)}</strong>&nbsp;•
                Remaining: <strong>{fmt.money(context.remaining)}</strong>
              </div>
            )}
            <div className="full">
              <label>Invoice PDF — drop to auto-fill fields</label>
              <Dropzone
                file={fileRef ? { filename: fileRef.filename, download_url: fileRef.download_url } : null}
                onFile={onFile}
                onClear={() => setFileRef(null)}
                busy={uploading}
                accept="application/pdf"
                label={uploading ? 'Extracting with Claude…' : 'Drop invoice PDF — Claude will pre-fill fields'}
              />
              {extractNote && <div className="hint" style={{ marginTop: 6 }}>{extractNote}</div>}
            </div>
            <div>
              <label>Invoice number</label>
              <input value={invoiceNumber} onChange={(e)=>setInvoiceNumber(e.target.value)} />
            </div>
            <div>
              <label>Amount</label>
              <input type="number" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} />
            </div>
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} />
            </div>
            <div>
              <label>Vendor</label>
              <SmartSearch
                value={vendor}
                onChange={(v) => setVendor(v)}
                fetcher={(q) => api.searchVendors(q)}
                placeholder="Vendor"
              />
            </div>
            <div className="full">
              <label>Description / notes</label>
              <textarea rows={4} value={description} onChange={(e)=>setDescription(e.target.value)}
                        placeholder="A summary will be auto-generated from the uploaded PDF" />
            </div>
          </div>
          {overspend && <div className="error" style={{ marginTop: 10 }}>
            Warning: amount exceeds remaining contract balance ({fmt.moneyPrecise(context.remaining)}).
          </div>}
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
