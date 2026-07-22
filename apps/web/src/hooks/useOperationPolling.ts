import { useEffect, useState } from 'react';

export function useOperationPolling<T>(
  load: () => Promise<T>,
  shouldContinue: (value: T) => boolean,
  dependencies: readonly unknown[],
) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await load();
        if (!active) return;
        setValue(next);
        setError('');
        if (shouldContinue(next)) timer = window.setTimeout(poll, 2500);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to read operation status.');
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // Callers provide the request identity and keep the request itself stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return { value, error };
}
