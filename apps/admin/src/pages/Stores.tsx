import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getStores, AdminStore } from '../api';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <div className="pager" aria-label="Store pages"><button className="button button-secondary" type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>Previous</button><span>Page {page} of {totalPages}</span><button className="button button-secondary" type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>Next</button></div>;
}

export default function Stores() {
  const [params, setParams] = useSearchParams();
  const organizationId = params.get('organizationId') || '';
  const status = params.get('status') || '';
  const page = Number(params.get('page') || '1');
  const [stores, setStores] = useState<AdminStore[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getStores({ organizationId, status }, page).then((result) => {
      if (!active) return;
      setStores(result.stores);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load stores.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [organizationId, page, status]);

  function changeFilter(nextStatus: string) {
    const next = new URLSearchParams(params);
    if (nextStatus) next.set('status', nextStatus); else next.delete('status');
    next.delete('page');
    setParams(next);
  }

  function changePage(nextPage: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(nextPage));
    setParams(next);
  }

  return (
    <div className="content-column">
      <div className="section-heading"><div><p className="eyebrow">Business records</p><h1>Stores</h1><p className="muted">Inspect store status across customer organizations.</p></div><span className="count-badge" aria-label={`${total} stores`}>{total}</span></div>
      <section className="panel" aria-labelledby="store-list-title">
        <div className="toolbar"><div><p className="eyebrow">Filters</p><h2 id="store-list-title">Store inventory</h2></div><label className="filter-field" htmlFor="store-status">Status<select id="store-status" value={status} onChange={(event) => changeFilter(event.target.value)}><option value="">All statuses</option><option value="active">Active</option><option value="provisioning">Provisioning</option><option value="failed">Failed</option></select></label></div>
        {organizationId && <p className="filter-note">Filtered to organization <code>{organizationId}</code>. <Link to="/stores">Clear organization filter</Link></p>}
        {loading ? <p className="state-message">Loading stores...</p> : error ? <p className="alert alert-error" role="alert">{error}</p> : stores.length === 0 ? <p className="state-message">No stores match the selected filters.</p> : (
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Store</th><th>Organization</th><th>Status</th><th>Tier</th><th>Domains</th><th>Created</th><th><span className="sr-only">Store id</span></th></tr></thead><tbody>{stores.map((store) => <tr key={store.id}>
            <td><strong>{store.externalId || 'Unnamed store'}</strong><span className="table-subtext">{store.id}</span></td>
            <td><Link className="table-link" to={`/organizations/${encodeURIComponent(store.organizationId)}`}><strong>{store.organization.name}</strong><span>{store.organization.slug}</span></Link></td>
            <td><span className={`status-pill status-${store.status}`}>{store.status}</span></td>
            <td>{store.tier || 'Not set'}</td>
            <td>{store.domains.length ? store.domains.map((domain) => <span className="domain-line" key={domain.hostname}>{domain.hostname} <small>{domain.tlsStatus}</small></span>) : <span className="muted">None</span>}</td>
            <td className="muted">{formatDate(store.createdAt)}</td>
            <td><span className="table-id" title={store.id}>{store.id.slice(0, 8)}</span></td>
          </tr>)}</tbody></table></div>
        )}
        <Pager page={page} totalPages={totalPages} onChange={changePage} />
      </section>
    </div>
  );
}
