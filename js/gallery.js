// Archive gallery UI — browse every drawing and story the server has saved.
// Read-only viewer over /api/gallery (server/gallery_routes.py).

import { log } from './logger.js';

let offset = 0;
let total = 0;
const PAGE = 24;

const $ = (id) => document.getElementById(id);

export function initGallery() {
  const btn = $('gallery-btn');
  if (!btn) return;
  btn.addEventListener('click', toggleGallery);
  $('gallery-more-btn')?.addEventListener('click', () => loadPage());
  log('init', 'gallery wired up');
}

async function toggleGallery() {
  const section = $('gallery-section');
  const open = section.style.display !== 'none';
  if (open) { section.style.display = 'none'; return; }
  section.style.display = '';
  $('gallery-grid').innerHTML = '';
  $('gallery-detail').innerHTML = '';
  offset = 0;
  await loadPage();
}

async function loadPage() {
  try {
    const res = await fetch(`/api/gallery?offset=${offset}&limit=${PAGE}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = await res.json();
    total = body.total;
    body.sessions.forEach(addCard);
    offset += body.sessions.length;
  } catch (e) {
    log('gallery', 'load failed', { error: e.message });
    $('gallery-grid').textContent = 'Could not load the gallery — try again?';
    return;
  }
  const more = $('gallery-more-btn');
  if (more) more.style.display = offset < total ? '' : 'none';
  const empty = $('gallery-grid').children.length === 0;
  if (empty) $('gallery-grid').textContent = 'Nothing saved yet — draw something and bring it to life!';
}

function thumbFor(session) {
  const prefer = ['ai_image.jpg', 'scene_01.jpg', 'drawing.png'];
  const file = prefer.find(f => session.files.includes(f));
  return file ? `/api/gallery/${encodeURIComponent(session.name)}/${file}` : null;
}

function addCard(session) {
  const card = document.createElement('button');
  card.className = 'gallery-card';
  const src = thumbFor(session);
  if (src) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = session.subject || session.name;
    img.src = src;
    card.appendChild(img);
  }
  const label = document.createElement('span');
  label.textContent = (session.kind === 'story' ? '📖 ' : '🎨 ')
    + (session.title || session.subject || 'untitled');
  card.appendChild(label);
  card.addEventListener('click', () => showDetail(session));
  $('gallery-grid').appendChild(card);
}

function showDetail(session) {
  const box = $('gallery-detail');
  box.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = session.title || session.subject || session.name;
  box.appendChild(title);

  const images = session.files.filter(f => f !== 'meta.json');
  images.forEach((file, i) => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = file;
    img.src = `/api/gallery/${encodeURIComponent(session.name)}/${file}`;
    box.appendChild(img);
    const narration = session.narrations[i];
    if (session.kind === 'story' && narration) {
      const cap = document.createElement('p');
      cap.textContent = narration;
      box.appendChild(cap);
    }
  });
  box.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
}
