import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/chat.js', () => ({ logStep: vi.fn() }));
vi.mock('../js/living.js', () => ({ makeAlive: vi.fn() }));
vi.mock('../js/regions.js', () => ({ animateRegions: vi.fn() }));
vi.mock('../js/story.js', () => ({ playStory: vi.fn() }));

import { applyLivingToLastImage, cancelAnimateFlow } from '../js/animate-flow.js';
import { makeAlive } from '../js/living.js';
import { animateRegions } from '../js/regions.js';
import { playStory } from '../js/story.js';

function addChatImage() {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  const img = document.createElement('img');
  Object.defineProperty(img, 'complete', { value: true });
  img.src = 'https://image.pollinations.ai/prompt/cat';
  bubble.appendChild(img);
  document.body.appendChild(bubble);
  return img;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('use_backend', 'true');
});

describe('applyLivingToLastImage cancellation', () => {
  it('discards a region plan that arrives after cancelAnimateFlow()', async () => {
    addChatImage();
    playStory.mockResolvedValue(false);      // story path falls through
    let resolveRegion;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { resolveRegion = r; })));

    const p = applyLivingToLastImage();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    cancelAnimateFlow();                      // user pressed Escape mid-fetch
    resolveRegion({ ok: true, json: () => Promise.resolve({ regions: [{}] }) });
    await p;

    expect(animateRegions).not.toHaveBeenCalled();
    expect(makeAlive).not.toHaveBeenCalled();
  });

  it('applies the region plan when not cancelled', async () => {
    addChatImage();
    playStory.mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ regions: [{}] }),
    }));

    await applyLivingToLastImage();
    expect(animateRegions).toHaveBeenCalledTimes(1);
  });

  it('skips everything when the story succeeds', async () => {
    addChatImage();
    playStory.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn());

    await applyLivingToLastImage();
    expect(fetch).not.toHaveBeenCalled();
    expect(makeAlive).not.toHaveBeenCalled();
  });
});
