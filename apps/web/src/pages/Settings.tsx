import { FormEvent, useEffect, useState } from 'react';
import {
  ApiError,
  ApiKey,
  createApiKey,
  getApiKeys,
  getOrganizations,
  organizationIdFromToken,
  Organization,
  revokeApiKey,
} from '../api';

function formatDate(value?: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

function accessDeniedMessage(): string {
  return 'API key management is restricted to organization owners and admins.';
}

function isForbidden(reason: unknown): boolean {
  return reason instanceof ApiError && reason.status === 403;
}

function KeyRow({
  apiKey,
  confirming,
  revoking,
  onConfirm,
  onCancel,
  onStart,
}: {
  apiKey: ApiKey;
  confirming: boolean;
  revoking: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onStart: () => void;
}) {
  return (
    <li className="api-key-row">
      <div className="api-key-main">
        <strong>{apiKey.name}</strong>
        <span className="table-id">{apiKey.id}</span>
      </div>
      <div className="api-key-meta"><span><b>Last used</b>{formatDate(apiKey.lastUsedAt)}</span><span><b>Expires</b>{formatDate(apiKey.expiresAt)}</span><span><b>Created</b>{formatDate(apiKey.createdAt)}</span></div>
      {!confirming ? <button className="button button-secondary api-key-revoke" type="button" onClick={onStart} disabled={revoking}>Revoke</button> : <div className="api-key-confirm" role="group" aria-label={`Confirm revoking ${apiKey.name}`}><span>Revoking stops integrations using this key immediately.</span><button className="button button-secondary" type="button" onClick={onCancel} disabled={revoking}>Cancel</button><button className="button button-danger" type="button" onClick={onConfirm} disabled={revoking}>{revoking ? 'Revoking...' : 'Revoke key'}</button></div>}
    </li>
  );
}

export default function Settings() {
  const organizationId = organizationIdFromToken();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyError, setKeyError] = useState('');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmingKeyId, setConfirmingKeyId] = useState('');
  const [revokingKeyId, setRevokingKeyId] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    setKeyError('');
    if (!organizationId) {
      setError('Your session does not include an organization. Please sign in again.');
      setLoading(false);
      return;
    }

    const [organizationsResult, keysResult] = await Promise.allSettled([
      getOrganizations(),
      getApiKeys(organizationId),
    ]);
    if (organizationsResult.status === 'fulfilled') {
      setOrganization(organizationsResult.value.find((item) => item.id === organizationId) || null);
    } else {
      setError(organizationsResult.reason instanceof Error ? organizationsResult.reason.message : 'Unable to load organization details.');
    }
    if (keysResult.status === 'fulfilled') {
      setApiKeys(keysResult.value);
    } else if (isForbidden(keysResult.reason)) {
      setApiKeys([]);
      setKeyError(accessDeniedMessage());
    } else {
      setKeyError(keysResult.reason instanceof Error ? keysResult.reason.message : 'Unable to load API keys.');
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    return () => setGeneratedKey('');
  }, [organizationId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !name.trim()) return;
    setCreating(true);
    setKeyError('');
    setGeneratedKey('');
    setCopied(false);
    try {
      const created = await createApiKey(organizationId, name.trim());
      setApiKeys((current) => [{ id: created.id, name: created.name, createdAt: created.createdAt }, ...current]);
      setName('');
      setGeneratedKey(created.key);
    } catch (reason) {
      setKeyError(isForbidden(reason) ? accessDeniedMessage() : reason instanceof Error ? reason.message : 'Unable to create API key.');
    } finally {
      setCreating(false);
    }
  }

  async function copyGeneratedKey() {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
    } catch {
      setKeyError('Unable to copy the key. Select it and copy it manually.');
    }
  }

  async function confirmRevoke(keyId: string) {
    if (!organizationId) return;
    setRevokingKeyId(keyId);
    setKeyError('');
    try {
      await revokeApiKey(organizationId, keyId);
      setApiKeys((current) => current.filter((apiKey) => apiKey.id !== keyId));
      setConfirmingKeyId('');
    } catch (reason) {
      setKeyError(isForbidden(reason) ? accessDeniedMessage() : reason instanceof Error ? reason.message : 'Unable to revoke API key.');
    } finally {
      setRevokingKeyId('');
    }
  }

  return (
    <div className="content-column">
      <div className="section-heading"><div><p className="eyebrow">Workspace access</p><h1>Settings</h1><p className="muted">Manage the organization identity and API keys used by your integrations.</p></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh</button></div>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {loading ? <p className="panel state-message">Loading organization settings...</p> : <>
        <section className="panel organization-summary" aria-labelledby="organization-title">
          <div><p className="eyebrow">Organization</p><h2 id="organization-title">{organization?.name || 'Organization unavailable'}</h2><p className="muted">{organization?.slug ? `/${organization.slug}` : 'No organization details were returned.'}</p></div>
          {organization?.role && <span className="status-pill status-active">{organization.role}</span>}
        </section>
        <section className="panel" aria-labelledby="api-keys-title">
          <div className="panel-heading"><div><p className="eyebrow">Credentials</p><h2 id="api-keys-title">API keys</h2></div><span className="count-badge" aria-label={`${apiKeys.length} API keys`}>{apiKeys.length}</span></div>
          <p className="muted">Keys grant access to your organization. Treat them like passwords and revoke any key you no longer recognize.</p>
          {keyError && <p className="alert alert-error" role="alert">{keyError}</p>}
          {generatedKey && <div className="one-time-key" role="status"><div><p className="eyebrow">New key: copy it now</p><p className="one-time-warning">This value is shown once and cannot be recovered after you leave this page.</p></div><code>{generatedKey}</code><div className="one-time-actions"><button className="button button-primary" type="button" onClick={() => void copyGeneratedKey()}>{copied ? 'Copied' : 'Copy key'}</button><button className="button button-secondary" type="button" onClick={() => { setGeneratedKey(''); setCopied(false); }}>Dismiss</button></div></div>}
          <form className="api-key-create" onSubmit={submit}><label htmlFor="api-key-name">New key name</label><div><input id="api-key-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Deployment pipeline" required disabled={creating || Boolean(keyError && keyError === accessDeniedMessage())} /><button className="button button-primary" type="submit" disabled={creating || !name.trim() || !organization}>{creating ? 'Creating...' : 'Create API key'}</button></div></form>
          {!keyError && !apiKeys.length ? <p className="state-message">No API keys have been created for this organization.</p> : !keyError && <ul className="api-key-list">{apiKeys.map((apiKey) => <KeyRow key={apiKey.id} apiKey={apiKey} confirming={confirmingKeyId === apiKey.id} revoking={revokingKeyId === apiKey.id} onStart={() => setConfirmingKeyId(apiKey.id)} onCancel={() => setConfirmingKeyId('')} onConfirm={() => void confirmRevoke(apiKey.id)} />)}</ul>}
        </section>
      </>}
    </div>
  );
}
