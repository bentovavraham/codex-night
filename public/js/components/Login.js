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
    <div className="login">
      <h1>ActiveAcq</h1>
      <p className="hint">Project Financial Manager — sign in to continue.</p>
      <form onSubmit={submit}>
        <div className="row">
          <label>Email</label>
          <input type="email" autoFocus required
                 value={email} onChange={(e)=>setEmail(e.target.value)} />
        </div>
        <div className="row">
          <label>Password</label>
          <input type="password" required
                 value={password} onChange={(e)=>setPassword(e.target.value)} />
        </div>
        {err && <div className="row error">{err}</div>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};
