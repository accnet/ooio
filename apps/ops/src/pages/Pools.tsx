import { useCallback, useEffect, useState } from 'react';
import { getPools, Pool, setPoolStatus } from '../api';

// Mirrors the lifecycle in ADR-006 section 8.
const STATUSES = ['provisioning', 'healthy', 'draining', 'maintenance', 'retiring', 'deleted'];

export default function Pools() {
  const [pools, setPools] = useState<Pool[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPools(await getPools());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load pools.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(pool: Pool, status: string) {
    if (status === pool.status) return;
    // Draining blocks every new store allocation on this pool, platform-wide.
    // Worth a confirmation even for an operator.
    if (status === 'draining' || status === 'retiring' || status === 'deleted') {
      const ok = window.confirm(
        `Set pool "${pool.name}" to ${status}? This stops new store allocations on it.`,
      );
      if (!ok) return;
    }
    setBusy(pool.id);
    try {
      await setPoolStatus(pool.id, status);
      await load();
      setError('');
    } catch (reason) {
      // The API rejects invalid transitions (for example retiring while used > 0).
      // Surface its message rather than guessing at the rule here.
      setError(reason instanceof Error ? reason.message : 'Unable to change pool status.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h1>Database pools</h1>
      <p className="muted">Placement authority is the Database Allocation Service. This view changes pool state only.</p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th><th>Cluster</th><th>Status</th><th>Used / capacity</th><th>Change status</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => (
            <tr key={pool.id}>
              <td>{pool.name}</td>
              <td className="muted">{pool.clusterId}</td>
              <td>{pool.status}</td>
              <td>{pool.used} / {pool.capacity || '∞'}</td>
              <td>
                <select
                  value={pool.status}
                  disabled={busy === pool.id}
                  onChange={(event) => void change(pool, event.target.value)}
                >
                  {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </td>
            </tr>
          ))}
          {pools.length === 0 && !error && (
            <tr><td colSpan={5} className="muted">No pools registered.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
