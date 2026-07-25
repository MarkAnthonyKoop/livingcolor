import { describe, it, expect, beforeEach, vi } from 'vitest';
import { speak, stopSpeaking, isVoiceEnabled, setVoiceEnabled } from '../js/voice.js';

// Controllable fetch: resolves when we say so
function deferredFetch() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  const fetchMock = vi.fn(() => promise);
  const respond = () => resolve({
    ok: true,
    blob: () => Promise.resolve(new Blob(['mp3'])),
  });
  return { fetchMock, respond };
}

class FakeAudio {
  constructor(url) {
    this.url = url;
    this.played = false;
    FakeAudio.instances.push(this);
  }
  addEventListener() {}
  play() { this.played = true; return Promise.resolve(); }
  pause() { this.paused = true; }
}

beforeEach(() => {
  localStorage.clear();
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} });
});

describe('voice enable toggle', () => {
  it('defaults to enabled and round-trips', () => {
    expect(isVoiceEnabled()).toBe(true);
    setVoiceEnabled(false);
    expect(isVoiceEnabled()).toBe(false);
    setVoiceEnabled(true);
    expect(isVoiceEnabled()).toBe(true);
  });

  it('speak() is a no-op when voice is off', async () => {
    setVoiceEnabled(false);
    const { fetchMock } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    await speak('hello there friend');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('speak', () => {
  it('plays audio when the TTS request succeeds', async () => {
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const p = speak('hello there friend');
    respond();
    await p;
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].played).toBe(true);
  });

  it('skips trivially short text without a network call', async () => {
    const { fetchMock } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    await speak('a');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards audio when stopSpeaking() fires while the request is in flight', async () => {
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const p = speak('hello there friend');
    stopSpeaking();          // cancel while the fetch is pending
    respond();               // stale response arrives afterwards
    await p;
    expect(FakeAudio.instances).toHaveLength(0);  // stale narration must not play
  });

  it('strips emoji from the spoken text', async () => {
    const { fetchMock, respond } = deferredFetch();
    vi.stubGlobal('fetch', fetchMock);
    const p = speak('Wow! 🦋✨ Amazing butterfly!');
    respond();
    await p;
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe('Wow! Amazing butterfly!');
  });
});
