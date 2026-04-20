window.Contracts = function Contracts({ projectId, initialContractId, onContractOpened }) {
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [selected, setSelected] = React.useState(initialContractId || null);
  const [filter, setFilter] = React.useState({ vendor: '', status: '', sort: '' });

  React.useEffect(() => {
    if (initialContractId) { setSelected(initialContractId); if (onContractOpened) onContractOpened(); }
  }, [initialContractId]);

  async function load() {
    setLoading(true);
    try { setContracts(await api.listContracts(projectId, filter)); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [projectId, filter.vendor, filter.status, filter.sort]);

  if (selected) {
    return <ContractDetail contractId={selected} projectId={projectId}
                           onClose={() => { setSelected(null); load(); }} />;
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Contracts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`/api/projects/${projectId}/contracts/export`} target="_blank" className="btn" style={{ fontSize: 12 }}>Export CSV</a>
          <button className="primary" onClick={() => setShowNew(true)}>+ New Contract</button>
        </div>
      </div>
      <div className="toolbar">
        <input placeholder="Filter by vendor" value={filter.vendor}
               onChange={(e)=>setFilter({...filter, vendor: e.target.value})} style={{width:180}} />
        <select value={filter.status} onChange={(e)=>setFilter({...filter, status: e.target.value})} style={{width:120}}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filter.sort} onChange={(e)=>setFilter({...filter, sort: e.target.value})} style={{width:120}}>
          <option value="">Sort: Date</option>
          <option value="vendor">Sort: Vendor</option>
          <option value="amount">Sort: Amount</option>
          <option value="status">Sort: Status</option>
        </select>
      </div>
      {err && <div className="error">{err}</div>}
      {loading ? <div className="empty">Loading…</div>
       : contracts.length === 0 ? <div className="empty">No contracts match these filters.</div>
       : (
        <table className="data">
          <thead>
            <tr>
              <th>Vendor</th><th>Description</th><th>Date</th>
              <th className="num">Initial Contract Amt</th><th className="num">Invoiced</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} style={{cursor:'pointer'}} onClick={()=>setSelected(c.id)}>
                <td>
                  <strong>{c.vendor_name}</strong>
                  {c.file_reference && <> · <a href={`/api/files/${encodeURIComponent(c.file_reference)}`} target="_blank" onClick={e=>e.stopPropagation()} title="View PDF">📄</a></>}
                </td>
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
        onClose={()=>setShowNew(false)}
        onSaved={async()=>{setShowNew(false);await load();}} />}
    </div>
  );
};

