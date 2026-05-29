// Per-region animation: split an AI image into bbox-defined regions,
// position each as an overlay div with background-position trick,
// animate each independently using transform.

import { log } from './logger.js';

let activeAnim = null;
let overlayEls = [];

const ANCHOR_MAP = {
  'center': '50% 50%', 'top': '50% 0%', 'bottom': '50% 100%',
  'left': '0% 50%', 'right': '100% 50%',
  'top-left': '0% 0%', 'top-right': '100% 0%',
  'bottom-left': '0% 100%', 'bottom-right': '100% 100%',
};

export function stopRegionAnimation() {
  if (activeAnim) {
    cancelAnimationFrame(activeAnim);
    activeAnim = null;
  }
  for (const el of overlayEls) el.remove();
  overlayEls = [];
}

function evalTransform(tr, elapsedMs) {
  const phase = (elapsedMs % tr.period_ms) / tr.period_ms;
  let v;
  if (tr.easing === 'linear') v = phase * 2 - 1;
  else if (tr.easing === 'ease') v = phase < 0.5 ? 2 * phase * phase : 1 - Math.pow(-2 * phase + 2, 2) / 2;
  else v = Math.sin(phase * Math.PI * 2);
  return v * tr.amplitude;
}

// imgEl: the <img> displaying the AI image.
// plan: { regions: [{ name, bbox: [x,y,w,h], anchor, motions: [{type,axis,amplitude,period_ms,easing}] }] }
export function animateRegions(imgEl, plan) {
  if (!plan || !plan.regions || plan.regions.length === 0) return false;
  stopRegionAnimation();
  log('regions', 'starting region animation', { count: plan.regions.length });

  const container = imgEl.parentElement;
  container.style.position = container.style.position || 'relative';

  const rect = imgEl.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (W < 10 || H < 10) {
    log('regions', 'image not laid out yet, aborting');
    return false;
  }

  // Make the original image a faded base layer so seams blend
  imgEl.style.transition = 'opacity 0.4s ease-out';
  imgEl.style.opacity = '1';

  for (const region of plan.regions) {
    const [bx, by, bw, bh] = region.bbox;
    const el = document.createElement('div');
    el.className = 'region-overlay';
    el.style.cssText = `
      position: absolute;
      left: ${bx * W}px;
      top: ${by * H}px;
      width: ${bw * W}px;
      height: ${bh * H}px;
      background-image: url("${imgEl.src}");
      background-position: ${-bx * W}px ${-by * H}px;
      background-size: ${W}px ${H}px;
      background-repeat: no-repeat;
      transform-origin: ${ANCHOR_MAP[region.anchor] || '50% 50%'};
      pointer-events: none;
      will-change: transform;
    `;
    container.appendChild(el);
    overlayEls.push(el);
    region._el = el;
  }

  const startTime = performance.now();

  function animate() {
    const elapsed = performance.now() - startTime;
    for (const region of plan.regions) {
      let tx = 0, ty = 0, rot = 0, scale = 1;
      for (const m of region.motions || []) {
        const v = evalTransform(m, elapsed);
        if (m.type === 'translate') {
          if (m.axis === 'x') tx += v;
          else ty += v;
        } else if (m.type === 'rotate') rot += v;
        else if (m.type === 'scale') scale += v;
      }
      region._el.style.transform =
        `translate(${tx}px, ${ty}px) rotate(${rot}deg) scale(${scale})`;
    }
    activeAnim = requestAnimationFrame(animate);
  }

  activeAnim = requestAnimationFrame(animate);
  return true;
}
