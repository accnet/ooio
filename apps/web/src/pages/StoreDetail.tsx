import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createStoreOperation,
  getStore,
  getStoreOperations,
  getSubscription,
  organizationIdFromToken,
  Operation,
  Store,
  StoreActionType,
  StoreOperationsResponse,
  Subscription,
} from '../api';
import { StatusPill } from '../components/StatusPill';
import { useOperationPolling } from '../hooks/useOperationPolling';

const TERMINAL_OPERATION_STATES = ['succeeded', 'failed', 'cancelled'];

function formatDate(value?: string): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

function StoreSummary({ store, subscription }: { store: Store; subscription: Subscription | null }) {
  const primaryDomain = store.domains?.[0];
  const storeName = store.title || primaryDomain?.hostname || store.externalId || store.id;

  return (
    <>
      <div className="detail-hero">
        <div>
          <p className="eyebrow">Store environment</p>
          <h1>{storeName}</h1>
          <p className="detail-address">{store.path || primaryDomain?.hostname || 'Address pending configuration'}</p>
        </div>
        <StatusPill status={store.status} />
      </div>

      <div className="detail-facts">
        <div><span className="eyebrow">Created</span><strong>{formatDate(store.createdAt)}</strong></div>
        <div><span className="eyebrow">Plan</span><strong>{subscription?.plan.name || 'No active plan'}</strong></div>
        <div><span className="eyebrow">Tier</span><strong>{store.tier || 'Standard'}</strong></div>
      </div>

      <section className="panel" aria-labelledby="domains-title">
        <div className="panel-heading"><div><p className="eyebrow">Connectivity</p><h2 id="domains-title">Domains and SSL</h2></div><span className="panel-index">{store.domains?.length || 0}</span></div>
        {!store.domains?.length ? <p className="state-message">No domains have been configured yet.</p> : <div className="domain-list">{store.domains.map((domain) => <div className="domain-row" key={domain.hostname}><div><strong>{domain.hostname}</strong><p className="muted">{domain.verified ? 'Verified' : 'Verification pending'}</p></div><span className={`tls-status tls-${domain.tlsStatus}`}>{domain.tlsStatus.replaceAll('_', ' ')}</span></div>)}</div>}
      </section>
    </>
  );
}

function OperationHistory({ value, error }: { value: StoreOperationsResponse | null; error: string }) {
  if (error) return <p className="alert alert-error" role="alert">{error}</p>;
  if (!value) return <p className="state-message">Loading operation history...</p>;
  if (!value.operations.length) return <p className="state-message">No operations have been recorded for this store.</p>;

  return <div className="operation-table-wrap"><table className="operation-table"><thead><tr><th scope="col">Operation</th><th scope="col">Status</th><th scope="col">Progress</th><th scope="col">Updated</th><th scope="col">Details</th></tr></thead><tbody>{value.operations.map((operation) => <OperationRow key={operation.id} operation={operation} />)}</tbody></table></div>;
}

function actionLabel(type: StoreActionType): string {
  if (type === 'backup-store') return 'Backup database';
  if (type === 'issue-ssl') return 'Issue SSL certificate';
  return 'Delete store';
}

