// Thin orchestrator: imports all modules and calls init on DOMContentLoaded.

import { setCanvas, setCtx } from './state.js';
import { resizeCanvas, setupCanvas, setupKeyboard, saveState } from './canvas.js';
import { setupColors, setupTools, setupSuggestions } from './colors.js';
import { setupGenerate } from './generate.js';
import { setupApiKey } from './setup.js';

function init() {
  const canvas = document.getElementById('drawing-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  setCanvas(canvas);
  setCtx(ctx);

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  setupApiKey();
  setupColors();
  setupTools();
  setupCanvas();
  setupGenerate();
  setupKeyboard();
  setupSuggestions();

  saveState();
}

document.addEventListener('DOMContentLoaded', init);
