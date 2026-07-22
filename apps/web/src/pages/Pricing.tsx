import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPlans, Plan } from '../api';

function formatPrice(priceCents: number): string {
  if (priceCents === 0) return 'Free';
  return `$${(priceCents / 100).toFixed(0)} / month`;
}

export default function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    getPlans()
      .then((loadedPlans) => {
        if (active) setPlans(loadedPlans);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load pricing.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="public-page">
      <header className="public-header">
        <Link className="brand" to="/" aria-label="WooCloud home">
          <span className="brand-mark">W</span>
          <span>WooCloud <small>CONTROL PLANE</small></span>
        </Link>
        <nav className="public-nav" aria-label="Public navigation">
          <Link to="/">Overview</Link>
          <Link to="/login">Sign in</Link>
          <Link className="button button-primary" to="/register">Get started</Link>
        </nav>
      </header>
      <section className="pricing-intro" aria-labelledby="pricing-title">
        <p className="eyebrow">Simple capacity planning</p>
        <h1 id="pricing-title">Choose the room your stores need.</h1>
        <p className="landing-lede">Plans are loaded from the control plane, so the details here stay in step with what is available.</p>
      </section>
      {loading && <div className="panel state-message" role="status">Loading plans...</div>}
      {error && <div className="panel alert alert-error" role="alert">{error}</div>}
      {!loading && !error && plans.length === 0 && <div className="panel state-message">No plans are available right now.</div>}
      {!loading && !error && plans.length > 0 && (
        <section className="plan-grid public-plan-grid" aria-label="Available plans">
          {plans.map((plan) => (
            <article className="plan-card" key={plan.id}>
              <div className="plan-card-top">
                <div>
                  <p className="eyebrow">{plan.slug}</p>
                  <h2>{plan.name}</h2>
                </div>
              </div>
              <p className="plan-price">{formatPrice(plan.priceCents)}</p>
              <p className="muted">
                {plan.limits?.maxStores === undefined ? 'No store limit' : `Up to ${plan.limits.maxStores} stores`}
              </p>
              <Link className="button button-secondary button-wide" to="/register">Get started</Link>
            </article>
          ))}
        </section>
      )}
      <footer className="public-footer">
        <span>WooCloud Control Plane</span>
        <Link to="/">Back to overview</Link>
      </footer>
    </main>
  );
}
