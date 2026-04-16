// Global toast notification system.
// Usage: window.toast('Invoice approved') or window.toast('Error', 'error')

const _toasts = [];
let _setToasts = null;

window.toast = function toast(message, type = 'success') {
  const id = Date.now() + Math.random();
  const item = { id, message, type };
  _toasts.push(item);
  if (_setToasts) _setToasts([..._toasts]);
  setTimeout(() => {
    const idx = _toasts.findIndex(t => t.id === id);
    if (idx >= 0) _toasts.splice(idx, 1);
    if (_setToasts) _setToasts([..._toasts]);
  }, 4000);
};

window.ToastContainer = function ToastContainer() {
  const [items, setItems] = React.useState([]);
  _setToasts = setItems;
  if (items.length === 0) return null;
  return (
    <div className="toast-container">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
};

// Confirm dialog — returns a Promise<boolean>.
// Usage: if (await confirm('Delete this?', 'This cannot be undone.')) { ... }
let _showConfirm = null;

window.confirmDialog = function confirmDialog(title, message) {
  return new Promise(resolve => {
    if (_showConfirm) _showConfirm({ title, message, resolve });
  });
};

window.ConfirmDialog = function ConfirmDialog() {
  const [state, setState] = React.useState(null);
  _showConfirm = setState;
  if (!state) return null;
  function respond(ok) { state.resolve(ok); setState(null); }
  return (
    <div className="modal-backdrop" onClick={() => respond(false)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header"><strong>{state.title}</strong></div>
        <div className="modal-body"><p>{state.message}</p></div>
        <div className="modal-footer">
          <button onClick={() => respond(false)}>Cancel</button>
          <button className="primary" onClick={() => respond(true)}>Confirm</button>
        </div>
      </div>
    </div>
  );
};

// Rejection note dialog — returns a Promise<string|null>.
let _showReject = null;

window.rejectDialog = function rejectDialog(invoiceNumber) {
  return new Promise(resolve => {
    if (_showReject) _showReject({ invoiceNumber, resolve });
  });
};

window.RejectDialog = function RejectDialog() {
  const [state, setState] = React.useState(null);
  const [note, setNote] = React.useState('');
  _showReject = (s) => { setNote(''); setState(s); };
  if (!state) return null;
  function submit() {
    const trimmed = note.trim();
    if (!trimmed) return;
    state.resolve(trimmed);
    setState(null);
  }
  function cancel() { state.resolve(null); setState(null); }
  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
        <div className="modal-header"><strong>Reject {state.invoiceNumber}</strong></div>
        <div className="modal-body">
          <p className="hint">Provide a reason so the submitter knows what to fix.</p>
          <textarea rows={3} autoFocus value={note} onChange={e => setNote(e.target.value)}
                    placeholder="Reason for rejection (required)" />
        </div>
        <div className="modal-footer">
          <button onClick={cancel}>Cancel</button>
          <button className="danger" disabled={!note.trim()} onClick={submit}>Reject</button>
        </div>
      </div>
    </div>
  );
};