function StoreActions({
  store,
  operations,
  operationError,
  actionOperationId,
  onOperationCreated,
}: {
  store: Store;
  operations: StoreOperationsResponse | null;
  operationError: string;
  actionOperationId: string;
  onOperationCreated: (operationId: string) => void;
}) {
  const [submitting, setSubmitting] = useState<StoreActionType | ''>('');
  const [actionError, setActionError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const primaryDomain = store.domains?.[0];
  const activeOperation = operations?.operations.find(
    (operation) => !TERMINAL_OPERATION_STATES.includes(operation.status),
  );
  const confirmationTargets = [store.title, store.path].filter(
    (value): value is string => Boolean(value),
  );
  const deleteConfirmed = confirmationTargets.includes(deleteConfirmation);
  const actionOperation = operations?.operations.find((operation) => operation.id === actionOperationId);
  const actionPending = Boolean(actionOperationId) && (!actionOperation || !TERMINAL_OPERATION_STATES.includes(actionOperation.status));
  const actionsDisabled = !operations || Boolean(activeOperation) || actionPending || submitting !== '';

  async function submit(type: StoreActionType, payload?: Record<string, unknown>) {
    setSubmitting(type);
    setActionError('');
    try {
      const operation = await createStoreOperation(store.id, type, payload);
      onOperationCreated(operation.id);
      if (type === 'delete-store') {
        setDeleteOpen(false);
        setDeleteConfirmation('');
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : `Unable to start ${actionLabel(type).toLowerCase()}.`);
    } finally {
      setSubmitting('');
    }
  }

  return (
    <>
      <section className="panel action-panel" aria-labelledby="store-actions-title">
        <div className="panel-heading"><div><p className="eyebrow">Store operations</p><h2 id="store-actions-title">Maintain this store</h2></div></div>
        <p className="muted">These actions are sent to the runtime agent and tracked in the operation history below.</p>
        {activeOperation && <p className="alert alert-warning" role="status">{activeOperation.type.replaceAll('-', ' ')} is still running. Store actions are temporarily disabled.</p>}
        {operationError && <p className="alert alert-error" role="alert">Unable to check action status: {operationError}</p>}
        {actionError && <p className="alert alert-error" role="alert">{actionError}</p>}
        <div className="action-grid">
          <button className="button button-secondary" type="button" onClick={() => void submit('backup-store', { kind: 'database' })} disabled={actionsDisabled}>{submitting === 'backup-store' ? 'Starting backup...' : 'Backup database'}</button>
          <button className="button button-secondary" type="button" onClick={() => void submit('issue-ssl', { domain: primaryDomain?.hostname })} disabled={actionsDisabled || !primaryDomain?.hostname}>{submitting === 'issue-ssl' ? 'Starting SSL...' : 'Issue SSL certificate'}</button>
        </div>
        {!primaryDomain?.hostname && <p className="muted">SSL issuance is unavailable until this store has a domain.</p>}
        {actionOperation && <ActionOperationStatus operation={actionOperation} />}
      </section>

      <section className="panel danger-panel" aria-labelledby="delete-store-title">
        <div className="panel-heading"><div><p className="eyebrow">Destructive action</p><h2 id="delete-store-title">Delete this store</h2></div></div>
        <p className="danger-copy">Deleting this store is permanent and also deletes its database. This cannot be undone.</p>
        {!deleteOpen ? <button className="button button-danger" type="button" onClick={() => setDeleteOpen(true)} disabled={actionsDisabled}>Prepare store deletion</button> : <div className="delete-confirmation">
          <label htmlFor="delete-confirmation">Type the store name or path exactly to confirm</label>
          <input id="delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={confirmationTargets[0] || 'Store name or path'} autoComplete="off" />
          {!confirmationTargets.length && <p className="alert alert-error" role="alert">This store has no name or path available for confirmation.</p>}
          <div className="delete-actions">
            <button className="button button-secondary" type="button" onClick={() => { setDeleteOpen(false); setDeleteConfirmation(''); }}>Cancel</button>
            <button className="button button-danger" type="button" onClick={() => void submit('delete-store', { siteId: store.id })} disabled={actionsDisabled || !deleteConfirmed}>{submitting === 'delete-store' ? 'Starting deletion...' : 'Delete store permanently'}</button>
          </div>
        </div>}
      </section>
    </>
  );
}

function ActionOperationStatus({ operation }: { operation: Operation }) {
  const failed = operation.status === 'failed';
  const finished = TERMINAL_OPERATION_STATES.includes(operation.status);
  return <div className={`action-operation-status ${failed ? 'action-operation-failed' : ''}`} role={failed ? 'alert' : 'status'}>
    <StatusPill status={operation.status} />
    <span>{failed ? operation.error || 'The operation failed.' : finished ? `${operation.type.replaceAll('-', ' ')} completed.` : `${operation.type.replaceAll('-', ' ')} is in progress (${operation.progress ?? 0}%).`}</span>
  </div>;
}

function OperationRow({ operation }: { operation: Operation }) {
  return <tr><td><strong>{operation.type.replaceAll('-', ' ')}</strong><span className="table-id">{operation.id}</span></td><td><StatusPill status={operation.status} /></td><td><span>{operation.progress ?? 0}%</span><div className="progress-track" aria-label={`${operation.progress ?? 0}% complete`}><span style={{ width: `${Math.max(0, Math.min(100, operation.progress ?? 0))}%` }} /></div></td><td>{formatDate(operation.updatedAt || operation.createdAt)}</td><td>{operation.error ? <span className="operation-error">{operation.error}</span> : <span className="muted">—</span>}</td></tr>;
}

export default function StoreDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const organizationId = organizationIdFromToken();
  const [store, setStore] = useState<Store | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [actionOperationId, setActionOperationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { value: operations, error: operationError } = useOperationPolling(
    () => getStoreOperations(id),
    (next) => next.operations.some((operation) => !TERMINAL_OPERATION_STATES.includes(operation.status)),
    [id, actionOperationId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([
      getStore(id),
      organizationId ? getSubscription(organizationId) : Promise.resolve(null),
    ]).then(([nextStore, nextSubscription]) => {
      if (!active) return;
      setStore(nextStore);
      setSubscription(nextSubscription);
    }).catch((reason) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : 'Unable to load this store.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id, organizationId]);

  if (loading) return <div className="content-column"><p className="state-message">Loading store...</p></div>;
  if (error || !store) {
    const message = error || 'Store not found.';
    return <div className="content-column"><section className="panel empty-detail"><p className="eyebrow">Store unavailable</p><h1>{message}</h1><p className="muted">This store may not exist or may not belong to your organization.</p><Link className="button button-primary" to="/stores">Back to stores</Link></section></div>;
  }

  return <div className="content-column"><Link className="back-link" to="/stores">Back to stores</Link><StoreSummary store={store} subscription={subscription} /><StoreActions store={store} operations={operations} operationError={operationError} actionOperationId={actionOperationId} onOperationCreated={setActionOperationId} /><section className="panel" aria-labelledby="operations-title"><div className="panel-heading"><div><p className="eyebrow">Activity</p><h2 id="operations-title">Operation history</h2></div></div><OperationHistory value={operations} error={operationError} /></section></div>;
}
