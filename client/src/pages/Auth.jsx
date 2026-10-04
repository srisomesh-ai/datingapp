import { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { APP_NAME, api } from '../lib/api.js';

export default function Auth() {
  const { setUser, toast } = useApp();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '', gender: 'female', dob: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form;
      const { user } = await api(`/auth/${mode}`, { method: 'POST', body });
      setUser(user);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="logo">🧩💗</div>
        <h1>{APP_NAME}</h1>
        <p>No swiping. Play a little puzzle about someone's hobbies to reveal their photo — then say hi.</p>
      </div>
      <form className="card stack" onSubmit={submit}>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Sign up</button>
        </div>
        {mode === 'register' && (
          <>
            <label>Name<input value={form.name} onChange={set('name')} required maxLength={40} /></label>
            <label>
              I am
              <select value={form.gender} onChange={set('gender')}>
                <option value="female">Woman</option>
                <option value="male">Man</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Date of birth<input type="date" value={form.dob} onChange={set('dob')} required /></label>
            <label>Phone (optional)<input type="tel" value={form.phone} onChange={set('phone')} maxLength={20} /></label>
          </>
        )}
        <label>Email<input type="email" value={form.email} onChange={set('email')} required autoComplete="email" /></label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        {mode === 'register' && <p className="fine">You must be 18+. By signing up you agree to be kind and respectful.</p>}
      </form>
    </div>
  );
}
