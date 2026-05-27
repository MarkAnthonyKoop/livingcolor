// Generate flow: analyzeDrawing, loadResultImage, download helpers.

import {
  GEMINI_URL, POLLINATIONS_IMAGE,
  setLastGeneratedPrompt,
} from './state.js';
import { isCanvasBlank, getCanvasBase64 } from './canvas.js';
import { getApiKey, showSetup } from './setup.js';
import { startVeoGeneration, loadStoryboardImages, resetVideoUI } from './video.js';
import { captureSketch, playMorph } from './morph.js';

export function setStatus(msg, isError) {
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

async function analyzeDrawing(styleHint) {
  const key = getApiKey();
  if (!key) {
    showSetup();
    throw new Error('API key required -- please enter your Gemini key.');
  }

  const b64 = getCanvasBase64();
  const systemPrompt = styleHint
    ? 'Describe this hand drawing for an image generator. The user wants it in this style: "' + styleHint + '". Write a vivid 2-3 sentence image generation prompt describing a polished version. Output ONLY the prompt.'
    : 'Describe this hand drawing for an image generator. Write a vivid 2-3 sentence image generation prompt that brings this sketch to life as a polished, detailed artwork. Mention subject, composition, colors, lighting, and mood. Output ONLY the prompt.';

  const res = await fetch(GEMINI_URL + '?key=' + key, {
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
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('gemini_key');
      showSetup();
      throw new Error('API key rejected -- please enter a valid key.');
    }
    if (res.status === 429 || res.status === 503) {
      return null;
    }
    throw new Error('Vision API error (' + res.status + ')');
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

function loadResultImage(prompt) {
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 999999);
  const url = POLLINATIONS_IMAGE + encoded + '?width=768&height=768&seed=' + seed + '&nologo=true';

  const resultImg = document.getElementById('result-image');
  const resultVideo = document.getElementById('result-video');
  const placeholder = document.getElementById('result-placeholder');
  const morphContainer = document.getElementById('morph-container');
  const actions = document.getElementById('result-actions');

  resultImg.style.display = '';
  resultVideo.style.display = 'none';
  resultVideo.src = '';

  captureSketch();

  resultImg.onload = () => {
    setLoading(false);
    setStatus('');
    placeholder.style.display = 'none';
    morphContainer.style.display = 'flex';
    actions.style.display = 'flex';
    setTimeout(playMorph, 300);

    loadStoryboardImages(null, prompt);
    startVeoGeneration(prompt, resultImg);
  };
  resultImg.onerror = () => {
    setLoading(false);
    setStatus('Image generation failed -- try again in a moment', true);
  };
  resultImg.src = url;
}

export async function generate() {
  if (isCanvasBlank()) {
    setStatus('Draw something first, then click Bring to Life!', true);
    return;
  }

  const { getVeoAbort, setVeoAbort } = await import('./state.js');
  const abort = getVeoAbort();
  if (abort) { abort.abort(); setVeoAbort(null); }

  resetVideoUI();

  setLoading(true);
  const styleHint = document.getElementById('style-prompt').value.trim();
  setStatus('AI is analyzing your drawing...');

  try {
    let prompt = await analyzeDrawing(styleHint);
    if (!prompt) {
      const fallback = styleHint || 'a vibrant creative artwork, imaginative scene';
      setStatus('AI vision busy -- generating from description...');
      prompt = fallback + ', highly detailed, professional quality, vivid colors, beautiful lighting, masterpiece';
    }
    setLastGeneratedPrompt(prompt);
    setStatus('Generating: ' + prompt.slice(0, 60) + '...');
    loadResultImage(prompt);
  } catch (err) {
    console.error(err);
    setLoading(false);
    setStatus('Error: ' + err.message, true);
  }
}

export function downloadResult() {
  const video = document.getElementById('result-video');
  if (video.style.display !== 'none' && video.src) {
    downloadVideoResult();
    return;
  }
  const img = document.getElementById('result-image');
  if (!img.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = 'livingcolor-' + Date.now() + '.jpg';
  a.target = '_blank';
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadVideoResult() {
  const video = document.getElementById('result-video');
  if (!video.src) return;
  const a = document.createElement('a');
  a.href = video.src;
  a.download = 'livingcolor-video.mp4';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function setupGenerate() {
  document.getElementById('generate-btn').addEventListener('click', generate);
  document.getElementById('download-btn')?.addEventListener('click', downloadResult);
  document.getElementById('download-video-btn')?.addEventListener('click', downloadVideoResult);
  document.getElementById('retry-btn')?.addEventListener('click', generate);
}
