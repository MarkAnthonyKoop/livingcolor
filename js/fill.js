// Flood fill with pattern support (rainbow, sunset, ocean, fire, forest).

import { getCanvas, getCtx, getCurrentColor, getFillPattern } from './state.js';
import { saveState } from './canvas.js';

export function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Each pattern returns [r, g, b] for a given pixel coordinate.
const FILL_PATTERNS = {
  solid: () => {
    const tmp = document.createElement('canvas');
    tmp.width = 1; tmp.height = 1;
    const t = tmp.getContext('2d');
    t.fillStyle = getCurrentColor();
    t.fillRect(0, 0, 1, 1);
    const d = t.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  },
  rainbow: (x, y) => {
    const hue = ((x + y) * 2) % 360;
    return hslToRgb(hue, 100, 55);
  },
  sunset: (x, y, h) => {
    const t = y / h;
    return [
      Math.round(255 * (1 - t * 0.3)),
      Math.round(100 + 80 * (1 - t)),
      Math.round(50 + 200 * t)
    ];
  },
  ocean: (x, y) => {
    const wave = Math.sin(x * 0.05 + y * 0.03) * 0.5 + 0.5;
    return [
      Math.round(20 + 40 * wave),
      Math.round(80 + 100 * wave),
      Math.round(160 + 80 * wave)
    ];
  },
  fire: (x, y, h) => {
    const t = 1 - y / h;
    const flicker = Math.sin(x * 0.1) * 0.2 + 0.8;
    return [
      Math.round(255 * flicker),
      Math.round((200 * t) * flicker),
      Math.round((50 * t * t) * flicker)
    ];
  },
  forest: (x, y) => {
    const noise = Math.sin(x * 0.08) * Math.cos(y * 0.06) * 0.5 + 0.5;
    return [
      Math.round(20 + 60 * noise),
      Math.round(100 + 100 * noise),
      Math.round(20 + 40 * noise)
    ];
  },
};

export function floodFill(startX, startY) {
  saveState();
  const canvas = getCanvas();
  const ctx = getCtx();
  const w = canvas.width, h = canvas.height;
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const sx = Math.floor(startX), sy = Math.floor(startY);
  const idx = (sy * w + sx) * 4;
  const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2];

  const patternFn = FILL_PATTERNS[getFillPattern()];
  let solidColor = null;
  if (getFillPattern() === 'solid') {
    solidColor = patternFn(0, 0);
    if (tr === solidColor[0] && tg === solidColor[1] && tb === solidColor[2]) return;
  }

  const tolerance = 48;
  const match = (i) => Math.abs(data[i] - tr) + Math.abs(data[i+1] - tg) + Math.abs(data[i+2] - tb) < tolerance;

  const queue = [sx, sy];
  const visited = new Uint8Array(w * h);
  visited[sy * w + sx] = 1;

  while (queue.length > 0) {
    const y = queue.pop(), x = queue.pop();
    const i = (y * w + x) * 4;
    const c = solidColor || patternFn(x, y, h);
    data[i] = c[0]; data[i+1] = c[1]; data[i+2] = c[2]; data[i+3] = 255;

    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (visited[ni]) continue;
      visited[ni] = 1;
      if (match(ni * 4)) { queue.push(nx, ny); }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
