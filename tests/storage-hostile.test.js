import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getApiKey, setApiKey } from '../js/setup.js';
import { isVoiceEnabled, setVoiceEnabled } from '../js/voice.js';
import { log, getLogText } from '../js/logger.js';

// Real failure modes for a kid's tablet:
//  - Safari Private Browsing: every setItem throws QuotaExceededError
//  - a long session filling the 5MB quota
//  - storage disabled entirely by policy/parental controls
// None of these should break drawing, chatting, or the settings toggles.

const realStorage = globalThis.localStorage;

function stubStorage({ throwOnSet = false, throwOnGet = false } = {}) {
  const map = new Map();
  const store = {
    getItem(k) {
      if (throwOnGet) throw new DOMException('storage disabled', 'SecurityError');
      return map.has(String(k)) ? map.get(String(k)) : null;
    },
    setItem(k, v) {
      if (throwOnSet) throw new DOMException('exceeded quota', 'QuotaExceededError');
      map.set(String(k), String(v));
    },
    removeItem(k) {
      if (throwOnSet) throw new DOMException('exceeded quota', 'QuotaExceededError');
      map.delete(String(k));
    },
    clear() { map.clear(); },
    key(i) { return [...map.keys()][i] ?? null; },
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  return store;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: realStorage, configurable: true });
});

describe('storage full / disabled (Safari private mode)', () => {
  it('setApiKey does not throw when the quota is exhausted', () => {
    stubStorage({ throwOnSet: true });
    expect(() => setApiKey('AIzaSyTESTKEY')).not.toThrow();
  });

  it('getApiKey still returns a usable key when reads throw', () => {
    stubStorage({ throwOnGet: true });
    let key;
    expect(() => { key = getApiKey(); }).not.toThrow();
    expect(typeof key).toBe('string');
  });

  it('the voice toggle survives a full quota', () => {
    stubStorage({ throwOnSet: true });
    expect(() => setVoiceEnabled(false)).not.toThrow();
    expect(() => setVoiceEnabled(true)).not.toThrow();
  });

  it('isVoiceEnabled defaults to on when reads throw', () => {
    stubStorage({ throwOnGet: true });
    let on;
    expect(() => { on = isVoiceEnabled(); }).not.toThrow();
    expect(on).toBe(true);       // voice should work, not silently vanish
  });

  it('logging never throws when storage is unavailable', () => {
    stubStorage({ throwOnSet: true, throwOnGet: true });
    expect(() => log('test', 'event', { a: 1 })).not.toThrow();
    expect(() => getLogText()).not.toThrow();
  });
});

describe('storage holding junk from another app/version', () => {
  it.each([
    ['not json at all'],
    ['{"unclosed": '],
    ['null'],
    ['12345'],
    ['{"not": "an array"}'],
  ])('logger recovers from a corrupt log value: %s', (junk) => {
    const store = stubStorage();
    store.setItem('lc_chat_log', junk);
    expect(() => log('test', 'after-corruption')).not.toThrow();
    expect(() => getLogText()).not.toThrow();
  });

  it('a corrupt log does not lose subsequent entries', () => {
    const store = stubStorage();
    store.setItem('lc_chat_log', 'garbage');
    log('test', 'recovered');
    expect(getLogText()).toContain('recovered');
  });
});
