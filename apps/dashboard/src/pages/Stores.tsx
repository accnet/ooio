import { FormEvent, useEffect, useState } from 'react';
import { ApiError, createStore, getOperation, getStores, Operation, Store } from '../api';

const initialForm = { domain: '', path: '/', title: '', adminEmail: '' };

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{status.replace('-', ' ')}</span>;
}

function OperationStatus({ operationId }: { operationId: string }) {
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await getOperation(operationId);
        if (!active) return;
        setOperation(next);
        if (!['succeeded', 'failed', 'cancelled'].includes(next.status)) timer = window.setTimeout(poll, 2500);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to read operation status.');
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [operationId]);

  return (
    <section className="operation-panel" aria-live="polite">
      <div className="section-heading compact"><div><p className="eyebrow">Provisioning operation</p><h3>{operationId}</h3></div>{operation && <StatusPill status={operation.status} />}</div>
      {error ? <p className="alert alert-error">{error}</p> : !operation ? <p className="muted">Checking the latest operation status...</p> : (
        <div className="operation-detail"><strong>{operation.type.replaceAll('-', ' ')}</strong><span>{operation.progress ?? 0}% complete</span>{operation.error && <p className="alert alert-error">{operation.error}</p>}</div>
      )}
    </section>
  );
}

export default function Stores() {
  const [stores, setStores] = useState<Store[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [operationId, setOperationId] = useState('');

  async function loadStores() {
    setLoading(true);
    setError('');
    try {
      setStores(await getStores());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load stores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadStores(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await createStore(form);
      setOperationId(result.operationId);
      setForm(initialForm);
      await loadStores();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 402) {
        setError(reason.message || 'Store quota exceeded.');
      } else {
        setError(reason instanceof Error ? reason.message : 'Unable to create store.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="content-column">
      <div className="section-heading"><div><p className="eyebrow">Workspace</p><h1>Stores</h1><p className="muted">Provisioning overview for your WooCommerce sites.</p></div><button className="button button-secondary" type="button" onClick={() => void loadStores()} disabled={loading}>Refresh</button></div>
      <div className="split-layout">
        <section className="panel" aria-labelledby="create-store-title">
          <div className="panel-heading"><div><p className="eyebrow">New environment</p><h2 id="create-store-title">Create a store</h2></div><span className="panel-index">01</span></div>
          <form className="form-stack" onSubmit={submit}>
            <label htmlFor="domain">Network domain</label><input id="domain" value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="shop.example.com" required />
            <label htmlFor="path">Site path</label><input id="path" value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} placeholder="/store-one/" required />
            <label htmlFor="title">Store title</label><input id="title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Store One" required />
            <label htmlFor="adminEmail">Admin email</label><input id="adminEmail" type="email" value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} placeholder="owner@example.com" required />
            {error && <p className="alert alert-error" role="alert">{error}</p>}
            <button className="button button-primary button-wide" type="submit" disabled={submitting}>{submitting ? 'Starting operation...' : 'Create store'}</button>
          </form>
        </section>
        <section className="panel panel-muted" aria-labelledby="store-list-title">
          <div className="panel-heading"><div><p className="eyebrow">Inventory</p><h2 id="store-list-title">Your stores</h2></div><span className="count-badge">{stores.length}</span></div>
          {loading ? <p className="state-message">Loading stores...</p> : error && !stores.length ? <p className="alert alert-error">{error}</p> : !stores.length ? <p className="state-message">No stores yet. Create the first environment to see it here.</p> : <div className="store-list">{stores.map((store) => <article className="store-row" key={store.id}><div><h3>{store.domains?.[0]?.domain || store.externalId || store.id.slice(0, 12)}</h3><p className="muted">{store.id} {store.nodeId ? `· node ${store.nodeId}` : '· awaiting node placement'}</p></div><StatusPill status={store.status} /></article>)}</div>}
        </section>
      </div>
      {operationId && <OperationStatus operationId={operationId} />}
    </div>
  );
}
