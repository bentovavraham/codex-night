// Inline confidence dot shown next to auto-filled labels.
// Clears when the user edits the field manually.
function ConfidenceDot({ level }) {
  if (!level) return null;
  const map = {
    high:   { color: '#16a34a', tip: 'High confidence — Claude found this clearly in the document' },
    medium: { color: '#d97706', tip: 'Medium confidence — verify this field before saving' },
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

function InvoiceTypeBadge({ type }) {
  if (!type || type === 'fixed') return null;
  const styles = {
    tm:      { bg: 'rgba(37,99,235,0.09)',  color: '#1d4ed8', label: 'T&M'     },
    expense: { bg: 'rgba(124,58,237,0.09)', color: '#6d28d9', label: 'Expense' },
  };
  const s = styles[type];
  if (!s) return null;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: s.bg, color: s.color, flexShrink: 0 }}>
      {s.label}
    </span>
  );
}

// contractId prop: when provided, locks the list + NewInvoiceModal to that contract.
// This is how the contract-level Invoices tab reuses the same component as the project view.
window.Invoices = function Invoices({ projectId, contractId, userRole: userRoleProp }) {
  const userRole = userRoleProp || window.__userRole || 'pm';
  const [invoices, setInvoices] = React.useState([]);
  const [contracts, setContracts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState(null);
  const [showNew, setShowNew] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  const [view, setView] = React.useState('all');
  const [filter, setFilter] = React.useState({ status: '', contract_id: contractId ? String(contractId) : '', vendor: '', sort: '', invoice_type: '' });
  const [selected, setSelected] = React.useState(new Set());
  const [busy, setBusy] = React.useState({}); // id -> true

  async function load() {
    setLoading(true);
    try {
      // In 'needs approval' view fetch all statuses so pm_approved/partner_approved are visible
      const f = view === 'pending' ? { ...filter, status: '' } : filter;
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

  async function handlePmApprove(inv) {
    await doAction(`${inv.invoice_number} PM approved`, api.pmApproveInvoice, inv.id);
  }

  async function handlePartnerApprove(inv) {
    await doAction(`${inv.invoice_number} partner approved`, api.partnerApproveInvoice, inv.id);
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
    const ok = await confirmDialog('Final approve invoice?',
      `Final-approve ${inv.invoice_number} for ${fmt.moneyPrecise(inv.amount)} from ${inv.vendor_name}?`);
    if (!ok) return;
    await doAction(`${inv.invoice_number} approved`, api.approveInvoice, inv.id);
  }

  async function handleBulkApprove() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirmDialog(`PM-approve ${ids.length} invoices?`,
      `This will PM-approve ${ids.length} pending invoice(s). Continue?`);
    if (!ok) return;
    setBusy(b => ({ ...b, bulk: true }));
    try {
      const result = await api.bulkApprove(ids);
      toast(`${result.approved} invoice(s) PM-approved`);
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
  const IN_PROGRESS = ['pending', 'pm_approved', 'partner_approved'];
  const inProgressInvoices = invoices.filter(i => IN_PROGRESS.includes(i.status));
  const inProgressCount = inProgressInvoices.length;
  const totalInProgress = inProgressInvoices.reduce((s, i) => s + Number(i.amount), 0);
  const approvedInvoices = invoices.filter(i => ['approved', 'pushed', 'paid'].includes(i.status));
  const totalApproved = approvedInvoices.reduce((s, i) => s + Number(i.amount), 0);
  const totalPaid = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount), 0);
  const totalFixed   = approvedInvoices.filter(i => !i.invoice_type || i.invoice_type === 'fixed').reduce((s, i) => s + Number(i.amount), 0);
  const totalTM      = approvedInvoices.filter(i => i.invoice_type === 'tm').reduce((s, i) => s + Number(i.amount), 0);
  const totalExpense = approvedInvoices.filter(i => i.invoice_type === 'expense').reduce((s, i) => s + Number(i.amount), 0);

  // Pending tab: show all in-progress items; bulk select only targets strictly pending
  const needsApprovalInvoices = view === 'pending' ? inProgressInvoices : [];
  const pendingInvoices = invoices.filter(i => i.status === 'pending');
  const allPendingSelected = pendingInvoices.length > 0 && pendingInvoices.every(i => selected.has(i.id));

  // Status accent colors
  function statusAccent(status) {
    if (status === 'pending')          return { color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.3)'  };
    if (status === 'pm_approved')      return { color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.3)'  };
    if (status === 'partner_approved') return { color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.3)'  };
    if (status === 'on_hold')          return { color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.3)' };
    if (status === 'approved')         return { color: '#2563eb', bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.25)' };
    if (status === 'pushed')           return { color: '#0891b2', bg: 'rgba(8,145,178,0.08)',  border: 'rgba(8,145,178,0.25)' };
    if (status === 'paid')             return { color: '#16a34a', bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.25)' };
    if (status === 'rejected')         return { color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.25)' };
    return { color: 'var(--text-3)', bg: 'var(--surface-2)', border: 'var(--border)' };
  }

  return (
    <div className="panel">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Invoices</h2>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            {inProgressCount > 0 && (
              <span style={{ marginLeft: 8, padding: '1px 7px', borderRadius: 10, background: '#d97706', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                {inProgressCount} in progress
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!contractId && <a href={`/api/projects/${projectId}/invoices/export`} target="_blank" className="btn" style={{ fontSize: 12 }}>Export CSV</a>}
          <button className="primary" onClick={() => setShowNew(true)}>+ New Invoice</button>
        </div>
      </div>

      {/* Summary strip */}
      {invoices.length > 0 && (
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ flex: 1, padding: '12px 18px', borderRight: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Needs Approval</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: inProgressCount > 0 ? '#d97706' : 'var(--ok)' }}>
              {inProgressCount > 0 ? fmt.money(totalInProgress) : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {inProgressCount > 0 ? `${inProgressCount} invoice${inProgressCount !== 1 ? 's' : ''}` : 'all clear'}
            </div>
          </div>
          <div style={{ flex: 2, padding: '12px 18px', borderRight: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Approved / Billed</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{fmt.money(totalApproved)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, display: 'flex', gap: 10 }}>
              <span>Fixed <strong style={{ color: 'var(--text-2)' }}>{fmt.money(totalFixed)}</strong></span>
              {totalTM > 0 && <span>T&M <strong style={{ color: '#1d4ed8' }}>{fmt.money(totalTM)}</strong></span>}
              {totalExpense > 0 && <span>Expenses <strong style={{ color: '#6d28d9' }}>{fmt.money(totalExpense)}</strong></span>}
            </div>
          </div>
          <div style={{ flex: 1, padding: '12px 18px', background: 'var(--surface-2)' }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Paid</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>{fmt.money(totalPaid)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>cash out</div>
          </div>
        </div>
      )}

      {/* View tabs */}
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>All invoices</button>
        <button className={view === 'pending' ? 'active' : ''} onClick={() => setView('pending')}>
          Needs approval {inProgressCount > 0 ? `(${inProgressCount})` : ''}
        </button>
      </div>

      {/* Filters — only on all-view */}
      {view === 'all' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {/* Type toggle */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { k: '',        label: 'All types' },
              { k: 'fixed',   label: 'Fixed scope' },
              { k: 'tm',      label: 'T&M' },
              { k: 'expense', label: 'Expense' },
            ].map(t => (
              <button key={t.k} onClick={() => setFilter({ ...filter, invoice_type: t.k })} style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: filter.invoice_type === t.k ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                background: filter.invoice_type === t.k ? 'rgba(196,82,42,0.09)' : 'var(--surface)',
                color: filter.invoice_type === t.k ? 'var(--accent)' : 'var(--text-2)',
              }}>{t.label}</button>
            ))}
          </div>
          {/* Other filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input placeholder="Search vendor" value={filter.vendor}
              onChange={e => setFilter({ ...filter, vendor: e.target.value })}
              style={{ flex: '1 1 140px', minWidth: 0 }} />
            <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} style={{ width: 130 }}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="on_hold">On Hold</option>
              <option value="rejected">Rejected</option>
              <option value="pushed">Pushed</option>
              <option value="paid">Paid</option>
            </select>
            {!contractId && (
              <select value={filter.contract_id} onChange={e => setFilter({ ...filter, contract_id: e.target.value })} style={{ width: 200 }}>
                <option value="">All contracts</option>
                <option value="none">Standalone only</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name} — {fmt.money(c.total_value)}</option>)}
              </select>
            )}
            <select value={filter.sort} onChange={e => setFilter({ ...filter, sort: e.target.value })} style={{ width: 130 }}>
              <option value="">Sort: Date</option>
              <option value="amount">Sort: Amount</option>
              <option value="vendor">Sort: Vendor</option>
              <option value="status">Sort: Status</option>
            </select>
          </div>
        </div>
      )}

      {/* Bulk select bar — bulk PM-approve strictly pending invoices */}
      {view === 'pending' && pendingInvoices.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 14px', borderRadius: 7, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <input type="checkbox" style={{ width: 'auto', margin: 0 }}
            checked={allPendingSelected}
            onChange={e => e.target.checked ? selectAll() : setSelected(new Set())} />
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {selected.size > 0 ? `${selected.size} selected` : `Select all ${pendingInvoices.length} pending`}
          </span>
          {selected.size > 0 && (
            <>
              <button className="primary" disabled={busy.bulk} onClick={handleBulkApprove} style={{ marginLeft: 'auto' }}>
                {busy.bulk ? <><span className="spinner"></span>Approving…</> : `PM Approve ${selected.size}`}
              </button>
              <button onClick={() => setSelected(new Set())}>Clear</button>
            </>
          )}
        </div>
      )}

      {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}

      {loading ? <div className="empty">Loading invoices…</div>
       : invoices.length === 0 ? <div className="empty">No invoices match these filters.</div>
       : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(view === 'pending' ? needsApprovalInvoices : invoices).map(i => {
            const sa = statusAccent(i.status);
            const isBusy = !!busy[i.id];
            const isInProgress = IN_PROGRESS.includes(i.status);
            const isPending = i.status === 'pending';
            const isSelected = selected.has(i.id);

            return (
              <div key={i.id} style={{
                borderRadius: 8,
                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                borderLeft: `4px solid ${sa.color}`,
                background: isSelected ? 'rgba(196,82,42,0.04)' : 'var(--surface)',
                overflow: 'hidden',
                transition: 'box-shadow 0.12s',
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
              >
                {/* Main row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px' }}>

                  {/* Checkbox — only for pending */}
                  <div style={{ flexShrink: 0, width: 18 }}>
                    {isPending && (
                      <input type="checkbox" style={{ width: 'auto', margin: 0 }}
                        checked={isSelected} onChange={() => toggleSelect(i.id)} />
                    )}
                  </div>

                  {/* Vendor + invoice # */}
                  <div style={{ flex: '1 1 0', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{i.vendor_name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'monospace' }}>{i.invoice_number}</span>
                      <InvoiceTypeBadge type={i.invoice_type} />
                      {i.file_reference && (
                        <a href={`/api/files/${encodeURIComponent(i.file_reference)}`} target="_blank"
                          title="View PDF" style={{ fontSize: 13, textDecoration: 'none', flexShrink: 0 }}>📄</a>
                      )}
                      {i.alloc_count > 1 && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#e8daff', color: '#5b21b6' }}>
                          split ×{i.alloc_count}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                      {i.contract_id
                        ? (i.alloc_count > 1 ? 'Multiple contracts' : (i.contract_vendor || `Contract #${i.contract_id}`))
                        : 'Standalone'}
                      {i.invoice_date && <span style={{ marginLeft: 8 }}>{fmt.date(i.invoice_date)}</span>}
                      {i.created_by_name && <span style={{ marginLeft: 8 }}>· {i.created_by_name}</span>}
                    </div>
                  </div>

                  {/* Amount */}
                  <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 90 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{fmt.moneyPrecise(i.amount)}</div>
                  </div>

                  {/* Status — pipeline for in-progress, pill otherwise */}
                  <div style={{ flexShrink: 0, minWidth: 90, textAlign: 'center' }}>
                    {IN_PROGRESS.includes(i.status)
                      ? <ApprovalPipeline status={i.status} />
                      : <span style={{
                          display: 'inline-block', fontSize: 10, fontWeight: 700,
                          letterSpacing: '0.07em', textTransform: 'uppercase',
                          padding: '3px 9px', borderRadius: 5,
                          background: sa.bg, color: sa.color, border: `1px solid ${sa.border}`,
                        }}>{i.status.replace('_',' ')}</span>
                    }
                  </div>

                  {/* Actions */}
                  <div style={{ flexShrink: 0, display: 'flex', gap: 5, alignItems: 'center' }}>
                    <button onClick={() => setEditingId(i.id)} style={{ fontSize: 12, padding: '4px 10px' }}>Edit</button>
                    {isInProgress && (
                      <>
                        <ApprovalActions
                          item={i} userRole={userRole}
                          onPmApprove={() => handlePmApprove(i)}
                          onPartnerApprove={() => handlePartnerApprove(i)}
                          onApprove={() => handleApprove(i)}
                          onReject={() => handleReject(i)}
                          size="small"
                        />
                        {isPending && <button disabled={isBusy} onClick={() => handleHold(i)} style={{ fontSize: 12, padding: '4px 10px' }}>Hold</button>}
                      </>
                    )}
                    {i.status === 'on_hold' && <>
                      <button className="primary" disabled={isBusy} onClick={() => handleApprove(i)} style={{ fontSize: 12, padding: '4px 10px' }}>Approve</button>
                      <button disabled={isBusy} onClick={() => handleRevert(i)} style={{ fontSize: 12, padding: '4px 10px' }}>Release</button>
                    </>}
                    {['approved','rejected','pushed','paid'].includes(i.status) &&
                      <button disabled={isBusy} onClick={() => handleRevert(i)} style={{ fontSize: 12, padding: '4px 10px' }}>Revert</button>}
                    {i.status === 'approved' &&
                      <button disabled={isBusy} onClick={() => doAction(`${i.invoice_number} pushed`, api.markPushed, i.id)} style={{ fontSize: 12, padding: '4px 10px' }}>Push</button>}
                    {(i.status === 'approved' || i.status === 'pushed') &&
                      <button disabled={isBusy} onClick={() => doAction(`${i.invoice_number} marked paid`, api.markPaid, i.id, null)} style={{ fontSize: 12, padding: '4px 10px' }}>Paid</button>}
                  </div>
                </div>

                {/* Rejection note — inline below the row */}
                {i.rejection_note && (
                  <div style={{ padding: '7px 16px 10px 52px', borderTop: '1px solid var(--border)', background: 'rgba(220,38,38,0.04)', fontSize: 12.5, color: '#dc2626' }}>
                    <strong>Rejected:</strong> {i.rejection_note}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showNew && <NewInvoiceModal
        projectId={projectId}
        contracts={contracts}
        defaultContractId={contractId ? String(contractId) : undefined}
        lockedContract={contractId ? contracts.find(c => c.id === contractId || String(c.id) === String(contractId)) : undefined}
        onClose={() => setShowNew(false)}
        onSaved={async () => { setShowNew(false); toast('Invoice created'); await load(); }} />}
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
  const [invoiceType, setInvoiceType] = React.useState('fixed');
  const [allocs, setAllocs] = React.useState([{ contract_id: '', amount: '' }]);
  const [invoiceNumber, setInvoiceNumber] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [date, setDate] = React.useState('');
  const [vendor, setVendor] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [fileRef, setFileRef] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [extractNote, setExtractNote] = React.useState(null);
  const [confidence, setConfidence] = React.useState({});
  const [confirmed, setConfirmed] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [dupWarning, setDupWarning] = React.useState(null); // { message, duplicates }

  function aiFieldStyle(field) {
    const c = confidence[field];
    if (c === 'low')    return { border: '1.5px solid #dc2626', background: '#fef2f2' };
    if (c === 'medium') return { border: '1.5px solid #d97706', background: '#fffbeb' };
    return {};
  }

  React.useEffect(() => {
    if (mode !== 'contract' || !contractId) { setContext(null); return; }
    api.getContract(contractId).then(c => {
      const remaining = Number(c.remaining_amount);
      const tmInvoiced = Number(c.tm_invoiced_amount || 0);
      setContext({ total: Number(c.total_value), invoiced: Number(c.invoiced_amount), remaining, tmInvoiced });
      if (!vendor) setVendor(c.vendor_name);
      // Only prefill amount with remaining for fixed-scope invoices
      if (invoiceType === 'fixed' && (!amount || Number(amount) === 0)) setAmount(String(remaining));
    }).catch(e => setErr(e.message));
  }, [contractId, mode, invoiceType]);

  async function onFile(f) {
    setErr(null); setExtractNote(null); setUploading(true);
    try {
      const resp = await api.extractInvoice(f);
      setFileRef({ file_reference: resp.file_reference, filename: resp.filename, download_url: resp.download_url });
      if (resp.extract_error) { setExtractNote(`PDF saved. Extraction failed: ${resp.extract_error}`); }
      else if (resp.extracted) {
        const e = resp.extracted;
        const filled = [];
        if (e.invoice_number && !invoiceNumber) { setInvoiceNumber(e.invoice_number); filled.push('invoice_number'); }
        if (e.vendor_name && !vendor) { setVendor(e.vendor_name); filled.push('vendor_name'); }
        if (e.amount && (!amount || Number(amount) === 0)) { setAmount(String(e.amount)); filled.push('amount'); }
        if (e.invoice_date && !date) { setDate(e.invoice_date); filled.push('invoice_date'); }
        if (e.summary) setDescription(d => d ? `${d}\n\n${e.summary}` : e.summary);
        if (e.confidence) {
          const conf = {};
          filled.forEach(fld => { if (e.confidence[fld]) conf[fld] = e.confidence[fld]; });
          setConfidence(conf);
        }

        // Auto-select contract if vendor name matches one in this project
        let contractNote = '';
        if (e.vendor_name && !contractId && !lockedContract && contracts && contracts.length > 0) {
          const needle = e.vendor_name.toLowerCase().trim();
          // Exact match first, then prefix/contains
          const match =
            contracts.find(c => c.vendor_name.toLowerCase().trim() === needle) ||
            contracts.find(c => c.vendor_name.toLowerCase().includes(needle) || needle.includes(c.vendor_name.toLowerCase().trim()));
          if (match) {
            setContractId(String(match.id));
            contractNote = ` · Contract matched: ${match.vendor_name}`;
          }
        }

        setExtractNote(`Fields pre-filled from PDF — colored dots show confidence${contractNote}.`);
      }
    } catch (e) { setErr(e.message); }
    finally { setUploading(false); }
  }

  function setAlloc(i, patch) { const n = allocs.slice(); n[i] = { ...n[i], ...patch }; setAllocs(n); }
  const allocSum = allocs.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const allocDiff = (Number(amount) || 0) - allocSum;

  async function save(force = false) {
    setErr(null);
    if (!force) setDupWarning(null);
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
        invoice_type: invoiceType,
      };
      if (force) body.force = true;
      if (mode === 'contract') {
        body.contract_id = Number(contractId);
      } else if (mode === 'multi') {
        body.contracts = allocs.filter(a => a.contract_id && a.amount).map(a => ({
          contract_id: Number(a.contract_id), amount: Number(a.amount),
        }));
      }
      await api.createInvoice(body);
      onSaved();
    } catch (e) {
      if (e.status === 409 && e.payload?.soft_duplicate) {
        setDupWarning(e.payload);
      } else {
        setErr(e.message);
      }
    }
    finally { setSaving(false); }
  }

  const overspend = mode === 'contract' && invoiceType === 'fixed' && context && Number(amount) > context.remaining + 0.01;
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

            {/* Invoice type selector */}
            {mode !== 'standalone' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Invoice type</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    { k: 'fixed',   label: 'Fixed scope',  tip: 'Counts against the contract value — lump-sum work billed per contract line items' },
                    { k: 'tm',      label: 'T&M',          tip: 'Time & Materials billing — does not erode the fixed contract value, shows as additional project cost' },
                    { k: 'expense', label: 'Expense',      tip: 'Reimbursable expenses (travel, tolls, etc.) — does not erode the fixed contract value' },
                  ].map(t => (
                    <button key={t.k} type="button" title={t.tip} onClick={() => setInvoiceType(t.k)} style={{
                      flex: 1, padding: '7px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      border: invoiceType === t.k ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                      background: invoiceType === t.k ? 'rgba(196,82,42,0.08)' : 'var(--surface)',
                      color: invoiceType === t.k ? 'var(--accent)' : 'var(--text-2)',
                    }}>{t.label}</button>
                  ))}
                </div>
                {invoiceType !== 'fixed' && (
                  <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-3)', padding: '5px 10px', background: 'rgba(232,146,26,0.06)', borderRadius: 5, border: '1px solid rgba(232,146,26,0.2)' }}>
                    {invoiceType === 'tm' ? 'T&M invoices track additional hours billed — they do not count against the fixed contract value.' : 'Expense invoices track reimbursables — they do not count against the fixed contract value.'}
                  </div>
                )}
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
                {context && invoiceType === 'fixed' && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-3)' }}>
                    Initial: <strong style={{ color: 'var(--text-2)' }}>{fmt.money(context.total)}</strong>
                    {' · '}Fixed invoiced: <strong style={{ color: 'var(--text-2)' }}>{fmt.money(context.invoiced)}</strong>
                    {' · '}Remaining: <strong style={{ color: context.remaining < 0 ? 'var(--danger)' : 'var(--ok)' }}>{fmt.money(context.remaining)}</strong>
                  </div>
                )}
                {context && invoiceType !== 'fixed' && (
                  <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-3)' }}>
                    Initial: <strong style={{ color: 'var(--text-2)' }}>{fmt.money(context.total)}</strong>
                    {' · '}T&M billed to date: <strong style={{ color: 'var(--amber)' }}>{fmt.money(context.tmInvoiced || 0)}</strong>
                    {' · '}Fixed remaining: <strong>{fmt.money(context.remaining)}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Main fields */}
            <div className="form-grid">
              <div>
                <label data-tip="The invoice number from the vendor's document — used for duplicate detection">
                  Invoice number <ConfidenceDot level={confidence.invoice_number} />
                </label>
                <input value={invoiceNumber} onChange={e => { setInvoiceNumber(e.target.value); setConfidence(c => ({ ...c, invoice_number: undefined })); setConfirmed(false); }} placeholder="e.g. INV-001" autoFocus={!hasPdf} style={aiFieldStyle('invoice_number')} />
              </div>
              <div>
                <label data-tip="Total dollar amount billed on this invoice">
                  Amount <ConfidenceDot level={confidence.amount} />
                </label>
                <input type="number" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setConfidence(c => ({ ...c, amount: undefined })); setConfirmed(false); }} placeholder="0.00" style={aiFieldStyle('amount')} />
              </div>
              <div>
                <label data-tip="Date printed on the vendor's invoice — may differ from today's date">
                  Invoice date <ConfidenceDot level={confidence.invoice_date} />
                </label>
                <input type="date" value={date} onChange={e => { setDate(e.target.value); setConfidence(c => ({ ...c, invoice_date: undefined })); setConfirmed(false); }} style={aiFieldStyle('invoice_date')} />
              </div>
              <div>
                <label data-tip="Vendor or subcontractor submitting this invoice">
                  Vendor <ConfidenceDot level={confidence.vendor_name} />
                </label>
                <SmartSearch value={vendor} onChange={v => { setVendor(v); setConfidence(c => ({ ...c, vendor_name: undefined })); setConfirmed(false); }} fetcher={q => api.searchVendors(q)} placeholder="Vendor name" style={aiFieldStyle('vendor_name')} />
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
            {dupWarning && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 6, background: 'rgba(245,158,11,0.08)', border: '1.5px solid rgba(245,158,11,0.4)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#b45309', marginBottom: 6 }}>
                  ⚠ Possible duplicate — {dupWarning.message}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
                  {dupWarning.duplicates.map(d => (
                    <div key={d.id} style={{ fontSize: 12, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>
                      #{d.invoice_number} · {fmt.money(d.amount)} · {d.status}{d.invoice_date ? ' · ' + fmt.date(d.invoice_date) : ''}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setDupWarning(null)}>Go back</button>
                  <button className="primary" style={{ fontSize: 12, padding: '4px 12px', background: '#b45309', borderColor: '#b45309' }}
                    disabled={saving} onClick={() => save(true)}>
                    {saving ? 'Saving…' : 'Save anyway'}
                  </button>
                </div>
              </div>
            )}
            {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
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
          <button className="primary" disabled={saving || (!!fileRef && !confirmed) || !!dupWarning} onClick={() => save(false)}>
            {saving ? 'Creating…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}
