const COLORS = [
  '#000000', '#ffffff', '#ff4444', '#ff8844', '#ffcc00', '#44cc44',
  '#2299ff', '#7744ff', '#cc44cc', '#ff66aa', '#88ddff', '#66ff99',
  '#ffdd88', '#aa8866', '#666666', '#bbbbbb',
];

const POLLINATIONS_IMAGE = 'https://image.pollinations.ai/prompt/';

let canvas, ctx;
let drawing = false;
let currentColor = '#000000';
let currentTool = 'brush';
let brushSize = 8;
let history = [];
const MAX_HISTORY = 30;

function init() {
  canvas = document.getElementById('drawing-canvas');
  ctx = canvas.getContext('2d', { willReadFrequently: true });

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  setupColors();
  setupTools();
  setupCanvas();
  setupGenerate();
  setupKeyboard();

  saveState();
}

function resizeCanvas() {
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const prevData = ctx ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;

  canvas.width = rect.width;
  canvas.height = rect.height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (prevData) {
    ctx.putImageData(prevData, 0, 0);
  }
}

function setupColors() {
  const container = document.getElementById('color-swatches');
  COLORS.forEach(color => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch' + (color === currentColor ? ' active' : '');
    swatch.style.background = color;
    if (color === '#ffffff') swatch.style.border = '2px solid #ccc';
    swatch.addEventListener('click', () => selectColor(color, swatch));
    container.appendChild(swatch);
  });

  const customInput = document.getElementById('custom-color');
  customInput.addEventListener('input', (e) => selectColor(e.target.value, null));
}

function selectColor(color, swatch) {
  currentColor = color;
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
  if (swatch) swatch.classList.add('active');
  if (currentTool === 'eraser') selectTool('brush');
}

function setupTools() {
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });

  const sizeInput = document.getElementById('brush-size');
  const sizeDisplay = document.getElementById('size-display');
  sizeInput.addEventListener('input', () => {
    brushSize = parseInt(sizeInput.value);
    sizeDisplay.textContent = brushSize;
  });

  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('clear-btn').addEventListener('click', clearCanvas);
}

function selectTool(tool) {
  if (tool === 'fill') {
    fillCanvas();
    return;
  }
  currentTool = tool;
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
}

function fillCanvas() {
  saveState();
  ctx.fillStyle = currentColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setupCanvas() {
  canvas.addEventListener('pointerdown', startDraw);
  canvas.addEventListener('pointermove', draw);
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointerleave', endDraw);
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startDraw(e) {
  drawing = true;
  saveState();
  const pos = getPos(e);
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
  ctx.lineTo(pos.x, pos.y);
  applyStroke();
  ctx.stroke();
}

function draw(e) {
  if (!drawing) return;
  const pos = getPos(e);
  ctx.lineTo(pos.x, pos.y);
  applyStroke();
  ctx.stroke();
}

function applyStroke() {
  ctx.lineWidth = brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = currentTool === 'eraser' ? '#ffffff' : currentColor;
}

function endDraw() {
  if (!drawing) return;
  drawing = false;
  ctx.beginPath();
}

function saveState() {
  if (history.length >= MAX_HISTORY) history.shift();
  history.push(canvas.toDataURL());
}

function undo() {
  if (history.length === 0) return;
  const prev = history.pop();
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  };
  img.src = prev;
}

function clearCanvas() {
  saveState();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      undo();
    }
  });
}

function setupGenerate() {
  document.getElementById('generate-btn').addEventListener('click', generate);
  document.getElementById('download-btn')?.addEventListener('click', downloadResult);
  document.getElementById('retry-btn')?.addEventListener('click', generate);
}

function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

function setLoading(on) {
  const btn = document.getElementById('generate-btn');
  btn.disabled = on;
  btn.querySelector('.btn-text').style.display = on ? 'none' : '';
  btn.querySelector('.btn-loading').style.display = on ? 'inline' : 'none';
}

function analyzeCanvasColors() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const colorCounts = {};
  const step = 8;
  for (let i = 0; i < imageData.length; i += 4 * step) {
    const r = imageData[i], g = imageData[i + 1], b = imageData[i + 2];
    if (r > 240 && g > 240 && b > 240) continue;
    const bucket = [Math.round(r / 32) * 32, Math.round(g / 32) * 32, Math.round(b / 32) * 32].join(',');
    colorCounts[bucket] = (colorCounts[bucket] || 0) + 1;
  }
  const sorted = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
  const names = sorted.slice(0, 5).map(([rgb]) => {
    const [r, g, b] = rgb.split(',').map(Number);
    return closestColorName(r, g, b);
  });
  return [...new Set(names)];
}

function closestColorName(r, g, b) {
  const map = [
    [0, 0, 0, 'black'], [255, 0, 0, 'red'], [0, 255, 0, 'green'],
    [0, 0, 255, 'blue'], [255, 255, 0, 'yellow'], [255, 128, 0, 'orange'],
    [128, 0, 255, 'purple'], [255, 0, 255, 'pink'], [0, 255, 255, 'cyan'],
    [128, 64, 0, 'brown'], [128, 128, 128, 'gray'],
  ];
  let best = 'colorful', bestDist = Infinity;
  for (const [cr, cg, cb, name] of map) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestDist) { bestDist = d; best = name; }
  }
  return best;
}

function buildPrompt(description) {
  const colors = analyzeCanvasColors();
  let prompt = description;
  if (colors.length > 0) {
    prompt += ', featuring ' + colors.join(' and ') + ' tones';
  }
  prompt += ', highly detailed, professional quality, vivid colors, beautiful lighting';
  return prompt;
}

async function generate() {
  const description = document.getElementById('style-prompt').value.trim();
  if (!description) {
    setStatus('Please describe what you drew — e.g. "a cat on a roof" or "sunset over mountains"', true);
    document.getElementById('style-prompt').focus();
    return;
  }

  setLoading(true);
  setStatus('Generating your image...');

  const prompt = buildPrompt(description);
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 999999);
  const url = POLLINATIONS_IMAGE + encoded + '?width=768&height=768&seed=' + seed + '&nologo=true';

  const resultImg = document.getElementById('result-image');
  const placeholder = document.getElementById('result-placeholder');
  const actions = document.getElementById('result-actions');

  resultImg.onload = () => {
    setLoading(false);
    setStatus('');
    placeholder.style.display = 'none';
    resultImg.style.display = 'block';
    actions.style.display = 'flex';
  };
  resultImg.onerror = () => {
    setLoading(false);
    setStatus('Image generation failed — try a different description or try again in a moment', true);
  };
  resultImg.src = url;
}

function downloadResult() {
  const img = document.getElementById('result-image');
  if (!img.src) return;
  window.open(img.src, '_blank');
}

document.addEventListener('DOMContentLoaded', init);
