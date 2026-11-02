import { useEffect, useState } from 'react';

/** Current time, refreshed every `intervalMs` (default one minute) so "due" states roll over live. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
