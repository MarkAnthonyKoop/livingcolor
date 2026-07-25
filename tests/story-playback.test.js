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

// R's live benchmark (2026-07-25): Pollinations averages ~13.6s per image while
// scenes are staggered 4s apart and hold 3-5s — so playback can outrun the
// preloader and individual scenes can miss their 20s window. Partial failure is
// therefore the COMMON case in production, not an edge case.
describe('partial scene failure', () => {
  let imgEl;

  beforeEach(() => {
    imgEl = document.createElement('img');
    vi.useFakeTimers();
  });
  afterEach(() => { stopStory(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('plays the scenes that DID load and reports success', async () => {
    let n = 0;
    // fail every second image, deterministically by call order
    class EverySecondFails {
      set src(v) {
        this._src = v;
        const fail = (++n % 2) === 0;
        queueMicrotask(() => {
          if (fail) this.onerror && this.onerror(new Error('flaky'));
          else { this.naturalWidth = 768; this.onload && this.onload(); }
        });
      }
      get src() { return this._src; }
    }
    vi.stubGlobal('Image', EverySecondFails);
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(
      url === '/api/story'
        ? { ok: true, json: () => Promise.resolve(SCENES) }
        : { ok: true, json: () => Promise.resolve({}) })));

    const p = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(180000);

    // at least one scene displayed → success, so the caller does NOT fall back
    // and clobber a partially-played story
    expect(await p).toBe(true);
    expect(imgEl.src).toBeTruthy();
    expect(imgEl.style.opacity).not.toBe('0');
  });

  it('a scene that never resolves is skipped without stalling the rest', async () => {
    let call = 0;
    class SecondHangs {
      set src(v) {
        this._src = v;
        const hangs = (++call === 2);   // scene 2 never fires either handler
        if (hangs) return;
        queueMicrotask(() => { this.naturalWidth = 768; this.onload && this.onload(); });
      }
      get src() { return this._src; }
    }
    vi.stubGlobal('Image', SecondHangs);
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(
      url === '/api/story'
        ? { ok: true, json: () => Promise.resolve(SCENES) }
        : { ok: true, json: () => Promise.resolve({}) })));

    const p = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(300000);
    expect(await p).toBe(true);          // hung scene skipped after its 20s race
  });
});
