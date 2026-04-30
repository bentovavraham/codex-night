import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useUserStore } from '../store/userStore';

export default function LoginScreen() {
  const navigate = useNavigate();
  const setUser = useUserStore(s => s.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const user = await api.login(email, password);
      setUser(user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f2ee',
    }}>
      <div style={{
        background: '#fff', borderRadius: 8, border: '1px solid #e0d9d0',
        padding: '40px 36px', width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
      }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1714', marginBottom: 4 }}>Active Acq</div>
          <div style={{ fontSize: 13, color: '#8a7f74' }}>Sign in to continue</div>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a7f74' }}>Email</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required autoFocus
              style={{ padding: '8px 10px', border: '1px solid #d4cdc4', borderRadius: 4, fontSize: 13, outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8a7f74' }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required
              style={{ padding: '8px 10px', border: '1px solid #d4cdc4', borderRadius: 4, fontSize: 13, outline: 'none' }}
            />
          </div>
          {error && <div style={{ fontSize: 12, color: '#c0392b', background: '#fde0dc', padding: '6px 10px', borderRadius: 4 }}>{error}</div>}
          <button
            type="submit" disabled={loading}
            style={{
              marginTop: 4, padding: '10px', background: '#c4522a', color: '#fff',
              border: 'none', borderRadius: 4, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
