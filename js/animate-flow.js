// Animation fallback chain for the last generated image:
// story arc → per-region motion → whole-image motion plan → makeAlive.

import { log } from './logger.js';
import { readStored } from './storage.js';
import { logStep } from './chat.js';
import { makeAlive } from './living.js';
import { animateRegions } from './regions.js';
import { playStory } from './story.js';

// Bumped by cancelAnimateFlow(); a running chain re-checks after every await
// so a stop can't be outrun by an in-flight fetch.
let flowEpoch = 0;

export function cancelAnimateFlow() {
  flowEpoch++;
}

export async function applyLivingToLastImage() {
  const epoch = flowEpoch;
  const imgs = document.querySelectorAll('.chat-bubble img');
  if (imgs.length === 0) return;
  const lastImg = imgs[imgs.length - 1];
  const useBackend = readStored('use_backend') === 'true';
  const subject = window._lcSubject || 'object';
  const info = window._lcDrawingInfo || {};

  // PRIMARY when backend on: narrative story arc (Claude writes 4 scenes,
  // each becomes a Pollinations image with narration). Real progression.
  if (useBackend) {
    try {
      logStep('Writing your story...');
      const ok = await playStory(lastImg, subject, info);
      if (ok || epoch !== flowEpoch) return;
    } catch (e) {
      log('story', 'fatal, falling back to regions', { error: e.message });
    }
  }

  // FALLBACK 1: per-region motion (separate parts animate)
  if (useBackend && lastImg.src) {
    try {
      const res = await fetch('/api/region-motion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: lastImg.src, subject }),
        signal: AbortSignal.timeout(60000),
      });
      if (epoch !== flowEpoch) return;
      if (res.ok) {
        const plan = await res.json();
        log('regions', 'plan received', { count: plan.regions?.length });
        const apply = () => animateRegions(lastImg, plan);
        if (lastImg.complete) apply();
        else lastImg.addEventListener('load', apply, { once: true });
        return;
      }
    } catch (e) {
      log('regions', 'region-motion failed', { error: e.message });
    }
  }

  // Fallback: whole-image motion plan
  let plan = null;
  if (useBackend) {
    try {
      const res = await fetch('/api/motion-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          composition: info.composition || '',
          details: info.details || '',
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (epoch !== flowEpoch) return;
      if (res.ok) {
        plan = await res.json();
        log('motion', 'plan received', { layers: plan.layers?.length });
      }
    } catch (e) {
      log('motion', 'plan fetch failed', { error: e.message });
    }
  }

  if (epoch !== flowEpoch) return;
  const start = () => makeAlive(lastImg, plan);
  if (lastImg.complete) start();
  else lastImg.addEventListener('load', start, { once: true });
}
