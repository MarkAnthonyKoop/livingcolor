// Generate flow: now routes through chat. Kept: download helpers.

import { startChatFlow } from './chat-flow.js';
import { show, hide, isShown } from './vis.js';

export function setStatus(msg, isError) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isError ? ' error' : '');
}

export async function generate() {
  const btn = document.getElementById('generate-btn');
  const btnText = btn.querySelector('.btn-text');
  const btnLoad = btn.querySelector('.btn-loading');
  btn.disabled = true;
  hide(btnText);
  show(btnLoad, 'inline');
  setStatus('');
  try {
    await startChatFlow();
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, true);
  }
  btn.disabled = false;
  show(btnText);
  hide(btnLoad);
}

export function downloadResult() {
  const video = document.getElementById('result-video');
  if (isShown(video) && video.src) {
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
