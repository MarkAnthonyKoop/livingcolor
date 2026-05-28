// Chat panel UI: rendering messages, scrolling, button creation.

import { getChatMessages, addChatMessage } from './state.js';
import { speak } from './voice.js';

let chatContainer = null;
let chatButtons = null;
let onButtonClick = null;

export function initChatUI() {
  chatContainer = document.getElementById('chat-messages');
  chatButtons = document.getElementById('chat-buttons');
}

export function setButtonHandler(fn) {
  onButtonClick = fn;
}

export function appendMessage(msg) {
  addChatMessage(msg);
  renderMessage(msg);
  scrollToBottom();
  // Speak AI text messages (not system logs, not loading bubbles, not user echoes)
  if (msg.role === 'ai' && msg.type === 'text' && msg.content) {
    speak(msg.content);
  }
}

function renderMessage(msg) {
  if (!chatContainer) return;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-' + msg.role;

  if (msg.type === 'text') {
    bubble.textContent = msg.content;
  } else if (msg.type === 'image') {
    const img = document.createElement('img');
    img.src = msg.content;
    img.className = 'chat-image';
    img.alt = 'AI creation';
    img.referrerPolicy = 'no-referrer';
    bubble.appendChild(img);
    if (msg.caption) {
      const cap = document.createElement('div');
      cap.className = 'chat-caption';
      cap.textContent = msg.caption;
      bubble.appendChild(cap);
    }
  } else if (msg.type === 'video') {
    const video = document.createElement('video');
    video.src = msg.content;
    video.className = 'chat-video';
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    bubble.appendChild(video);
    if (msg.caption) {
      const cap = document.createElement('div');
      cap.className = 'chat-caption';
      cap.textContent = msg.caption;
      bubble.appendChild(cap);
    }
  } else if (msg.type === 'loading') {
    bubble.innerHTML = '<span class="chat-dots"><span>.</span><span>.</span><span>.</span></span> ' + (msg.content || '');
  }

  chatContainer.appendChild(bubble);
}

export function removeLoading() {
  if (!chatContainer) return;
  const dots = chatContainer.querySelectorAll('.chat-bubble:has(.chat-dots)');
  dots.forEach(el => el.remove());
}

export function showButtons(buttons) {
  if (!chatButtons) return;
  chatButtons.innerHTML = '';
  for (const btn of buttons) {
    const el = document.createElement('button');
    el.className = 'chat-response-btn ' + (btn.color || '');
    el.textContent = btn.label;
    el.addEventListener('click', () => {
      if (onButtonClick) onButtonClick(btn.value, btn.label);
    });
    chatButtons.appendChild(el);
  }
  chatButtons.style.display = 'flex';
  scrollToBottom();
}

export function showEmojiGrid(items) {
  if (!chatButtons) return;
  chatButtons.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  for (const item of items) {
    const el = document.createElement('button');
    el.className = 'emoji-btn';
    el.innerHTML = '<span class="emoji-icon">' + item.emoji + '</span><span class="emoji-label">' + item.label + '</span>';
    el.addEventListener('click', () => {
      if (onButtonClick) onButtonClick(item.label, item.emoji + ' ' + item.label);
    });
    grid.appendChild(el);
  }
  chatButtons.appendChild(grid);
  chatButtons.style.display = 'flex';
  scrollToBottom();
}

export function showTextInput() {
  if (!chatButtons) return;
  chatButtons.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'chat-input-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-text-input';
  input.placeholder = 'Type what you drew...';
  const send = document.createElement('button');
  send.className = 'chat-send-btn';
  send.textContent = 'Send';
  function submit() {
    const val = input.value.trim();
    if (!val) return;
    if (onButtonClick) onButtonClick(val, val);
  }
  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  row.appendChild(input);
  row.appendChild(send);
  chatButtons.appendChild(row);
  chatButtons.style.display = 'flex';
  input.focus();
  scrollToBottom();
}

export function hideButtons() {
  if (!chatButtons) return;
  chatButtons.innerHTML = '';
  chatButtons.style.display = 'none';
}

export function clearChatUI() {
  if (chatContainer) chatContainer.innerHTML = '';
  hideButtons();
  // Show placeholder
  const ph = document.getElementById('chat-placeholder');
  if (ph) ph.style.display = 'flex';
}

function scrollToBottom() {
  if (!chatContainer) return;
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

export function hidePlaceholder() {
  const ph = document.getElementById('chat-placeholder');
  if (ph) ph.style.display = 'none';
}
