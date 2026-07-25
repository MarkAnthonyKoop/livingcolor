import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/voice.js', () => ({ speak: vi.fn(), stopSpeaking: vi.fn() }));

import { playStory, stopStory } from '../js/story.js';

const SCENES = {
  title: 'T',
  scenes: [1, 2, 3, 4].map(i => ({ image_prompt: 'scene ' + i, narration: 'n' + i, hold_ms: 3000 })),
};

// Image stub whose loads always fail (Pollinations down / rate-limited)
class FailingImage {
  set src(_) { queueMicrotask(() => this.onerror && this.onerror(new Error('load failed'))); }
}

let imgEl;

beforeEach(() => {
  imgEl = document.createElement('img');
  vi.stubGlobal('Image', FailingImage);
});

afterEach(() => {
  stopStory();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('playStory', () => {
  it('returns false when /api/story fails, so the caller can fall back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    expect(await playStory(imgEl, 'cat', {})).toBe(false);
  });

  it('does not archive or preload a story cancelled during the fetch', async () => {
    let resolveStory;
    const fetchMock = vi.fn(() => new Promise((r) => { resolveStory = r; }));
    vi.stubGlobal('fetch', fetchMock);

    const p = playStory(imgEl, 'cat', {});
    await Promise.resolve();               // let playStory reach the await
    stopStory();                           // user starts something new mid-fetch
    resolveStory({ ok: true, json: () => Promise.resolve(SCENES) });

    expect(await p).toBe(true);            // cancelled ≠ failed: no fallback wanted
    // only the /api/story call — no /api/archive-story POST for a dead story
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/story');
  });

  it('returns false when every scene image fails to load', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url) => Promise.resolve(
      url === '/api/story'
        ? { ok: true, json: () => Promise.resolve(SCENES) }
        : { ok: true, json: () => Promise.resolve({}) }
    ));
    vi.stubGlobal('fetch', fetchMock);

    const p = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(120000);  // burn staggers + per-scene 20s races

    expect(await p).toBe(false);           // zero scenes shown → report failure
    expect(imgEl.style.opacity).not.toBe('0');  // image never stranded invisible
  });
});