function NewContractModal({ projectId, onClose, onSaved }) {
  const [codes, setCodes] = React.useState([]);
  const [vendor, setVendor] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [total, setTotal] = React.useState('');
  const [earmarked, setEarmarked] = React.useState('');
  const [date, setDate] = React.useState('');
  const [ref, setRef] = React.useState('');
  const [fileRef, setFileRef] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [extractNote, setExtractNote] = React.useState(null);
  const [status, setStatus] = React.useState('draft');
  const [lines, setLines] = React.useState([{qb_code_id:'',amount:''}]);
  const [err, setErr] = React.useState(null);

  React.useEffect(()=>{
    if(lines.length===1&&total&&(!lines[0].amount||Number(lines[0].amount)===0)){
      setLines([{...lines[0],amount:String(Number(total))}]);
    }
  },[total]);

  React.useEffect(()=>{
    api.getQbCodes().then(r=>setCodes(r.flat||[])).catch(e=>setErr(e.message));
  },[]);

  async function onFile(f) {
    setErr(null); setExtractNote(null); setUploading(true);
    try {
      const resp = await api.extractContract(f);
      setFileRef({file_reference:resp.file_reference,filename:resp.filename,download_url:resp.download_url});
      if(resp.extract_error){
        setExtractNote(`File saved, but extraction failed: ${resp.extract_error}`);
      } else if(resp.extracted){
        const e=resp.extracted;
        if(e.vendor_name&&!vendor) setVendor(e.vendor_name);
        if(e.total_value&&(!total||Number(total)===0)) setTotal(String(e.total_value));
        if(e.contract_date&&!date) setDate(e.contract_date);
        if(e.reference_number&&!ref) setRef(e.reference_number);
        if(e.description) setDescription(d=>d?`${d}\n\n${e.description}`:e.description);
        setExtractNote('Fields pre-filled from PDF — review before saving.');
      }
    } catch(e){setErr(e.message);}
    finally{setUploading(false);}
  }

  function setLine(i,patch){const n=lines.slice();n[i]={...n[i],...patch};setLines(n);}
  const sum=lines.reduce((s,l)=>s+(Number(l.amount)||0),0);
  const diff=(Number(total)||0)-sum;

  async function save(){
    setErr(null);
    if(!vendor||!total){setErr('Vendor and total required');return;}
    const cleaned=lines.filter(l=>l.qb_code_id&&l.amount!=='').map(l=>({qb_code_id:Number(l.qb_code_id),amount:Number(l.amount)}));
    if(cleaned.length===0){setErr('At least one allocation line required');return;}
    try{
      await api.createContract(projectId,{
        vendor_name:vendor,description,total_value:Number(total),
        earmarked_amount:earmarked?Number(earmarked):null,
        contract_date:date||null,reference_number:ref||null,status,
        file_reference:fileRef?.file_reference||null,lines:cleaned,
      });
      onSaved();
    }catch(e){setErr(e.message);}
  }

  const pdfUrl = fileRef ? `/api/files/${encodeURIComponent(fileRef.file_reference)}` : null;
  const hasPdf = !!pdfUrl;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', flexDirection: 'column',
    }} onClick={onClose}>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        margin: hasPdf ? '20px' : 'auto',
        width: hasPdf ? 'calc(100% - 40px)' : '680px',
        maxHeight: hasPdf ? 'calc(100% - 40px)' : 'calc(100% - 80px)',
        background: 'var(--surface)', borderRadius: 10,
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <strong style={{ fontSize: 15 }}>New Contract</strong>
          <button onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>

        {/* Body — split when PDF present, single column otherwise */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* Left: PDF viewer */}
          {hasPdf && (
            <div style={{
              flex: '0 0 55%', borderRight: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', background: '#1a1a1a',
            }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📄</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileRef.filename}</span>
                <a href={pdfUrl} target="_blank" style={{ fontSize: 11, flexShrink: 0 }}>Open full screen ↗</a>
                <button onClick={() => setFileRef(null)} style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>Remove</button>
              </div>
              <iframe
                src={pdfUrl}
                style={{ flex: 1, border: 'none', width: '100%' }}
                title="Contract PDF"
              />
            </div>
          )}

          {/* Right: Form */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

            {/* Drop zone — only when no PDF yet */}
            {!hasPdf && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>
                  Contract PDF — upload to view alongside form
                </label>
                <Dropzone
                  file={null}
                  onFile={onFile} onClear={() => setFileRef(null)} busy={uploading}
                  accept="application/pdf"
                  label={uploading ? 'Uploading…' : 'Drop contract PDF here — view it while filling the form'} />
              </div>
            )}

            {uploading && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'var(--accent-dim)', fontSize: 13, color: 'var(--accent)' }}>
                Uploading PDF…
              </div>
            )}
            {extractNote && (
              <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 6, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', fontSize: 13, color: 'var(--ok)' }}>
                {extractNote}
              </div>
            )}

            <div className="form-grid">
              <div>
                <label data-tip="The company or individual you are contracting with. Type to search existing vendors.">Vendor</label>
                <SmartSearch value={vendor} onChange={v => setVendor(v)} fetcher={q => api.searchVendors(q)} placeholder="Search vendors" />
              </div>
              <div>
                <label data-tip="The vendor's own reference number or proposal number. Used for matching their invoices later.">Reference number</label>
                <input value={ref} onChange={e => setRef(e.target.value)} />
              </div>
              <div>
                <label data-tip="The dollar amount on the signed contract — the fixed lump sum only. Do not include estimated T&M.">Initial Contract Amount</label>
                <input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label data-tip="Your internal budget for what this vendor will actually cost you — including open-ended T&M, meetings, and additional services. Leave blank if truly unknown. The dashboard uses this as the warning threshold.">Internal Budget</label>
                <input type="number" step="0.01" value={earmarked} onChange={e => setEarmarked(e.target.value)} placeholder="Optional — incl. T&M tail" />
              </div>
              <div>
                <label data-tip="The date the contract was signed or became effective.">Contract date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div>
                <label data-tip="Draft = not yet active. Active = work in progress. Closed = complete or terminated.">Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="full">
                <label data-tip="Describe the scope of work. This appears on the contract overview and helps identify what was purchased.">Description</label>
                <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Scope of work…" />
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }} data-tip="Allocate the contract amount across QuickBooks cost codes. The total must match the Initial Contract Amount. This drives your QB reporting.">QB Code Allocation</div>
              <table className="data">
                <thead><tr><th>QB Code</th><th className="num">Amount</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td><QbCodePicker codes={codes} value={l.qb_code_id} onChange={id => setLine(i, { qb_code_id: id })} /></td>
                      <td className="num"><input type="number" step="0.01" value={l.amount}
                        onChange={e => setLine(i, { amount: e.target.value })} style={{ textAlign: 'right', maxWidth: 140 }} /></td>
                      <td><button onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td><button onClick={() => setLines([...lines, { qb_code_id: '', amount: '' }])}>+ Add line</button></td>
                  <td className="num"><strong>{fmt.moneyPrecise(sum)}</strong></td>
                  <td></td>
                </tr></tfoot>
              </table>
              <div className="hint" style={{ marginTop: 6 }}>
                Lines must sum to total value.
                {Math.abs(diff) > 0.01 && <span style={{ color: 'var(--danger)' }}> Off by {fmt.moneyPrecise(diff)}.</span>}
              </div>
            </div>

            {err && <div className="error" style={{ marginTop: 16 }}>{err}</div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0,
          background: 'var(--surface)',
        }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={Math.abs(diff) > 0.01 || !vendor || !total} onClick={save}>
            Create Contract
          </button>
        </div>
      </div>
    </div>
  );
}

