import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  changeSubscription,
  createStore,
  emailFromToken,
  getPlans,
  organizationIdFromToken,
  Plan,
} from '../api';

// The multisite network domain is a property of the runtime, not a customer
// choice: every store in a subdirectory network shares it. Custom domains are a
// separate flow (Phase 2 Domain module), so the wizard does not ask for one.
const RUNTIME_DOMAIN = (import.meta.env.VITE_RUNTIME_DOMAIN as string | undefined) || 'localhost';

// NOTE: there is deliberately no "Region" step. The plan sketches one, but the API
// exposes no endpoint listing selectable regions — placement is decided by the
// Scheduler. A dropdown here would be a control that does not control anything.

const STEPS = ['Store', 'Plan', 'Review'] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function CreateStore() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const adminEmail = useMemo(() => emailFromToken() || '', []);
  const organizationId = useMemo(() => organizationIdFromToken(), []);
  const effectiveSlug = slugEdited ? slug : slugify(title);

  useEffect(() => {
    getPlans()
      .then((list) => {
        setPlans(list);
        setPlanId((current) => current || list[0]?.id || '');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load plans.'));
  }, []);

  function next() {
    setError('');
    if (step === 0 && !effectiveSlug) {
      setError('Give the store a name first.');
      return;
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      // Change the plan BEFORE creating the store. Store creation is quota-gated,
      // so doing it the other way round can fail against the old plan's limit and
      // leave the account on a plan it did not choose.
      if (organizationId && planId) {
        const current = plans.find((plan) => plan.id === planId);
        if (current) await changeSubscription(organizationId, planId);
      }
      const created = await createStore({
        domain: RUNTIME_DOMAIN,
        path: `/${effectiveSlug}`,
        title: title.trim(),
        adminEmail,
      });
      // The store list already polls operation progress, so hand off to it rather
      // than duplicating that logic here.
      navigate(`/stores?operation=${encodeURIComponent(created.operationId)}`, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create the store.');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedPlan = plans.find((plan) => plan.id === planId);

  return (
    <section className="content-column">
      <div className="section-heading">
        <div>
          <p className="eyebrow">New store</p>
          <h1>Create a store</h1>
        </div>
      </div>

      <ol className="wizard-steps" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''}>
            <span className="wizard-index">{index + 1}</span>{label}
          </li>
        ))}
      </ol>

      <div className="panel">
        {step === 0 && (
          <div className="form-stack">
            <label htmlFor="title">Store name</label>
            <input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Acme Coffee"
              required
            />
            <label htmlFor="slug">Address</label>
            <div className="slug-row">
              <span className="muted">{RUNTIME_DOMAIN}/</span>
              <input
                id="slug"
                value={effectiveSlug}
                onChange={(event) => { setSlugEdited(true); setSlug(slugify(event.target.value)); }}
              />
            </div>
            <p className="muted">Derived from the name. You can change it before creating.</p>
          </div>
        )}

        {step === 1 && (
          <div className="form-stack">
            {plans.length === 0 && <p className="muted">Loading plans...</p>}
            {plans.map((plan) => (
              <label key={plan.id} className={`plan-option ${planId === plan.id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="plan"
                  value={plan.id}
                  checked={planId === plan.id}
                  onChange={() => setPlanId(plan.id)}
                />
                <span>
                  <strong>{plan.name}</strong>
                  <span className="muted">
                    {plan.priceCents === 0 ? 'Free' : `$${(plan.priceCents / 100).toFixed(2)}/mo`}
                    {plan.limits?.maxStores ? ` · up to ${plan.limits.maxStores} stores` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {step === 2 && (
          <dl className="review-list">
            <dt>Store name</dt><dd>{title || '—'}</dd>
            <dt>Address</dt><dd>{RUNTIME_DOMAIN}/{effectiveSlug}</dd>
            <dt>Plan</dt><dd>{selectedPlan?.name || '—'}</dd>
            <dt>Admin email</dt><dd>{adminEmail || '—'}</dd>
          </dl>
        )}

        {error && <p className="alert alert-error" role="alert">{error}</p>}

        <div className="wizard-actions">
          {step > 0 && (
            <button className="button button-secondary" type="button" onClick={() => setStep(step - 1)} disabled={submitting}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button className="button button-primary" type="button" onClick={next}>Continue</button>
          ) : (
            <button className="button button-primary" type="button" onClick={() => void submit()} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create store'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
