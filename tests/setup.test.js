import { describe, it, expect, beforeEach } from 'vitest';
import { getApiKey, setApiKey } from '../js/setup.js';

describe('API key management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns obfuscated default key when no localStorage key', () => {
    const key = getApiKey();
    expect(key).toBeTruthy();
    expect(key.startsWith('AIza')).toBe(true);
    expect(key.length).toBeGreaterThan(30);
  });

  it('XOR decode produces valid Google API key format', () => {
    const key = getApiKey();
    expect(key).toMatch(/^AIzaSy[A-Za-z0-9_-]{33}$/);
  });

  it('setApiKey stores in localStorage', () => {
    setApiKey('test-key-123');
    expect(localStorage.getItem('gemini_key')).toBe('test-key-123');
  });

  it('setApiKey trims whitespace', () => {
    setApiKey('  key-with-spaces  ');
    expect(localStorage.getItem('gemini_key')).toBe('key-with-spaces');
  });

  it('getApiKey prefers localStorage over default', () => {
    setApiKey('my-custom-key');
    expect(getApiKey()).toBe('my-custom-key');
  });

  it('getApiKey falls back to default when localStorage cleared', () => {
    setApiKey('temp');
    localStorage.clear();
    const key = getApiKey();
    expect(key.startsWith('AIza')).toBe(true);
  });
});
