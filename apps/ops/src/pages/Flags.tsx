import { useCallback, useEffect, useState } from 'react';
import { FeatureFlag, getFlags, setFlag } from '../api';

export default function Flags() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFlags(await getFlags());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load flags.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(flag: FeatureFlag) {
    setBusy(flag.key);
    try {
      await setFlag(flag.key, !flag.enabled);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update flag.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h1>Feature flags</h1>
      <p className="muted">
        This toggle sets the global default only. Per-scope rules resolve org &gt; plan &gt; cluster &gt; global.
      </p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <table className="data-table">
        <thead>
          <tr><th>Key</th><th>Description</th><th>Global default</th><th /></tr>
        </thead>
        <tbody>
          {flags.map((flag) => (
            <tr key={flag.key}>
              <td><code>{flag.key}</code></td>
              <td className="muted">{flag.description || '—'}</td>
              <td>{flag.enabled ? 'on' : 'off'}</td>
              <td>
                <button
                  className="button button-quiet"
                  type="button"
                  disabled={busy === flag.key}
                  onClick={() => void toggle(flag)}
                >
                  Turn {flag.enabled ? 'off' : 'on'}
                </button>
              </td>
            </tr>
          ))}
          {flags.length === 0 && !error && (
            <tr><td colSpan={4} className="muted">No flags defined.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
