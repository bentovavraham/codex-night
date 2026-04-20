window.Login = function Login({ onLoggedIn }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [err, setErr] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const user = await api.login(email, password);
      onLoggedIn(user);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login">
        <div className="login-logo">
          <div className="wordmark-active">Active</div>
          <div className="wordmark-sub">— Acquisitions —</div>
        </div>
        <h2>Sign in to continue</h2>
        <form onSubmit={submit}>
          <div className="row">
            <label>Email</label>
            <input type="email" autoFocus required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <label>Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
          <button type="submit" className="primary" disabled={busy}
            style={{ width: '100%', marginTop: 20, padding: '10px 0', fontSize: 14 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};
