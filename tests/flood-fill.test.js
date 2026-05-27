import { describe, it, expect, beforeEach } from 'vitest';
import { setCanvas, setCtx, setCurrentColor, setFillPattern } from '../js/state.js';
import { floodFill } from '../js/fill.js';

function setupCanvas(w = 100, h = 100) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  setCanvas(canvas);
  setCtx(ctx);
  return { canvas, ctx };
}

function getPixel(ctx, x, y) {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

describe('floodFill', () => {
  beforeEach(() => {
    setFillPattern('solid');
    setCurrentColor('#ff0000');
  });

  it('fills a white canvas with the selected color', () => {
    const { ctx } = setupCanvas(50, 50);
    floodFill(25, 25);
    const [r, g, b] = getPixel(ctx, 25, 25);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('fills entire white canvas when no boundaries', () => {
    const { ctx } = setupCanvas(20, 20);
    floodFill(10, 10);
    const corner = getPixel(ctx, 0, 0);
    expect(corner[0]).toBe(255);
    expect(corner[1]).toBe(0);
  });

  it('respects boundaries drawn in black', () => {
    const { ctx } = setupCanvas(50, 50);

    ctx.fillStyle = '#000000';
    ctx.fillRect(20, 0, 3, 50);

    setCurrentColor('#00ff00');
    floodFill(5, 25);

    const leftSide = getPixel(ctx, 5, 25);
    expect(leftSide[0]).toBe(0);
    expect(leftSide[1]).toBe(255);

    const rightSide = getPixel(ctx, 40, 25);
    expect(rightSide[0]).toBe(255);
    expect(rightSide[1]).toBe(255);
    expect(rightSide[2]).toBe(255);
  });

  it('does not fill when clicking same color', () => {
    const { ctx } = setupCanvas(20, 20);
    setCurrentColor('#ffffff');
    floodFill(10, 10);
    const p = getPixel(ctx, 10, 10);
    expect(p[0]).toBe(255);
    expect(p[1]).toBe(255);
    expect(p[2]).toBe(255);
  });

  it('fills with rainbow pattern', () => {
    const { ctx } = setupCanvas(50, 50);
    setFillPattern('rainbow');
    floodFill(25, 25);
    const p1 = getPixel(ctx, 0, 0);
    const p2 = getPixel(ctx, 25, 25);
    expect(p1[0] !== p2[0] || p1[1] !== p2[1] || p1[2] !== p2[2]).toBe(true);
  });

  it('handles edge coordinates', () => {
    const { ctx } = setupCanvas(10, 10);
    setCurrentColor('#0000ff');
    floodFill(0, 0);
    const p = getPixel(ctx, 0, 0);
    expect(p[2]).toBe(255);
  });

  it('fills enclosed region without leaking', () => {
    const { ctx } = setupCanvas(50, 50);

    ctx.fillStyle = '#000000';
    ctx.fillRect(10, 10, 30, 2);
    ctx.fillRect(10, 38, 30, 2);
    ctx.fillRect(10, 10, 2, 30);
    ctx.fillRect(38, 10, 2, 30);

    setCurrentColor('#ff0000');
    floodFill(25, 25);

    const inside = getPixel(ctx, 25, 25);
    expect(inside[0]).toBe(255);

    const outside = getPixel(ctx, 5, 5);
    expect(outside[0]).toBe(255);
    expect(outside[1]).toBe(255);
    expect(outside[2]).toBe(255);
  });
});
