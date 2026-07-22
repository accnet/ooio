import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clearTokens, isOperator, login, saveTokens } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from || '/pools';
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
      // A customer account can authenticate here — /auth/login is shared. Reject
      // it at the door so the operator console never renders in a half-usable
      // state where every request comes back 403. The API is still the authority:
      // PlatformRoleGuard blocks operator routes regardless of what the UI shows.
      if (!isOperator()) {
        clearTokens();
        setError('This account does not have the platform operator role.');
        return;
      }
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
        <div className="brand brand-inverted">
          <span className="brand-mark">O</span>
          <span>ooio <small>OPS</small></span>
        </div>
        <p className="eyebrow">Platform operations</p>
        <h1>Pools, distributions, and the work the fleet is doing.</h1>
        <p className="login-copy">
          Operator access only. Customer accounts sign in at the customer portal.
        </p>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div>
          <p className="eyebrow">Operator sign in</p>
          <h2 id="login-title">Sign in</h2>
          <p className="muted">Requires an account with the platform operator role.</p>
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
