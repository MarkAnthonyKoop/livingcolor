import { describe, it, expect, beforeEach } from 'vitest';
import { setCanvas, setCtx, getHistory, popHistory } from '../js/state.js';
import { getPos, saveState, clearCanvas } from '../js/canvas.js';

function createMockCanvas(cssW = 800, cssH = 600, pixW = 800, pixH = 600) {
  const canvas = document.createElement('canvas');
  canvas.width = pixW;
  canvas.height = pixH;

  const container = document.createElement('div');
  container.appendChild(canvas);
  document.body.appendChild(container);

  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: cssW, height: cssH });

  const ctx = canvas.getContext('2d');
  setCanvas(canvas);
  setCtx(ctx);
  return { canvas, ctx, container };
}

describe('getPos', () => {
  it('returns canvas coordinates from mouse event', () => {
    const { canvas } = createMockCanvas(800, 600, 800, 600);
    const pos = getPos({ clientX: 100, clientY: 50 });
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(50);
  });

  it('scales coordinates when CSS size differs from pixel buffer', () => {
    const { canvas } = createMockCanvas(400, 300, 800, 600);
    const pos = getPos({ clientX: 200, clientY: 150 });
    expect(pos.x).toBe(400);
    expect(pos.y).toBe(300);
  });

  it('accounts for canvas offset', () => {
    const { canvas } = createMockCanvas(800, 600, 800, 600);
    canvas.getBoundingClientRect = () => ({ left: 50, top: 100, width: 800, height: 600 });
    const pos = getPos({ clientX: 150, clientY: 200 });
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(100);
  });
});

describe('saveState', () => {
  beforeEach(() => {
    while (getHistory().length > 0) popHistory();
    createMockCanvas(100, 100, 100, 100);
  });

  it('pushes to history', () => {
    saveState();
    expect(getHistory().length).toBe(1);
  });

  it('history entry is a data URL string', () => {
    saveState();
    const entry = getHistory()[0];
    expect(typeof entry).toBe('string');
    expect(entry.startsWith('data:image/')).toBe(true);
  });

  it('multiple saves accumulate', () => {
    saveState();
    saveState();
    saveState();
    expect(getHistory().length).toBe(3);
  });
});

describe('clearCanvas', () => {
  it('fills canvas with white', () => {
    const { ctx } = createMockCanvas(100, 100, 100, 100);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 100, 100);

    clearCanvas();

    const pixel = ctx.getImageData(50, 50, 1, 1).data;
    expect(pixel[0]).toBe(255);
    expect(pixel[1]).toBe(255);
    expect(pixel[2]).toBe(255);
  });
});
