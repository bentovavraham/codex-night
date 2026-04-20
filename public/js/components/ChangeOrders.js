// Change Orders — list view per-contract, with entry form and approve/reject flow.

window.ChangeOrders = function ChangeOrders({ contractId, contractVendor, onLedgerRefresh }) {
  const [cos, setCos] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showNew, setShowNew] = React.useState(false);
  const [err, setErr] = React.useState(null);

  async function load() {
    setLoading(true);
    try { setCos(await api.listChangeOrders(contractId)); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [contractId]);

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

  const pending   = cos.filter(c => c.status === 'pending');
  const approved  = cos.filter(c => c.status === 'approved');
  const rejected  = cos.filter(c => c.status === 'rejected');
  const approvedTotal = approved.reduce((s, c) => s + Number(c.amount), 0);
  const pendingTotal  = pending.reduce((s, c) => s + Number(c.amount), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          {approvedTotal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ok)' }}>
              ✓ {fmt.money(approvedTotal)} approved
            </div>
          )}
          {pendingTotal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--warn)' }}>
              ⏳ {fmt.money(pendingTotal)} pending
            </div>
          )}
        </div>
        <button className="primary" style={{ fontSize: 12 }} onClick={() => setShowNew(true)}>+ New Change Order</button>
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? <div className="empty">Loading…</div> : cos.length === 0 ? (
        <div className="empty" style={{ padding: '20px 0' }}>No change orders on this contract.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>CO #</th>
              <th>Description</th>
              <th className="num">Amount</th>
              <th>Status</th>
              <th>Created by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cos.map(co => (
              <tr key={co.id} className={co.status === 'rejected' ? 'row-over' : ''}>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{co.co_number || <span className="hint">—</span>}</td>
                <td>
                  {co.description}
                  {co.rejection_note && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
                      Rejected: {co.rejection_note}
                    </div>
                  )}
                  {co.file_reference && (
                    <> · <a href={`/api/files/${encodeURIComponent(co.file_reference)}`} target="_blank" onClick={e => e.stopPropagation()} style={{ fontSize: 11 }}>📄</a></>
                  )}
                </td>
                <td className="num" style={{ fontWeight: 600, color: co.status === 'approved' ? 'var(--ok)' : co.status === 'rejected' ? 'var(--text-3)' : 'var(--warn)' }}>
                  {fmt.money(co.amount)}
                </td>
                <td><COStatusBadge status={co.status} /></td>
                <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{co.created_by_name} · {fmt.date(co.created_at)}</td>
                <td>
                  {co.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => approve(co.id)}>Approve</button>
                      <button style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => reject(co.id)}>Reject</button>
                      <button style={{ fontSize: 11, padding: '3px 8px', color: 'var(--text-3)' }} onClick={() => del(co.id)} title="Delete">✕</button>
                    </div>
                  )}
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
    </div>
  );
};

function COStatusBadge({ status }) {
  const colors = {
    pending:  { bg: 'rgba(230,160,30,0.15)', border: 'rgba(230,160,30,0.4)', color: '#e6a01e' },
    approved: { bg: 'rgba(50,190,100,0.15)', border: 'rgba(50,190,100,0.4)', color: 'var(--ok)' },
    rejected: { bg: 'rgba(220,55,55,0.12)',  border: 'rgba(220,55,55,0.3)',  color: 'var(--danger)' },
  };
  const c = colors[status] || colors.pending;
  return (
    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: c.bg, border: `1px solid ${c.border}`, color: c.color }}>
      {status}
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 560 }}>
        <div className="modal-header">
          <strong>New Change Order</strong>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div>
              <label>CO Number (optional)</label>
              <input value={coNumber} onChange={e => setCoNumber(e.target.value)} placeholder="e.g. CO-001" />
            </div>
            <div>
              <label>Amount</label>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="full">
              <label>Description</label>
              <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Describe the scope change…" />
            </div>
            <div className="full">
              <label>Supporting document (optional)</label>
              <Dropzone
                file={fileRef ? { filename: fileRef.filename, download_url: `/api/files/${encodeURIComponent(fileRef.file_reference)}` } : null}
                onFile={onFile} onClear={() => setFileRef(null)} busy={uploading}
                label="Drop PDF or image" />
            </div>
          </div>
          {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving || uploading} onClick={save}>
            {saving ? 'Saving…' : 'Create Change Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
