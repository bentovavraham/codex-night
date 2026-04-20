// Contract Expenses — list view per-contract, with entry form and approve/reject flow.

const EXPENSE_CATEGORIES = ['travel', 'tolls', 'food', 'hotel', 'copies', 'other'];

window.Expenses = function Expenses({ contractId, onLedgerRefresh }) {
  const [expenses, setExpenses] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showNew, setShowNew] = React.useState(false);
  const [err, setErr] = React.useState(null);

  async function load() {
    setLoading(true);
    try { setExpenses(await api.listExpenses(contractId)); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  React.useEffect(() => { load(); }, [contractId]);

  async function approve(id) {
    try {
      await api.approveExpense(id);
      toast('Expense approved');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function reject(id) {
    const note = await rejectDialog('expense');
    if (!note) return;
    try {
      await api.rejectExpense(id, note);
      toast('Expense rejected');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  async function del(id) {
    if (!await confirmDialog('Delete expense?', 'This cannot be undone.')) return;
    try {
      await api.deleteExpense(id);
      toast('Deleted');
      await load();
      if (onLedgerRefresh) onLedgerRefresh();
    } catch (e) { toast(e.message, 'error'); }
  }

  const pending  = expenses.filter(e => e.status === 'pending');
  const approved = expenses.filter(e => e.status === 'approved');
  const approvedTotal = approved.reduce((s, e) => s + Number(e.amount), 0);
  const pendingTotal  = pending.reduce((s, e)  => s + Number(e.amount), 0);

  // Group approved by category for quick summary
  const byCategory = approved.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
    return acc;
  }, {});

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {approvedTotal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ok)' }}>✓ {fmt.money(approvedTotal)} approved</div>
          )}
          {pendingTotal > 0 && (
            <div style={{ fontSize: 12, color: 'var(--warn)' }}>⏳ {fmt.money(pendingTotal)} pending</div>
          )}
          {approvedTotal === 0 && pendingTotal === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No expenses yet.</div>
          )}
          {Object.entries(byCategory).map(([cat, total]) => (
            <div key={cat} style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {cat}: <span style={{ color: 'var(--text-2)' }}>{fmt.money(total)}</span>
            </div>
          ))}
        </div>
        <button className="primary" style={{ fontSize: 12 }} onClick={() => setShowNew(true)}>+ New Expense</button>
      </div>

      {err && <div className="error">{err}</div>}

      {loading ? <div className="empty">Loading…</div> : expenses.length === 0 ? (
        <div className="empty" style={{ padding: '20px 0' }}>No expenses on this contract.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th data-tip="Date the expense was incurred">Date</th>
              <th data-tip="Expense type — travel, tolls, food, hotel, copies, or other">Category</th>
              <th data-tip="What the expense was for">Description</th>
              <th className="num" data-tip="Dollar amount from the receipt or invoice">Amount</th>
              <th data-tip="pending = awaiting approval · approved = counted in contract spend · rejected = declined">Status</th>
              <th data-tip="Team member who entered this expense">Added by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map(e => (
              <tr key={e.id} className={e.status === 'rejected' ? 'row-over' : ''}>
                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{fmt.date(e.expense_date)}</td>
                <td>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: 'rgba(196,82,42,0.12)', border: '1px solid rgba(196,82,42,0.3)',
                    color: 'var(--accent)', textTransform: 'capitalize',
                  }}>{e.category}</span>
                </td>
                <td>
                  {e.description || <span className="hint">—</span>}
                  {e.notes && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{e.notes}</div>}
                  {e.rejection_note && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>Rejected: {e.rejection_note}</div>
                  )}
                  {e.file_reference && (
                    <> · <a href={`/api/files/${encodeURIComponent(e.file_reference)}`} target="_blank" onClick={ev => ev.stopPropagation()} style={{ fontSize: 11 }}>📄 receipt</a></>
                  )}
                </td>
                <td className="num" style={{ fontWeight: 600, color: e.status === 'approved' ? 'var(--ok)' : e.status === 'rejected' ? 'var(--text-3)' : 'var(--warn)' }}>
                  {fmt.money(e.amount)}
                </td>
                <td><COStatusBadge status={e.status} /></td>
                <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{e.created_by_name} · {fmt.date(e.created_at)}</td>
                <td>
                  {e.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => approve(e.id)}>Approve</button>
                      <button style={{ fontSize: 11, padding: '3px 10px', color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => reject(e.id)}>Reject</button>
                      <button style={{ fontSize: 11, padding: '3px 8px', color: 'var(--text-3)' }} onClick={() => del(e.id)} title="Delete">✕</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew && (
        <NewExpenseModal contractId={contractId}
          onClose={() => setShowNew(false)}
          onSaved={async () => { setShowNew(false); await load(); if (onLedgerRefresh) onLedgerRefresh(); }} />
      )}
    </div>
  );
};

function NewExpenseModal({ contractId, onClose, onSaved }) {
  const [category, setCategory] = React.useState('other');
  const [amount, setAmount] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [date, setDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
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
    if (!amount) { setErr('Amount required'); return; }
    setSaving(true);
    try {
      await api.createExpense(contractId, {
        category,
        amount: Number(amount),
        description: description || null,
        expense_date: date || null,
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
        width: hasPdf ? 'calc(100% - 40px)' : '520px',
        maxHeight: hasPdf ? 'calc(100% - 40px)' : '90vh',
        background: 'var(--surface)', borderRadius: 10,
        border: '1px solid var(--border)', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <strong style={{ fontSize: 15 }}>New Expense</strong>
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
              <iframe src={pdfUrl} style={{ flex: 1, border: 'none', width: '100%' }} title="Receipt" />
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {!hasPdf && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>Receipt / supporting document (optional)</label>
                <Dropzone file={null} onFile={onFile} onClear={() => setFileRef(null)} busy={uploading} label="Drop receipt PDF — view alongside form" />
              </div>
            )}

            <div className="form-grid">
              <div>
                <label data-tip="Expense type — used for category breakdowns and cost reporting (travel, tolls, food, hotel, copies, other)">Category <span style={{ color: 'var(--danger)' }}>*</span></label>
                <select value={category} onChange={e => setCategory(e.target.value)}>
                  {EXPENSE_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label data-tip="Total dollar amount of this expense — enter from the receipt">Amount <span style={{ color: 'var(--danger)' }}>*</span></label>
                <input type="number" step="0.01" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label data-tip="Date the expense was incurred — use the date on the receipt">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="full">
                <label data-tip="What the expense was for — appears on cost reports">Description</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Toll charges for site delivery" />
              </div>
              <div className="full">
                <label data-tip="Additional context — vendor name, reimbursement status, receipt reference, etc.">Notes</label>
                <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional details, vendor name, etc." />
              </div>
            </div>

            {err && <div className="error" style={{ marginTop: 16 }}>{err}</div>}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={saving || uploading || !amount} onClick={save}>
            {saving ? 'Saving…' : 'Create Expense'}
          </button>
        </div>
      </div>
    </div>
  );
}
