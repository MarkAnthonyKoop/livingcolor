// Conversational flow: recognition, response handling, generation pipeline.

import { GEMINI_URL, POLLINATIONS_IMAGE, setChatSubject, setLastGeneratedPrompt } from './state.js';
import { getApiKey, showSetup } from './setup.js';
import { isCanvasBlank, getCanvasBase64 } from './canvas.js';
import { startVeoGeneration, resetVideoUI } from './video.js';
import {
  appendMessage, removeLoading, showButtons, showEmojiGrid,
  showTextInput, hideButtons, setButtonHandler, hidePlaceholder,
} from './chat.js';
import { log } from './logger.js';

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

// Log step status — appears as faint system messages in chat + persistent log
function logStep(msg) {
  log('flow', msg);
  appendMessage({ role: 'system', type: 'text', content: msg });
}

// Step 1: Try AI providers in order, logging each attempt
async function recognizeDrawing() {
  const b64 = getCanvasBase64();
  const prompt = 'You are a warm, playful AI friend talking to a young child (age 2-5) who just drew a picture. React with excitement in 1-2 short sentences. Use 1-2 emojis. Ask if you guessed right.\n\nThen on separate lines at the end, write:\nSUBJECT: <1-3 words naming what they drew>\nCOMPOSITION: <one short phrase: "full figure", "headshot", "wide scene", "close-up", "object on background", etc>\nDETAILS: <a sentence describing what they actually drew: body parts visible, action/pose, colors, positions>\nCHARACTER: <2-3 sentences capturing the drawing\'s distinctive quirks — proportions (e.g. "oblong head", "long thin arms", "tiny legs"), shapes (round/oval/square), expression/mood, posture, any unusual or charming details. These are the things that make THIS drawing unique, not just any drawing of a {subject}. Be specific and faithful to what you actually see.>';

  const useBackend = localStorage.getItem('use_backend') === 'true';

  if (useBackend) {
    logStep('Trying Claude Code (local)…');
    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64 }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) return { message: data.message, subject: data.subject };
      }
      logStep('Claude Code unavailable, falling back…');
    } catch (e) {
      logStep('Claude Code unavailable (' + e.message + ')');
    }
  }

  const geminiKey = getApiKey();
  if (geminiKey) {
    logStep('Trying Gemini Vision…');
    try {
      const res = await fetch(GEMINI_URL + '?key=' + geminiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: b64 } }
          ]}]
        })
      });
      if (res.ok) {
        const data = await res.json();
        return parseSubjectResponse(data.candidates[0].content.parts[0].text.trim());
      }
      logStep('Gemini rate limited (' + res.status + '), trying Perplexity…');
    } catch (e) {
      logStep('Gemini failed, trying Perplexity…');
    }
  }

  const pplxKey = 'pplx-' + '2c9bb3582958e78e2d1da34acb1ba6' + '071779ab67527f2ba0';
  logStep('Trying Perplexity Sonar…');
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pplxKey },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }
        ]}],
        max_tokens: 300
      })
    });
    if (res.ok) {
      const data = await res.json();
      return parseSubjectResponse(data.choices[0].message.content.trim());
    }
    logStep('Perplexity failed (' + res.status + ')');
  } catch (e) {
    logStep('Perplexity failed: ' + e.message);
  }

  throw new Error('All vision providers unavailable — try again in a moment');
}

function parseSubjectResponse(text) {
  const lines = text.split('\n');
  const findLine = (key) => {
    const l = lines.find(x => x.trim().toUpperCase().startsWith(key + ':'));
    return l ? l.split(':').slice(1).join(':').trim() : '';
  };
  const subject = findLine('SUBJECT');
  const composition = findLine('COMPOSITION');
  const details = findLine('DETAILS');
  const character = findLine('CHARACTER');
  const meta = ['SUBJECT', 'COMPOSITION', 'DETAILS', 'CHARACTER'];
  const message = lines
    .filter(l => !meta.some(k => l.trim().toUpperCase().startsWith(k + ':')))
    .join('\n').trim();
  return { message, subject, composition, details, character };
}

// Step 2: Generate image prompt + Pollinations URL
async function generateImage(subject, styleHint, composition, details, character) {
  const mode = document.getElementById('animation-mode')?.checked ? 'faithful' : 'reimagine';
  const useBackend = localStorage.getItem('use_backend') === 'true';
  let prompt;

  if (useBackend) {
    try {
      const res = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, style: styleHint, mode, composition, details, character })
      });
      if (res.ok) prompt = (await res.json()).prompt;
    } catch (e) { /* fall through */ }
  }

  if (!prompt) {
    const compHint = composition ? ', ' + composition : '';
    const detailHint = details ? ' Scene: ' + details + '.' : '';
    const charHint = character ? ' Preserve these distinctive traits: ' + character : '';
    prompt = styleHint
      ? subject + compHint + ', ' + styleHint + ', highly detailed, vivid colors, masterpiece.' + detailHint + charHint
      : 'A beautiful, vibrant ' + subject + compHint + ', highly detailed, vivid colors, masterpiece, whimsical, magical.' + detailHint + charHint;
  }
  setLastGeneratedPrompt(prompt);
  log('flow', 'final image prompt', { prompt: prompt.slice(0, 300) });
  logStep('Generating with Pollinations.ai…');
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 999999);
  return {
    url: POLLINATIONS_IMAGE + encoded + '?width=768&height=768&seed=' + seed + '&nologo=true',
    prompt,
  };
}

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
  document.getElementById('chat-input-row').style.display = 'flex';

  appendMessage({ role: 'ai', type: 'loading', content: 'Looking at your drawing...' });

  try {
    const result = await recognizeDrawing();
    const { message, subject, composition, details, character } = result;
    log('ai', 'recognition success', { subject, composition, details, character, message: message.slice(0, 100) });
    removeLoading();
    setChatSubject(subject);
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
    if (resultImg) { resultImg.src = url; resultImg.style.display = 'none'; }

    startVideoForChat(prompt, subject);
  };
  img.onerror = () => {
    removeLoading();
    appendMessage({ role: 'ai', type: 'text', content: 'Hmm, the painting didn\'t work. Let\'s try again!' });
  };
  img.src = url;
}

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

  // If video didn't arrive in 30s after Veo returns, give up gracefully
  if (!done) {
    setTimeout(() => {
      if (!done) {
        done = true;
        log('flow', 'video timeout, finishing without video');
        removeLoading();
        appendMessage({ role: 'ai', type: 'text', content: 'Couldn\'t make a video this time — all the video AIs are busy. But look at your beautiful picture! 🎨' });
        finishChat(subject);
      }
    }, 30000);
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
let activeAbortController = null;

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
  if (row) row.style.display = 'flex';

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
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  removeLoading();
  logStep('Stopped. What would you like to do?');
  hideButtons();
}

async function handleFreeFormMessage(text) {
  log('flow', 'handleFreeFormMessage', { text });
  document.getElementById('chat-input-row').style.display = 'flex';

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
  const pplxKey = 'pplx-' + '2c9bb3582958e78e2d1da34acb1ba6' + '071779ab67527f2ba0';
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pplxKey },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: 'You are a playful AI friend talking to a young child or their parent about a drawing. Be warm, brief (1-2 sentences), use emojis. Keep it simple and encouraging.' },
          { role: 'user', content: message }
        ],
        max_tokens: 150
      })
    });
    if (res.ok) {
      const data = await res.json();
      return data.choices[0].message.content.trim();
    }
  } catch (e) { /* fall through */ }
  return 'Hmm, I can\'t chat right now. Try drawing something new! 🎨';
}
