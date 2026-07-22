import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getOrganizations, Organization } from '../api';

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="pager" aria-label="Organization pages">
      <button className="button button-secondary" type="button" onClick={() => onChange(page - 1)} disabled={page <= 1}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button className="button button-secondary" type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages}>Next</button>
    </div>
  );
}

export default function Organizations() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getOrganizations(submittedSearch, page).then((result) => {
      if (!active) return;
      setOrganizations(result.organizations);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Unable to load organizations.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [page, submittedSearch]);

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setSubmittedSearch(search);
  }

  return (
    <div className="content-column">
      <div className="section-heading">
        <div><p className="eyebrow">Customer support</p><h1>Organizations</h1><p className="muted">Search sellers and open their account context without exposing infrastructure.</p></div>
        <span className="count-badge" aria-label={`${total} organizations`}>{total}</span>
      </div>
      <section className="panel" aria-labelledby="organization-list-title">
        <div className="toolbar">
          <form className="search-form" onSubmit={submitSearch}>
            <label htmlFor="organization-search">Search organizations</label>
            <div><input id="organization-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, slug, or owner email" /><button className="button button-secondary" type="submit">Search</button></div>
          </form>
          <p className="muted toolbar-note">{total ? `${total} customer account${total === 1 ? '' : 's'}` : 'No matching accounts'}</p>
        </div>
        <h2 className="sr-only" id="organization-list-title">Organization list</h2>
        {loading ? <p className="state-message">Loading organizations...</p> : error ? <p className="alert alert-error" role="alert">{error}</p> : organizations.length === 0 ? <p className="state-message">No organizations match this search.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Organization</th><th>Owner</th><th>Plan</th><th>Stores</th><th>Members</th><th>Status</th><th>Created</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>{organizations.map((organization) => <tr key={organization.id}>
                <td><Link className="table-link" to={`/organizations/${encodeURIComponent(organization.id)}`}><strong>{organization.name}</strong><span>{organization.slug}</span></Link></td>
                <td className="muted">{organization.ownerEmail || 'No owner email'}</td>
                <td>{organization.plan?.name || organization.plan?.slug || 'No plan'}</td>
                <td>{organization.storeCount}</td>
                <td>{organization.memberCount}</td>
                <td><span className={`status-pill status-${organization.status}`}>{organization.status}</span></td>
                <td className="muted">{formatDate(organization.createdAt)}</td>
                <td><Link className="icon-link" to={`/organizations/${encodeURIComponent(organization.id)}`} aria-label={`Open ${organization.name}`}>→</Link></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        <Pager page={page} totalPages={totalPages} onChange={setPage} />
      </section>
    </div>
  );
}
