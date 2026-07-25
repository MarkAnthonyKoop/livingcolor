import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/voice.js', () => ({ speak: vi.fn(), stopSpeaking: vi.fn() }));

import { sanitizePrompt, buildPollinationsUrl, playStory, stopStory } from '../js/story.js';

// The server allowlist (server/core.py) that every generated URL must satisfy.
// If the client can build a URL the server refuses, archiving silently fails.
const ALLOWED_HOST = 'image.pollinations.ai';

const HOSTILE_PROMPTS = [
  '',
  '   ',
  null,
  undefined,
  'a'.repeat(5000),
  'niño pequeño 小さな猫 🦋',
  'cat?width=1&x=y',                       // query-injection attempt
  'cat#fragment',
  'cat/../../etc/passwd',
  'cat@evil.com',                          // userinfo-injection attempt
  'https://evil.com/',                     // whole URL as the prompt
  '//evil.com/x',
  'cat\nnewline\ttab',
  'cat\x00null',
  'cat"quote\'apos`tick',
  '<script>alert(1)</script>',
  '%2e%2e%2f',                             // pre-encoded traversal
  '‮reversed',                        // right-to-left override
  '🦋'.repeat(500),
];

describe('buildPollinationsUrl is allowlist-safe for any prompt', () => {
  it.each(HOSTILE_PROMPTS.map(p => [String(p).slice(0, 24), p]))(
    'stays on the allowlisted https host: %s', (_label, prompt) => {
      const url = buildPollinationsUrl(prompt, 12345);
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.hostname).toBe(ALLOWED_HOST);
      expect(parsed.username).toBe('');       // no userinfo smuggling
      expect(parsed.password).toBe('');
      expect(parsed.port).toBe('');
      // the seed we asked for must survive — no query-param injection displacing it
      expect(parsed.searchParams.get('seed')).toBe('12345');
      expect(parsed.searchParams.get('width')).toBe('768');
    });

  it('never emits a raw newline, space, or control char in the URL', () => {
    for (const prompt of HOSTILE_PROMPTS) {
      const url = buildPollinationsUrl(prompt, 1);
      expect(url).not.toMatch(/[\s\x00-\x1F\x7F]/);
    }
  });

  it('caps the ENCODED url length for multibyte prompts too', () => {
    // one emoji costs up to 12 chars once percent-encoded, so an ASCII-only
    // assertion here would pass while real prompts blew past the ceiling.
    for (const prompt of ['x'.repeat(100000), '🦋'.repeat(5000),
                          'niño pequeño '.repeat(500), '小さな猫'.repeat(2000)]) {
      const url = buildPollinationsUrl(prompt, 1);
      expect(url.length).toBeLessThanOrEqual(1800);
      expect(new URL(url).hostname).toBe(ALLOWED_HOST);
    }
  });
});

describe('sanitizePrompt total function', () => {
  it.each(HOSTILE_PROMPTS.map(p => [String(p).slice(0, 24), p]))(
    'always returns a string: %s', (_label, prompt) => {
      expect(typeof sanitizePrompt(prompt)).toBe('string');
    });
});

// --- playStory against hostile /api/story payloads ---

class FailingImage {
  set src(_) { queueMicrotask(() => this.onerror && this.onerror(new Error('fail'))); }
}

// Images that LOAD, so hostile scene *content* is exercised during real playback
// rather than short-circuited by every image failing.
class OkImage {
  constructor() { this.naturalWidth = 768; this.naturalHeight = 768; }
  set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
  get src() { return this._src; }
}

const HOSTILE_STORIES = [
  null,
  {},
  { scenes: null },
  { scenes: [] },
  { scenes: 'not-a-list' },
  { scenes: [null, null] },
  { scenes: [{}] },                                        // scene with no fields
  { scenes: [{ image_prompt: null, narration: null }] },
  { scenes: [{ image_prompt: 'x', hold_ms: -5000 }] },      // negative hold
  { scenes: [{ image_prompt: 'x', hold_ms: 'soon' }] },     // wrong type
  { title: 'x'.repeat(10000), scenes: [{ image_prompt: 'x' }] },
  // non-string scene fields — the class that threw out of playStory before
  { scenes: [{ image_prompt: 12345, narration: 'ok' }] },
  { scenes: [{ image_prompt: 'ok', narration: 999 }] },
  { scenes: [{ image_prompt: {}, narration: [] }] },
  { scenes: [{ image_prompt: 'ok', narration: 'ok', hold_ms: 'soon' }] },
];

describe('playStory survives hostile server payloads', () => {
  let imgEl;
  beforeEach(() => {
    imgEl = document.createElement('img');
    vi.stubGlobal('Image', FailingImage);
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopStory();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(HOSTILE_STORIES.map((s, i) => [i, s]))(
    'returns a boolean and never throws (images FAIL): payload %i', async (_i, payload) => {
      vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(
        url === '/api/story'
          ? { ok: true, json: () => Promise.resolve(payload) }
          : { ok: true, json: () => Promise.resolve({}) }
      )));
      const p = playStory(imgEl, 'cat', {});
      await vi.advanceTimersByTimeAsync(180000);
      const result = await p;
      expect(typeof result).toBe('boolean');
      expect(imgEl.style.opacity).not.toBe('0');   // never stranded invisible
    });

  it.each(HOSTILE_STORIES.map((s, i) => [i, s]))(
    'reaches playback with loadable images and still survives: payload %i',
    async (_i, payload) => {
      vi.stubGlobal('Image', OkImage);   // images LOAD → scene content is exercised
      vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(
        url === '/api/story'
          ? { ok: true, json: () => Promise.resolve(payload) }
          : { ok: true, json: () => Promise.resolve({}) }
      )));
      const p = playStory(imgEl, 'cat', {});
      await vi.advanceTimersByTimeAsync(180000);
      expect(typeof await p).toBe('boolean');
      expect(imgEl.style.opacity).not.toBe('0');
    });

  it('a scene with hold_ms: "soon" still holds, not NaN-instant', async () => {
    vi.stubGlobal('Image', OkImage);
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(
      url === '/api/story'
        ? { ok: true, json: () => Promise.resolve({
            scenes: [{ image_prompt: 'a', narration: 'n', hold_ms: 'soon' },
                     { image_prompt: 'b', narration: 'n', hold_ms: 'soon' }] }) }
        : { ok: true, json: () => Promise.resolve({}) }
    )));
    const p = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(1000);   // well under one 2500ms minimum hold
    const midSrc = imgEl.src;
    await vi.advanceTimersByTimeAsync(500);
    expect(imgEl.src).toBe(midSrc);            // scene did NOT advance instantly
    await vi.advanceTimersByTimeAsync(180000);
    await p;
  });

  it('handles a malformed JSON body without hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token')),
    }));
    const p = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe(false);                   // clean failure → fallback runs
  });
});
