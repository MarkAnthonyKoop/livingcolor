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

  it('caps prompt length so the URL stays reasonable', () => {
    const url = buildPollinationsUrl('x'.repeat(100000), 1);
    expect(url.length).toBeLessThan(2000);   // common URL length ceiling
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
    'returns a boolean and never throws: payload %i', async (_i, payload) => {
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

  it('handles a malformed JSON body without hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.reject(new SyntaxError('Unexpected token')),
    }));
    const p = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe(false);                   // clean failure → fallback runs
  });
});
