import { useEffect, useState } from 'react';
import { API_BASE } from '../utils/api';

let _promise = null;
let _resolved = null;
let _failed   = false;

export function _resetForTests() {
  _promise = null;
  _resolved = null;
  _failed = false;
}

function ensurePromise() {
  if (_promise) return _promise;
  _promise = fetch(`${API_BASE}/api/flights/filter-options`)
    .then(res => {
      if (!res.ok) throw new Error(res.statusText);
      return res.json();
    })
    .then(data => { _resolved = data; return data; })
    .catch(() => { _failed = true; _resolved = null; return null; });
  return _promise;
}

export function useFilterOptions() {
  const [data, setData] = useState(_resolved);
  const [err,  setErr]  = useState(_failed);

  useEffect(() => {
    if (_resolved || _failed) return;
    let active = true;
    ensurePromise().then(d => {
      if (!active) return;
      if (d) setData(d);
      else setErr(true);
    });
    return () => { active = false; };
  }, []);

  return {
    filterOptions: data,
    apiStatus:     data?.apiStatus ?? null,
    error:         err,
  };
}
