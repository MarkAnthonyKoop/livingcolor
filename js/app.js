// Thin orchestrator: imports all modules and calls init on DOMContentLoaded.

import { setCanvas, setCtx } from './state.js';
import { resizeCanvas, setupCanvas, setupKeyboard, saveState } from './canvas.js';
import { setupColors, setupTools, setupSuggestions } from './colors.js';
import { setupGenerate } from './generate.js';
import { setupApiKey } from './setup.js';
import { initChatUI } from './chat.js';
import { initChatInput } from './chat-flow.js';
import { initWorkshop, wireWorkshopButtons } from './workshop.js';
import { downloadLog, log } from './logger.js';

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
  initChatUI();
  initChatInput();
  initWorkshop();
  wireWorkshopButtons();

  document.getElementById('download-log-btn')?.addEventListener('click', downloadLog);
  log('init', 'app initialized');

  saveState();
}

document.addEventListener('DOMContentLoaded', init);
