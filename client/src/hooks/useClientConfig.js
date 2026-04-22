import { useEffect, useState } from 'react';
import { API_BASE } from '../utils/api';

// Module-level cache — one fetch per page load across all consumers.
let cached = null;
let inflight = null;

export function useClientConfig() {
  const [flags, setFlags] = useState(cached);

  useEffect(() => {
    if (cached) { setFlags(cached); return; }
    if (!inflight) {
      inflight = fetch(`${API_BASE}/api/config/client`)
        .then((r) => r.json())
        .then((j) => {
          cached = j?.flags || {};
          return cached;
        })
        .catch(() => ({}));
    }
    inflight.then((f) => setFlags(f));
  }, []);

  return flags || {};
}
