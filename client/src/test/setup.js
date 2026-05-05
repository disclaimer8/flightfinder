import '@testing-library/jest-dom';

// jsdom does not implement IntersectionObserver. Provide a no-op stub so
// components that use it (e.g. SiteLayout sentinel scroll tracking) don't
// throw in tests.
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  class IntersectionObserverStub {
    constructor() {}
    observe()    {}
    unobserve()  {}
    disconnect() {}
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: IntersectionObserverStub,
  });
}

// Node.js v25 introduces --localstorage-file support. When this flag is present
// without a valid path (e.g. in CI / Claude sandbox), it replaces
// window.localStorage with a broken stub that has no .getItem/.setItem methods.
// This affects jsdom environments used by vitest. Restore a working in-memory
// localStorage implementation so tests that use AuthContext pass reliably.
if (typeof window !== 'undefined' && typeof window.localStorage?.getItem !== 'function') {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
}
