// Inline confidence dot shown next to auto-filled contract fields.
function ContractConfidenceDot({ level }) {
  if (!level) return null;
  const map = {
    high:   { color: '#16a34a', tip: 'High confidence — Claude found this clearly in the document' },
    medium: { color: '#d97706', tip: 'Medium confidence — verify before saving' },
    low:    { color: '#dc2626', tip: 'Low confidence — Claude guessed this; please verify' },
  };
  const m = map[level];
  if (!m) return null;
  return (
    <span title={m.tip} style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: m.color, marginLeft: 5, verticalAlign: 'middle',
      boxShadow: `0 0 4px ${m.color}88`,
    }} />
  );
}

// Compute overage severity for a single contract row (invoiced vs initial)
function contractOverSev(c) {
  const invoiced = parseFloat(c.invoiced_amount) || 0;
  const initial  = parseFloat(c.total_value) || 0;
  if (initial <= 0 || invoiced <= initial) return null;
  const pct = (invoiced - initial) / initial * 100;
  if (pct < 10)  return { sev: 'low',      pct, color: '#d97706', bg: '#fffbeb', border: '#fde68a', label: 'LOW' };
  if (pct < 25)  return { sev: 'moderate', pct, color: '#c4522a', bg: '#fff7f4', border: '#fcd9cc', label: 'MODERATE' };
  if (pct < 50)  return { sev: 'high',     pct, color: '#b04824', bg: '#fef3ee', border: '#f9b49a', label: 'HIGH' };
  return             { sev: 'critical', pct, color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'CRITICAL' };
}

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

  // Summary stats
  const totalValue    = contracts.reduce((s, c) => s + (Number(c.total_value) || 0), 0);
  const totalInvoiced = contracts.reduce((s, c) => s + (Number(c.invoiced_amount) || 0), 0);
  const activeCount   = contracts.filter(c => c.status === 'active').length;

  return (
    <div className="panel">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Contracts</h2>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
            {contracts.length} contract{contracts.length !== 1 ? 's' : ''}
            {activeCount > 0 && <span style={{ marginLeft: 8, color: 'var(--ok)', fontWeight: 600 }}>{activeCount} active</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href={`/api/projects/${projectId}/contracts/export`} target="_blank" className="btn" style={{ fontSize: 12 }}>Export CSV</a>
          <button className="primary" onClick={() => setShowNew(true)}>+ New Contract</button>
        </div>
      </div>

      {/* Summary strip */}
      {contracts.length > 0 && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {[
            { label: 'Total Contracted', value: fmt.money(totalValue) },
            { label: 'Total Invoiced',   value: fmt.money(totalInvoiced) },
            { label: 'Contracts',        value: contracts.length },
          ].map((s, i) => (
            <div key={i} style={{
              flex: 1, padding: '12px 18px',
              borderRight: i < 2 ? '1px solid var(--border)' : 'none',
              background: 'var(--surface-2)',
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input placeholder="Filter by vendor" value={filter.vendor}
               onChange={(e)=>setFilter({...filter, vendor: e.target.value})}
               style={{ flex: '1 1 160px', minWidth: 0 }} />
        <select value={filter.status} onChange={(e)=>setFilter({...filter, status: e.target.value})} style={{ width: 130 }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filter.sort} onChange={(e)=>setFilter({...filter, sort: e.target.value})} style={{ width: 130 }}>
          <option value="">Sort: Date</option>
          <option value="vendor">Sort: Vendor</option>
          <option value="amount">Sort: Amount</option>
          <option value="status">Sort: Status</option>
        </select>
      </div>

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? <div className="empty">Loading…</div>
       : contracts.length === 0 ? <div className="empty">No contracts match these filters.</div>
       : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {contracts.map((c) => {
            const flag = contractOverSev(c);
            const invoiced = Number(c.invoiced_amount) || 0;
            const total    = Number(c.total_value) || 0;
            const invoicedPct = total > 0 ? Math.min((invoiced / total) * 100, 100) : 0;
            const overPct     = total > 0 && invoiced > total ? Math.min(((invoiced - total) / total) * 100, 50) : 0;

            return (
              <div key={c.id}
                onClick={() => setSelected(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 16,
                  padding: '14px 18px',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderLeft: `4px solid ${flag ? flag.color : 'var(--border)'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'box-shadow 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.1)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
              >
                {/* Vendor + description */}
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.vendor_name}
                    </span>
                    {flag && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
                        padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                        background: flag.bg, color: flag.color, border: `1px solid ${flag.border}`,
                      }}>{flag.label}</span>
                    )}
                    {c.file_reference && (
                      <a href={`/api/files/${encodeURIComponent(c.file_reference)}`}
                         target="_blank" onClick={e => e.stopPropagation()}
                         title="View PDF" style={{ flexShrink: 0, fontSize: 13, textDecoration: 'none' }}>📄</a>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.description || <span style={{ fontStyle: 'italic' }}>No description</span>}
                    {c.contract_date && <span style={{ marginLeft: 10 }}>{fmt.date(c.contract_date)}</span>}
                  </div>
                </div>

                {/* Mini invoice bar */}
                <div style={{ flex: '0 0 120px' }}>
                  <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'visible', position: 'relative', marginBottom: 4 }}>
                    {invoicedPct > 0 && (
                      <div style={{
                        width: `${invoicedPct}%`, height: '100%',
                        background: flag ? flag.color : '#16a34a',
                        borderRadius: 3, transition: 'width 0.3s',
                      }} />
                    )}
                    {overPct > 0 && (
                      <div style={{
                        position: 'absolute', top: 0, right: `-${overPct * 0.6}%`,
                        width: `${overPct * 0.6}%`, height: '100%',
                        background: '#dc2626', borderRadius: '0 3px 3px 0',
                        boxShadow: '0 0 4px rgba(220,38,38,0.5)',
                      }} />
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', textAlign: 'right' }}>
                    {invoicedPct.toFixed(0)}% invoiced
                  </div>
                </div>

                {/* Amounts */}
                <div style={{ flex: '0 0 110px', textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>{fmt.money(total)}</div>
                  <div style={{ fontSize: 11.5, color: flag ? flag.color : 'var(--text-3)', fontWeight: flag ? 600 : 400 }}>
                    {fmt.money(invoiced)} invoiced
                  </div>
                </div>

                {/* Status */}
                <div style={{ flex: '0 0 64px', textAlign: 'right' }}>
                  <span className={`badge ${c.status}`}>{c.status}</span>
                </div>
              </div>
            );
          })}
        </div>
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
  const [confidence, setConfidence] = React.useState({});
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
        const filled=[];
        if(e.vendor_name&&!vendor){setVendor(e.vendor_name);filled.push('vendor_name');}
        if(e.total_value&&(!total||Number(total)===0)){setTotal(String(e.total_value));filled.push('total_value');}
        if(e.contract_date&&!date){setDate(e.contract_date);filled.push('contract_date');}
        if(e.reference_number&&!ref){setRef(e.reference_number);filled.push('reference_number');}
        if(e.description) setDescription(d=>d?`${d}\n\n${e.description}`:e.description);
        if(e.confidence){
          const conf={};
          filled.forEach(f=>{if(e.confidence[f])conf[f]=e.confidence[f];});
          setConfidence(conf);
        }
        setExtractNote('Fields pre-filled from PDF — colored dots show extraction confidence.');
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
                <label data-tip="The company or individual you are contracting with. Type to search existing vendors.">
                  Vendor <ContractConfidenceDot level={confidence.vendor_name} />
                </label>
                <SmartSearch value={vendor} onChange={v => { setVendor(v); setConfidence(c=>({...c,vendor_name:undefined})); }} fetcher={q => api.searchVendors(q)} placeholder="Search vendors" />
              </div>
              <div>
                <label data-tip="The vendor's own reference number or proposal number. Used for matching their invoices later.">
                  Reference number <ContractConfidenceDot level={confidence.reference_number} />
                </label>
                <input value={ref} onChange={e => { setRef(e.target.value); setConfidence(c=>({...c,reference_number:undefined})); }} />
              </div>
              <div>
                <label data-tip="The dollar amount on the signed contract — the fixed lump sum only. Do not include estimated T&M.">
                  Initial Contract Amount <ContractConfidenceDot level={confidence.total_value} />
                </label>
                <input type="number" step="0.01" value={total} onChange={e => { setTotal(e.target.value); setConfidence(c=>({...c,total_value:undefined})); }} placeholder="0.00" />
              </div>
              <div>
                <label data-tip="Your internal budget for what this vendor will actually cost you — including open-ended T&M, meetings, and additional services. Leave blank if truly unknown. The dashboard uses this as the warning threshold.">Internal Budget</label>
                <input type="number" step="0.01" value={earmarked} onChange={e => setEarmarked(e.target.value)} placeholder="Optional — incl. T&M tail" />
              </div>
              <div>
                <label data-tip="The date the contract was signed or became effective.">
                  Contract date <ContractConfidenceDot level={confidence.contract_date} />
                </label>
                <input type="date" value={date} onChange={e => { setDate(e.target.value); setConfidence(c=>({...c,contract_date:undefined})); }} />
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
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 18 }}>
            {tabs.map(t => (
              <button key={t.k} onClick={() => setActiveTab(t.k)} style={{
                padding: '10px 18px', background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: activeTab === t.k ? 700 : 500,
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

          {activeTab === 'history' && history.length === 0 && (
            <div className="empty">No history yet.</div>
          )}
          {activeTab === 'history' && history.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {history.map((h, idx) => {
                const cfg = {
                  // contract events
                  created:          { icon: '◈', color: '#16a34a', label: 'Contract created' },
                  edited:           { icon: '✎', color: '#2563eb', label: 'Contract edited'  },
                  // invoice events
                  created_invoice:  { icon: '📄', color: '#6b7280', label: 'Invoice submitted' },
                  approved:         { icon: '✓',  color: '#16a34a', label: 'Approved'          },
                  rejected:         { icon: '✕',  color: '#dc2626', label: 'Rejected'          },
                  on_hold:          { icon: '⏸',  color: '#d97706', label: 'Put on hold'       },
                  pushed:           { icon: '→',  color: '#0891b2', label: 'Pushed to QB'      },
                  paid:             { icon: '$',  color: '#16a34a', label: 'Marked paid'       },
                  reverted:         { icon: '↩',  color: '#9333ea', label: 'Reverted'          },
                  // change order events
                  created_co:       { icon: '＋', color: '#d97706', label: 'CO submitted'      },
                  approved_co:      { icon: '✓',  color: '#16a34a', label: 'CO approved'       },
                  rejected_co:      { icon: '✕',  color: '#dc2626', label: 'CO rejected'       },
                  // T&M events (written to contract_logs)
                  tm_added:         { icon: '⏱',  color: '#d97706', label: 'T&M added'         },
                  tm_approved:      { icon: '✓',  color: '#16a34a', label: 'T&M approved'      },
                  tm_rejected:      { icon: '✕',  color: '#dc2626', label: 'T&M rejected'      },
                  tm_deleted:       { icon: '✕',  color: '#9ca3af', label: 'T&M deleted'       },
                  // Expense events
                  expense_added:    { icon: '🧾', color: '#d97706', label: 'Expense added'     },
                  expense_approved: { icon: '✓',  color: '#16a34a', label: 'Expense approved'  },
                  expense_rejected: { icon: '✕',  color: '#dc2626', label: 'Expense rejected'  },
                  expense_deleted:  { icon: '✕',  color: '#9ca3af', label: 'Expense deleted'   },
                }[h.action] || { icon: '·', color: '#9ca3af', label: h.action };

                // Derive a clean action label from source + action for CO/invoice
                let actionLabel = cfg.label;
                if (h.source === 'invoice' && h.action === 'created') actionLabel = 'Invoice submitted';
                if (h.source === 'change_order' && h.action === 'created') actionLabel = 'CO submitted';
                if (h.source === 'change_order' && h.action === 'approved') actionLabel = 'CO approved';
                if (h.source === 'change_order' && h.action === 'rejected') actionLabel = 'CO rejected';
                if (h.source === 'change_order' && h.action === 'edited') actionLabel = 'CO edited';

                return (
                  <div key={`${h.source}-${h.id}-${idx}`} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '10px 14px',
                    borderRadius: 7,
                    background: idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                    border: '1px solid var(--border)',
                  }}>
                    {/* Icon */}
                    <div style={{
                      flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                      background: `${cfg.color}18`, border: `1px solid ${cfg.color}40`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, color: cfg.color, fontWeight: 700, marginTop: 1,
                    }}>{cfg.icon}</div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: cfg.color }}>{actionLabel}</span>
                        {h.amount != null && Number(h.amount) > 0 && (
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', fontFamily: 'var(--mono)' }}>
                            {fmt.moneyPrecise(h.amount)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.4 }}>
                        {h.detail}
                      </div>
                    </div>

                    {/* Who + when */}
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{h.changed_by_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{fmt.datetime(h.changed_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Contract-level Dashboard (Overview tab) ──────────────────────────────────

function ContractDashboard({ contract: c, ledger: l, onGoToTab }) {
  const original      = Number(l.original_contract) || 0;
  const commitment    = Number(l.commitment) || 0;      // contract + approved COs only
  const totalExposure = Number(l.total_exposure) || commitment; // commitment + T&M + expenses
  const invoiced      = Number(l.invoiced) || 0;
  const paid          = Number(l.paid) || 0;
  const earmarked     = Number(l.earmarked_amount) || 0;
  const approvedCOs   = Number(l.approved_cos) || 0;
  const tmApproved    = Number(l.tm_approved) || 0;
  const expApproved   = Number(l.expense_approved) || 0;

  const outstanding         = Math.max(invoiced - paid, 0);
  // Committed-not-invoiced: total exposure minus what's already been invoiced
  const committedUninvoiced = Math.max(totalExposure - invoiced, 0);
  const buffer              = earmarked > 0 ? earmarked - totalExposure : null;
  const overBudget          = earmarked > 0 && totalExposure > earmarked;
  const overInitial         = commitment > original;
  const overInitialAmt      = overInitial ? commitment - original : 0;

  // Budget pressure: total_exposure vs earmarked
  const budgetUsedPct = earmarked > 0 ? (totalExposure / earmarked) * 100 : null;
  let budgetPressure = null;
  if (budgetUsedPct !== null) {
    if (budgetUsedPct >= 100) budgetPressure = 'danger';
    else if (budgetUsedPct >= 90) budgetPressure = 'warning';
    else if (budgetUsedPct >= 75) budgetPressure = 'caution';
  }

  // Burn bar: scale = earmarked if set, otherwise totalExposure * 1.4
  const barScale = earmarked > 0
    ? Math.max(earmarked, totalExposure * 1.02)
    : Math.max(original * 1.5, totalExposure * 1.15, 100);

  function pct(val) {
    if (!barScale || val <= 0) return 0;
    return Math.min((val / barScale) * 100, 100);
  }

  const paidPct              = pct(paid);
  const outstandingPct       = pct(outstanding);
  const committedUninvPct    = pct(committedUninvoiced);
  const initialTickPct       = pct(original);
  const earmarkedTickPct     = earmarked > 0 ? pct(earmarked) : null;

  // Budget callout config
  const budgetCallout = overBudget ? {
    bg: '#fef2f2', border: '#fecaca', color: '#dc2626',
    title: 'GET MORE MONEY',
    body: `Commitment exceeds budget by ${fmt.money(commitment - earmarked)}`,
    icon: '🔴',
  } : budgetPressure === 'warning' ? {
    bg: '#fff7ed', border: '#fed7aa', color: '#c2410c',
    title: 'BUDGET RUNNING LOW',
    body: `Only ${fmt.money(buffer)} left — ${(100 - budgetUsedPct).toFixed(1)}% of budget remaining`,
    icon: '⚠',
  } : budgetPressure === 'caution' ? {
    bg: '#fffbeb', border: '#fde68a', color: '#d97706',
    title: 'Watch the budget',
    body: `${fmt.money(buffer)} remaining — ${(100 - budgetUsedPct).toFixed(1)}% of budget left`,
    icon: '◎',
  } : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Budget alert banner — the most important signal ── */}
      {budgetCallout && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 8,
          background: budgetCallout.bg,
          border: `1px solid ${budgetCallout.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>{budgetCallout.icon}</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: budgetCallout.color, letterSpacing: '-0.01em' }}>
              {budgetCallout.title}
            </div>
            <div style={{ fontSize: 13, color: budgetCallout.color, opacity: 0.85, marginTop: 2 }}>
              {budgetCallout.body}
            </div>
          </div>
          {overBudget && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Over by</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--mono)', color: '#dc2626', letterSpacing: '-0.02em' }}>
                {fmt.money(commitment - earmarked)}
              </div>
            </div>
          )}
          {!overBudget && earmarked > 0 && (
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: budgetCallout.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Remaining</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--mono)', color: budgetCallout.color, letterSpacing: '-0.02em' }}>
                {fmt.money(buffer)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── The full spend story — always shown ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>

        {/* Story headline row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--border)' }}>
          <ContractStat
            label="Initial Contract"
            value={original}
            sublabel="What was signed"
            color="var(--text-1)"
            topBar="var(--border-2)"
            tip="The original signed contract value — the number the vendor committed to at execution."
          />
          <ContractStat
            label="Commitment"
            value={commitment}
            sublabel={approvedCOs > 0 ? `+${fmt.money(approvedCOs)} in COs` : 'Contract + approved COs'}
            color={overBudget ? 'var(--danger)' : overInitial ? 'var(--warn)' : 'var(--accent)'}
            topBar={overBudget ? 'var(--danger)' : overInitial ? 'var(--warn)' : 'var(--accent)'}
            tip="What you are legally on the hook for: Initial contract + all approved change orders. T&M and expenses are tracked separately as additional exposure."
          />
          <ContractStat
            label="Invoiced to Date"
            value={invoiced}
            sublabel={commitment > 0 ? `${Math.round((invoiced / commitment) * 100)}% of commitment` : 'no invoices yet'}
            color={invoiced > commitment ? 'var(--danger)' : 'var(--text-1)'}
            topBar={null}
            tip="What vendors have actually billed. Should not exceed Total Commitment."
          />
          {earmarked > 0 ? (
            <ContractStat
              label="Internal Budget"
              value={earmarked}
              sublabel={
                overBudget
                  ? `${fmt.money(commitment - earmarked)} OVER budget`
                  : buffer !== null ? `${fmt.money(buffer)} remaining` : ''
              }
              color={overBudget ? 'var(--danger)' : budgetPressure === 'warning' ? 'var(--warn)' : 'var(--text-2)'}
              topBar={overBudget ? 'var(--danger)' : null}
              tip="Your internal estimate for total expected spend including T&M, change orders, and buffer. Set when the contract was created."
            />
          ) : (
            <ContractStat
              label="Paid"
              value={paid}
              sublabel={invoiced > 0 && paid > 0 ? `${Math.round((paid / invoiced) * 100)}% of invoiced` : invoiced > 0 ? `${fmt.money(outstanding)} outstanding` : ''}
              color={paid > 0 ? 'var(--ok)' : 'var(--text-3)'}
              topBar={paid > 0 ? 'var(--ok)' : null}
              tip="Cash actually sent to the vendor."
            />
          )}
        </div>

        {/* ── Burn bar — full story ── */}
        <div style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
              Commitment vs. Budget
            </span>
            {earmarked > 0 && budgetUsedPct !== null && (
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: overBudget ? '#dc2626' : budgetPressure === 'warning' ? '#c2410c' : budgetPressure === 'caution' ? '#d97706' : 'var(--ok)',
              }}>
                {budgetUsedPct.toFixed(1)}% of budget used
              </span>
            )}
          </div>

          {/* The bar */}
          <div style={{ position: 'relative', height: 28, borderRadius: 6, background: 'var(--surface-3)', overflow: 'visible' }}>

            {/* Background track */}
            <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'var(--surface-3)' }} />

            {/* Paid segment — green */}
            {paidPct > 0 && (
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${paidPct}%`,
                background: 'var(--ok)',
                borderRadius: outstandingPct > 0 || committedUninvPct > 0 ? '6px 0 0 6px' : 6,
                transition: 'width 0.6s ease',
              }} title={`Paid: ${fmt.money(paid)}`} />
            )}

            {/* Outstanding segment — amber */}
            {outstandingPct > 0 && (
              <div style={{
                position: 'absolute', left: `${paidPct}%`, top: 0, bottom: 0,
                width: `${outstandingPct}%`,
                background: 'var(--amber)',
                borderRadius: committedUninvPct > 0 ? 0 : '0 6px 6px 0',
                transition: 'width 0.6s ease',
              }} title={`Invoiced (not yet paid): ${fmt.money(outstanding)}`} />
            )}

            {/* Committed-not-yet-invoiced — terracotta, slightly transparent */}
            {committedUninvPct > 0 && (
              <div style={{
                position: 'absolute', left: `${paidPct + outstandingPct}%`, top: 0, bottom: 0,
                width: `${committedUninvPct}%`,
                background: 'rgba(196,82,42,0.55)',
                backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.12) 4px, rgba(255,255,255,0.12) 8px)',
                borderRadius: '0 6px 6px 0',
                transition: 'width 0.6s ease',
              }} title={`Committed but not yet invoiced: ${fmt.money(committedUninvoiced)}`} />
            )}

            {/* Initial contract tick — dark vertical line */}
            {initialTickPct > 0 && initialTickPct < 99 && (
              <div style={{
                position: 'absolute', left: `${initialTickPct}%`,
                top: -5, bottom: -5,
                width: 2, background: 'var(--text-1)', opacity: 0.5,
                borderRadius: 1, zIndex: 3,
              }} title={`Initial contract: ${fmt.money(original)}`} />
            )}

            {/* Earmarked (budget) end line — only if earmarked < barScale */}
            {earmarkedTickPct !== null && earmarkedTickPct < 99 && (
              <div style={{
                position: 'absolute', left: `${earmarkedTickPct}%`,
                top: -7, bottom: -7,
                width: 2,
                background: overBudget ? '#dc2626' : 'var(--accent)',
                opacity: 0.8,
                borderRadius: 1, zIndex: 3,
              }} title={`Internal budget: ${fmt.money(earmarked)}`} />
            )}

            {/* Over-budget overflow zone */}
            {overBudget && earmarkedTickPct !== null && (
              <div style={{
                position: 'absolute', left: `${earmarkedTickPct}%`, right: 0, top: 0, bottom: 0,
                background: 'rgba(220,38,38,0.15)',
                border: '2px solid rgba(220,38,38,0.4)',
                borderLeft: 'none',
                borderRadius: '0 6px 6px 0',
              }} />
            )}
          </div>

          {/* Tick labels */}
          <div style={{ position: 'relative', height: 22, marginTop: 6 }}>
            {initialTickPct > 1 && initialTickPct < 95 && (
              <div style={{
                position: 'absolute', left: `${initialTickPct}%`,
                transform: 'translateX(-50%)',
                fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap',
              }}>
                ↑ Initial {fmt.money(original)}
              </div>
            )}
            {earmarked > 0 && (
              <div style={{
                position: 'absolute', right: 0,
                fontSize: 11,
                color: overBudget ? '#dc2626' : 'var(--text-3)',
                fontWeight: overBudget ? 700 : 400,
              }}>
                {overBudget ? '⚠ ' : ''}Budget {fmt.money(earmarked)}
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 18, marginTop: 6, flexWrap: 'wrap' }}>
            {[
              paid > 0.01      && { label: 'Paid',                     val: paid,               color: 'var(--ok)' },
              outstanding > 0.01 && { label: 'Invoiced – not yet paid',  val: outstanding,        color: 'var(--amber)' },
              committedUninvoiced > 0.01 && { label: 'Committed – not yet invoiced', val: committedUninvoiced, color: 'rgba(196,82,42,0.55)' },
            ].filter(Boolean).map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: item.color, flexShrink: 0, display: 'inline-block' }} />
                {item.label}: <strong style={{ color: 'var(--text-1)', fontFamily: 'var(--mono)' }}>{fmt.money(item.val)}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── The full spend story — ALWAYS shown ── */}
      <div style={{ background: 'var(--surface)', border: `1px solid ${overBudget ? '#fecaca' : 'var(--border)'}`, borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
          How we got here
        </div>

        {/* TIER 1: Commitment (legal) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Legal Commitment
        </div>
        <ContractLedgerRow label="Initial Contract Amount" value={original} total={totalExposure} color="var(--text-2)" />
        <ContractLedgerRow
          label={approvedCOs > 0 ? `+ Approved Change Orders (${l.pending_co_count > 0 ? l.pending_co_count + ' pending' : 'all approved'})` : '+ Change Orders — none yet'}
          value={approvedCOs}
          total={totalExposure}
          color={approvedCOs > 0 ? 'var(--warn)' : 'var(--text-3)'}
          onClick={() => onGoToTab('change-orders')}
        />
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>= Commitment</span>
          <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--mono)', color: overInitial ? 'var(--warn)' : 'var(--accent)', letterSpacing: '-0.02em' }}>
            {fmt.money(commitment)}
          </span>
        </div>

        {/* TIER 2: Additional exposure (T&M + Expenses) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          Additional Exposure
        </div>
        <ContractLedgerRow
          label={tmApproved > 0 ? '+ Approved T&M charges' : '+ T&M — none yet'}
          value={tmApproved}
          total={totalExposure}
          color={tmApproved > 0 ? '#c4522a' : 'var(--text-3)'}
          onClick={() => onGoToTab('t-and-m')}
        />
        <ContractLedgerRow
          label={expApproved > 0 ? '+ Approved Expenses' : '+ Expenses — none yet'}
          value={expApproved}
          total={totalExposure}
          color={expApproved > 0 ? '#c4522a' : 'var(--text-3)'}
          onClick={() => onGoToTab('expenses')}
        />

        {/* TOTAL EXPOSURE */}
        <div style={{ borderTop: '2px solid var(--border)', paddingTop: 10, marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>= Total Exposure</span>
          <span style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--mono)', color: overBudget ? 'var(--danger)' : 'var(--accent)', letterSpacing: '-0.02em' }}>
            {fmt.money(totalExposure)}
          </span>
        </div>

        {/* Budget vs. Exposure — the key question */}
        {earmarked > 0 && (
          <div style={{
            marginTop: 12, padding: '12px 16px', borderRadius: 8,
            background: overBudget ? '#fef2f2' : budgetPressure === 'warning' ? '#fff7ed' : budgetPressure === 'caution' ? '#fffbeb' : 'var(--surface-2)',
            border: `1px solid ${overBudget ? '#fecaca' : budgetPressure === 'warning' ? '#fed7aa' : budgetPressure === 'caution' ? '#fde68a' : 'var(--border)'}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Internal Budget</div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--text-1)', letterSpacing: '-0.02em', marginTop: 3 }}>
                {fmt.money(earmarked)}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {overBudget ? 'OVER BUDGET — GET MORE MONEY' : 'Buffer Remaining'}
              </div>
              <div style={{
                fontSize: 30, fontWeight: 800, fontFamily: 'var(--mono)',
                color: overBudget ? '#dc2626' : budgetPressure === 'warning' ? '#c2410c' : budgetPressure === 'caution' ? '#d97706' : 'var(--ok)',
                letterSpacing: '-0.02em', marginTop: 2,
              }}>
                {overBudget ? `–${fmt.money(totalExposure - earmarked)}` : fmt.money(buffer)}
              </div>
              {budgetUsedPct !== null && (
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>
                  {budgetUsedPct.toFixed(1)}% of budget used
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending COs warning */}
        {l.pending_co_count > 0 && (
          <div style={{
            marginTop: 10, padding: '10px 14px', borderRadius: 7,
            background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
          }} onClick={() => onGoToTab('change-orders')}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--warn)' }}>
                ⏳ {l.pending_co_count} change order{l.pending_co_count > 1 ? 's' : ''} pending approval
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                If approved: commitment → {fmt.money(commitment + Number(l.pending_cos))}
                {earmarked > 0 ? ` · exposure → ${fmt.money(totalExposure + Number(l.pending_cos))} (${((totalExposure + Number(l.pending_cos)) / earmarked * 100).toFixed(1)}% of budget)` : ''}
              </div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>Review →</span>
          </div>
        )}
      </div>

      {/* ── Contract meta + QB allocation ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Contract Details</div>
          {c.description && <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 8, lineHeight: 1.5 }}>{c.description}</div>}
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 4 }}>Date: <span style={{ color: 'var(--text-2)' }}>{fmt.date(c.contract_date)}</span></div>
          {c.reference_number && <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 4 }}>Reference: <span style={{ color: 'var(--text-2)' }}>{c.reference_number}</span></div>}
          {earmarked > 0 && paid > 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 4 }}>
              Paid: <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{fmt.money(paid)}</span>
              {outstanding > 0 && <> · <span style={{ color: 'var(--amber)' }}>{fmt.money(outstanding)} outstanding</span></>}
            </div>
          )}
          {c.file_reference && <div style={{ marginTop: 8 }}><a href={`/api/files/${encodeURIComponent(c.file_reference)}`} target="_blank" style={{ fontSize: 13 }}>📄 View contract PDF</a></div>}
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>QB Code Allocation</div>
          <table className="data" style={{ margin: 0 }}>
            <thead><tr><th>Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
            <tbody>{(c.lines || []).map(ln => (
              <tr key={ln.id}><td className="code">{ln.code}</td><td>{ln.name}</td><td className="num">{fmt.moneyPrecise(ln.amount)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => onGoToTab('change-orders')} style={{
          flex: 1, padding: '12px', textAlign: 'center',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          cursor: 'pointer', color: 'var(--text-2)', fontSize: 14, fontWeight: 500,
        }}>
          + Change Order{l.pending_co_count > 0 && <span style={{ marginLeft: 6, color: 'var(--warn)', fontWeight: 700 }}>· {l.pending_co_count} pending</span>}
        </button>
        <button onClick={() => onGoToTab('invoices')} style={{
          flex: 1, padding: '12px', textAlign: 'center',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          cursor: 'pointer', color: 'var(--text-2)', fontSize: 14, fontWeight: 500,
        }}>
          + Invoice{outstanding > 0 && <span style={{ marginLeft: 6, color: 'var(--amber)', fontWeight: 600 }}>· {fmt.money(outstanding)} outstanding</span>}
        </button>
      </div>
    </div>
  );
}

function ContractStat({ label, value, sublabel, color, topBar, tip }) {
  return (
    <div data-tip={tip} style={{ background: 'var(--surface)', padding: '16px 18px', position: 'relative' }}>
      {topBar && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: topBar, borderRadius: '2px 2px 0 0' }} />}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 9 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--mono)', color, lineHeight: 1, marginBottom: 6, letterSpacing: '-0.02em' }}>
        {value > 0 ? fmt.money(value) : <span style={{ color: 'var(--text-3)', fontSize: 18 }}>—</span>}
      </div>
      {sublabel && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{sublabel}</div>}
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
