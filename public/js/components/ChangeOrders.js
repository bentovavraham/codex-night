// Change Orders — list view per-contract, with entry form and approve/reject flow.

window.ChangeOrders = function ChangeOrders({ contractId, contractVendor, onLedgerRefresh, userRole: userRoleProp }) {
  const userRole = userRoleProp || window.__userRole || 'pm';
  const [cos, setCos] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showNew, setShowNew] = React.useState(false);
  const [editingCo, setEditingCo] = React.useState(null);
  const [err, setErr] = React.useState(null);

  async function load() {
    setLoading(true);
    try { setCos(await api.listChangeOrders(contractId)); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [contractId]);

  async function pmApprove(id) {
    try {
      await api.pmApproveChangeOrder(id);
      toast('PM approved');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function partnerApprove(id) {
    try {
      await api.partnerApproveChangeOrder(id);
      toast('Partner approved');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function approve(id) {
    try {
      await api.approveChangeOrder(id);
      toast('Change order approved');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function reject(id) {
    const note = await rejectDialog('change order');
    if (!note) return;
    try {
      await api.rejectChangeOrder(id, note);
      toast('Change order rejected');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function del(id) {
    if (!await confirmDialog('Delete change order?', 'This cannot be undone.')) return;
    try {
      await api.deleteChangeOrder(id);
      toast('Deleted');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  const inProgress = cos.filter(c => ['pending','pm_approved','partner_approved'].includes(c.status));
  const approved   = cos.filter(c => c.status === 'approved');
  const rejected   = cos.filter(c => c.status === 'rejected');
  const approvedTotal  = approved.reduce((s, c) => s + Number(c.amount), 0);
  const inProgressTotal = inProgress.reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 20 }}>
          {approvedTotal > 0 && (
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ok)' }}>
              ✓ {fmt.money(approvedTotal)} approved
            </div>
          )}
          {inProgressTotal > 0 && (
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--warn)' }}>
              ⏳ {fmt.money(inProgressTotal)} in progress
            </div>
          )}
          {cos.length === 0 && <div style={{ fontSize: 14, color: 'var(--text-3)' }}>No change orders yet</div>}
        </div>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Change Order</button>
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? <div className="empty">Loading…</div> : cos.length === 0 ? (
        <div className="empty" style={{ padding: '20px 0' }}>No change orders on this contract.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th data-tip="Change order reference number">CO #</th>
              <th data-tip="Scope change description">Description</th>
              <th className="num" data-tip="Dollar value added to or removed from the contract">Amount</th>
              <th data-tip="pending = awaiting approval · approved = added to contract value · rejected = declined">Status</th>
              <th data-tip="Team member who entered this change order">Created by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cos.map(co => (
              <tr key={co.id} className={co.status === 'rejected' ? 'row-over' : ''}>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600 }}>{co.co_number || <span className="hint">—</span>}</td>
                <td>
                  <div style={{ fontSize: 14 }}>{co.description}</div>
                  {co.rejection_note && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 3 }}>
                      Rejected: {co.rejection_note}
                    </div>
                  )}
                  {co.file_reference && (
                    <> · <a href={`/api/files/${encodeURIComponent(co.file_reference)}`} target="_blank" onClick={e => e.stopPropagation()} style={{ fontSize: 12 }}>📄</a></>
                  )}
                </td>
                <td className="num" style={{ fontWeight: 700, fontSize: 15, color: co.status === 'approved' ? 'var(--ok)' : co.status === 'rejected' ? 'var(--text-3)' : 'var(--warn)' }}>
                  {fmt.money(co.amount)}
                </td>
                <td><ApprovalPipeline status={co.status} /></td>
                <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{co.created_by_name} · {fmt.date(co.created_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <ApprovalActions
                      item={co} userRole={userRole}
                      onPmApprove={() => pmApprove(co.id)}
                      onPartnerApprove={() => partnerApprove(co.id)}
                      onApprove={() => approve(co.id)}
                      onReject={() => reject(co.id)}
                      size="small"
                    />
                    {['pending','pm_approved','partner_approved','approved'].includes(co.status) && (
                      <button style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setEditingCo(co)}>Edit</button>
                    )}
                    {co.status === 'pending' && (
                      <button style={{ fontSize: 12, padding: '4px 8px', color: 'var(--text-3)' }} onClick={() => del(co.id)} title="Delete">✕</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && (
        <NewCOModal contractId={contractId} onClose={() => setShowNew(false)}
          onSaved={async () => { setShowNew(false); await load(); if (onLedgerRefresh) onLedgerRefresh(); }} />
      )}
      {editingCo && (
        <EditCOModal co={editingCo} onClose={() => setEditingCo(null)}
          onSaved={async () => { setEditingCo(null); await load(); if (onLedgerRefresh) onLedgerRefresh(); }} />
      )}
    </div>
  );
};

function COStatusBadge({ status }) {
  const colors = {
    pending:          { bg: 'rgba(230,160,30,0.15)', border: 'rgba(230,160,30,0.4)', color: '#e6a01e' },
    pm_approved:      { bg: 'rgba(230,160,30,0.15)', border: 'rgba(230,160,30,0.4)', color: '#e6a01e' },
    partner_approved: { bg: 'rgba(230,160,30,0.15)', border: 'rgba(230,160,30,0.4)', color: '#e6a01e' },
    approved:         { bg: 'rgba(50,190,100,0.15)', border: 'rgba(50,190,100,0.4)', color: 'var(--ok)' },
    rejected:         { bg: 'rgba(220,55,55,0.12)',  border: 'rgba(220,55,55,0.3)',  color: 'var(--danger)' },
  };
  const labels = { pm_approved: 'PM approved', partner_approved: 'partner approved' };
  const c = colors[status] || colors.pending;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      {labels[status] || status}
    </span>
  );
}

function NewCOModal({ contractId, onClose, onSaved }) {
  const [coNumber, setCoNumber] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [fileRef, setFileRef] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  async function onFile(f) {
    setUploading(true);
    try {
      const r = await api.uploadFile(f);
      setFileRef(r);
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); }
  }

  async function save() {
    setErr(null);
    if (!description || !amount) { setErr('Description and amount required'); return; }
    setSaving(true);
    try {
      await api.createChangeOrder(contractId, {
        co_number: coNumber || null,
        description,
        amount: Number(amount),
        file_reference: fileRef?.file_reference || null,
      });
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
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
        width: hasPdf ? 'calc(100% - 40px)' : '560px',
        maxHeight: hasPdf ? 'calc(100% - 40px)' : '90vh',
        background: 'var(--surface)', borderRadius: 10,
        border: '1px solid var(--border)', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <strong style={{ fontSize: 15 }}>New Change Order</strong>
          <button onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>

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
              <iframe src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} title="CO document" />
            </div>
          )}

          {/* Form */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {!hasPdf && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Supporting document (optional)</label>
                <Dropzone file={null} onFile={onFile} onClear={() => setFileRef(null)} busy={uploading} label="Drop PDF — view alongside form" />
              </div>
            )}
            <div className="form-grid">
              <div>
                <label data-tip="Vendor's change order reference number — if blank, one will be auto-assigned">CO Number (optional)</label>
                <input value={coNumber} onChange={e => setCoNumber(e.target.value)} placeholder="e.g. CO-001" />
              </div>
              <div>
                <label data-tip="Dollar value of this change order — positive adds to contract total, negative is a credit">Amount</label>
                <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="full">
                <label data-tip="Describe what changed in scope and why — used for audit trail and reporting">Description</label>
                <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the scope change…" />
              </div>
            </div>
            {err && <div className="error" style={{ marginTop: 16 }}>{err}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving || uploading} onClick={save}>
            {saving ? 'Saving…' : 'Create Change Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditCOModal({ co, onClose, onSaved }) {
  const [coNumber, setCoNumber] = React.useState(co.co_number || '');
  const [description, setDescription] = React.useState(co.description || '');
  const [amount, setAmount] = React.useState(String(co.amount || ''));
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  async function save() {
    setErr(null);
    if (!description || !amount) { setErr('Description and amount required'); return; }
    setSaving(true);
    try {
      await api.updateChangeOrder(co.id, {
        co_number: coNumber || null,
        description,
        amount: Number(amount),
      });
      toast('Change order updated');
      onSaved();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ width: 480, background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid var(--border)' }}>
          <strong style={{ fontSize: 16 }}>Edit Change Order{co.co_number ? ` — ${co.co_number}` : ''}</strong>
          <button onClick={onClose} style={{ fontSize: 20, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>
        {co.status === 'approved' && (
          <div style={{ padding: '10px 22px', background: 'var(--warn-bg)', borderBottom: '1px solid var(--warn-border)', fontSize: 13, color: 'var(--warn)' }}>
            ⚠ This CO is approved — editing will update the commitment amount.
          </div>
        )}
        <div style={{ padding: '22px' }}>
          <div className="form-grid">
            <div>
              <label data-tip="Vendor's CO reference number">CO Number (optional)</label>
              <input value={coNumber} onChange={e => setCoNumber(e.target.value)} placeholder="e.g. CO-001" />
            </div>
            <div>
              <label data-tip="Dollar amount of this change order">Amount ($)</label>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="full">
              <label data-tip="Scope change description — used in audit trail">Description</label>
              <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the scope change…" />
            </div>
          </div>
          {err && <div className="error" style={{ marginTop: 14 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 22px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
