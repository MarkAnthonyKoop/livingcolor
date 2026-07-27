// Voice input via the browser's built-in speech recognition (Chrome/Safari).
// No external service from the page — the browser engine does the work.

import { log } from './logger.js';

export function micSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Wire a push-to-talk button to fill an input. Returns false when the
// browser has no recognizer (button gets hidden).
export function attachMic(button, input, onResult) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor || !button || !input) {
    if (button) button.style.display = 'none';
    return false;
  }
  let active = null;
  button.addEventListener('click', () => {
    if (active) { active.stop(); return; }
    const rec = new Ctor();
    rec.lang = document.documentElement.lang || 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    active = rec;
    button.classList.add('mic-live');
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript || '';
      log('mic', 'heard', { text });
      input.value = text;
      if (onResult) onResult(text);
    };
    rec.onerror = (e) => log('mic', 'error', { error: e.error });
    rec.onend = () => {
      active = null;
      button.classList.remove('mic-live');
    };
    try { rec.start(); } catch (e) { active = null; }
  });
  return true;
}
