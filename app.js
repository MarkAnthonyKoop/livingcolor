const COLORS = [
  '#000000', '#ffffff', '#ff4444', '#ff8844', '#ffcc00', '#44cc44',
  '#2299ff', '#7744ff', '#cc44cc', '#ff66aa', '#88ddff', '#66ff99',
  '#ffdd88', '#aa8866', '#666666', '#bbbbbb',
];

const POLLINATIONS_IMAGE = 'https://image.pollinations.ai/prompt/';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_KEY = 'AIzaSyC1CgTurH_IOd4TrnzPIVpmWn3f7Rh37Cw';

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
  setupSuggestions();

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

function setupSuggestions() {
  document.querySelectorAll('.suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('style-prompt');
      input.value = btn.dataset.prompt;
      input.classList.add('pulse');
      setTimeout(() => input.classList.remove('pulse'), 400);
    });
  });
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

function isCanvasBlank() {
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = 16;
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) return false;
  }
  return true;
}

function getCanvasBase64() {
  const tmp = document.createElement('canvas');
  tmp.width = 512;
  tmp.height = 512;
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#ffffff';
  tctx.fillRect(0, 0, 512, 512);
  tctx.drawImage(canvas, 0, 0, 512, 512);
  return tmp.toDataURL('image/jpeg', 0.8).split(',')[1];
}

async function analyzeDrawing(styleHint) {
  const b64 = getCanvasBase64();
  const systemPrompt = styleHint
    ? 'Describe this hand drawing for an image generator. The user wants it in this style: "' + styleHint + '". Write a vivid 2-3 sentence image generation prompt describing a polished version. Output ONLY the prompt.'
    : 'Describe this hand drawing for an image generator. Write a vivid 2-3 sentence image generation prompt that brings this sketch to life as a polished, detailed artwork. Mention subject, composition, colors, lighting, and mood. Output ONLY the prompt.';

  const res = await fetch(GEMINI_URL + '?key=' + GEMINI_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: systemPrompt },
          { inline_data: { mime_type: 'image/jpeg', data: b64 } }
        ]
      }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error('Vision API error (' + res.status + ')');
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

function captureSketch() {
  const overlay = document.getElementById('sketch-overlay');
  const container = document.getElementById('morph-container');
  const rect = container.getBoundingClientRect();
  overlay.width = rect.width;
  overlay.height = rect.height;
  const octx = overlay.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, overlay.width, overlay.height);
  octx.drawImage(canvas, 0, 0, overlay.width, overlay.height);
  overlay.style.opacity = '1';
}

function playMorph() {
  const overlay = document.getElementById('sketch-overlay');
  const w = overlay.width, h = overlay.height;
  const octx = overlay.getContext('2d');

  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = w;
  snapCanvas.height = h;
  snapCanvas.getContext('2d').drawImage(overlay, 0, 0);

  const snapData = snapCanvas.getContext('2d').getImageData(0, 0, w, h).data;

  const tileSize = 8;
  const cols = Math.ceil(w / tileSize), rows = Math.ceil(h / tileSize);
  const cx = w / 2, cy = h / 2;
  const tiles = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = c * tileSize, ty = r * tileSize;
      let hasDark = false;
      for (let py = ty; py < Math.min(ty + tileSize, h) && !hasDark; py++) {
        for (let px = tx; px < Math.min(tx + tileSize, w) && !hasDark; px++) {
          const i = (py * w + px) * 4;
          if (snapData[i] < 200 || snapData[i+1] < 200 || snapData[i+2] < 200) hasDark = true;
        }
      }
      if (!hasDark) continue;

      const dist = Math.hypot(tx - cx, ty - cy);
      tiles.push({
        x: tx, y: ty,
        vx: (tx - cx) * 0.03 + (Math.random() - 0.5) * 3,
        vy: (ty - cy) * 0.03 + (Math.random() - 0.5) * 3 - 1,
        rot: 0,
        vr: (Math.random() - 0.5) * 0.15,
        delay: dist * 0.05 + Math.random() * 10,
      });
    }
  }

  octx.clearRect(0, 0, w, h);

  let frame = 0;
  const duration = 120;

  function animate() {
    frame++;
    octx.clearRect(0, 0, w, h);
    let alive = false;

    for (const t of tiles) {
      if (frame < t.delay) {
        octx.drawImage(snapCanvas, t.x, t.y, tileSize, tileSize, t.x, t.y, tileSize, tileSize);
        alive = true;
        continue;
      }
      const age = frame - t.delay;
      const lifespan = Math.max(20, duration - t.delay);
      const p = Math.min(1, age / lifespan);
      if (p >= 1) continue;

      alive = true;
      const dx = t.vx * age * 0.5;
      const dy = t.vy * age * 0.5 + age * age * 0.01;
      t.rot += t.vr;
      const scale = 1 + p * 0.3;

      octx.save();
      octx.globalAlpha = Math.max(0, 1 - p * p * p);
      octx.translate(t.x + tileSize / 2 + dx, t.y + tileSize / 2 + dy);
      octx.rotate(t.rot);
      octx.scale(scale, scale);
      octx.drawImage(snapCanvas, t.x, t.y, tileSize, tileSize, -tileSize / 2, -tileSize / 2, tileSize, tileSize);
      octx.restore();
    }

    if (alive) requestAnimationFrame(animate);
    else overlay.style.opacity = '0';
  }

  requestAnimationFrame(animate);
}

async function generate() {
  if (isCanvasBlank()) {
    setStatus('Draw something first, then click Bring to Life!', true);
    return;
  }

  setLoading(true);
  const styleHint = document.getElementById('style-prompt').value.trim();
  setStatus('AI is analyzing your drawing...');

  try {
    const prompt = await analyzeDrawing(styleHint);
    setStatus('Generating: ' + prompt.slice(0, 60) + '...');
    loadResultImage(prompt);
  } catch (err) {
    console.error(err);
    setLoading(false);
    setStatus('Error: ' + err.message, true);
  }
}

function loadResultImage(prompt) {
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 999999);
  const url = POLLINATIONS_IMAGE + encoded + '?width=768&height=768&seed=' + seed + '&nologo=true';

  const resultImg = document.getElementById('result-image');
  const placeholder = document.getElementById('result-placeholder');
  const morphContainer = document.getElementById('morph-container');
  const actions = document.getElementById('result-actions');

  captureSketch();

  resultImg.onload = () => {
    setLoading(false);
    setStatus('');
    placeholder.style.display = 'none';
    morphContainer.style.display = 'flex';
    actions.style.display = 'flex';
    setTimeout(playMorph, 300);
  };
  resultImg.onerror = () => {
    setLoading(false);
    setStatus('Image generation failed — try again in a moment', true);
  };
  resultImg.src = url;
}

function downloadResult() {
  const img = document.getElementById('result-image');
  if (!img.src) return;
  window.open(img.src, '_blank');
}

document.addEventListener('DOMContentLoaded', init);
