import { describe, it, expect, beforeEach } from 'vitest';
import { getApiKey, setApiKey } from '../js/setup.js';

describe('API key management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty string when no key is stored — no embedded key ships', () => {
    // The old XOR-obfuscated default was revoked and removed; an empty key
    // makes every caller fall back to the server-side Claude path.
    expect(getApiKey()).toBe('');
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

  it('getApiKey returns empty again after localStorage cleared', () => {
    setApiKey('temp');
    localStorage.clear();
    expect(getApiKey()).toBe('');
  });
});
