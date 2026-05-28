// Text-to-speech for AI chat bubbles.
// Strips emoji, calls /api/speak, plays the returned MP3.
// User can toggle off via localStorage('voice_off').

import { log } from './logger.js';

let currentAudio = null;

export function isVoiceEnabled() {
  return localStorage.getItem('voice_off') !== 'true';
}

export function setVoiceEnabled(enabled) {
  if (enabled) localStorage.removeItem('voice_off');
  else localStorage.setItem('voice_off', 'true');
}

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}

function stripForSpeech(text) {
  // Remove emoji + markdown asterisks, collapse whitespace
  return text
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250);
}

export async function speak(text) {
  if (!isVoiceEnabled()) return;
  const clean = stripForSpeech(text);
  if (clean.length < 2) return;

  stopSpeaking();

  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      log('voice', 'speak failed', { status: res.status });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    audio.addEventListener('ended', () => URL.revokeObjectURL(url));
    await audio.play();
    log('voice', 'speaking', { len: clean.length });
  } catch (e) {
    log('voice', 'error', { error: e.message });
  }
}
