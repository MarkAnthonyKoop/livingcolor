// Sketch capture and particle-dissolve morph animation.

import { getCanvas } from './state.js';

export function captureSketch() {
  const canvas = getCanvas();
  const overlay = document.getElementById('sketch-overlay');
  const container = document.getElementById('morph-container');
  const rect = container.getBoundingClientRect();
  overlay.width = rect.width;
  overlay.height = rect.height;
  const octx = overlay.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, overlay.width, overlay.height);
  octx.drawImage(canvas, 0, 0, overlay.width, overlay.height);
  overlay.style.opacity = '1';
}

export function playMorph() {
  const overlay = document.getElementById('sketch-overlay');
  const w = overlay.width, h = overlay.height;
  const octx = overlay.getContext('2d');

  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = w;
  snapCanvas.height = h;
  snapCanvas.getContext('2d').drawImage(overlay, 0, 0);
  const snapData = snapCanvas.getContext('2d').getImageData(0, 0, w, h).data;

  const tileSize = 8;
  const cols = Math.ceil(w / tileSize), rows = Math.ceil(h / tileSize);
  const cx = w / 2, cy = h / 2;
  const tiles = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = c * tileSize, ty = r * tileSize;
      let hasDark = false;
      for (let py = ty; py < Math.min(ty + tileSize, h) && !hasDark; py++) {
        for (let px = tx; px < Math.min(tx + tileSize, w) && !hasDark; px++) {
          const i = (py * w + px) * 4;
          if (snapData[i] < 200 || snapData[i+1] < 200 || snapData[i+2] < 200) hasDark = true;
        }
      }
      if (!hasDark) continue;

      const dist = Math.hypot(tx - cx, ty - cy);
      tiles.push({
        x: tx, y: ty,
        vx: (tx - cx) * 0.03 + (Math.random() - 0.5) * 3,
        vy: (ty - cy) * 0.03 + (Math.random() - 0.5) * 3 - 1,
        rot: 0,
        vr: (Math.random() - 0.5) * 0.15,
        delay: dist * 0.05 + Math.random() * 10,
      });
    }
  }

  octx.clearRect(0, 0, w, h);

  let frame = 0;
  const duration = 120;

  function animate() {
    frame++;
    octx.clearRect(0, 0, w, h);
    let alive = false;

    for (const t of tiles) {
      if (frame < t.delay) {
        octx.drawImage(snapCanvas, t.x, t.y, tileSize, tileSize, t.x, t.y, tileSize, tileSize);
        alive = true;
        continue;
      }
      const age = frame - t.delay;
      const lifespan = Math.max(20, duration - t.delay);
      const p = Math.min(1, age / lifespan);
      if (p >= 1) continue;

      alive = true;
      const dx = t.vx * age * 0.5;
      const dy = t.vy * age * 0.5 + age * age * 0.01;
      t.rot += t.vr;
      const scale = 1 + p * 0.3;

      octx.save();
      octx.globalAlpha = Math.max(0, 1 - p * p * p);
      octx.translate(t.x + tileSize / 2 + dx, t.y + tileSize / 2 + dy);
      octx.rotate(t.rot);
      octx.scale(scale, scale);
      octx.drawImage(snapCanvas, t.x, t.y, tileSize, tileSize, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
      octx.restore();
    }

    if (alive) requestAnimationFrame(animate);
    else overlay.style.opacity = '0';
  }

  requestAnimationFrame(animate);
}
