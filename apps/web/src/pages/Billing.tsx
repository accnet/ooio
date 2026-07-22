import { useEffect, useState } from 'react';
import { changeSubscription, getPlans, getUsage, organizationIdFromToken, Plan, Subscription, Usage } from '../api';

export default function Billing() {
  const organizationId = organizationIdFromToken();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const loadedPlans = await getPlans();
      setPlans(loadedPlans);
      if (organizationId) setUsage(await getUsage(organizationId));
      else setError('Your session does not include an organization. Please sign in again.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load billing data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [organizationId]);

  async function selectPlan(planId: string) {
    if (!organizationId) return;
    setChanging(planId);
    setError('');
    try {
      setSubscription(await changeSubscription(organizationId, planId));
      setUsage(await getUsage(organizationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change plan.');
    } finally {
      setChanging('');
    }
  }

  return (
    <div className="content-column">
      <div className="section-heading"><div><p className="eyebrow">Capacity and plans</p><h1>Billing</h1><p className="muted">Keep store capacity aligned with the way your team operates.</p></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh</button></div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {loading ? <div className="panel state-message">Loading plans and usage...</div> : usage ? <section className="usage-strip" aria-label="Current usage"><div><span className="eyebrow">Current plan</span><strong>{usage.plan}</strong></div><div><span className="eyebrow">Stores in use</span><strong>{usage.stores.used} <small>/ {usage.stores.limit}</small></strong></div><div className="usage-meter" aria-label={`${usage.stores.used} of ${usage.stores.limit} stores used`}><span style={{ width: `${Math.min(100, usage.stores.limit ? (usage.stores.used / usage.stores.limit) * 100 : 0)}%` }} /></div></section> : null}
      {!loading && !plans.length && !error ? <p className="state-message">No active plans are available.</p> : <div className="plan-grid">{plans.map((plan) => <article className={`plan-card ${usage?.plan === plan.slug ? 'plan-current' : ''}`} key={plan.id}><div className="plan-card-top"><div><p className="eyebrow">{plan.slug}</p><h2>{plan.name}</h2></div>{usage?.plan === plan.slug && <span className="status-pill status-active">Current</span>}</div><p className="plan-price">{plan.priceCents === 0 ? 'Free' : `$${(plan.priceCents / 100).toFixed(0)} / month`}</p><p className="muted">Up to {plan.limits?.maxStores ?? 'unlimited'} stores</p><button className="button button-secondary button-wide" type="button" onClick={() => void selectPlan(plan.id)} disabled={changing !== '' || usage?.plan === plan.slug}>{changing === plan.id ? 'Updating...' : usage?.plan === plan.slug ? 'Selected' : 'Choose plan'}</button></article>)}</div>}
      {subscription && <p className="success-note" role="status">Plan updated to {subscription.plan.name}.</p>}
    </div>
  );
}
