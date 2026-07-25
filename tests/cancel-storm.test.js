import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/voice.js', () => ({ speak: vi.fn(), stopSpeaking: vi.fn() }));

import { playStory, stopStory } from '../js/story.js';

// NOTE: no local unhandledRejection listener here — vitest reports and fails on
// escaped rejections itself, and installing one silently swallows them.
// A kid mashing buttons: overlapping starts, stops mid-flight, restarts.
// The invariants that must hold no matter the interleaving:
//   1. no unhandled rejection / thrown exception escapes
//   2. the chat image is never left invisible
//   3. at most one playback is live (an old one can't resurrect after a new start)

const STORY = {
  title: 'T',
  scenes: [1, 2, 3, 4].map(i => ({ image_prompt: 's' + i, narration: 'n' + i, hold_ms: 3000 })),
};

class OkImage {
  constructor() { this.naturalWidth = 768; this.naturalHeight = 768; }
  set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
  get src() { return this._src; }
}

let imgEl;

beforeEach(() => {
  imgEl = document.createElement('img');
  vi.stubGlobal('Image', OkImage);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve(STORY),
  })));
  vi.useFakeTimers();
});

afterEach(() => {
  stopStory();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('cancel storms', () => {
  it('survives 20 rapid start/stop cycles without throwing or stranding opacity', async () => {
    const running = [];
    for (let i = 0; i < 20; i++) {
      running.push(playStory(imgEl, 'cat', {}));
      await vi.advanceTimersByTimeAsync(50);
      stopStory();
    }
    // let every pending sleep/race drain before collecting results
    const all = Promise.all(running);
    await vi.advanceTimersByTimeAsync(180000);
    const results = await all;
    expect(results.every(r => typeof r === 'boolean')).toBe(true);
    expect(imgEl.style.opacity).not.toBe('0');
  });

  it('an older playback cannot resurrect after a newer one starts', async () => {
    const first = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(100);
    const second = playStory(imgEl, 'dog', {});   // implicitly cancels the first
    await vi.advanceTimersByTimeAsync(2000);

    expect(await first).toBe(true);               // cancelled cleanly, not a failure
    stopStory();
    await vi.advanceTimersByTimeAsync(60000);
    await second;
    // after everything settles, no further image mutation should be pending
    const settled = imgEl.src;
    await vi.advanceTimersByTimeAsync(60000);
    expect(imgEl.src).toBe(settled);
  });

  it('stop during the very first await is safe', async () => {
    const p = playStory(imgEl, 'cat', {});
    stopStory();                                   // before anything resolved
    await vi.advanceTimersByTimeAsync(60000);
    expect(typeof await p).toBe('boolean');
    expect(imgEl.style.opacity).not.toBe('0');
  });

  it('repeated stopStory() calls are harmless and idempotent', async () => {
    const p = playStory(imgEl, 'cat', {});
    await vi.advanceTimersByTimeAsync(100);
    for (let i = 0; i < 50; i++) stopStory();   // the REAL function, not a mock
    await vi.advanceTimersByTimeAsync(60000);
    expect(typeof await p).toBe('boolean');
    expect(imgEl.style.opacity).not.toBe('0');
  });
});
