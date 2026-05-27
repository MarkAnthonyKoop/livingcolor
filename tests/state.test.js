import { describe, it, expect, beforeEach } from 'vitest';
import {
  COLORS, POLLINATIONS_IMAGE, GEMINI_URL, VEO_URL, MAX_HISTORY,
  getCanvas, setCanvas, getCtx, setCtx,
  getDrawing, setDrawing,
  getCurrentColor, setCurrentColor,
  getCurrentTool, setCurrentTool,
  getBrushSize, setBrushSize,
  getHistory, pushHistory, popHistory,
  getFillPattern, setFillPattern,
  getLastGeneratedPrompt, setLastGeneratedPrompt,
  getVeoAbort, setVeoAbort,
} from '../js/state.js';

describe('state constants', () => {
  it('has 16 colors', () => {
    expect(COLORS).toHaveLength(16);
    expect(COLORS[0]).toBe('#000000');
    expect(COLORS[1]).toBe('#ffffff');
  });

  it('has correct API URLs', () => {
    expect(POLLINATIONS_IMAGE).toContain('image.pollinations.ai');
    expect(GEMINI_URL).toContain('generativelanguage.googleapis.com');
    expect(VEO_URL).toContain('veo-3.1');
  });

  it('MAX_HISTORY is 30', () => {
    expect(MAX_HISTORY).toBe(30);
  });
});

describe('state getters/setters', () => {
  it('canvas get/set', () => {
    const mock = { width: 100 };
    setCanvas(mock);
    expect(getCanvas()).toBe(mock);
  });

  it('ctx get/set', () => {
    const mock = { fillRect: () => {} };
    setCtx(mock);
    expect(getCtx()).toBe(mock);
  });

  it('drawing get/set', () => {
    setDrawing(true);
    expect(getDrawing()).toBe(true);
    setDrawing(false);
    expect(getDrawing()).toBe(false);
  });

  it('currentColor defaults to black', () => {
    setCurrentColor('#000000');
    expect(getCurrentColor()).toBe('#000000');
    setCurrentColor('#ff0000');
    expect(getCurrentColor()).toBe('#ff0000');
  });

  it('currentTool defaults to brush', () => {
    setCurrentTool('brush');
    expect(getCurrentTool()).toBe('brush');
    setCurrentTool('eraser');
    expect(getCurrentTool()).toBe('eraser');
  });

  it('brushSize get/set', () => {
    setBrushSize(20);
    expect(getBrushSize()).toBe(20);
  });

  it('fillPattern get/set', () => {
    setFillPattern('rainbow');
    expect(getFillPattern()).toBe('rainbow');
    setFillPattern('solid');
  });

  it('lastGeneratedPrompt get/set', () => {
    setLastGeneratedPrompt('test prompt');
    expect(getLastGeneratedPrompt()).toBe('test prompt');
  });

  it('veoAbort get/set', () => {
    const ctrl = new AbortController();
    setVeoAbort(ctrl);
    expect(getVeoAbort()).toBe(ctrl);
    setVeoAbort(null);
  });
});

describe('history', () => {
  beforeEach(() => {
    while (getHistory().length > 0) popHistory();
  });

  it('push and pop', () => {
    pushHistory('state1');
    pushHistory('state2');
    expect(getHistory()).toHaveLength(2);
    expect(popHistory()).toBe('state2');
    expect(popHistory()).toBe('state1');
    expect(getHistory()).toHaveLength(0);
  });

  it('enforces MAX_HISTORY limit', () => {
    for (let i = 0; i < 35; i++) pushHistory(`state${i}`);
    expect(getHistory()).toHaveLength(MAX_HISTORY);
    expect(getHistory()[0]).toBe('state5');
  });

  it('popHistory on empty returns undefined', () => {
    expect(popHistory()).toBeUndefined();
  });
});
