// Color swatches, custom color picker, tool selection, suggestion chips.

import {
  COLORS, getCurrentColor, setCurrentColor,
  getCurrentTool, setCurrentTool, setBrushSize, setFillPattern,
} from './state.js';
import { undo, clearCanvas } from './canvas.js';

export function selectTool(tool) {
  setCurrentTool(tool);
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  const canvas = document.getElementById('drawing-canvas');
  canvas.style.cursor = tool === 'fill' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'crosshair';
  document.getElementById('pattern-picker').style.display = tool === 'fill' ? 'flex' : 'none';
}

export function selectColor(color, swatch) {
  setCurrentColor(color);
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
  if (swatch) swatch.classList.add('active');
  if (getCurrentTool() === 'eraser') selectTool('brush');
}

export function setupColors() {
  const container = document.getElementById('color-swatches');
  COLORS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch' + (color === getCurrentColor() ? ' active' : '');
    swatch.style.background = color;
    if (color === '#ffffff') swatch.style.border = '2px solid #ccc';
    swatch.addEventListener('click', () => selectColor(color, swatch));
    container.appendChild(swatch);
  });

  const customInput = document.getElementById('custom-color');
  customInput.addEventListener('input', (e) => selectColor(e.target.value, null));
}

export function setupTools() {
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });

  const sizeInput = document.getElementById('brush-size');
  const sizeDisplay = document.getElementById('size-display');
  sizeInput.addEventListener('input', () => {
    const size = parseInt(sizeInput.value);
    setBrushSize(size);
    sizeDisplay.textContent = size;
  });

  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('clear-btn').addEventListener('click', clearCanvas);

  document.querySelectorAll('.pattern-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setFillPattern(btn.dataset.pattern);
      document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

export function setupSuggestions() {
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('style-prompt');
      input.value = btn.dataset.prompt;
      input.classList.add('pulse');
      setTimeout(() => input.classList.remove('pulse'), 400);
    });
  });
}
