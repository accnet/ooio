import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { login, saveTokens } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from || '/overview';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      saveTokens(await login(email, password));
      navigate(destination, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-intro">
        <div className="brand brand-inverted"><span className="brand-mark">W</span><span>WooCloud <small>CONTROL PLANE</small></span></div>
        <p className="eyebrow">Operations console</p>
        <h1>Run every store from one quiet surface.</h1>
        <p className="login-copy">Provision sites, track node work, and keep subscription capacity visible across your WooCommerce fleet.</p>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h2 id="login-title">Sign in</h2>
          <p className="muted">
            Use your control plane account to continue. New here? <Link to="/register">Create an account</Link>
          </p>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <button className="button button-primary button-wide" type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
