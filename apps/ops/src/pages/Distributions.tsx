import { useCallback, useEffect, useState } from 'react';
import { Distribution, getDistributions, publishDistribution } from '../api';

export default function Distributions() {
  const [items, setItems] = useState<Distribution[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getDistributions());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load distributions.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function publish(item: Distribution) {
    // Publishing is one-way: ADR-004 makes a published artifact immutable, so the
    // only way to change it afterwards is to cut a new version.
    const ok = window.confirm(
      `Publish ${item.name} ${item.version}? Published artifacts are immutable — changes require a new version.`,
    );
    if (!ok) return;
    setBusy(item.id);
    try {
      await publishDistribution(item.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to publish.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h1>Distributions</h1>
      <p className="muted">Immutable versioned artifacts (ADR-004). No arbitrary plugin upload.</p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <table className="data-table">
        <thead>
          <tr><th>Name</th><th>Version</th><th>Channel</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{item.version}</td>
              <td className="muted">{item.channel}</td>
              <td>{item.status}</td>
              <td>
                {item.status === 'draft' && (
                  <button
                    className="button button-quiet"
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => void publish(item)}
                  >
                    Publish
                  </button>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && !error && (
            <tr><td colSpan={5} className="muted">No distributions registered.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
