import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getOrganization, OrganizationDetail } from '../api';

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Not available';
}

export default function OrganizationDetailPage() {
  const { id = '' } = useParams();
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getOrganization(id).then((result) => {
      if (active) setOrganization(result);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load organization.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id]);

  if (loading) return <p className="state-message">Loading organization...</p>;
  if (error || !organization) return <div className="content-column"><p className="alert alert-error" role="alert">{error || 'Organization not found.'}</p><Link className="button button-secondary button-fit" to="/organizations">Back to organizations</Link></div>;

  return (
    <div className="content-column">
      <Link className="back-link" to="/organizations">← Organizations</Link>
      <div className="section-heading">
        <div><p className="eyebrow">Organization account</p><h1>{organization.name}</h1><p className="muted">{organization.slug} · joined {formatDate(organization.createdAt)}</p></div>
        <span className={`status-pill status-${organization.status}`}>{organization.status}</span>
      </div>
      <div className="summary-grid">
        <section className="summary-card"><span>Current plan</span><strong>{organization.plan?.name || organization.plan?.slug || 'No plan'}</strong><small>{organization.subscription?.status || 'No active subscription'}</small></section>
        <section className="summary-card"><span>Stores</span><strong>{organization.storeCount}</strong><small>Across all statuses</small></section>
        <section className="summary-card"><span>Members</span><strong>{organization.memberCount}</strong><small>Organization members</small></section>
      </div>
      <div className="detail-grid">
        <section className="panel" aria-labelledby="account-context-title">
          <div className="panel-heading"><div><p className="eyebrow">Account context</p><h2 id="account-context-title">Seller details</h2></div></div>
          <dl className="detail-list"><div><dt>Owner email</dt><dd>{organization.ownerEmail || 'Not available'}</dd></div><div><dt>Plan</dt><dd>{organization.plan?.name || organization.plan?.slug || 'Not assigned'}</dd></div><div><dt>Subscription</dt><dd>{organization.subscription ? `${organization.subscription.status} · ${organization.subscription.plan.name}` : 'Not active'}</dd></div><div><dt>Current period ends</dt><dd>{formatDate(organization.subscription?.currentPeriodEnd)}</dd></div></dl>
        </section>
        <section className="panel panel-muted" aria-labelledby="store-context-title">
          <div className="panel-heading"><div><p className="eyebrow">Business records</p><h2 id="store-context-title">Store activity</h2></div></div>
          <p className="muted">Review this seller's stores and status without entering the infrastructure console.</p>
          <Link className="button button-primary button-fit" to={`/stores?organizationId=${encodeURIComponent(organization.id)}`}>View organization stores</Link>
        </section>
      </div>
    </div>
  );
}
