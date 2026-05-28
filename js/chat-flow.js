// Conversational flow: recognition, response handling, generation pipeline.

import { GEMINI_URL, POLLINATIONS_IMAGE, setChatSubject, setLastGeneratedPrompt } from './state.js';
import { getApiKey, showSetup } from './setup.js';
import { isCanvasBlank, getCanvasBase64 } from './canvas.js';
import { startVeoGeneration, resetVideoUI } from './video.js';
import {
  appendMessage, removeLoading, showButtons, showEmojiGrid,
  showTextInput, hideButtons, setButtonHandler, hidePlaceholder,
} from './chat.js';

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

// Log step status — appears as faint system messages in chat
function logStep(msg) {
  appendMessage({ role: 'system', type: 'text', content: msg });
}

// Step 1: Try AI providers in order, logging each attempt
async function recognizeDrawing() {
  const b64 = getCanvasBase64();
  const prompt = 'You are a warm, playful AI friend talking to a young child (age 2-5) who just drew a picture. React with excitement in 1-2 short sentences. Use 1-2 emojis. Ask if you guessed right. On the last line write SUBJECT: followed by 1-3 word name.';

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
  const subjectLine = lines.find(l => l.trim().toUpperCase().startsWith('SUBJECT:'));
  const subject = subjectLine ? subjectLine.split(':')[1].trim() : '';
  const message = lines.filter(l => !l.trim().toUpperCase().startsWith('SUBJECT:')).join('\n').trim();
  return { message, subject };
}

// Step 2: Generate image prompt + Pollinations URL
async function generateImage(subject, styleHint) {
  const mode = document.getElementById('animation-mode')?.checked ? 'faithful' : 'reimagine';
  const useBackend = localStorage.getItem('use_backend') === 'true';
  let prompt;

  if (useBackend) {
    try {
      const res = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, style: styleHint, mode })
      });
      if (res.ok) prompt = (await res.json()).prompt;
    } catch (e) { /* fall through */ }
  }

  if (!prompt) {
    prompt = styleHint
      ? subject + ', ' + styleHint + ', highly detailed, vivid colors, masterpiece'
      : 'A beautiful, vibrant ' + subject + ', highly detailed, vivid colors, masterpiece, whimsical, magical';
  }
  setLastGeneratedPrompt(prompt);
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
  if (isCanvasBlank()) {
    appendMessage({ role: 'ai', type: 'text', content: 'Draw something first, then show me! I can\'t wait to see!' });
    return;
  }

  resetVideoUI();
  hidePlaceholder();
  hideButtons();
  document.getElementById('chat-input-row').style.display = 'flex';

  appendMessage({ role: 'ai', type: 'loading', content: 'Looking at your drawing...' });

  try {
    const { message, subject } = await recognizeDrawing();
    removeLoading();
    setChatSubject(subject);
    appendMessage({ role: 'ai', type: 'text', content: message });

    showButtons([
      { label: 'Yes! ✅', value: 'yes', color: 'btn-green' },
      { label: 'Hmm, not quite 🤔', value: 'not-quite', color: 'btn-orange' },
      { label: 'It\'s a...', value: 'type-it', color: 'btn-blue' },
    ]);

    setButtonHandler((value, label) => handleStep1Response(value, label, subject));
  } catch (err) {
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
  const { url, prompt } = await generateImage(subject, styleHint);

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
  let done = false;
  const onVideo = (videoSrc) => {
    if (done) return;
    done = true;
    removeLoading();
    appendMessage({ role: 'ai', type: 'video', content: videoSrc, caption: 'Wow! Your ' + subject + ' is alive! 🌟' });
    finishChat(subject);
  };

  try {
    await startVeoGeneration(prompt, null, onVideo);
  } catch (e) {
    console.error('Video gen error:', e);
  }

  // Veo/poll finished (or errored). If callback hasn't fired yet, LTX fallback
  // may still be running. Don't block -- just wait a bit then finish gracefully.
  if (!done) {
    setTimeout(() => {
      if (!done) { done = true; removeLoading(); finishChat(subject); }
    }, 120000);
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
  if (!input || !sendBtn) return;

  function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    appendMessage({ role: 'user', type: 'text', content: text });
    handleFreeFormMessage(text);
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      abortCurrentWork();
    }
  });

  // Global ESC to abort
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.activeElement !== input) {
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
  // Show input row if not already
  document.getElementById('chat-input-row').style.display = 'flex';

  const lower = text.toLowerCase();
  if (lower.includes('draw') && (lower.includes('again') || lower.includes('new'))) {
    appendMessage({ role: 'ai', type: 'text', content: 'Clear the canvas and draw something new! Then click Bring to Life! ✨' });
    return;
  }
  if (lower.includes('stop') || lower.includes('cancel')) {
    abortCurrentWork();
    return;
  }

  // Otherwise, send to AI for conversational response
  appendMessage({ role: 'ai', type: 'loading', content: '' });
  const reply = await chatWithAI(text);
  removeLoading();
  appendMessage({ role: 'ai', type: 'text', content: reply });
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
