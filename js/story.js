// Story playback: Claude writes a 4-6 scene narrative arc, each scene gets a
// Pollinations image + ElevenLabs narration. Plays as a kind of animated picture book.

import { POLLINATIONS_IMAGE } from './state.js';
import { log } from './logger.js';
import { speak, stopSpeaking } from './voice.js';

let activePlayback = null;

export function stopStory() {
  if (activePlayback) {
    activePlayback.cancelled = true;
    activePlayback = null;
  }
  stopSpeaking();
}

function sanitizePrompt(p) {
  // Normalize smart quotes / dashes / weird unicode that can confuse upstream
  return (p || '')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[…]/g, '...')
    .replace(/[\x00-\x1F\x7F]/g, '')  // strip control chars; keep accents/CJK — encodeURIComponent handles them
    .trim();
}

function buildPollinationsUrl(prompt, seed) {
  const cleaned = sanitizePrompt(prompt);
  // Cap length: very long URLs sometimes get rejected
  const capped = cleaned.length > 400 ? cleaned.slice(0, 400) : cleaned;
  const full = capped + ', highly detailed, vivid colors, masterpiece';
  const encoded = encodeURIComponent(full);
  return POLLINATIONS_IMAGE + encoded + '?width=768&height=768&seed=' + seed + '&nologo=true';
}

function loadImage(url, label) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      log('story', 'image loaded', { label, w: img.naturalWidth, h: img.naturalHeight });
      resolve(img);
    };
    img.onerror = (e) => {
      log('story', 'image error', { label, urlLen: url.length, urlEnd: url.slice(-80) });
      reject(new Error('image load failed: ' + label));
    };
    img.src = url;
  });
}

function sleep(ms, ctrl) {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    if (ctrl) ctrl._timers.push(id);
  });
}

export async function playStory(imgEl, subject, info) {
  log('story', 'fetching arc', { subject });
  stopStory();
  const ctrl = { cancelled: false, _timers: [] };
  activePlayback = ctrl;

  // Get the story from Claude
  let storyData;
  try {
    const res = await fetch('/api/story', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        character: info.character || '',
        details: info.details || '',
        style: info.style || '',
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      log('story', 'fetch failed', { status: res.status });
      return false;
    }
    storyData = await res.json();
  } catch (e) {
    log('story', 'fetch error', { error: e.message });
    return false;
  }

  if (!storyData?.scenes?.length) {
    log('story', 'no scenes returned');
    return false;
  }

  log('story', 'arc received', { title: storyData.title, scenes: storyData.scenes.length });

  // Prepare scene URLs (single shared seed for character consistency across scenes)
  const seed = Math.floor(Math.random() * 999999);
  const sceneUrls = storyData.scenes.map(s => buildPollinationsUrl(s.image_prompt, seed));

  // Archive the story
  fetch('/api/archive-story', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject,
      title: storyData.title,
      scenes: storyData.scenes.map((s, i) => ({
        narration: s.narration,
        image_prompt: s.image_prompt,
        image_url: sceneUrls[i],
        hold_ms: s.hold_ms,
      })),
    }),
  }).catch(() => {});

  // Load scenes sequentially with stagger — Pollinations rate-limits parallel hits
  log('story', 'sequential preload starting', { count: sceneUrls.length });
  const preloaded = [];
  // Start scene 1 immediately, scene 2 after 4s, scene 3 after 8s, etc.
  // First await scene 1 fully; the rest race in the background.
  preloaded[0] = loadImage(sceneUrls[0], 'scene_1').catch((e) => {
    log('story', 'scene 1 retry', { error: e.message });
    return loadImage(sceneUrls[0] + '&retry=1', 'scene_1_retry').catch(() => null);
  });

  // Kick off rest with stagger
  for (let i = 1; i < sceneUrls.length; i++) {
    preloaded[i] = sleep(i * 4000, ctrl).then(() => {
      if (ctrl.cancelled) return null;
      return loadImage(sceneUrls[i], 'scene_' + (i + 1)).catch(() => null);
    });
  }

  // Wait for scene 1 only before playback begins
  await preloaded[0];
  if (ctrl.cancelled) return true;

  imgEl.style.transition = 'opacity 0.5s ease-in-out';
  let shown = 0;

  for (let i = 0; i < storyData.scenes.length; i++) {
    if (ctrl.cancelled) return true;
    const scene = storyData.scenes[i];
    log('story', 'scene ' + (i + 1) + ' start', { narration: scene.narration?.slice(0, 60) });

    // Wait if this scene isn't loaded yet (max 20s)
    const img = await Promise.race([preloaded[i], sleep(20000, ctrl).then(() => null)]);
    if (ctrl.cancelled) return true;

    if (!img) {
      log('story', 'scene image unavailable, skipping', { i: i + 1 });
      continue;
    }

    // Crossfade: fade out, swap, fade in
    imgEl.style.opacity = '0';
    await sleep(400, ctrl);
    if (ctrl.cancelled) {
      imgEl.style.opacity = '1';  // never leave the chat image invisible
      return true;
    }
    imgEl.src = img.src;
    // Force reflow then fade in
    void imgEl.offsetHeight;
    imgEl.style.opacity = '1';
    shown++;

    // Speak narration (overlapping with hold)
    if (scene.narration) speak(scene.narration);

    // Hold the scene
    const holdMs = Math.max(2500, Math.min(6000, scene.hold_ms || 4000));
    await sleep(holdMs, ctrl);
  }

  if (shown === 0) {
    // Every scene image failed — report failure so the caller's fallback chain
    // (region motion → makeAlive) still gives the drawing some animation.
    log('story', 'no scenes displayed, falling back');
    return false;
  }
  log('story', 'arc finished', { title: storyData.title });
  return true;
}
