// Conversational flow: recognition, response handling, generation pipeline.

import { setChatSubject } from './state.js';
import { isCanvasBlank, getCanvasBase64 } from './canvas.js';
import { startVeoGeneration, resetVideoUI } from './video.js';
import {
  appendMessage, removeLoading, showButtons, showEmojiGrid,
  showTextInput, hideButtons, setButtonHandler, hidePlaceholder, logStep,
} from './chat.js';
import { recognizeDrawing, generateImage } from './providers.js';
import { applyLivingToLastImage, cancelAnimateFlow } from './animate-flow.js';
import { log } from './logger.js';
import { readStored } from './storage.js';
import { stopLiving } from './living.js';
import { stopRegionAnimation } from './regions.js';
import { playStory, stopStory } from './story.js';
import { show } from './vis.js';

const EMOJI_ITEMS = [
  { emoji: '🦋', label: 'butterfly' }, { emoji: '🐱', label: 'cat' },
  { emoji: '🏠', label: 'house' },     { emoji: '🌳', label: 'tree' },
  { emoji: '🌸', label: 'flower' },     { emoji: '🌅', label: 'sunset' },
  { emoji: '❤️', label: 'heart' },      { emoji: '⛰️', label: 'mountains' },
  { emoji: '🐉', label: 'dragon' },     { emoji: '🚗', label: 'car' },
  { emoji: '🐶', label: 'dog' },        { emoji: '🦄', label: 'unicorn' },
  { emoji: '⭐', label: 'star' },              { emoji: '🌈', label: 'rainbow' },
  { emoji: '🎂', label: 'cake' },       { emoji: '🚀', label: 'rocket' },
];

// Main entry point: start the conversational flow
export async function startChatFlow() {
  log('user', 'clicked Bring to Life');
  if (isCanvasBlank()) {
    log('flow', 'canvas blank, prompting user');
    appendMessage({ role: 'ai', type: 'text', content: 'Draw something first, then show me! I can\'t wait to see!' });
    return;
  }

  resetVideoUI();
  hidePlaceholder();
  hideButtons();
  show(document.getElementById('chat-input-row'), 'flex');

  appendMessage({ role: 'ai', type: 'loading', content: 'Looking at your drawing...' });

  try {
    const result = await recognizeDrawing();
    const { message, subject, composition, details, character } = result;
    log('ai', 'recognition success', { subject, composition, details, character, message: message.slice(0, 100) });
    removeLoading();
    setChatSubject(subject);
    window._lcSubject = subject;
    window._lcDrawingInfo = { composition, details, character };
    appendMessage({ role: 'ai', type: 'text', content: message });

    showButtons([
      { label: 'Yes! ✅', value: 'yes', color: 'btn-green' },
      { label: 'Hmm, not quite 🤔', value: 'not-quite', color: 'btn-orange' },
      { label: 'It\'s a...', value: 'type-it', color: 'btn-blue' },
    ]);

    setButtonHandler((value, label) => handleStep1Response(value, label, subject));
  } catch (err) {
    log('error', 'recognition failed', { error: err.message });
    removeLoading();
    appendMessage({ role: 'ai', type: 'text', content: 'Oops, I couldn\'t see your drawing! Try again?' });
    console.error(err);
  }
}

function handleStep1Response(value, label, guessedSubject) {
  hideButtons();
  appendMessage({ role: 'user', type: 'text', content: label });

  if (value === 'yes') {
    const subject = guessedSubject || 'drawing';
    setChatSubject(subject);
    appendMessage({ role: 'ai', type: 'text', content: 'Yay! I love your ' + subject + '! Let me make it come alive! ✨🎨' });
    startGeneration(subject);
  } else if (value === 'not-quite') {
    appendMessage({ role: 'ai', type: 'text', content: 'Oops! What is it? I want to see! 👀' });
    showEmojiGrid(EMOJI_ITEMS);
    setButtonHandler((val, display) => handleSubjectPicked(val, display));
  } else if (value === 'type-it') {
    appendMessage({ role: 'ai', type: 'text', content: 'Tell me what you drew! 👀' });
    showTextInput();
    setButtonHandler((val, display) => handleSubjectPicked(val, display));
  }
}

function handleSubjectPicked(subject, display) {
  hideButtons();
  appendMessage({ role: 'user', type: 'text', content: display });
  setChatSubject(subject);
  appendMessage({ role: 'ai', type: 'text', content: 'Oh, a ' + subject + '! Of course! It\'s beautiful! Let me bring it to life! ✨' });
  startGeneration(subject);
}

async function startGeneration(subject) {
  hideButtons();
  stopLiving();
  stopRegionAnimation();
  stopStory();
  appendMessage({ role: 'ai', type: 'loading', content: 'I\'m painting your ' + subject + '... 🎨' });

  const styleHint = document.getElementById('style-prompt').value.trim();
  const info = window._lcDrawingInfo || {};
  const { url, prompt } = await generateImage(subject, styleHint, info.composition, info.details, info.character);

  // Load the image
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.onload = () => {
    removeLoading();
    appendMessage({ role: 'ai', type: 'image', content: url, caption: 'Ta-da! ✨' });
    appendMessage({ role: 'ai', type: 'loading', content: 'Now let me make it move... 🎬' });

    // Store reference for video gen and download
    const resultImg = document.getElementById('result-image');
    if (resultImg) { resultImg.src = url; hide(resultImg); }

    archiveDrawing(subject, url, prompt);
    startVideoForChat(prompt, subject);
  };
  img.onerror = () => {
    removeLoading();
    appendMessage({ role: 'ai', type: 'text', content: 'Hmm, the painting didn\'t work. Let\'s try again!' });
  };
  img.src = url;
}

