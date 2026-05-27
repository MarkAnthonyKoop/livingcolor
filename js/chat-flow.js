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

// Step 1: Send drawing for recognition (backend with Gemini→Perplexity fallback)
async function recognizeDrawing() {
  const b64 = getCanvasBase64();
  const res = await fetch('/api/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: b64 })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Recognition failed (' + res.status + ')');
  }
  const data = await res.json();
  return { message: data.message, subject: data.subject };
}

// Step 2: Generate image via backend prompt + Pollinations
async function generateImage(subject, styleHint) {
  let prompt;
  try {
    const mode = document.getElementById('animation-mode')?.checked ? 'faithful' : 'reimagine';
    const res = await fetch('/api/generate-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, style: styleHint, mode })
    });
    if (res.ok) {
      const data = await res.json();
      prompt = data.prompt;
    }
  } catch (e) { /* fallback below */ }

  if (!prompt) {
    prompt = styleHint
      ? subject + ', ' + styleHint + ', highly detailed, vivid colors, masterpiece'
      : 'A beautiful, vibrant ' + subject + ', highly detailed, vivid colors, masterpiece';
  }
  setLastGeneratedPrompt(prompt);
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
  appendMessage({ role: 'ai', type: 'text', content: 'Do you want to draw something new? 🖍️' });
  showButtons([
    { label: 'Draw again! 🎨', value: 'again', color: 'btn-green' },
  ]);
  setButtonHandler(() => { hideButtons(); });
}