function ContractDetail({ contractId, projectId, onClose }) {
  const [data, setData] = React.useState(null);
  const [ledger, setLedger] = React.useState(null);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({});
  const [history, setHistory] = React.useState([]);
  const [showNewInvoice, setShowNewInvoice] = React.useState(false);
  const [editingInvoiceId, setEditingInvoiceId] = React.useState(null);
  const [busyInvoice, setBusyInvoice] = React.useState({});
  const [err, setErr] = React.useState(null);
  const [activeTab, setActiveTab] = React.useState('overview');

  async function load() {
    try {
      const [d, hist, led] = await Promise.all([
        api.getContract(contractId),
        api.getContractHistory(contractId),
        api.getContractLedger(contractId),
      ]);
      setData(d); setHistory(hist); setLedger(led);
      setForm({
        vendor_name: d.vendor_name, description: d.description || '',
        total_value: String(d.total_value),
        earmarked_amount: d.earmarked_amount != null ? String(d.earmarked_amount) : '',
        contract_date: d.contract_date ? d.contract_date.slice(0, 10) : '',
        reference_number: d.reference_number || '', status: d.status,
      });
    } catch (e) { setErr(e.message); }
  }

  async function saveEdit() {
    setErr(null);
    try {
      await api.updateContract(contractId, {
        ...form,
        total_value: Number(form.total_value),
        earmarked_amount: form.earmarked_amount ? Number(form.earmarked_amount) : null,
      });
      toast('Contract updated');
      setEditing(false);
      await load();
    } catch (e) { setErr(e.message); toast(e.message, 'error'); }
  }

  React.useEffect(() => { load(); }, [contractId]);

  if (!data) return <div className="empty">Loading contract…</div>;
  if (err) return <div className="error">{err}</div>;

  const pendingTM  = ledger ? ledger.tm_pending  || 0 : 0;
  const pendingExp = ledger ? ledger.expense_pending || 0 : 0;

  const tabs = [
    { k: 'overview',      label: 'Overview' },
    { k: 'change-orders', label: `Change Orders${ledger && ledger.pending_co_count > 0 ? ` (${ledger.pending_co_count})` : ''}` },
    { k: 't-and-m',       label: `T&M${pendingTM > 0 ? ` (${fmt.money(pendingTM)} pending)` : ''}` },
    { k: 'expenses',      label: `Expenses${pendingExp > 0 ? ` (${fmt.money(pendingExp)} pending)` : ''}` },
    { k: 'invoices',      label: 'Invoices' },
    { k: 'history',       label: 'History' },
  ];

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 style={{ margin: 0 }}>{data.vendor_name}</h2>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
            <span className={`badge ${data.status}`}>{data.status}</span>
            {data.reference_number && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Ref: {data.reference_number}</span>}
            {data.file_reference && (
              <a href={`/api/files/${encodeURIComponent(data.file_reference)}`} target="_blank" style={{ fontSize: 12 }}>📄 Contract</a>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>
          <button onClick={onClose}>← Back</button>
        </div>
      </div>

      {/* Cost ledger strip */}
      {ledger && !editing && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 1, background: 'var(--border)', borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)', marginBottom: 16,
        }}>
          {[
            { label: 'Initial Contract Amt', val: ledger.original_contract, color: 'var(--text-1)', tip: 'The dollar amount on the signed contract.' },
            { label: '+ Approved COs', val: ledger.approved_cos, color: ledger.approved_cos > 0 ? 'var(--warn)' : 'var(--text-3)', show: true, tip: 'Sum of all approved change orders added to this contract.' },
            { label: '+ T&M', val: ledger.tm_approved, color: ledger.tm_approved > 0 ? 'var(--warn)' : 'var(--text-3)', show: true, tip: 'Approved time & material charges logged against this contract.' },
            { label: '= Commitment', val: ledger.commitment, color: ledger.cost_creep ? 'var(--danger)' : 'var(--accent)', bold: true, tip: 'Total you are committed to pay: Initial + Approved COs + Approved T&M + Approved Expenses.' },
            { label: 'Internal Budget', val: ledger.earmarked_amount, color: 'var(--text-2)', show: true, tip: 'Your internal estimate for total expected spend, including open-ended T&M. Set when creating the contract.' },
            { label: 'Invoiced', val: ledger.invoiced, color: 'var(--text-1)', tip: 'Sum of all approved, pushed, or paid invoices against this contract.' },
            { label: 'Paid', val: ledger.paid, color: 'var(--ok)', tip: 'Amount confirmed paid to the vendor.' },
          ].filter(item => item.val > 0 || item.show).map(item => (
            <div key={item.label} data-tip={item.tip} style={{ background: 'var(--surface)', padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
              <div style={{ fontSize: 14, fontWeight: item.bold ? 700 : 600, color: item.color, fontFamily: 'var(--mono)' }}>
                {item.val != null && item.val > 0 ? fmt.money(item.val) : <span style={{ color: 'var(--text-3)' }}>—</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Alerts */}
      {ledger && ledger.cost_creep && (
        <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 5, background: 'rgba(220,55,55,0.1)', border: '1px solid rgba(220,55,55,0.3)', fontSize: 12, color: 'var(--danger)' }}>
          🔴 Cost creep: commitment {fmt.money(ledger.commitment)} exceeds earmark {fmt.money(ledger.earmarked_amount)}
        </div>
      )}
      {ledger && ledger.pending_co_count > 0 && (
        <div style={{ padding: '8px 14px', marginBottom: 12, borderRadius: 5, background: 'rgba(230,160,30,0.1)', border: '1px solid rgba(230,160,30,0.3)', fontSize: 12, color: 'var(--warn)' }}>
          ⚠️ {ledger.pending_co_count} change order{ledger.pending_co_count > 1 ? 's' : ''} pending — {fmt.money(ledger.pending_cos)} not yet committed
        </div>
      )}

      {editing ? (
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <div><label>Vendor</label><input value={form.vendor_name} onChange={e => setForm({ ...form, vendor_name: e.target.value })} /></div>
          <div><label>Reference #</label><input value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} /></div>
          <div><label>Initial Contract Amount</label><input type="number" step="0.01" value={form.total_value} onChange={e => setForm({ ...form, total_value: e.target.value })} /></div>
          <div><label>Internal Budget <span className="hint">your total expected spend incl. T&M — leave blank if unknown</span></label><input type="number" step="0.01" value={form.earmarked_amount} onChange={e => setForm({ ...form, earmarked_amount: e.target.value })} placeholder="Optional" /></div>
          <div><label>Date</label><input type="date" value={form.contract_date} onChange={e => setForm({ ...form, contract_date: e.target.value })} /></div>
          <div><label>Status</label>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="draft">Draft</option><option value="active">Active</option>
              <option value="closed">Closed</option><option value="approved">Approved</option>
            </select>
          </div>
          <div className="full"><label>Description</label><textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          {err && <div className="full"><div className="error">{err}</div></div>}
          <div className="full"><button className="primary" onClick={saveEdit}>Save changes</button></div>
        </div>
      ) : (
        <>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
            {tabs.map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)} style={{
                padding: '8px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: activeTab === t.k ? 600 : 400,
                color: activeTab === t.k ? 'var(--accent)' : 'var(--text-2)',
                borderBottom: activeTab === t.k ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
              }}>{t.label}</button>
            ))}
          </div>

          {activeTab === 'overview' && ledger && (
            <ContractDashboard contract={data} ledger={ledger} onGoToTab={setActiveTab} />
          )}
          {activeTab === 'overview' && !ledger && (
            <div className="empty">Loading…</div>
          )}

          {activeTab === 'change-orders' && (
            <ChangeOrders contractId={contractId} contractVendor={data.vendor_name}
              onLedgerRefresh={load} />
          )}

          {activeTab === 't-and-m' && (
            <TMCharges contractId={contractId} onLedgerRefresh={load} />
          )}

          {activeTab === 'expenses' && (
            <Expenses contractId={contractId} onLedgerRefresh={load} />
          )}

          {activeTab === 'invoices' && (() => {
            // Full invoice action handlers — mirrors the project-level Invoices component.
            async function invAction(label, fn, id, ...args) {
              setBusyInvoice(b => ({ ...b, [id]: true }));
              try { await fn(id, ...args); toast(label); await load(); }
              catch (e) { toast(e.message, 'error'); }
              finally { setBusyInvoice(b => { const n = { ...b }; delete n[id]; return n; }); }
            }
            async function handleInvApprove(inv) {
              const ok = await confirmDialog('Approve invoice?',
                `Approve ${inv.invoice_number} for ${fmt.moneyPrecise(inv.amount)}?`);
              if (!ok) return;
              await invAction(`${inv.invoice_number} approved`, api.approveInvoice, inv.id);
            }
            async function handleInvHold(inv) {
              const note = prompt('Reason for hold (optional):');
              if (note === null) return;
              await invAction(`${inv.invoice_number} on hold`, api.holdInvoice, inv.id, note);
            }
            async function handleInvReject(inv) {
              const note = await rejectDialog(inv.invoice_number);
              if (!note) return;
              await invAction(`${inv.invoice_number} rejected`, api.rejectInvoice, inv.id, note);
            }
            async function handleInvRevert(inv) {
              const ok = await confirmDialog('Revert to pending?',
                `Revert ${inv.invoice_number} from "${inv.status}" back to "pending"?`);
              if (!ok) return;
              await invAction(`${inv.invoice_number} reverted`, api.revertInvoice, inv.id);
            }

            if (editingInvoiceId) {
              return (
                <InvoiceEdit
                  invoiceId={editingInvoiceId}
                  projectId={projectId}
                  contracts={[data]}
                  onClose={() => { setEditingInvoiceId(null); load(); }}
                />
              );
            }

            const invoices = data.invoices || [];
            const totalApproved = invoices.filter(i => ['approved','pushed','paid'].includes(i.status)).reduce((s,i) => s + Number(i.amount), 0);
            const totalPending  = invoices.filter(i => i.status === 'pending').reduce((s,i) => s + Number(i.amount), 0);
            const totalPaid     = invoices.filter(i => i.status === 'paid').reduce((s,i) => s + Number(i.amount), 0);

            return (
              <>
                {/* Summary strip */}
                {invoices.length > 0 && (
                  <div style={{ display: 'flex', gap: 1, background: 'var(--border)', marginBottom: 14, borderRadius: 6, overflow: 'hidden' }}>
                    {[
                      { label: 'Pending', val: totalPending, color: totalPending > 0 ? 'var(--warn)' : 'var(--text-3)' },
                      { label: 'Approved+', val: totalApproved, color: totalApproved > 0 ? 'var(--ok)' : 'var(--text-3)' },
                      { label: 'Paid', val: totalPaid, color: totalPaid > 0 ? 'var(--ok)' : 'var(--text-3)' },
                    ].map(item => (
                      <div key={item.label} style={{ flex: 1, background: 'var(--surface)', padding: '8px 14px', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{item.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: item.color, fontFamily: 'var(--mono)' }}>
                          {item.val > 0 ? fmt.money(item.val) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                        </div>
                      </div>
                    ))}
                    <div style={{ flex: 'none', background: 'var(--surface)', padding: '8px 14px', display: 'flex', alignItems: 'center' }}>
                      <button className="primary" style={{ fontSize: 12 }} onClick={() => setShowNewInvoice(true)}>+ New Invoice</button>
                    </div>
                  </div>
                )}

                {invoices.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '32px 20px' }}>
                    <div className="empty" style={{ marginBottom: 12 }}>No invoices against this contract yet.</div>
                    <button className="primary" onClick={() => setShowNewInvoice(true)}>+ New Invoice</button>
                  </div>
                ) : (
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Invoice #</th><th>Vendor</th><th>Date</th>
                        <th className="num">Amount</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map(i => (
                        <React.Fragment key={i.id}>
                          <tr className={i.status === 'rejected' ? 'row-over' : ''}>
                            <td>
                              <strong style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{i.invoice_number}</strong>
                              {i.file_reference && <> · <a href={`/api/files/${encodeURIComponent(i.file_reference)}`} target="_blank" onClick={e => e.stopPropagation()} title="View PDF">📄</a></>}
                            </td>
                            <td>{i.vendor_name}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmt.date(i.invoice_date)}</td>
                            <td className="num">{fmt.moneyPrecise(i.amount)}</td>
                            <td><span className={`badge ${i.status}`}>{i.status}</span></td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button style={{ fontSize: 11, marginRight: 4 }} onClick={() => setEditingInvoiceId(i.id)}>Edit</button>
                              {i.status === 'pending' && <>
                                <button className="primary" style={{ fontSize: 11 }} disabled={busyInvoice[i.id]} onClick={() => handleInvApprove(i)}>
                                  {busyInvoice[i.id] ? <span className="spinner"></span> : null}Approve
                                </button>
                                <button style={{ fontSize: 11, marginLeft: 4 }} disabled={busyInvoice[i.id]} onClick={() => handleInvHold(i)}>Hold</button>
                                <button className="danger" style={{ fontSize: 11, marginLeft: 4 }} disabled={busyInvoice[i.id]} onClick={() => handleInvReject(i)}>Reject</button>
                              </>}
                              {i.status === 'on_hold' && <>
                                <button className="primary" style={{ fontSize: 11 }} disabled={busyInvoice[i.id]} onClick={() => handleInvApprove(i)}>Approve</button>
                                <button style={{ fontSize: 11, marginLeft: 4 }} disabled={busyInvoice[i.id]} onClick={() => handleInvRevert(i)}>Release</button>
                              </>}
                              {['approved','rejected','pushed','paid'].includes(i.status) && (
                                <button style={{ fontSize: 11, marginLeft: 4 }} disabled={busyInvoice[i.id]} onClick={() => handleInvRevert(i)}>Revert</button>
                              )}
                              {i.status === 'approved' && (
                                <button style={{ fontSize: 11, marginLeft: 4 }} disabled={busyInvoice[i.id]}
                                  onClick={() => invAction(`${i.invoice_number} pushed`, api.markPushed, i.id)}>Push</button>
                              )}
                              {(i.status === 'approved' || i.status === 'pushed') && (
                                <button style={{ fontSize: 11, marginLeft: 4 }} disabled={busyInvoice[i.id]}
                                  onClick={() => invAction(`${i.invoice_number} marked paid`, api.markPaid, i.id, null)}>Paid</button>
                              )}
                            </td>
                          </tr>
                          {i.rejection_note && (
                            <tr><td colSpan={6}>
                              <div className="rejection-note"><strong>Rejected:</strong> {i.rejection_note}</div>
                            </td></tr>
                          )}
                          {i.hold_reason && (
                            <tr><td colSpan={6}>
                              <div className="rejection-note" style={{ background: 'rgba(245,158,11,0.07)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--warn)' }}>
                                <strong>Hold:</strong> {i.hold_reason}
                              </div>
                            </td></tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                )}

                {showNewInvoice && (
                  <NewInvoiceModal
                    projectId={projectId}
                    contracts={[data]}
                    defaultContractId={contractId}
                    lockedContract={data}
                    onClose={() => setShowNewInvoice(false)}
                    onSaved={() => { setShowNewInvoice(false); toast('Invoice created'); load(); }}
                  />
                )}
              </>
            );
          })()}

          {activeTab === 'history' && history.length > 0 && (
            <div className="activity-log">
              {history.map(h => (
                <div key={h.id} className="activity-item">
                  <span className={`activity-action ${h.action}`}>{h.action}</span>
                  <span style={{ flex: 1 }}>{h.detail}</span>
                  <span className="hint">{h.changed_by_name} · {fmt.datetime(h.changed_at)}</span>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'history' && history.length === 0 && (
            <div className="empty">No history yet.</div>
          )}
        </>
      )}
    </div>
  );
}

// ── Contract-level Dashboard (Overview tab) ──────────────────────────────────

function ContractDashboard({ contract: c, ledger: l, onGoToTab }) {
  const original    = l.original_contract;
  const commitment  = l.commitment;
  const invoiced    = l.invoiced;
  const paid        = l.paid;
  const earmarked   = l.earmarked_amount;
  const outstanding = invoiced - paid;

  // Spend story — the core metric
  const overInitial    = invoiced - original;
  const overInitialPct = original > 0 ? ((Math.abs(overInitial) / original) * 100).toFixed(0) : 0;
  const isOverInitial  = overInitial > 0.01;
  const underInitial   = original > invoiced && invoiced > 0;

  // Burn bar scale: earmark if set, otherwise generous headroom above invoiced/original
  const barScale = earmarked
    ? Math.max(earmarked, invoiced * 1.05)
    : Math.max(original * 1.5, invoiced * 1.1, 100);
  function barPct(val) {
    if (!barScale || val <= 0) return '0%';
    return Math.min((val / barScale) * 100, 100).toFixed(2) + '%';
  }
  const initialTickPct = barScale > 0 ? Math.min((original / barScale) * 100, 100).toFixed(2) + '%' : '0%';

  // Remaining against earmark (internal budget)
  const remainingToEarmark = earmarked ? earmarked - invoiced : null;
  const overEarmark = earmarked && invoiced > earmarked;

  // Health
  let health = 'ok';
  if (overEarmark || l.cost_creep) health = 'danger';
  else if (isOverInitial || l.pending_co_count > 0) health = 'warn';

  const hc = {
    ok:     { color: 'var(--ok)',     bg: 'rgba(34,197,94,0.07)',  border: 'rgba(34,197,94,0.2)',   icon: '●' },
    warn:   { color: 'var(--warn)',   bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.25)', icon: '▲' },
    danger: { color: 'var(--danger)', bg: 'rgba(239,68,68,0.09)',  border: 'rgba(239,68,68,0.28)',  icon: '■' },
  }[health];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Status banner ── */}
      <div style={{ padding: '12px 16px', borderRadius: 7, background: hc.bg, border: `1px solid ${hc.border}`, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ color: hc.color, fontSize: 13, marginTop: 1, flexShrink: 0 }}>{hc.icon}</span>
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 12 }}>
          {invoiced === 0 && <span style={{ color: 'var(--text-2)' }}>No invoices yet — {fmt.money(original)} signed contract on the books.</span>}
          {isOverInitial && (
            <span style={{ color: 'var(--warn)', fontWeight: 600 }}>
              +{fmt.money(overInitial)} over initial contract ({overInitialPct}%) — T&M and additional services are running.
            </span>
          )}
          {underInitial && <span style={{ color: 'var(--text-2)' }}>{fmt.money(invoiced)} invoiced of {fmt.money(original)} contract — {fmt.money(original - invoiced)} remaining.</span>}
          {overEarmark && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Over internal budget by {fmt.money(invoiced - earmarked)} — earmark was {fmt.money(earmarked)}.</span>}
          {earmarked && !overEarmark && invoiced > 0 && (
            <span style={{ color: 'var(--text-2)' }}>{fmt.money(remainingToEarmark)} remaining of {fmt.money(earmarked)} internal budget.</span>
          )}
          {l.pending_co_count > 0 && (
            <span style={{ color: 'var(--warn)' }}>
              ⚠ {l.pending_co_count} CO{l.pending_co_count > 1 ? 's' : ''} pending — {fmt.money(l.pending_cos)} not yet committed.
            </span>
          )}
        </div>
      </div>

      {/* ── Four key numbers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: earmarked ? 'repeat(4,1fr)' : 'repeat(3,1fr)', gap: 1, background: 'var(--border)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <ContractStat
          label="Initial Contract Amt"
          value={original}
          sublabel="What was signed"
          color="var(--text-1)"
          topBar="var(--border-2)"
          tip="The original signed contract value — the number the vendor committed to at execution."
        />
        <ContractStat
          label="Total Invoiced"
          value={invoiced}
          sublabel={
            invoiced === 0 ? 'no invoices yet' :
            isOverInitial ? `+${overInitialPct}% over initial` :
            original > 0 ? `${Math.round((invoiced/original)*100)}% of initial` : ''
          }
          color={overEarmark ? 'var(--danger)' : isOverInitial ? 'var(--warn)' : 'var(--text-1)'}
          topBar={overEarmark ? 'var(--danger)' : isOverInitial ? 'var(--warn)' : null}
          tip="Sum of all invoices submitted against this contract — includes T&M and additional services billed above the initial amount."
        />
        <ContractStat
          label="Paid"
          value={paid}
          sublabel={invoiced > 0 && paid > 0 ? `${Math.round((paid/invoiced)*100)}% of invoiced` : invoiced > 0 ? `${fmt.money(outstanding)} outstanding` : ''}
          color={paid > 0 ? 'var(--ok)' : 'var(--text-3)'}
          topBar={paid > 0 ? 'var(--ok)' : null}
          tip="Cash actually sent to the vendor. Outstanding = Total Invoiced minus Paid."
        />
        {earmarked && (
          <ContractStat
            label="Internal Budget"
            value={earmarked}
            sublabel={
              remainingToEarmark >= 0
                ? `${fmt.money(remainingToEarmark)} remaining`
                : `${fmt.money(Math.abs(remainingToEarmark))} OVER budget`
            }
            color={overEarmark ? 'var(--danger)' : remainingToEarmark < earmarked * 0.2 ? 'var(--warn)' : 'var(--text-2)'}
            topBar={null}
            tip="Your internal estimate of total expected spend — set higher than the contract to account for T&M tail, expenses, and additional services."
          />
        )}
      </div>

      {/* ── Spend bar ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Total Spend vs. Budget</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {earmarked
              ? `${fmt.money(invoiced)} invoiced of ${fmt.money(earmarked)} budget`
              : `${fmt.money(invoiced)} invoiced`}
          </span>
        </div>

        {/* Bar */}
        <div style={{ height: 22, borderRadius: 4, background: 'var(--surface-3)', overflow: 'visible', display: 'flex', position: 'relative' }}>
          {/* Paid segment */}
          {paid > 0 && (
            <div style={{ width: barPct(paid), background: 'var(--ok)', height: '100%', borderRadius: '4px 0 0 4px', transition: 'width 0.5s', flexShrink: 0 }}
              title={`Paid: ${fmt.money(paid)}`} />
          )}
          {/* Outstanding (invoiced not paid) */}
          {outstanding > 0 && (
            <div style={{ width: barPct(outstanding), background: '#3b82f6', height: '100%', transition: 'width 0.5s', flexShrink: 0 }}
              title={`Outstanding: ${fmt.money(outstanding)}`} />
          )}
          {/* Initial contract tick mark — always shown */}
          {original > 0 && (
            <div style={{
              position: 'absolute', left: initialTickPct, top: -4, bottom: -4,
              width: 2, background: 'var(--text-1)', opacity: 0.7, borderRadius: 1,
              zIndex: 2,
            }} title={`Initial contract: ${fmt.money(original)}`} />
          )}
        </div>

        {/* Tick label */}
        <div style={{ position: 'relative', height: 18, marginTop: 4 }}>
          <div style={{
            position: 'absolute', left: initialTickPct, transform: 'translateX(-50%)',
            fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap',
          }}>
            ↑ Initial {fmt.money(original)}
          </div>
          {earmarked && (
            <div style={{ position: 'absolute', right: 0, fontSize: 10, color: 'var(--text-3)' }}>
              Budget {fmt.money(earmarked)}
            </div>
          )}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Paid', val: paid, color: 'var(--ok)' },
            { label: 'Invoiced (outstanding)', val: outstanding, color: '#3b82f6' },
            isOverInitial && { label: `Over initial contract`, val: overInitial, color: 'var(--warn)' },
          ].filter(Boolean).filter(i => i.val > 0.01).map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-2)' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, flexShrink: 0, display: 'inline-block' }} />
              {item.label}: <strong style={{ color: 'var(--text-1)' }}>{fmt.money(item.val)}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* ── Commitment breakdown — only if there are additions ── */}
      {(l.approved_cos > 0 || l.tm_approved > 0 || l.expense_approved > 0 || l.pending_co_count > 0) && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>How commitment is built</div>
          <ContractLedgerRow label="Initial Contract Amount" value={original} total={commitment} />
          {l.approved_cos > 0 && <ContractLedgerRow label="+ Approved Change Orders" value={l.approved_cos} total={commitment} color="var(--warn)" onClick={() => onGoToTab('change-orders')} />}
          {l.tm_approved > 0 && <ContractLedgerRow label="+ Approved T&M" value={l.tm_approved} total={commitment} color="var(--warn)" onClick={() => onGoToTab('t-and-m')} />}
          {l.expense_approved > 0 && <ContractLedgerRow label="+ Approved Expenses" value={l.expense_approved} total={commitment} color="var(--warn)" onClick={() => onGoToTab('expenses')} />}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>= Total Commitment</span>
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', color: l.cost_creep ? 'var(--danger)' : 'var(--accent)' }}>{fmt.money(commitment)}</span>
          </div>
          {l.pending_co_count > 0 && (
            <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 5, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', fontSize: 12, color: 'var(--warn)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}
              onClick={() => onGoToTab('change-orders')}>
              <span>⏳ {l.pending_co_count} CO{l.pending_co_count > 1 ? 's' : ''} pending — if approved, commitment → {fmt.money(commitment + l.pending_cos)}</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Review →</span>
            </div>
          )}
        </div>
      )}

      {/* ── Contract meta + QB allocation ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Contract Details</div>
          {c.description && <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>{c.description}</div>}
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3 }}>Date: <span style={{ color: 'var(--text-2)' }}>{fmt.date(c.contract_date)}</span></div>
          {c.reference_number && <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 3 }}>Reference: <span style={{ color: 'var(--text-2)' }}>{c.reference_number}</span></div>}
          {c.file_reference && <div style={{ marginTop: 8 }}><a href={`/api/files/${encodeURIComponent(c.file_reference)}`} target="_blank" style={{ fontSize: 12 }}>📄 View contract PDF</a></div>}
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>QB Code Allocation</div>
          <table className="data" style={{ margin: 0 }}>
            <thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
            <tbody>{c.lines.map(ln => (
              <tr key={ln.id}><td className="code">{ln.code}</td><td>{ln.name}</td><td className="num">{fmt.moneyPrecise(ln.amount)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onGoToTab('change-orders')} style={{ fontSize: 12, flex: 1, padding: '10px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)' }}>
          + Change Order {l.pending_co_count > 0 && <span style={{ color: 'var(--warn)', fontWeight: 700 }}>({l.pending_co_count} pending)</span>}
        </button>
        <button onClick={() => onGoToTab('invoices')} style={{ fontSize: 12, flex: 1, padding: '10px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-2)' }}>
          + Invoice {outstanding > 0 && <span style={{ color: 'var(--text-3)' }}>({fmt.money(outstanding)} outstanding)</span>}
        </button>
      </div>
    </div>
  );
}

function ContractStat({ label, value, sublabel, color, topBar, tip }) {
  return (
    <div data-tip={tip} style={{ background: 'var(--surface)', padding: '16px 18px', position: 'relative' }}>
      {topBar && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: topBar, borderRadius: '2px 2px 0 0' }} />}
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color, lineHeight: 1, marginBottom: 5, letterSpacing: '-0.02em' }}>
        {value > 0 ? fmt.money(value) : <span style={{ color: 'var(--text-3)', fontSize: 16 }}>—</span>}
      </div>
      {sublabel && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{sublabel}</div>}
    </div>
  );
}

function ContractLedgerRow({ label, value, total, color, onClick }) {
  const barPct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)', flex: 1 }}>{label}</span>
      <div style={{ width: 80, height: 4, borderRadius: 2, background: 'var(--surface-3)', flexShrink: 0 }}>
        <div style={{ width: `${Math.min(barPct, 100)}%`, height: '100%', background: color || 'var(--text-3)', borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)', color: color || 'var(--text-1)', minWidth: 80, textAlign: 'right' }}>{fmt.money(value)}</span>
    </div>
  );
}

function cpct(val, total) {
  if (!total || val <= 0) return '0%';
  return Math.min((val / total) * 100, 100).toFixed(2) + '%';
}

// QB Code picker with type-ahead filtering (replaces the long <select> dropdown).
function QbCodePicker({ codes, value, onChange }) {
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const selected = codes.find(c => String(c.id) === String(value));

  const filtered = search
    ? codes.filter(c => `${c.code} ${c.name}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20)
    : codes.slice(0, 20);

  React.useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(c) { onChange(String(c.id)); setSearch(''); setOpen(false); }

  return (
    <div className="combo" ref={ref} style={{ minWidth: 240 }}>
      <input
        value={open ? search : (selected ? `${selected.code} — ${selected.name}` : '')}
        placeholder="Type to search QB codes…"
        onFocus={() => { setOpen(true); setSearch(''); }}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
      />
      {open && (
        <ul className="combo-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {filtered.length === 0 && <li className="combo-empty">No matches</li>}
          {filtered.map(c => (
            <li key={c.id} className={`combo-item ${String(c.id) === String(value) ? 'active' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(c); }}>
              <span className="code" style={{ fontFamily: 'monospace', marginRight: 8 }}>{c.code}</span>{c.name}
            </li>
          ))}
          {codes.length > 20 && filtered.length >= 20 && <li className="combo-empty">Type to narrow results…</li>}
        </ul>
      )}
    </div>
  );
}

window.QbCodePicker = QbCodePicker;
