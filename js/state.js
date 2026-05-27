// Shared mutable state for all modules.
// Import getters/setters rather than accessing globals directly.

export const COLORS = [
  '#000000', '#ffffff', '#ff4444', '#ff8844', '#ffcc00', '#44cc44',
  '#2299ff', '#7744ff', '#cc44cc', '#ff66aa', '#88ddff', '#66ff99',
  '#ffdd88', '#aa8866', '#666666', '#bbbbbb',
];

export const POLLINATIONS_IMAGE = 'https://image.pollinations.ai/prompt/';
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
export const VEO_URL = 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning';
export const VEO_POLL_URL = 'https://generativelanguage.googleapis.com/v1beta/';
export const VEO_POLL_INTERVAL = 5000;
export const MAX_HISTORY = 30;

let canvas = null;
let ctx = null;
let drawing = false;
let currentColor = '#000000';
let currentTool = 'brush';
let brushSize = 8;
let history = [];
let fillPattern = 'solid';
let lastGeneratedPrompt = '';
let veoAbort = null;

export function getCanvas() { return canvas; }
export function setCanvas(c) { canvas = c; }

export function getCtx() { return ctx; }
export function setCtx(c) { ctx = c; }

export function getDrawing() { return drawing; }
export function setDrawing(d) { drawing = d; }

export function getCurrentColor() { return currentColor; }
export function setCurrentColor(c) { currentColor = c; }

export function getCurrentTool() { return currentTool; }
export function setCurrentTool(t) { currentTool = t; }

export function getBrushSize() { return brushSize; }
export function setBrushSize(s) { brushSize = s; }

export function getHistory() { return history; }
export function pushHistory(entry) {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(entry);
}
export function popHistory() { return history.pop(); }

export function getFillPattern() { return fillPattern; }
export function setFillPattern(p) { fillPattern = p; }

export function getLastGeneratedPrompt() { return lastGeneratedPrompt; }
export function setLastGeneratedPrompt(p) { lastGeneratedPrompt = p; }

export function getVeoAbort() { return veoAbort; }
export function setVeoAbort(a) { veoAbort = a; }
