import { useCallback, useEffect, useState } from 'react';
import { AnalyticsOverview, CapacityCluster, CapacityNode, getAnalyticsOverview } from '../api';

const HEARTBEAT_MAX_AGE_SECONDS = 120;
const REFRESH_INTERVAL_MS = 15_000;

function isStale(node: CapacityNode, now = Date.now()): boolean {
  if (!node.lastHeartbeatAt) return true;
  const heartbeat = Date.parse(node.lastHeartbeatAt);
  return Number.isNaN(heartbeat) || now - heartbeat > HEARTBEAT_MAX_AGE_SECONDS * 1000;
}

function percent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : 'n/a';
}

function statusClass(status: string): string {
  return `status-pill status-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function ClusterCard({ cluster }: { cluster: CapacityCluster }) {
  return (
    <article className="health-cluster">
      <header className="health-cluster-heading">
        <div>
          <p className="eyebrow">Cluster</p>
          <h2>{cluster.name}</h2>
          <p className="muted">{cluster.region}</p>
        </div>
        <span className={statusClass(cluster.status)}>{cluster.status}</span>
      </header>
      {cluster.nodes.length === 0 ? (
        <p className="state-message">No nodes registered in this cluster.</p>
      ) : (
        <div>
          {cluster.nodes.map((node) => {
            const stale = isStale(node);
            return (
              <section className={`health-node${stale ? ' is-stale' : ''}`} key={node.id}>
                <div className="health-node-heading">
                  <div>
                    <h3>{node.hostname}</h3>
                    <p className="muted">Health: {node.health || 'unknown'}</p>
                  </div>
                  <span className={statusClass(node.status)}>{node.status}</span>
                </div>
                {stale && (
                  <p className="health-node-alert" role="status">
                    {node.lastHeartbeatAt ? 'No recent heartbeat. ' : 'No heartbeat recorded. '}
                    The scheduler will not place new stores on this node.
                  </p>
                )}
                <dl className="health-metrics">
                  <div className="health-metric"><dt>CPU</dt><dd>{percent(node.capacity.cpuPercent)}</dd></div>
                  <div className="health-metric"><dt>Memory</dt><dd>{percent(node.capacity.memoryPercent)}</dd></div>
                  <div className="health-metric"><dt>Disk</dt><dd>{percent(node.capacity.diskPercent)}</dd></div>
                </dl>
                <p className="health-heartbeat">
                  Last heartbeat: {node.lastHeartbeatAt ? new Date(node.lastHeartbeatAt).toLocaleString() : 'never'}
                </p>
              </section>
            );
          })}
        </div>
      )}
    </article>
  );
}

export default function Health() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getAnalyticsOverview();
      setOverview(result);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load cluster health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (paused) return undefined;
    const interval = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [load, paused]);

  const capacity = overview?.capacity;

  return (
    <section className="content-column">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Platform health</p>
          <h1>Clusters and nodes</h1>
          <p className="muted">Live capacity and heartbeat status for the operator fleet.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => setPaused((value) => !value)}>
          {paused ? 'Continue refresh' : 'Pause refresh'}
        </button>
      </div>

      <div className="health-toolbar">
        <p className="muted" aria-live="polite">
          Auto-refresh is {paused ? 'paused' : 'on'} at 15-second intervals.
        </p>
      </div>

      {loading && <p className="state-message">Loading cluster health...</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {!loading && !error && !capacity && (
        <div className="health-empty" role="status">
          <strong>Operator access is required to view cluster capacity.</strong>
          <p className="muted">This account can authenticate, but the API did not return the operator-only capacity block.</p>
        </div>
      )}
      {!loading && !error && capacity && capacity.length === 0 && (
        <div className="health-empty" role="status">
          <strong>No clusters reported.</strong>
          <p className="muted">Register an agent and wait for its first heartbeat to see node health here.</p>
        </div>
      )}
      {!loading && !error && capacity && capacity.length > 0 && (
        <div className="health-grid">
          {capacity.map((cluster) => <ClusterCard cluster={cluster} key={cluster.id} />)}
        </div>
      )}
    </section>
  );
}
