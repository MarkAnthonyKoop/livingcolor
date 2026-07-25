import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import contract from './contract/archive_story_payload.json';

vi.mock('../js/voice.js', () => ({ speak: vi.fn(), stopSpeaking: vi.fn() }));

import { playStory, stopStory, buildPollinationsUrl } from '../js/story.js';

// The producer half of the client/server contract. server/test_contract.py
// asserts the consumer half against the SAME fixture, so a drift on either
// side fails on both sides at once instead of silently losing archives.

class OkImage {
  constructor() { this.naturalWidth = 768; this.naturalHeight = 768; }
  set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
  get src() { return this._src; }
}

describe('client emits the archive-story contract shape', () => {
  let imgEl, posted;

  beforeEach(() => {
    imgEl = document.createElement('img');
    posted = [];
    vi.stubGlobal('Image', OkImage);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
      if (url === '/api/archive-story') {
        posted.push(JSON.parse(opts.body));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          title: contract.title,
          scenes: contract.scenes.map(s => ({
            narration: s.narration, image_prompt: s.image_prompt, hold_ms: s.hold_ms,
          })),
        }),
      });
    }));
  });

  afterEach(() => { stopStory(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('posts every field the server contract declares', async () => {
    const p = playStory(imgEl, contract.subject, {});
    await vi.advanceTimersByTimeAsync(120000);
    await p;

    expect(posted).toHaveLength(1);
    const body = posted[0];
    expect(Object.keys(body).sort()).toEqual(['scenes', 'subject', 'title']);
    expect(body.subject).toBe(contract.subject);
    expect(body.title).toBe(contract.title);
    expect(body.scenes).toHaveLength(contract.scenes.length);

    body.scenes.forEach((scene, i) => {
      expect(Object.keys(scene).sort())
        .toEqual(['hold_ms', 'image_prompt', 'image_url', 'narration']);
      expect(scene.narration).toBe(contract.scenes[i].narration);
      expect(scene.image_prompt).toBe(contract.scenes[i].image_prompt);
      expect(typeof scene.hold_ms).toBe('number');
      // the URL must be one the server's allowlist accepts
      expect(new URL(scene.image_url).hostname).toBe('image.pollinations.ai');
      expect(new URL(scene.image_url).protocol).toBe('https:');
    });
  });

  it('the fixture URLs match what buildPollinationsUrl produces', () => {
    const url = buildPollinationsUrl(contract.scenes[0].image_prompt, 12345);
    const fixture = new URL(contract.scenes[0].image_url);
    const built = new URL(url);
    expect(built.hostname).toBe(fixture.hostname);
    expect(built.protocol).toBe(fixture.protocol);
    expect(built.searchParams.get('seed')).toBe(fixture.searchParams.get('seed'));
    expect(built.searchParams.get('width')).toBe(fixture.searchParams.get('width'));
    expect(built.searchParams.get('nologo')).toBe(fixture.searchParams.get('nologo'));
  });
});
