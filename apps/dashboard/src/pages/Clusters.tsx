import { useEffect, useState } from 'react';
import { Cluster, getClusters } from '../api';

export default function Clusters() {
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setClusters(await getClusters());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load cluster health.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="content-column">
      <div className="section-heading"><div><p className="eyebrow">Infrastructure</p><h1>Cluster health</h1><p className="muted">A quick read on the nodes serving your stores.</p></div><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh</button></div>
      {loading ? <section className="panel state-message">Loading cluster health...</section> : error ? <section className="panel"><p className="alert alert-error" role="alert">{error}</p></section> : clusters === null ? <section className="availability-panel"><span className="availability-mark">—</span><div><p className="eyebrow">Endpoint pending</p><h2>Cluster health is not available yet</h2><p className="muted">The control plane does not expose a cluster list endpoint in this release. This view will populate when the registry API is enabled.</p></div></section> : !clusters.length ? <section className="panel state-message">No clusters have reported health yet.</section> : <div className="cluster-grid">{clusters.map((cluster) => <section className="cluster-card" key={cluster.id}><div className="panel-heading"><div><p className="eyebrow">{cluster.region || 'Cluster'}</p><h2>{cluster.name}</h2></div><Status status={cluster.status || 'unknown'} /></div><div className="node-list">{cluster.nodes?.length ? cluster.nodes.map((node) => <div className="node-row" key={node.id}><span>{node.hostname || node.id}</span><Status status={node.status || 'unknown'} /></div>) : <p className="muted">No nodes reported.</p>}</div></section>)}</div>}
    </div>
  );
}

function Status({ status }: { status: string }) {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}