let videoFallbackTimer = null;

async function startVideoForChat(prompt, subject) {
  log('flow', 'starting video generation', { subject });
  let done = false;
  const onVideo = (videoSrc) => {
    if (done) return;
    done = true;
    log('ai', 'video ready');
    removeLoading();
    appendMessage({ role: 'ai', type: 'video', content: videoSrc, caption: 'Wow! Your ' + subject + ' is alive! 🌟' });
    finishChat(subject);
  };

  try {
    await startVeoGeneration(prompt, null, onVideo);
    log('flow', 'startVeoGeneration returned');
  } catch (e) {
    log('error', 'video gen exception', { error: e.message });
  }

  // If video didn't arrive in 30s, fall back to client-side "living" effect
  if (!done) {
    videoFallbackTimer = setTimeout(() => {
      videoFallbackTimer = null;
      if (!done) {
        done = true;
        log('flow', 'video timeout, applying living effect');
        removeLoading();
        appendMessage({ role: 'ai', type: 'text', content: 'Let me sprinkle some magic on it instead! ✨' });
        applyLivingToLastImage();
        finishChat(subject);
      }
    }, 30000);
  }
}

async function archiveDrawing(subject, aiImageUrl, prompt) {
  // Only when local backend is enabled
  if (readStored('use_backend') !== 'true') return;
  try {
    const info = window._lcDrawingInfo || {};
    const styleHint = document.getElementById('style-prompt')?.value.trim() || '';
    const mode = document.getElementById('animation-mode')?.checked ? 'faithful' : 'reimagine';
    const res = await fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drawing: getCanvasBase64(),
        ai_image_url: aiImageUrl,
        subject, prompt,
        composition: info.composition || '',
        details: info.details || '',
        character: info.character || '',
        mode, style: styleHint,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      log('archive', 'saved', { path: data.path, files: data.saved });
    }
  } catch (e) {
    log('archive', 'failed', { error: e.message });
  }
}

function finishChat(subject) {
  appendMessage({ role: 'ai', type: 'text', content: 'Do you want to draw something new? 🖍️ Or chat with me about your picture!' });
  showButtons([
    { label: 'Draw again! 🎨', value: 'again', color: 'btn-green' },
  ]);
  setButtonHandler(() => { hideButtons(); });
}

// Free-form chat input — visible after first interaction
export function initChatInput() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!input || !sendBtn) {
    log('init', 'chat input elements missing', { input: !!input, sendBtn: !!sendBtn });
    return;
  }
  log('init', 'chat input wired up');

  // Show the input row always so user can interact anytime
  const row = document.getElementById('chat-input-row');
  if (row) show(row, 'flex');

  function send() {
    const text = input.value.trim();
    if (!text) { log('user', 'empty send ignored'); return; }
    log('user', 'sent message', { text });
    input.value = '';
    appendMessage({ role: 'user', type: 'text', content: text });
    handleFreeFormMessage(text);
  }

  sendBtn.addEventListener('click', () => { log('user', 'clicked send button'); send(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); log('user', 'pressed Enter'); send(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      log('user', 'pressed Escape in input');
      abortCurrentWork();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement !== input) {
      log('user', 'pressed Escape (global)');
      abortCurrentWork();
    }
  });
}

function abortCurrentWork() {
  stopStory();            // also stops narration via stopSpeaking()
  cancelAnimateFlow();    // in-flight region/motion fetches won't apply
  stopRegionAnimation();
  stopLiving();
  if (videoFallbackTimer) {
    clearTimeout(videoFallbackTimer);
    videoFallbackTimer = null;
  }
  removeLoading();
  logStep('Stopped. What would you like to do?');
  hideButtons();
}

async function handleFreeFormMessage(text) {
  log('flow', 'handleFreeFormMessage', { text });
  show(document.getElementById('chat-input-row'), 'flex');

  const lower = text.toLowerCase();
  if (lower.includes('draw') && (lower.includes('again') || lower.includes('new'))) {
    log('flow', 'matched draw-again');
    appendMessage({ role: 'ai', type: 'text', content: 'Clear the canvas and draw something new! Then click Bring to Life! ✨' });
    return;
  }
  if (lower.includes('stop') || lower.includes('cancel')) {
    log('flow', 'matched stop/cancel');
    abortCurrentWork();
    return;
  }

  appendMessage({ role: 'ai', type: 'loading', content: '' });
  log('flow', 'calling chatWithAI');
  try {
    const reply = await chatWithAI(text);
    log('ai', 'chat reply', { reply: reply.slice(0, 100) });
    removeLoading();
    appendMessage({ role: 'ai', type: 'text', content: reply });
  } catch (e) {
    log('error', 'chatWithAI failed', { error: e.message });
    removeLoading();
    appendMessage({ role: 'ai', type: 'text', content: 'Sorry, I had trouble responding. Try again?' });
  }
}

async function chatWithAI(message) {
  // Server-side Claude (no browser API key). Runs on the user's subscription.
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.reply) return data.reply.trim();
    }
  } catch (e) { /* fall through */ }
  return 'Hmm, I can\'t chat right now. Try drawing something new! 🎨';
}
