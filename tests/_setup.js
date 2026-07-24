// Vitest setup: vitest 4 + jsdom 29 drop the window.localStorage accessor when
// populating test globals, so provide a deterministic in-memory implementation.
class MemoryStorage {
  constructor() { this._m = new Map(); }
  get length() { return this._m.size; }
  key(i) { return [...this._m.keys()][i] ?? null; }
  getItem(k) { return this._m.has(String(k)) ? this._m.get(String(k)) : null; }
  setItem(k, v) { this._m.set(String(k), String(v)); }
  removeItem(k) { this._m.delete(String(k)); }
  clear() { this._m.clear(); }
}

if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === undefined) {
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  if (typeof globalThis.window === 'object') {
    Object.defineProperty(globalThis.window, 'localStorage', { value: store, configurable: true });
  }
}
