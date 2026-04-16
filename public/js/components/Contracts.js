window.Contracts = function Contracts({ projectId }) {
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  const [filter, setFilter] = React.useState({ vendor: '', status: '', sort: '' });

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
        <button className="primary" onClick={() => setShowNew(true)}>+ New Contract</button>
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
              <th className="num">Total</th><th className="num">Invoiced</th><th>Status</th>
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
        contract_date:date||null,reference_number:ref||null,status,
        file_reference:fileRef?.file_reference||null,lines:cleaned,
      });
      onSaved();
    }catch(e){setErr(e.message);}
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{width:720}}>
        <div className="modal-header"><strong>New contract</strong><button onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="full">
              <label>Contract PDF — drop to auto-fill fields</label>
              <Dropzone file={fileRef?{filename:fileRef.filename,download_url:fileRef.download_url}:null}
                onFile={onFile} onClear={()=>setFileRef(null)} busy={uploading} accept="application/pdf"
                label={uploading?'Extracting with Claude…':'Drop contract PDF — Claude will pre-fill fields'} />
              {extractNote&&<div className="hint" style={{marginTop:6}}>{extractNote}</div>}
            </div>
            <div>
              <label>Vendor</label>
              <SmartSearch value={vendor} onChange={v=>setVendor(v)} fetcher={q=>api.searchVendors(q)} placeholder="Search vendors" />
            </div>
            <div>
              <label>Reference number</label>
              <input value={ref} onChange={e=>setRef(e.target.value)} />
            </div>
            <div>
              <label>Total value</label>
              <input type="number" step="0.01" value={total} onChange={e=>setTotal(e.target.value)} />
            </div>
            <div>
              <label>Date</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)} />
            </div>
            <div>
              <label>Status</label>
              <select value={status} onChange={e=>setStatus(e.target.value)}>
                <option value="draft">Draft</option><option value="active">Active</option><option value="closed">Closed</option>
              </select>
            </div>
            <div className="full">
              <label>Description</label>
              <textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)} placeholder="Claude will auto-summarize from uploaded PDF" />
            </div>
          </div>
          <h3 style={{marginTop:16,fontSize:14}}>QB code allocation</h3>
          <table className="data">
            <thead><tr><th>QB Code</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {lines.map((l,i)=>(
                <tr key={i}>
                  <td><select value={l.qb_code_id} onChange={e=>setLine(i,{qb_code_id:e.target.value})}>
                    <option value="">— Select —</option>
                    {codes.map(c=><option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select></td>
                  <td className="num"><input type="number" step="0.01" value={l.amount}
                    onChange={e=>setLine(i,{amount:e.target.value})} style={{textAlign:'right',maxWidth:140}} /></td>
                  <td><button onClick={()=>setLines(lines.filter((_,j)=>j!==i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td><button onClick={()=>setLines([...lines,{qb_code_id:'',amount:''}])}>+ Add line</button></td>
              <td className="num"><strong>{fmt.moneyPrecise(sum)}</strong></td><td></td>
            </tr></tfoot>
          </table>
          <div className="hint" style={{marginTop:6}}>
            Lines must sum to total value.
            {Math.abs(diff)>0.01&&<span style={{color:'var(--danger)'}}> Off by {fmt.moneyPrecise(diff)}.</span>}
          </div>
          {err&&<div className="error" style={{marginTop:10}}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={Math.abs(diff)>0.01} onClick={save}>Create</button>
        </div>
      </div>
    </div>
  );
}

function ContractDetail({ contractId, projectId, onClose }) {
  const [data, setData] = React.useState(null);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({});
  const [err, setErr] = React.useState(null);

  async function load() {
    try { const d = await api.getContract(contractId); setData(d); setForm({
      vendor_name:d.vendor_name, description:d.description||'', total_value:String(d.total_value),
      contract_date:d.contract_date?d.contract_date.slice(0,10):'', reference_number:d.reference_number||'',
      status:d.status,
    }); } catch(e){setErr(e.message);}
  }
  React.useEffect(()=>{load();},[contractId]);

  async function saveEdit(){
    setErr(null);
    try{
      await api.updateContract(contractId, form);
      setEditing(false); await load();
    }catch(e){setErr(e.message);}
  }

  if(!data) return <div className="empty">Loading contract…</div>;
  if(err) return <div className="error">{err}</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>{data.vendor_name}</h2>
        <div><button onClick={()=>setEditing(!editing)}>{editing?'Cancel':'Edit'}</button>
        <button onClick={onClose} style={{marginLeft:8}}>← Back</button></div>
      </div>

      {editing ? (
        <div className="form-grid">
          <div><label>Vendor</label><input value={form.vendor_name} onChange={e=>setForm({...form,vendor_name:e.target.value})} /></div>
          <div><label>Reference #</label><input value={form.reference_number} onChange={e=>setForm({...form,reference_number:e.target.value})} /></div>
          <div><label>Total value</label><input type="number" step="0.01" value={form.total_value} onChange={e=>setForm({...form,total_value:e.target.value})} /></div>
          <div><label>Date</label><input type="date" value={form.contract_date} onChange={e=>setForm({...form,contract_date:e.target.value})} /></div>
          <div><label>Status</label>
            <select value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>
              <option value="draft">Draft</option><option value="active">Active</option><option value="closed">Closed</option>
            </select></div>
          <div className="full"><label>Description</label><textarea rows={3} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} /></div>
          <div className="full"><button className="primary" onClick={saveEdit}>Save changes</button></div>
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <div>
            <div className="hint">Status</div><div><span className={`badge ${data.status}`}>{data.status}</span></div>
            <div className="hint" style={{marginTop:10}}>Date</div><div>{fmt.date(data.contract_date)}</div>
            <div className="hint" style={{marginTop:10}}>Reference #</div><div>{data.reference_number||'—'}</div>
            {data.description&&<><div className="hint" style={{marginTop:10}}>Description</div><div>{data.description}</div></>}
            {data.file_reference&&<><div className="hint" style={{marginTop:10}}>Attachment</div>
            <div><a href={`/api/files/${encodeURIComponent(data.file_reference)}`} target="_blank">View contract PDF</a></div></>}
          </div>
          <div>
            <div className="hint">Total value</div><div><strong>{fmt.moneyPrecise(data.total_value)}</strong></div>
            <div className="hint" style={{marginTop:10}}>Invoiced (approved+)</div><div>{fmt.moneyPrecise(data.invoiced_amount)}</div>
            <div className="hint" style={{marginTop:10}}>Remaining</div><div><strong>{fmt.moneyPrecise(data.remaining_amount)}</strong></div>
          </div>
        </div>
      )}

      <h3 style={{marginTop:20,fontSize:14}}>Allocation</h3>
      <table className="data">
        <thead><tr><th>QB Code</th><th>Name</th><th className="num">Amount</th></tr></thead>
        <tbody>{data.lines.map(l=>(
          <tr key={l.id}><td className="code">{l.code}</td><td>{l.name}</td><td className="num">{fmt.moneyPrecise(l.amount)}</td></tr>
        ))}</tbody>
      </table>

      <h3 style={{marginTop:20,fontSize:14}}>Invoices</h3>
      {data.invoices.length===0?<div className="empty" style={{padding:20}}>No invoices yet.</div>:(
        <table className="data">
          <thead><tr><th>Invoice #</th><th>Date</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>{data.invoices.map(i=>(
            <tr key={i.id}>
              <td>{i.invoice_number}{i.file_reference&&<> · <a href={`/api/files/${encodeURIComponent(i.file_reference)}`} target="_blank">📄</a></>}</td>
              <td>{fmt.date(i.invoice_date)}</td><td className="num">{fmt.moneyPrecise(i.amount)}</td>
              <td><span className={`badge ${i.status}`}>{i.status}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
