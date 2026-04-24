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
  const [projectAlerts, setProjectAlerts] = React.useState(null);

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

  // Load project-scoped alerts
  React.useEffect(() => {
    api.getAlerts()
      .then(d => {
        const flags = (d.contract_flags || []).filter(f => f.project_id === projectId);
        setProjectAlerts(flags);
      })
      .catch(() => setProjectAlerts([]));
  }, [projectId]);

  if (selected) {
    return <ContractDetail contractId={selected} projectId={projectId}
                           onClose={() => { setSelected(null); load(); }} />;
  }

  // Summary stats
  const totalValue    = contracts.reduce((s, c) => s + (Number(c.total_value) || 0), 0);
  const totalInvoiced = contracts.reduce((s, c) => s + (Number(c.invoiced_amount) || 0), 0);
  const activeCount   = contracts.filter(c => c.status === 'active').length;

  const CT_NUM = {
    fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500,
    fontFeatureSettings: '"tnum" 1', letterSpacing: '-0.01em',
  };

  return (
    <div className="panel">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em' }}>Contracts</h2>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            {contracts.length} contract{contracts.length !== 1 ? 's' : ''}
            {activeCount > 0 && <span style={{ color: '#16a34a', fontWeight: 600 }}>{activeCount} active</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href={`/api/projects/${projectId}/contracts/export`} target="_blank" className="btn" style={{ fontSize: 13 }}>Export CSV</a>
          <button className="primary" onClick={() => setShowNew(true)}>+ New Contract</button>
        </div>
      </div>

      {/* Alert strip */}
      {projectAlerts && projectAlerts.length > 0 && (() => {
        const scopeCount      = projectAlerts.filter(f => f.scope_creep_sev).length;
        const overbilledCount = projectAlerts.filter(f => f.overbilled_sev).length;
        const budgetCount     = projectAlerts.filter(f => f.budget_sev).length;
        const hasCritical     = projectAlerts.some(f =>
          f.scope_creep_sev === 'critical' || f.overbilled_sev === 'critical' || f.budget_sev === 'critical'
        );
        const hasHigh = !hasCritical && projectAlerts.some(f =>
          f.scope_creep_sev === 'high' || f.overbilled_sev === 'high' || f.budget_sev === 'high'
        );
        const sc = hasCritical ? '#dc2626' : hasHigh ? '#c4522a' : '#d97706';
        const pills = [
          scopeCount      > 0 && `${scopeCount} change order creep`,
          overbilledCount > 0 && `${overbilledCount} overbilled`,
          budgetCount     > 0 && `${budgetCount} budget pressure`,
        ].filter(Boolean);
        return (
          <div style={{
            marginBottom: 18, padding: '11px 16px',
            border: `1px solid ${sc}44`, borderLeft: `4px solid ${sc}`,
            borderRadius: 8, background: `${sc}08`,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: sc }}>
              {projectAlerts.length} contract{projectAlerts.length !== 1 ? 's' : ''} need attention
            </span>
            {pills.map((label, i) => (
              <span key={i} style={{
                fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 10,
                background: 'rgba(255,255,255,0.8)', color: sc, border: `1px solid ${sc}44`,
              }}>{label}</span>
            ))}
          </div>
        );
      })()}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input placeholder="Filter by vendor" value={filter.vendor}
               onChange={e => setFilter({ ...filter, vendor: e.target.value })}
               style={{ flex: '1 1 180px', minWidth: 0, fontSize: 13 }} />
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} style={{ width: 140, fontSize: 13 }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filter.sort} onChange={e => setFilter({ ...filter, sort: e.target.value })} style={{ width: 140, fontSize: 13 }}>
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
        <div style={{ borderRadius: 10, border: '1px solid var(--border-2)', boxShadow: '0 2px 8px rgba(28,24,20,0.08), 0 1px 3px rgba(28,24,20,0.05)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 100px 120px 100px 80px 80px',
            background: '#e8e3db', borderBottom: '2px solid var(--border-2)',
            padding: '0',
          }}>
            {[
              { label: 'Vendor / Description', left: true },
              { label: 'Ref #' },
              { label: 'Date' },
              { label: 'Contract Value' },
              { label: 'Invoiced' },
              { label: '% Billed' },
              { label: 'Status' },
            ].map((h, i) => (
              <div key={i} style={{
                padding: '11px 16px',
                fontSize: 11, fontWeight: 700,
                color: 'rgba(26,22,18,0.5)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
                textAlign: h.left ? 'left' : 'right',
                borderRight: i < 6 ? '1px solid var(--border)' : 'none',
              }}>{h.label}</div>
            ))}
          </div>

          {/* Totals row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 90px 100px 120px 100px 80px 80px',
            background: '#ede8e0', borderBottom: '2px solid var(--border-2)',
          }}>
            <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 14, color: 'var(--text-1)', letterSpacing: '-0.01em', borderRight: '1px solid var(--border)' }}>
              {contracts.length} contract{contracts.length !== 1 ? 's' : ''} · {activeCount} active
            </div>
            <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }} />
            <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }} />
            <div style={{ padding: '12px 16px', textAlign: 'right', borderRight: '1px solid var(--border)', ...CT_NUM, fontWeight: 700 }}>{fmt.money(totalValue)}</div>
            <div style={{ padding: '12px 16px', textAlign: 'right', borderRight: '1px solid var(--border)', ...CT_NUM, fontWeight: 700 }}>{fmt.money(totalInvoiced)}</div>
            <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }} />
            <div style={{ padding: '12px 16px' }} />
          </div>

          {/* Contract rows */}
          {contracts.map((c, idx) => {
            const flag        = contractOverSev(c);
            const invoiced    = Number(c.invoiced_amount) || 0;
            const total       = Number(c.total_value) || 0;
            const invoicedPct = total > 0 ? Math.min((invoiced / total) * 100, 100) : 0;
            const isOver      = invoiced > total && total > 0;
            const borderColor = flag ? flag.color : '#d1cbc2';
            const statusColors = {
              active: { color: '#15803d', bg: 'rgba(22,163,74,0.08)' },
              draft:  { color: '#7c7269', bg: 'rgba(0,0,0,0.06)' },
              closed: { color: '#7c7269', bg: 'rgba(0,0,0,0.06)' },
            };
            const sc = statusColors[c.status] || statusColors.draft;

            return (
              <div
                key={c.id}
                onClick={() => setSelected(c.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 90px 100px 120px 100px 80px 80px',
                  borderBottom: idx < contracts.length - 1 ? '1px solid var(--border)' : 'none',
                  borderLeft: `4px solid ${borderColor}`,
                  cursor: 'pointer',
                  background: 'var(--surface)',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(26,22,18,0.025)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface)'}
              >
                {/* Vendor + description */}
                <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.015em' }}>
                      {c.vendor_name}
                    </span>
                    {flag && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                        padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                        background: flag.bg, color: flag.color, border: `1px solid ${flag.border}`,
                      }}>{flag.label}</span>
                    )}
                    {c.file_reference && (
                      <a href={`/api/files/${encodeURIComponent(c.file_reference)}`}
                         target="_blank" onClick={e => e.stopPropagation()}
                         title="View PDF"
                         style={{ flexShrink: 0, fontSize: 12, textDecoration: 'none', color: 'var(--text-3)' }}>PDF ↗</a>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(26,22,18,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.description || <span style={{ fontStyle: 'italic' }}>No description</span>}
                  </div>
                </div>

                {/* Ref # */}
                <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)', fontSize: 12, color: 'rgba(26,22,18,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {c.reference_number || <span style={{ color: 'rgba(26,22,18,0.18)' }}>—</span>}
                </div>

                {/* Date */}
                <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)', fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  {c.contract_date ? fmt.date(c.contract_date) : <span style={{ color: 'rgba(26,22,18,0.18)' }}>—</span>}
                </div>

                {/* Contract value */}
                <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', ...CT_NUM, fontWeight: 700 }}>
                  {fmt.money(total)}
                </div>

                {/* Invoiced */}
                <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', ...CT_NUM, color: isOver ? '#dc2626' : invoiced > 0 ? 'var(--text-1)' : 'rgba(26,22,18,0.18)' }}>
                  {invoiced > 0 ? fmt.money(invoiced) : '—'}
                </div>

                {/* % Billed */}
                <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 4 }}>
                  {total > 0 ? (
                    <>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: isOver ? '#dc2626' : 'var(--text-2)', fontFeatureSettings: '"tnum" 1' }}>
                        {invoicedPct.toFixed(0)}%
                      </span>
                      <div style={{ width: 44, height: 4, borderRadius: 2, background: 'rgba(26,22,18,0.1)', overflow: 'hidden' }}>
                        <div style={{ width: `${invoicedPct}%`, height: '100%', background: isOver ? '#dc2626' : flag ? flag.color : '#16a34a', borderRadius: 2 }} />
                      </div>
                    </>
                  ) : <span style={{ color: 'rgba(26,22,18,0.18)', fontSize: 14 }}>—</span>}
                </div>

                {/* Status */}
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 5,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    background: sc.bg, color: sc.color,
                  }}>{c.status}</span>
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
  const [confirmed, setConfirmed] = React.useState(false);
  const [status, setStatus] = React.useState('draft');
  const [lines, setLines] = React.useState([{qb_code_id:'',amount:''}]);
  const [err, setErr] = React.useState(null);

  // Returns border/background style for AI-filled fields based on confidence level
  function aiFieldStyle(field) {
    const c = confidence[field];
    if (c === 'low')    return { border: '1.5px solid #dc2626', background: '#fef2f2' };
    if (c === 'medium') return { border: '1.5px solid #d97706', background: '#fffbeb' };
    return {};
  }

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
          filled.forEach(fld=>{if(e.confidence[fld])conf[fld]=e.confidence[fld];});
          setConfidence(conf);
        }
        // Pre-populate QB allocation lines if Claude suggested them
        if(resp.suggested_lines && resp.suggested_lines.length > 0){
          setLines(resp.suggested_lines.map(l=>({qb_code_id:String(l.qb_code_id),amount:String(l.amount),_suggested:true,_reason:l.reason,_confidence:l.confidence})));
          const linesNote = resp.suggested_lines.length === 1
            ? `QB code suggested: ${resp.suggested_lines[0].qb_code} — ${resp.suggested_lines[0].qb_name}`
            : `${resp.suggested_lines.length} QB codes suggested — review allocations below`;
          setExtractNote(`Fields pre-filled from PDF · ${linesNote}`);
        } else {
          setExtractNote('Fields pre-filled from PDF — colored dots show extraction confidence.');
        }
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
                <SmartSearch value={vendor} onChange={v => { setVendor(v); setConfidence(c=>({...c,vendor_name:undefined})); setConfirmed(false); }} fetcher={q => api.searchVendors(q)} placeholder="Search vendors" style={aiFieldStyle('vendor_name')} />
              </div>
              <div>
                <label data-tip="The vendor's own reference number or proposal number. Used for matching their invoices later.">
                  Reference number <ContractConfidenceDot level={confidence.reference_number} />
                </label>
                <input value={ref} onChange={e => { setRef(e.target.value); setConfidence(c=>({...c,reference_number:undefined})); setConfirmed(false); }} style={aiFieldStyle('reference_number')} />
              </div>
              <div>
                <label data-tip="The dollar amount on the signed contract — the fixed lump sum only. Do not include estimated T&M.">
                  Initial Contract Amount <ContractConfidenceDot level={confidence.total_value} />
                </label>
                <input type="number" step="0.01" value={total} onChange={e => { setTotal(e.target.value); setConfidence(c=>({...c,total_value:undefined})); setConfirmed(false); }} placeholder="0.00" style={aiFieldStyle('total_value')} />
              </div>
              <div>
                <label data-tip="Your internal budget for what this vendor will actually cost you — including open-ended T&M, meetings, and additional services. Leave blank if truly unknown. The dashboard uses this as the warning threshold.">Internal Budget</label>
                <input type="number" step="0.01" value={earmarked} onChange={e => setEarmarked(e.target.value)} placeholder="Optional — incl. T&M tail" />
              </div>
              <div>
                <label data-tip="The date the contract was signed or became effective.">
                  Contract date <ContractConfidenceDot level={confidence.contract_date} />
                </label>
                <input type="date" value={date} onChange={e => { setDate(e.target.value); setConfidence(c=>({...c,contract_date:undefined})); setConfirmed(false); }} style={aiFieldStyle('contract_date')} />
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
          padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0,
          background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
        }}>
          <button onClick={onClose}>Cancel</button>
          {fileRef && (
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 6,
              background: confirmed ? 'rgba(34,197,94,0.09)' : 'rgba(220,38,38,0.07)',
              border: `1.5px solid ${confirmed ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`,
              cursor: 'pointer', userSelect: 'none', flexShrink: 0,
            }}>
              <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
                style={{ width: 15, height: 15, accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                color: confirmed ? '#16a34a' : '#dc2626' }}>
                {confirmed ? '✓ Details confirmed' : 'Confirm details are correct'}
              </span>
            </label>
          )}
          <button className="primary"
            disabled={Math.abs(diff) > 0.01 || !vendor || !total || (!!fileRef && !confirmed)}
            onClick={save}>
            Create Contract
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Burn bar — budget utilization only (payment detail lives in Invoices tab) ──
function ContractBurnBar({ ledger: l }) {
  if (!l) return null;
  const original      = Number(l.original_contract) || 0;
  const commitment    = Number(l.commitment) || 0;
  const totalExposure = Number(l.total_exposure) || commitment;
  const earmarked     = Number(l.earmarked_amount) || 0;

  const overBudget    = earmarked > 0 && totalExposure > earmarked;
  const overAmt       = overBudget ? totalExposure - earmarked : 0;
  const budgetUsedPct = earmarked > 0 ? (totalExposure / earmarked) * 100 : null;

  const severityColor = !budgetUsedPct ? '#4d9e6f'
    : budgetUsedPct >= 100 ? '#dc2626'
    : budgetUsedPct >= 90  ? '#c2410c'
    : budgetUsedPct >= 75  ? '#d97706'
    : '#4d9e6f';

  const barMax = earmarked > 0
    ? Math.max(earmarked * 1.15, totalExposure * 1.05)
    : Math.max(original * 1.5, totalExposure * 1.2, 100);

  function pct(val) { return !barMax || val <= 0 ? 0 : Math.min((val / barMax) * 100, 100); }

  const pCommitment  = pct(Math.min(totalExposure, earmarked > 0 ? earmarked : totalExposure));
  const pOver        = overBudget ? pct(overAmt) : 0;
  const pInitialTick = pct(original);
  const pBudgetTick  = earmarked > 0 ? pct(earmarked) : null;

  const BAR_H      = 20;
  const TICK_BLEED = 5;

  function TickLabel({ p, children, color, bold }) {
    const nearRight = p > 78;
    const nearLeft  = p < 12;
    const anchor = nearRight
      ? { right: `${(100 - p).toFixed(1)}%` }
      : nearLeft
        ? { left: `${p.toFixed(1)}%` }
        : { left: `${p.toFixed(1)}%`, transform: 'translateX(-50%)' };
    return (
      <span style={{
        position: 'absolute', top: 0, ...anchor,
        fontSize: 11, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
        color: color || 'var(--text-3)', fontWeight: bold ? 700 : 400,
      }}>{children}</span>
    );
  }

  return (
    <div style={{ padding: '12px 20px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Budget Utilization
        </span>
        {budgetUsedPct !== null && (
          <span style={{ fontSize: 12, fontWeight: 700, color: severityColor, fontVariantNumeric: 'tabular-nums' }}>
            {budgetUsedPct.toFixed(1)}% of internal budget
            {overBudget && <span style={{ marginLeft: 6 }}>· over by {fmt.money(overAmt)}</span>}
          </span>
        )}
      </div>

      {/* Bar + ticks */}
      <div style={{ position: 'relative', paddingTop: TICK_BLEED }}>

        {/* Track */}
        <div style={{ position: 'relative', height: BAR_H, borderRadius: 4, background: 'var(--surface-3)', overflow: 'hidden' }}>
          {/* Commitment fill */}
          {pCommitment > 0 && (
            <div title={`Commitment: ${fmt.money(Math.min(totalExposure, earmarked || totalExposure))}`} style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pCommitment}%`,
              background: severityColor, transition: 'width 0.55s ease',
            }} />
          )}
          {/* Over-budget segment */}
          {overBudget && pOver > 0 && (
            <div title={`Over budget: ${fmt.money(overAmt)}`} style={{
              position: 'absolute', left: `${pCommitment}%`, top: 0, bottom: 0, width: `${pOver}%`,
              background: '#dc2626',
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.2) 4px, rgba(255,255,255,0.2) 8px)',
              transition: 'width 0.55s ease',
            }} />
          )}
        </div>

        {/* Tick marks */}
        {pInitialTick > 0 && (
          <div style={{
            position: 'absolute', left: `${pInitialTick}%`, top: 0,
            height: TICK_BLEED + BAR_H + TICK_BLEED, width: 2, marginLeft: -1,
            background: 'rgba(28,24,20,0.4)', borderRadius: 1, zIndex: 4,
          }} />
        )}
        {pBudgetTick !== null && (
          <div style={{
            position: 'absolute', left: `${pBudgetTick}%`, top: 0,
            height: TICK_BLEED + BAR_H + TICK_BLEED, width: 2, marginLeft: -1,
            background: overBudget ? '#dc2626' : 'rgba(28,24,20,0.35)', borderRadius: 1, zIndex: 4,
          }} />
        )}

        {/* Tick labels */}
        <div style={{ position: 'relative', height: 20, marginTop: TICK_BLEED + 3 }}>
          {pInitialTick > 0 && (
            <TickLabel p={pInitialTick}>Initial {fmt.money(original)}</TickLabel>
          )}
          {pBudgetTick !== null && earmarked > 0 && (
            <TickLabel p={pBudgetTick} color={overBudget ? '#dc2626' : 'var(--text-3)'} bold={overBudget}>
              {overBudget ? '⚠ ' : ''}Budget {fmt.money(earmarked)}
            </TickLabel>
          )}
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

  const tabs = [
    { k: 'overview',      label: 'Overview' },
    { k: 'change-orders', label: `Change Orders${ledger && ledger.pending_co_count > 0 ? ` (${ledger.pending_co_count})` : ''}` },
    { k: 'invoices',      label: 'Invoices' },
    { k: 'history',       label: 'History' },
    { k: 'alerts',        label: 'Alert Status' },
  ];

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em' }}>{data.vendor_name}</h2>
          <div style={{ display: 'flex', gap: 10, marginTop: 5, alignItems: 'center' }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              background: data.status === 'active' ? 'rgba(22,163,74,0.1)' : 'rgba(0,0,0,0.07)',
              color: data.status === 'active' ? '#15803d' : '#7c7269',
            }}>{data.status}</span>
            {data.reference_number && <span style={{ fontSize: 13, color: 'rgba(26,22,18,0.45)' }}>Ref: {data.reference_number}</span>}
            {data.file_reference && (
              <a href={`/api/files/${encodeURIComponent(data.file_reference)}`} target="_blank" style={{ fontSize: 13, color: 'var(--accent)' }}>PDF ↗</a>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</button>
          <button onClick={onClose}>← Back</button>
        </div>
      </div>

      {/* KPI Spreadsheet — Equals.com style: tight rows, full grid, double-border totals */}
      {ledger && !editing && (() => {
        const orig            = Number(ledger.original_contract) || 0;
        const cos             = Number(ledger.approved_cos) || 0;
        const commitment      = Number(ledger.commitment) || 0;
        const earmarked       = Number(ledger.earmarked_amount) || 0;
        const invoiced        = Number(ledger.invoiced) || 0;
        const tmInvoiced      = Number(ledger.tm_invoiced) || 0;
        const expenseInvoiced = Number(ledger.expense_invoiced) || 0;
        const totalBilled     = invoiced + tmInvoiced + expenseInvoiced;
        const paid            = Number(ledger.paid) || 0;
        const exposure        = Number(ledger.total_exposure) || commitment;
        const buffer          = earmarked > 0 ? earmarked - exposure : null;
        const overBudget      = earmarked > 0 && exposure > earmarked;

        // Grid constants — Equals-style
        const GRID  = '1px solid #e2dfd8';
        const GRID2 = '2px solid #c8c3ba';  // double-border for totals (accounting convention)
        const NUM   = { fontFamily: 'var(--mono)', fontFeatureSettings: '"tnum" 1', letterSpacing: '-0.01em' };
        const CELL  = { padding: '5px 12px', borderRight: GRID, borderBottom: GRID, verticalAlign: 'middle' };
        const DASH  = <span style={{ color: 'rgba(26,22,18,0.2)', fontFamily: 'var(--mono)' }}>—</span>;

        function N({ v, bold, color }) {
          if (v === null || v === undefined) return DASH;
          return <span style={{ ...NUM, fontSize: 13, fontWeight: bold ? 700 : 400, color: color || '#1a1612' }}>{fmt.money(v)}</span>;
        }
        function P({ v, color }) {
          if (v === null || v === undefined) return DASH;
          return <span style={{ ...NUM, fontSize: 13, fontWeight: 400, color: color || '#1a1612' }}>{v.toFixed(1)}%</span>;
        }
        function V({ v, bold }) {
          if (v === null || v === undefined) return DASH;
          const pos = v >= 0;
          const color = pos ? '#15803d' : '#dc2626';
          return <span style={{ ...NUM, fontSize: 13, fontWeight: bold ? 700 : 400, color }}>{pos ? '+' : ''}{fmt.money(v)}</span>;
        }

        // Section divider — thin rule with label, no background band
        function Section({ label }) {
          return (
            <tr>
              <td colSpan={5} style={{
                padding: '10px 12px 4px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: 'rgba(26,22,18,0.38)',
                borderBottom: GRID, background: '#faf9f7',
                borderTop: '2px solid #d6d1c8',
              }}>{label}</td>
            </tr>
          );
        }

        // Standard row
        function Row({ label, tip, goal, actual, variance, vColor, pct, pColor, bold, total, indent }) {
          const rowBg = total ? '#faf9f7' : '#ffffff';
          const topBorder = total ? GRID2 : 'none';
          const fw = bold || total ? 600 : 400;
          const fs = 13;
          return (
            <tr style={{ background: rowBg }}>
              <td data-tip={tip} style={{
                ...CELL,
                paddingLeft: indent ? 24 : 12,
                borderTop: topBorder,
                fontSize: fs, fontWeight: fw, color: '#1a1612',
                minWidth: 220,
              }}>
                {label}
              </td>
              <td style={{ ...CELL, textAlign: 'right', borderTop: topBorder, width: 130 }}>
                <N v={goal} bold={bold || total} />
              </td>
              <td style={{ ...CELL, textAlign: 'right', borderTop: topBorder, width: 130 }}>
                <N v={actual} bold={bold || total} color={vColor && actual > (goal || 0) ? vColor : null} />
              </td>
              <td style={{ ...CELL, textAlign: 'right', borderTop: topBorder, width: 120 }}>
                {variance !== undefined ? <V v={variance} bold={bold || total} /> : DASH}
              </td>
              <td style={{ ...CELL, textAlign: 'right', borderTop: topBorder, borderRight: 'none', width: 80 }}>
                <P v={pct} color={pColor} />
              </td>
            </tr>
          );
        }

        // Derived
        const cosPct      = orig > 0 && cos > 0  ? (cos / orig) * 100             : null;
        const exposurePct = earmarked > 0          ? (exposure / earmarked) * 100   : null;
        const invPct      = commitment > 0         ? (invoiced / commitment) * 100  : null;
        const billPct     = commitment > 0         ? (totalBilled / commitment) * 100 : null;
        const paidPct     = totalBilled > 0        ? (paid / totalBilled) * 100     : null;

        const expColor    = overBudget ? '#dc2626' : earmarked > 0 && exposurePct >= 90 ? '#d97706' : null;
        const bufColor    = buffer === null ? null : buffer < 0 ? '#dc2626' : '#15803d';

        return (
          <div style={{ borderTop: '2px solid #d6d1c8', borderBottom: '2px solid #d6d1c8', background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '40%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#f0ede8' }}>
                  {[
                    { label: 'Metric',           left: true,  tip: null },
                    { label: 'Budget / Goal',    left: false, tip: 'Target or internal budget for this line' },
                    { label: 'Actual',           left: false, tip: 'Current committed, billed, or paid amount' },
                    { label: 'Variance',         left: false, tip: 'Actual minus goal — green = under, red = over' },
                    { label: '% of Goal',        left: false, tip: 'Actual as a percentage of the goal' },
                  ].map((h, i) => (
                    <th key={i} data-tip={h.tip} style={{
                      padding: '8px 12px',
                      textAlign: h.left ? 'left' : 'right',
                      fontSize: 10, fontWeight: 700,
                      color: 'rgba(26,22,18,0.45)',
                      textTransform: 'uppercase', letterSpacing: '0.09em',
                      borderRight: i < 4 ? GRID : 'none',
                      borderBottom: '2px solid #d6d1c8',
                      whiteSpace: 'nowrap',
                    }}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>

                <Section label="Contract Scope" />
                <Row label="Initial Contract"
                  tip="The original signed contract value"
                  actual={orig} />
                <Row label="  + Change Orders"
                  tip="Approved change orders added to the contract"
                  indent
                  actual={cos > 0 ? cos : null}
                  variance={cos > 0 ? cos : undefined}
                  pct={cosPct}
                  pColor={cosPct >= 25 ? '#dc2626' : cosPct > 0 ? '#d97706' : null} />
                <Row label="= Commitment"
                  tip="Legal obligation: initial contract + all approved COs"
                  total
                  actual={commitment}
                  goal={earmarked > 0 ? earmarked : null}
                  variance={earmarked > 0 ? earmarked - commitment : undefined}
                  pct={earmarked > 0 ? (commitment / earmarked) * 100 : null}
                  pColor={earmarked > 0 && commitment > earmarked ? '#dc2626' : null} />

                <Section label="Additional Exposure" />
                <Row label="  + T&M Invoiced"
                  tip="Time & Materials billed beyond fixed scope"
                  indent
                  actual={tmInvoiced > 0 ? tmInvoiced : null} />
                <Row label="  + Expenses Invoiced"
                  tip="Reimbursable expenses billed beyond fixed scope"
                  indent
                  actual={expenseInvoiced > 0 ? expenseInvoiced : null} />
                <Row label="= Total Exposure"
                  tip="Commitment + T&M + expenses — full cost projection"
                  total
                  actual={exposure}
                  goal={earmarked > 0 ? earmarked : null}
                  variance={earmarked > 0 ? earmarked - exposure : undefined}
                  pct={exposurePct}
                  pColor={expColor} />

                <Section label="Billing" />
                <Row label="  Fixed Scope Invoiced"
                  tip="Invoices billed against the fixed contract commitment"
                  indent
                  actual={invoiced > 0 ? invoiced : null}
                  goal={commitment}
                  variance={invoiced - commitment}
                  pct={invPct}
                  pColor={invoiced > commitment ? '#dc2626' : null} />
                <Row label="  T&M Invoiced"
                  tip="T&M invoices billed — these are above fixed scope"
                  indent
                  actual={tmInvoiced > 0 ? tmInvoiced : null} />
                <Row label="  Expenses Invoiced"
                  tip="Expense reimbursements billed"
                  indent
                  actual={expenseInvoiced > 0 ? expenseInvoiced : null} />
                <Row label="= Total Billed"
                  tip="All approved invoices: fixed + T&M + expenses"
                  total
                  actual={totalBilled > 0 ? totalBilled : null}
                  goal={commitment}
                  variance={totalBilled > 0 ? totalBilled - commitment : undefined}
                  pct={billPct}
                  pColor={totalBilled > commitment ? '#dc2626' : null} />

                <Section label="Collections" />
                <Row label="Paid to Vendor"
                  tip="Cash actually sent — confirmed payments"
                  actual={paid > 0 ? paid : null}
                  goal={totalBilled > 0 ? totalBilled : null}
                  variance={totalBilled > 0 ? paid - totalBilled : undefined}
                  pct={paidPct}
                  pColor={paidPct !== null && paidPct < 100 ? '#d97706' : '#15803d'} />

              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Alerts */}
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


{activeTab === 'invoices' && (
            <Invoices projectId={projectId} contractId={contractId} />
          )}

          {activeTab === 'alerts' && ledger && (
            <ContractAlertStrip
              original={Number(ledger.original_contract) || 0}
              approvedCOs={Number(ledger.approved_cos) || 0}
              invoiced={Number(ledger.invoiced) || 0}
              totalExposure={Number(ledger.total_exposure) || 0}
              earmarked={Number(ledger.earmarked_amount) || 0}
            />
          )}
          {activeTab === 'alerts' && !ledger && (
            <div className="empty">Loading…</div>
          )}

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

// ── Alert status strip — shown in the Alert Status tab ───────────────────────
function ContractAlertStrip({ original, approvedCOs, invoiced, totalExposure, earmarked }) {
  function overageSev(pct) {
    if (pct <= 0)  return null;
    if (pct < 10)  return 'low';
    if (pct < 25)  return 'moderate';
    if (pct < 50)  return 'high';
    return 'critical';
  }
  function budgetSev(pct) {
    if (!pct || pct < 75) return null;
    if (pct < 90)  return 'low';
    if (pct < 100) return 'moderate';
    if (pct < 110) return 'high';
    return 'critical';
  }

  const coCreepPct    = original > 0 ? (approvedCOs / original) * 100 : 0;
  const overbilledPct = original > 0 ? Math.max((invoiced - original) / original * 100, 0) : 0;
  const budgetUsedPct = earmarked > 0 ? (totalExposure / earmarked) * 100 : null;

  const coSev     = overageSev(coCreepPct);
  const obSev     = overageSev(overbilledPct);
  const budSev    = budgetSev(budgetUsedPct);

  const SEV_COLOR = {
    low:      { dot: '#d97706', text: '#92400e', bg: '#fffbeb', label: 'LOW' },
    moderate: { dot: '#c4522a', text: '#9a3412', bg: '#fff7f4', label: 'MODERATE' },
    high:     { dot: '#b04824', text: '#7c2d12', bg: '#fef3ee', label: 'HIGH' },
    critical: { dot: '#dc2626', text: '#991b1b', bg: '#fef2f2', label: 'CRITICAL' },
  };
  const CLEAR = { dot: '#16a34a', text: 'var(--text-3)', bg: 'transparent' };

  function AlertRow({ label, sev, detail, clearDetail, last }) {
    const c = sev ? SEV_COLOR[sev] : CLEAR;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 14px',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        background: sev ? c.bg : 'transparent',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: c.dot,
          boxShadow: sev ? `0 0 5px ${c.dot}88` : 'none',
        }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)', minWidth: 160 }}>{label}</span>
        <span style={{ fontSize: 12, color: sev ? c.text : 'var(--text-3)', flex: 1 }}>
          {sev ? detail : clearDetail}
        </span>
        {sev && (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            padding: '2px 6px', borderRadius: 3,
            background: c.dot + '22', color: c.dot, border: `1px solid ${c.dot}44`,
            flexShrink: 0,
          }}>{c.label}</span>
        )}
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}>
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>Alert Status</span>
      </div>
      <AlertRow
        label="Change Order Creep"
        sev={coSev}
        detail={`COs added ${fmt.money(approvedCOs)} — ${coCreepPct.toFixed(1)}% above initial contract`}
        clearDetail={approvedCOs > 0 ? `COs added ${fmt.money(approvedCOs)} (${coCreepPct.toFixed(1)}% above initial) — within normal range` : 'No approved change orders'}
      />
      <AlertRow
        label="Overbilled"
        sev={obSev}
        detail={`Invoiced ${fmt.money(invoiced)} — ${overbilledPct.toFixed(1)}% above initial contract`}
        clearDetail={invoiced > 0 ? `Invoiced ${fmt.money(invoiced)} of ${fmt.money(original)} initial — within contract` : 'No invoices yet'}
      />
      <AlertRow
        label="Budget Pressure"
        sev={budSev}
        detail={earmarked > 0 ? `${budgetUsedPct.toFixed(1)}% of internal budget used — ${fmt.money(totalExposure)} exposure vs ${fmt.money(earmarked)}` : 'No internal budget set'}
        clearDetail={earmarked > 0 ? `${budgetUsedPct !== null ? budgetUsedPct.toFixed(1) : '0'}% of internal budget used — ${fmt.money(earmarked - totalExposure)} remaining` : 'No internal budget set'}
        last
      />
    </div>
  );
}

// ── Billing & Payment tab ─────────────────────────────────────────────────────

function BillingPaymentTab({ ledger: l, onGoToInvoices }) {
  const commitment     = Number(l.commitment) || 0;
  const invoiced       = Number(l.invoiced) || 0;
  const tmInvoiced     = Number(l.tm_invoiced) || 0;
  const expInvoiced    = Number(l.expense_invoiced) || 0;
  const totalBilled    = invoiced + tmInvoiced + expInvoiced;
  const paid           = Number(l.paid) || 0;
  const outstanding    = Math.max(totalBilled - paid, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            Billing & Payment
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            What has been invoiced and how much has been paid.
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Invoiced
        </div>
        <ContractLedgerRow label="Fixed Scope Invoiced" value={invoiced} total={totalBilled || commitment} color="var(--accent)" onClick={onGoToInvoices} />
        <ContractLedgerRow label="+ T&M Invoiced"       value={tmInvoiced} total={totalBilled || commitment} color="var(--warn)"   onClick={onGoToInvoices} />
        <ContractLedgerRow label="+ Expenses Invoiced"  value={expInvoiced} total={totalBilled || commitment} color="#2563eb"      onClick={onGoToInvoices} />

        <div style={{ borderTop: '2px solid var(--border)', paddingTop: 14, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: totalBilled > 0 ? 16 : 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>= Total Billed</span>
          <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--mono)', letterSpacing: '-0.02em',
            color: totalBilled > commitment ? 'var(--danger)' : totalBilled > 0 ? '#1d4ed8' : 'var(--text-2)' }}>
            {fmt.money(totalBilled)}
          </span>
        </div>

        {totalBilled > 0 && (
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, padding: '12px 16px', borderRadius: 8, background: paid > 0 ? 'rgba(34,197,94,0.07)' : 'var(--surface-2)', border: `1px solid ${paid > 0 ? 'rgba(34,197,94,0.25)' : 'var(--border)'}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)', marginBottom: 6 }}>Paid</div>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--mono)', color: paid > 0 ? 'var(--ok)' : 'var(--text-2)', letterSpacing: '-0.02em' }}>{fmt.money(paid)}</div>
              {totalBilled > 0 && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{Math.round((paid / totalBilled) * 100)}% of total billed</div>}
            </div>
            <div style={{ flex: 1, padding: '12px 16px', borderRadius: 8, background: outstanding > 0 ? 'rgba(232,146,26,0.07)' : 'var(--surface-2)', border: `1px solid ${outstanding > 0 ? 'rgba(232,146,26,0.3)' : 'var(--border)'}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)', marginBottom: 6 }}>Outstanding</div>
              <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--mono)', color: outstanding > 0 ? 'var(--warn)' : 'var(--ok)', letterSpacing: '-0.02em' }}>{fmt.money(outstanding)}</div>
              {outstanding === 0 && totalBilled > 0 && <div style={{ fontSize: 12, color: 'var(--ok)', marginTop: 3 }}>Fully paid</div>}
            </div>
          </div>
        )}

        {totalBilled === 0 && (
          <div className="empty" style={{ marginTop: 12 }}>No invoices submitted yet.</div>
        )}
      </div>
    </div>
  );
}

// ── Contract-level Dashboard (Overview tab) ──────────────────────────────────

function ContractDashboard({ contract: c, ledger: l, onGoToTab }) {
  const original      = Number(l.original_contract) || 0;
  const commitment    = Number(l.commitment) || 0;
  const totalExposure = Number(l.total_exposure) || commitment;
  const invoiced      = Number(l.invoiced) || 0;
  const tmInvoiced    = Number(l.tm_invoiced) || 0;
  const expInvoiced   = Number(l.expense_invoiced) || 0;
  const totalBilled   = invoiced + tmInvoiced + expInvoiced;
  const paid          = Number(l.paid) || 0;
  const earmarked     = Number(l.earmarked_amount) || 0;
  const approvedCOs   = Number(l.approved_cos) || 0;
  const tmApproved    = Number(l.tm_approved) || 0;
  const expApproved   = Number(l.expense_approved) || 0;

  const outstanding   = Math.max(totalBilled - paid, 0);
  const [billingOpen, setBillingOpen] = React.useState(false);
  const buffer        = earmarked > 0 ? earmarked - totalExposure : null;
  const overBudget    = earmarked > 0 && totalExposure > earmarked;
  const budgetUsedPct = earmarked > 0 ? (totalExposure / earmarked) * 100 : null;
  let budgetPressure  = null;
  if (budgetUsedPct !== null) {
    if (budgetUsedPct >= 100) budgetPressure = 'danger';
    else if (budgetUsedPct >= 90) budgetPressure = 'warning';
    else if (budgetUsedPct >= 75) budgetPressure = 'caution';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── How we got here — ALWAYS shown ── */}
      <div style={{ background: 'var(--surface)', border: `1px solid ${overBudget ? '#fecaca' : 'var(--border)'}`, borderRadius: 10, padding: '16px 20px' }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.02em', marginBottom: 4 }}>
            How we got here
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
            A full breakdown of every dollar committed, billed, and paid against this contract.
          </div>
        </div>

        {/* TIER 1: Commitment (legal) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Legal Commitment
        </div>
        <ContractLedgerRow label="Initial Contract" value={original} total={totalExposure} color="var(--text-2)" />
        <ContractLedgerRow
          label={approvedCOs > 0 ? `+ Change Orders (${l.pending_co_count > 0 ? l.pending_co_count + ' pending' : 'all approved'})` : '+ Change Orders'}
          value={approvedCOs}
          total={totalExposure}
          color={approvedCOs > 0 ? 'var(--warn)' : 'var(--text-3)'}
          onClick={() => onGoToTab('change-orders')}
        />
        <div style={{ borderTop: '2px solid var(--border)', paddingTop: 14, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>= Commitment</span>
          <span style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--mono)', color: commitment > original ? 'var(--warn)' : 'var(--accent)', letterSpacing: '-0.02em' }}>
            {fmt.money(commitment)}
          </span>
        </div>

        {/* TIER 2: Additional exposure (T&M + Expenses) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
          Additional Exposure
        </div>
        <ContractLedgerRow
          label={tmApproved > 0 ? '+ Approved T&M' : '+ T&M'}
          value={tmApproved}
          total={totalExposure}
          color={tmApproved > 0 ? '#c4522a' : 'var(--text-3)'}
          onClick={() => onGoToTab('t-and-m')}
        />
        <ContractLedgerRow
          label={expApproved > 0 ? '+ Approved Expenses' : '+ Expenses'}
          value={expApproved}
          total={totalExposure}
          color={expApproved > 0 ? '#c4522a' : 'var(--text-3)'}
          onClick={() => onGoToTab('expenses')}
        />

        {/* TOTAL EXPOSURE */}
        <div style={{ borderTop: '2px solid var(--border)', paddingTop: 14, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>= Total Exposure</span>
          <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--mono)', color: overBudget ? 'var(--danger)' : 'var(--accent)', letterSpacing: '-0.02em' }}>
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
                {overBudget ? 'CONTINGENCY DEPLETED' : 'Buffer Remaining'}
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
                  {budgetUsedPct.toFixed(1)}% of internal budget used
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
                {earmarked > 0 ? ` · exposure → ${fmt.money(totalExposure + Number(l.pending_cos))} (${((totalExposure + Number(l.pending_cos)) / earmarked * 100).toFixed(1)}% of internal budget)` : ''}
              </div>
            </div>
            <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>Review →</span>
          </div>
        )}
      </div>

      {/* ── Billing & Payment card ── */}
      <div style={{ background: 'var(--surface)', border: `1px solid ${totalBilled > commitment ? '#fecaca' : totalBilled > 0 ? 'rgba(37,99,235,0.3)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>

        {/* Header — always visible */}
        <div onClick={() => setBillingOpen(o => !o)} style={{
          padding: '14px 20px', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: totalBilled > 0 ? 'rgba(37,99,235,0.04)' : 'var(--surface)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-2)', display: 'inline-block', transition: 'transform 0.15s', transform: billingOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>Billing & Payment</span>
          </div>
          {totalBilled > 0 ? (
            <div style={{ display: 'flex', gap: 20, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Billed <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: totalBilled > commitment ? 'var(--danger)' : '#1d4ed8' }}>{fmt.money(totalBilled)}</span></span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Paid <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--ok)' }}>{fmt.money(paid)}</span></span>
              {outstanding > 0 && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Outstanding <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--warn)' }}>{fmt.money(outstanding)}</span></span>}
            </div>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>No invoices yet</span>
          )}
        </div>

        {/* Expanded detail */}
        {billingOpen && (
          <div style={{ padding: '4px 20px 20px', borderTop: '1px solid var(--border)' }}>
            <ContractLedgerRow label="Fixed Scope Invoiced" value={invoiced}   total={totalBilled || commitment} color="var(--accent)" onClick={() => onGoToTab('invoices')} />
            <ContractLedgerRow label="+ T&M Invoiced"       value={tmInvoiced}  total={totalBilled || commitment} color="var(--warn)"   onClick={() => onGoToTab('invoices')} />
            <ContractLedgerRow label="+ Expenses Invoiced"  value={expInvoiced} total={totalBilled || commitment} color="#2563eb"       onClick={() => onGoToTab('invoices')} />
            <div style={{ borderTop: '2px solid var(--border)', paddingTop: 14, marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: totalBilled > 0 ? 16 : 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.01em' }}>= Total Billed</span>
              <span style={{ fontSize: 32, fontWeight: 800, fontFamily: 'var(--mono)', letterSpacing: '-0.02em', color: totalBilled > commitment ? 'var(--danger)' : totalBilled > 0 ? '#1d4ed8' : 'var(--text-2)' }}>
                {fmt.money(totalBilled)}
              </span>
            </div>
            {totalBilled > 0 && (
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, padding: '12px 16px', borderRadius: 8, background: paid > 0 ? 'rgba(34,197,94,0.07)' : 'var(--surface-2)', border: `1px solid ${paid > 0 ? 'rgba(34,197,94,0.25)' : 'var(--border)'}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)', marginBottom: 6 }}>Paid</div>
                  <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--mono)', color: paid > 0 ? 'var(--ok)' : 'var(--text-2)', letterSpacing: '-0.02em' }}>{fmt.money(paid)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{Math.round((paid / totalBilled) * 100)}% of total billed</div>
                </div>
                <div style={{ flex: 1, padding: '12px 16px', borderRadius: 8, background: outstanding > 0 ? 'rgba(232,146,26,0.07)' : 'var(--surface-2)', border: `1px solid ${outstanding > 0 ? 'rgba(232,146,26,0.3)' : 'var(--border)'}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-2)', marginBottom: 6 }}>Outstanding</div>
                  <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'var(--mono)', color: outstanding > 0 ? 'var(--warn)' : 'var(--ok)', letterSpacing: '-0.02em' }}>{fmt.money(outstanding)}</div>
                  {outstanding === 0 && <div style={{ fontSize: 12, color: 'var(--ok)', marginTop: 3 }}>Fully paid</div>}
                </div>
              </div>
            )}
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
  const isZero = !value || Number(value) === 0;
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', cursor: onClick ? 'pointer' : 'default' }}>
      <span style={{ fontSize: 15, color: 'var(--text-1)', flex: 1, fontWeight: 500 }}>{label}</span>
      {!isZero && (
        <div style={{ width: 80, height: 6, borderRadius: 3, background: 'var(--surface-3)', flexShrink: 0 }}>
          <div style={{ width: `${Math.min(barPct, 100)}%`, height: '100%', background: color || 'var(--accent)', borderRadius: 3 }} />
        </div>
      )}
      {isZero && <div style={{ width: 80, flexShrink: 0 }} />}
      <span style={{ fontSize: 15, fontWeight: 600, fontFamily: 'var(--mono)', color: isZero ? 'var(--text-2)' : (color || 'var(--text-1)'), minWidth: 90, textAlign: 'right' }}>{fmt.money(value)}</span>
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
