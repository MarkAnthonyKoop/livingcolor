import { describe, it, expect } from 'vitest';
import { hslToRgb } from '../js/fill.js';

describe('hslToRgb', () => {
  it('converts red (0, 100, 50)', () => {
    const [r, g, b] = hslToRgb(0, 100, 50);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('converts green (120, 100, 50)', () => {
    const [r, g, b] = hslToRgb(120, 100, 50);
    expect(r).toBe(0);
    expect(g).toBe(255);
    expect(b).toBe(0);
  });

  it('converts blue (240, 100, 50)', () => {
    const [r, g, b] = hslToRgb(240, 100, 50);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(255);
  });

  it('converts white (0, 0, 100)', () => {
    const [r, g, b] = hslToRgb(0, 0, 100);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  it('converts black (0, 0, 0)', () => {
    const [r, g, b] = hslToRgb(0, 0, 0);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('returns integers', () => {
    const [r, g, b] = hslToRgb(45, 80, 60);
    expect(Number.isInteger(r)).toBe(true);
    expect(Number.isInteger(g)).toBe(true);
    expect(Number.isInteger(b)).toBe(true);
  });

  it('values are in 0-255 range', () => {
    for (let h = 0; h < 360; h += 30) {
      const [r, g, b] = hslToRgb(h, 100, 50);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });
});
