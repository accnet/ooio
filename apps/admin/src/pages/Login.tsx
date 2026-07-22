import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { login, SupportRoleError } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from || '/organizations';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(destination, { replace: true });
    } catch (reason) {
      setError(reason instanceof SupportRoleError
        ? reason.message
        : reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-intro">
        <div className="brand brand-inverted"><span className="brand-mark">S</span><span>ooio <small>SUPPORT</small></span></div>
        <p className="eyebrow">Business console</p>
        <h1>Help every seller move forward.</h1>
        <p className="login-copy">Review organizations, subscriptions, and store health from one customer-facing support surface.</p>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <p className="eyebrow">Support access</p>
        <h2 id="login-title">Sign in</h2>
        <p className="muted">Use a support account to continue. Infrastructure operations live in the separate ops console.</p>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <button className="button button-primary button-wide" type="submit" disabled={submitting}>
            {submitting ? 'Checking access...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
