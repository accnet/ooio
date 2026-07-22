import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { register, saveTokens } from '../api';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ organizationName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // Registering issues tokens directly, so there is no second sign-in step.
      saveTokens(await register({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim() || undefined,
        organizationName: form.organizationName.trim() || undefined,
      }));
      // Land on the wizard, not the empty store list: a new account has nothing
      // to look at, and creating the first store is the whole point of signing up.
      navigate('/stores/new', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-intro">
        <div className="brand brand-inverted">
          <span className="brand-mark">W</span>
          <span>WooCloud <small>CONTROL PLANE</small></span>
        </div>
        <p className="eyebrow">Get started</p>
        <h1>Your first store, running in minutes.</h1>
        <p className="login-copy">
          Create an account and we provision a WooCommerce store for you — no servers to set up.
        </p>
      </section>
      <section className="login-panel" aria-labelledby="register-title">
        <div>
          <p className="eyebrow">Create account</p>
          <h2 id="register-title">Sign up</h2>
          <p className="muted">Already have one? <Link to="/login">Sign in</Link></p>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="organizationName">Company or team name</label>
          <input
            id="organizationName"
            autoComplete="organization"
            value={form.organizationName}
            onChange={(event) => update('organizationName', event.target.value)}
            required
          />
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            autoComplete="name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
          />
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={form.password}
            onChange={(event) => update('password', event.target.value)}
            required
          />
          <p className="muted">At least 8 characters.</p>
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          <button className="button button-primary button-wide" type="submit" disabled={submitting}>
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      </section>
    </main>
  );
}
