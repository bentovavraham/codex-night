// Admin settings page: pasted-text import for vendors and customers, plus
// live counts. Reachable only when the logged-in user has role=admin.

window.Admin = function Admin({ onClose }) {
  const [status, setStatus] = React.useState(null);
  const [vendorText, setVendorText] = React.useState('');
  const [customerText, setCustomerText] = React.useState('');
  const [busy, setBusy] = React.useState(null); // 'vendors' | 'customers' | null
  const [msg, setMsg] = React.useState(null);
  const [err, setErr] = React.useState(null);

  async function loadStatus() {
    try { setStatus(await api.adminStatus()); }
    catch (e) { setErr(e.message); }
  }
  React.useEffect(() => { loadStatus(); }, []);

  // Parse helpers. Customers come tab-separated with a category in column 2;
  // vendors are one-per-line. Both skip blanks and the header row.
  function parseCustomers(text) {
    return text.split('\n')
      .map((l) => l.split('\t')[0].trim())
      .filter((l) => l && l.toLowerCase() !== 'customers');
  }
  function parseVendors(text) {
    return text.split('\n')
      .map((l) => l.trim())
      .filter((l) => l && l.toLowerCase() !== 'vendors');
  }

  async function importChunked(kind, names, replace) {
    const CHUNK = 50;
    let total = 0;
    for (let i = 0; i < names.length; i += CHUNK) {
      const slice = names.slice(i, i + CHUNK).map((name) => ({ name }));
      const payload = { replace: replace && i === 0 };
      payload[kind] = slice;
      const r = await api.adminImport(kind, payload);
      total = r.total ?? total;
    }
    return total;
  }

  async function doImport(kind, parse, text) {
    setErr(null); setMsg(null); setBusy(kind);
    try {
      const names = parse(text);
      if (names.length === 0) throw new Error('No names detected in the pasted text.');
      const total = await importChunked(kind, names, true);
      setMsg(`Imported ${names.length} ${kind} (table now has ${total}).`);
      if (kind === 'vendors') setVendorText('');
      if (kind === 'customers') setCustomerText('');
      await loadStatus();
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
        <a onClick={onClose}>← Back</a>
        <h1 style={{ margin: 0, fontSize: 20 }}>Admin</h1>
      </div>

      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      {msg && <div style={{ color: 'var(--ok)', marginBottom: 10 }}>{msg}</div>}

      <div className="panel">
        <h2>Database contents</h2>
        {status ? (
          <table className="data">
            <tbody>
              <tr><td>QB codes</td><td className="num"><strong>{status.qb_codes}</strong></td></tr>
              <tr><td>Users</td><td className="num">{status.users}</td></tr>
              <tr><td>Projects</td><td className="num">{status.projects}</td></tr>
              <tr><td>Budget lines</td><td className="num">{status.budget_lines}</td></tr>
              <tr><td>Contracts</td><td className="num">{status.contracts}</td></tr>
              <tr><td>Invoices</td><td className="num">{status.invoices}</td></tr>
              <tr><td>Vendors</td><td className="num"><strong>{status.vendors}</strong></td></tr>
              <tr><td>Customers</td><td className="num"><strong>{status.customers}</strong></td></tr>
            </tbody>
          </table>
        ) : <div className="hint">Loading…</div>}
      </div>

      <div className="panel">
        <h2>Import vendors</h2>
        <p className="hint">
          Paste the QuickBooks vendor list — one name per line. The Import button wipes the
          existing vendors table and replaces it with what's pasted.
        </p>
        <textarea rows={10} value={vendorText} onChange={(e)=>setVendorText(e.target.value)}
                  placeholder="Paste vendor list — one per line" />
        <div style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy === 'vendors' || !vendorText.trim()}
                  onClick={() => doImport('vendors', parseVendors, vendorText)}>
            {busy === 'vendors' ? 'Importing…' : 'Replace vendors'}
          </button>
          <span className="hint" style={{ marginLeft: 10 }}>
            {vendorText ? `${parseVendors(vendorText).length} name(s) detected` : ''}
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>Import customers / projects</h2>
        <p className="hint">
          Paste the QuickBooks customer list. Accepts lines in the form
          <code>Name&lt;TAB&gt;Category</code> (the category is ignored for now). Colon-nested
          names like <code>AA Residential:Dasgupta Colts Neck 250017</code> are kept verbatim.
          Replaces the existing customers table.
        </p>
        <textarea rows={10} value={customerText} onChange={(e)=>setCustomerText(e.target.value)}
                  placeholder="Paste customer list — name[TAB]category per line" />
        <div style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy === 'customers' || !customerText.trim()}
                  onClick={() => doImport('customers', parseCustomers, customerText)}>
            {busy === 'customers' ? 'Importing…' : 'Replace customers'}
          </button>
          <span className="hint" style={{ marginLeft: 10 }}>
            {customerText ? `${parseCustomers(customerText).length} name(s) detected` : ''}
          </span>
        </div>
      </div>
    </div>
  );
};
