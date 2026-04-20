// T&M Charges — list view per-contract, with entry form and approve/reject flow.

window.TMCharges = function TMCharges({ contractId, onLedgerRefresh }) {
  const [charges, setCharges] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showNew, setShowNew] = React.useState(false);
  const [err, setErr] = React.useState(null);

  async function load() {
    setLoading(true);
    try { setCharges(await api.listTMCharges(contractId)); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [contractId]);

  async function approve(id) {
    try {
      await api.approveTMCharge(id);
      toast('T&M charge approved');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function reject(id) {
    const note = await rejectDialog('T&M charge');
    if (!note) return;
    try {
      await api.rejectTMCharge(id, note);
      toast('T&M charge rejected');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function del(id) {
    if (!await confirmDialog('Delete T&M charge?', 'This cannot be undone.')) return;
    try {
      await api.deleteTMCharge(id);
      toast('Deleted');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  const pending  = charges.filter(c => c.status === 'pending');
  const approved = charges.filter(c => c.status === 'approved');
  const approvedTotal = approved.reduce((s, c) => s + Number(c.amount), 0);
  const pendingTotal  = pending.reduce((s, c)  => s + Number(c.amount), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          {approvedTotal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ok)' }}>✓ {fmt.money(approvedTotal)} approved</div>
          )}
          {pendingTotal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--warn)' }}>⏳ {fmt.money(pendingTotal)} pending</div>
          )}
          {approvedTotal === 0 && pendingTotal === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No T&M charges yet.</div>
          )}
        </div>
        <button className="primary" style={{ fontSize: 12 }} onClick={() => setShowNew(true)}>+ New T&M Charge</button>
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? <div className="empty">Loading…</div> : charges.length === 0 ? (
        <div className="empty" style={{ padding: '20px 0' }}>No time &amp; material charges on this contract.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th data-tip="Date the work was performed">Date</th>
              <th data-tip="Work description from the T&M charge record">Description</th>
              <th style={{ textAlign: 'right' }} data-tip="Hours billed for this charge">Hours</th>
              <th style={{ textAlign: 'right' }} data-tip="Hourly billing rate in dollars">Rate</th>
              <th className="num" data-tip="Total charge amount (hours × rate, or entered directly)">Amount</th>
              <th data-tip="pending = awaiting approval · approved = counted in contract spend · rejected = declined">Status</th>
              <th data-tip="Team member who entered this charge">Added by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {charges.map(c => (
              <tr key={c.id} className={c.status === 'rejected' ? 'row-over' : ''}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmt.date(c.charge_date)}</td>
                <td>
                  {c.description}
                  {c.notes && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{c.notes}</div>}
                  {c.rejection_note && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Rejected: {c.rejection_note}</div>
                  )}
                  {c.file_reference && (
                    <> · <a href={`/api/files/${encodeURIComponent(c.file_reference)}`} target="_blank" onClick={e => e.stopPropagation()} style={{ fontSize: 11 }}>📄</a></>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-3)' }}>
                  {c.hours ? c.hours : <span className="hint">—</span>}
                </td>
                <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-3)' }}>
                  {c.rate ? fmt.money(c.rate) : <span className="hint">—</span>}
                </td>
                <td className="num" style={{ fontWeight: 600, color: c.status === 'approved' ? 'var(--ok)' : c.status === 'rejected' ? 'var(--text-3)' : 'var(--warn)' }}>
                  {fmt.money(c.amount)}
                </td>
                <td><COStatusBadge status={c.status} /></td>
                <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{c.created_by_name} · {fmt.date(c.created_at)}</td>
                <td>
                  {c.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => approve(c.id)}>Approve</button>
                      <button style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => reject(c.id)}>Reject</button>
                      <button style={{ fontSize: 11, padding: '3px 8px', color: 'var(--text-3)' }} onClick={() => del(c.id)} title="Delete">✕</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && (
        <NewTMChargeModal contractId={contractId}
          onClose={() => setShowNew(false)}
          onSaved={async () => { setShowNew(false); await load(); if (onLedgerRefresh) onLedgerRefresh(); }} />
      )}
    </div>
  );
};

function NewTMChargeModal({ contractId, onClose, onSaved }) {
  const [description, setDescription] = React.useState('');
  const [hours, setHours] = React.useState('');
  const [rate, setRate] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [fileRef, setFileRef] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  // Auto-calculate amount when hours + rate both filled
  React.useEffect(() => {
    const h = parseFloat(hours);
    const r = parseFloat(rate);
    if (h > 0 && r > 0) {
      setAmount(String((h * r).toFixed(2)));
    }
  }, [hours, rate]);

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
      await api.createTMCharge(contractId, {
        description,
        hours: hours ? Number(hours) : null,
        rate: rate ? Number(rate) : null,
        amount: Number(amount),
        charge_date: date || null,
        notes: notes || null,
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
          <strong style={{ fontSize: 15 }}>New T&M Charge</strong>
          <button onClick={onClose} style={{ fontSize: 18, lineHeight: 1, padding: '2px 8px' }}>×</button>
        </div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {hasPdf && (
            <div style={{ flex: '0 0 55%', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: '#1a1a1a' }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>📄</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileRef.filename}</span>
                <a href={pdfUrl} target="_blank" style={{ fontSize: 11 }}>Open ↗</a>
                <button onClick={() => setFileRef(null)} style={{ fontSize: 11, color: 'var(--text-3)' }}>Remove</button>
              </div>
              <iframe src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} title="T&M document" />
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {!hasPdf && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Supporting document (optional — timesheets, work orders)</label>
                <Dropzone file={null} onFile={onFile} onClear={() => setFileRef(null)} busy={uploading} label="Drop PDF — view alongside form" />
              </div>
            )}

            <div className="form-grid">
              <div className="full">
                <label data-tip="Brief description of the work performed — appears on the charge record and reports">Description <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Additional labor for site prep…" />
              </div>
              <div>
                <label data-tip="Number of hours worked — multiplied by rate to auto-calculate total amount">Hours</label>
                <input type="number" step="0.25" min="0" value={hours} onChange={e => setHours(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label data-tip="Hourly billing rate in dollars — multiplied by hours to auto-calculate total amount">Rate ($/hr)</label>
                <input type="number" step="0.01" min="0" value={rate} onChange={e => setRate(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label data-tip="Total charge amount — enter directly or let it auto-fill from hours × rate above">Amount <span style={{ color: 'var(--danger)' }}>*</span> <span className="hint">auto-filled from hours × rate</span></label>
                <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label data-tip="Date the work was performed — used for period reporting">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="full">
                <label data-tip="Additional context — crew size, PO references, site conditions, etc.">Notes</label>
                <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional context, crew details, etc." />
              </div>
            </div>

            {err && <div className="error" style={{ marginTop: 16 }}>{err}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving || uploading || !description || !amount} onClick={save}>
            {saving ? 'Saving…' : 'Create T&M Charge'}
          </button>
        </div>
      </div>
    </div>
  );
}
