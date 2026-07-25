import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setCanvas, setCtx, setCurrentTool, getDrawing } from '../js/state.js';
import { setupCanvas } from '../js/canvas.js';

function mount() {
  document.body.innerHTML = '<canvas id="drawing-canvas" width="64" height="64"></canvas>';
  const canvas = document.getElementById('drawing-canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 64, height: 64 });
  canvas.toDataURL = () => 'data:,';
  const ctx = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
                clearRect: vi.fn(), fillRect: vi.fn(), getImageData: () => ({data:new Uint8ClampedArray(64*64*4)}) };
  setCanvas(canvas); setCtx(ctx); setCurrentTool('brush');
  setupCanvas();
  return canvas;
}

function pointer(type, x, y) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  e.clientX = x; e.clientY = y; e.pointerType = 'touch';
  return e;
}

describe('touch drawing lifecycle', () => {
  beforeEach(mount);

  it('a touch stroke draws', () => {
    const c = document.getElementById('drawing-canvas');
    c.dispatchEvent(pointer('pointerdown', 10, 10));
    expect(getDrawing()).toBe(true);
    c.dispatchEvent(pointer('pointermove', 20, 20));
    c.dispatchEvent(pointer('pointerup', 20, 20));
    expect(getDrawing()).toBe(false);
  });

  it('pointercancel (iOS system interrupt / palm rejection) ends the stroke', () => {
    const c = document.getElementById('drawing-canvas');
    c.dispatchEvent(pointer('pointerdown', 10, 10));
    expect(getDrawing()).toBe(true);
    c.dispatchEvent(pointer('pointercancel', 10, 10));
    expect(getDrawing(), 'stroke left active after pointercancel').toBe(false);
  });
});
