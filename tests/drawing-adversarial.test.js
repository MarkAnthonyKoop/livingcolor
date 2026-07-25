import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setCanvas, setCtx, setCurrentTool, setFillPattern, getHistory, MAX_HISTORY } from '../js/state.js';
import { getPos, saveState, undo, clearCanvas, isCanvasBlank } from '../js/canvas.js';
import { floodFill } from '../js/fill.js';

// A real 2D context is unavailable in jsdom, so model the pixel buffer directly.
function makeCanvas(w = 64, h = 64, cssW = w, cssH = h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: cssW, height: cssH });
  canvas.toDataURL = () => 'data:image/png;base64,AAA';
  const buf = new Uint8ClampedArray(w * h * 4).fill(255);   // white
  const ctx = {
    getImageData: () => ({ data: buf, width: w, height: h }),
    putImageData: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
  };
  setCanvas(canvas);
  setCtx(ctx);
  return { canvas, ctx, buf };
}

beforeEach(() => {
  while (getHistory().length) getHistory().pop();
  setCurrentTool('brush');
  setFillPattern('solid');
});

describe('getPos coordinate scaling', () => {
  it('scales pointer coords when CSS size differs from pixel size', () => {
    makeCanvas(800, 600, 400, 300);           // canvas displayed at half size
    const p = getPos({ clientX: 100, clientY: 50 });
    expect(p).toEqual({ x: 200, y: 100 });     // must double
  });

  it('does not produce NaN when the element has zero CSS size (hidden tab)', () => {
    makeCanvas(800, 600, 0, 0);
    const p = getPos({ clientX: 10, clientY: 10 });
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('floodFill hostile coordinates', () => {
  it.each([
    ['negative x', -5, 10],
    ['negative y', 10, -5],
    ['x past width', 999, 10],
    ['y past height', 10, 999],
    ['both out of range', -1, 9999],
    ['NaN', NaN, NaN],
    ['Infinity', Infinity, 0],
    ['fractional', 3.7, 4.2],
    ['exact edge', 63, 63],
    ['origin', 0, 0],
  ])('never throws for %s', (_label, x, y) => {
    makeCanvas();
    expect(() => floodFill(x, y)).not.toThrow();
  });

  it('does not corrupt the buffer for out-of-range starts', () => {
    const { buf } = makeCanvas();
    const before = buf.slice();
    floodFill(-10, -10);
    expect(Array.from(buf)).toEqual(Array.from(before));   // untouched
  });

  it.each(['rainbow', 'sunset', 'ocean', 'fire', 'forest', 'solid'])(
    'completes with the %s pattern without hanging', (pattern) => {
      makeCanvas(32, 32);
      setFillPattern(pattern);
      expect(() => floodFill(16, 16)).not.toThrow();
    });
});

describe('undo history bounds', () => {
  it('never grows past MAX_HISTORY under sustained drawing', () => {
    makeCanvas();
    for (let i = 0; i < MAX_HISTORY * 3; i++) saveState();
    expect(getHistory().length).toBeLessThanOrEqual(MAX_HISTORY);
  });

  it('undo on an empty history is a no-op, not a crash', () => {
    const { ctx } = makeCanvas();
    expect(() => undo()).not.toThrow();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it('repeated undos past the beginning stay safe', () => {
    makeCanvas();
    saveState();
    for (let i = 0; i < 10; i++) expect(() => undo()).not.toThrow();
    expect(getHistory().length).toBe(0);
  });
});

describe('canvas lifecycle', () => {
  it('clearCanvas saves state so it is undoable', () => {
    makeCanvas();
    clearCanvas();
    expect(getHistory().length).toBe(1);
  });

  it('isCanvasBlank does not throw on a fresh canvas', () => {
    makeCanvas();
    expect(() => isCanvasBlank()).not.toThrow();
  });
});
