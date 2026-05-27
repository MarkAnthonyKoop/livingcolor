// Canvas setup, drawing, brush, eraser, undo, clear, coordinate helpers.

import {
  getCanvas, getCtx, getDrawing, setDrawing,
  getCurrentColor, getCurrentTool, getBrushSize,
  getHistory, pushHistory, popHistory,
} from './state.js';

export function resizeCanvas() {
  const canvas = getCanvas();
  const ctx = getCtx();
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const prevData = ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;

  canvas.width = rect.width;
  canvas.height = rect.height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (prevData) {
    ctx.putImageData(prevData, 0, 0);
  }
}

export function getPos(e) {
  const canvas = getCanvas();
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function applyStroke() {
  const ctx = getCtx();
  ctx.lineWidth = getBrushSize();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = getCurrentTool() === 'eraser' ? '#ffffff' : getCurrentColor();
}

export function startDraw(e) {
  if (getCurrentTool() === 'fill') {
    // fill is handled by fill.js — import dynamically to avoid circular dep
    const pos = getPos(e);
    import('./fill.js').then(m => m.floodFill(pos.x, pos.y));
    return;
  }
  setDrawing(true);
  saveState();
  const pos = getPos(e);
  const ctx = getCtx();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(pos.x, pos.y);
  applyStroke();
  ctx.stroke();
}

export function draw(e) {
  if (!getDrawing()) return;
  const pos = getPos(e);
  const ctx = getCtx();
  ctx.lineTo(pos.x, pos.y);
  applyStroke();
  ctx.stroke();
}

export function endDraw() {
  if (!getDrawing()) return;
  setDrawing(false);
  getCtx().beginPath();
}

export function saveState() {
  pushHistory(getCanvas().toDataURL());
}

export function undo() {
  if (getHistory().length === 0) return;
  const prev = popHistory();
  const img = new Image();
  const canvas = getCanvas();
  const ctx = getCtx();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = prev;
}

export function clearCanvas() {
  saveState();
  const canvas = getCanvas();
  const ctx = getCtx();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

export function setupCanvas() {
  const canvas = getCanvas();
  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', draw);
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointerleave', endDraw);
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
}

export function isCanvasBlank() {
  const canvas = getCanvas();
  const ctx = getCtx();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = 16;
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) return false;
  }
  return true;
}

export function getCanvasBase64() {
  const canvas = getCanvas();
  const tmp = document.createElement('canvas');
  tmp.width = 512;
  tmp.height = 512;
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0, 0, 512, 512);
  tctx.drawImage(canvas, 0, 0, 512, 512);
  return tmp.toDataURL('image/jpeg', 0.8).split(',')[1];
}

export function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      undo();
    }
  });
}
