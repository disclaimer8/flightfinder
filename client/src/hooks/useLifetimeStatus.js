import { useEffect, useState, useRef } from 'react';

const POLL_MS = 30_000;

// Normalizes the server response into a stable {taken, cap, remaining, soldOut}
// shape. Controller currently emits {success, taken, cap, available}; if that
// ever grows the field names `remaining`/`soldOut` we still work.
function normalize(raw) {
  const taken = Number(raw?.taken ?? 0);
  const cap   = Number(raw?.cap ?? 500);
  const remaining = Number(raw?.remaining ?? raw?.available ?? (cap - taken));
  const soldOut   = raw?.soldOut ?? remaining <= 0;
  return { taken, cap, remaining, soldOut };
}

export function useLifetimeStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer;

    async function fetchOnce() {
      try {
        const res = await fetch('/api/subscriptions/lifetime-status', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (mounted.current) setStatus(normalize(data));
      } catch (err) {
        if (mounted.current) setError(err);
      } finally {
        if (mounted.current) timer = setTimeout(fetchOnce, POLL_MS);
      }
    }

    fetchOnce();
    return () => {
      mounted.current = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { status, error };
}
