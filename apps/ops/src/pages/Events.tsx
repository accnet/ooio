import { useCallback, useEffect, useState } from 'react';
import { getEvents, PlatformEvent } from '../api';

export default function Events() {
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const page = await getEvents(50);
      setEvents(page.events);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load events.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <h1>Event outbox</h1>
      <p className="muted">
        Operators see events across all organizations; a customer account sees only its own.
        An event with no <code>publishedAt</code> and a rising attempt count is stuck.
      </p>
      {error && <p className="alert alert-error" role="alert">{error}</p>}
      <button className="button button-quiet" type="button" onClick={() => void load()}>Refresh</button>
      <table className="data-table">
        <thead>
          <tr><th>Type</th><th>Aggregate</th><th>Occurred</th><th>Published</th><th>Attempts</th><th>Last error</th></tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{event.type}</td>
              <td className="muted">{event.aggregateType}/{event.aggregateId.slice(0, 10)}…</td>
              <td className="muted">{new Date(event.occurredAt).toLocaleString()}</td>
              <td>{event.publishedAt ? 'yes' : <strong>pending</strong>}</td>
              <td>{event.attempts}</td>
              <td className="muted">{event.lastError || '—'}</td>
            </tr>
          ))}
          {events.length === 0 && !error && (
            <tr><td colSpan={6} className="muted">No events.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
