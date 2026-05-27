// API key management, setup overlay, settings gear.

import { GEMINI_URL } from './state.js';

// Obfuscated default key (XOR with app name)
const _p = [13,32,12,8,61,30,7,31,34,36,33,62,59,51,25,0,51,25,12,43,33,11,61,39,66,27,52,45,10,91,2,37,53,121,38,23,81,58,83];
const _s = 'LivingColor';

function _dk() {
  return _p.map((c, i) => String.fromCharCode(c ^ _s.charCodeAt(i % _s.length))).join('');
}

export function getApiKey() {
  return localStorage.getItem('gemini_key') || _dk();
}

export function setApiKey(key) {
  localStorage.setItem('gemini_key', key.trim());
}

export function showSetup(prefill) {
  const overlay = document.getElementById('setup-overlay');
  const input = document.getElementById('api-key-input');
  const errEl = document.getElementById('setup-error');
  overlay.style.display = 'flex';
  errEl.textContent = '';
  if (prefill) input.value = prefill;
  input.focus();
}

export function hideSetup() {
  document.getElementById('setup-overlay').style.display = 'none';
}

export function setupApiKey() {
  const saveBtn = document.getElementById('save-key-btn');
  const input = document.getElementById('api-key-input');
  const errEl = document.getElementById('setup-error');

  async function trySave() {
    const key = input.value.trim();
    if (!key) {
      errEl.textContent = 'Please paste your API key.';
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Validating...';
    errEl.textContent = '';

    try {
      const res = await fetch(GEMINI_URL + '?key=' + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say "ok"' }] }]
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body?.error?.message || 'Invalid API key (HTTP ' + res.status + ')';
        throw new Error(msg);
      }
      setApiKey(key);
      hideSetup();
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save & Start Drawing';
    }
  }

  saveBtn.addEventListener('click', trySave);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') trySave();
  });

  document.getElementById('settings-btn').addEventListener('click', () => {
    showSetup(getApiKey());
  });

  // Allow closing overlay by clicking backdrop (only if key already saved)
  document.getElementById('setup-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget && getApiKey()) hideSetup();
  });

  // Embedded key works out of the box -- only show setup if user wants custom key
}
