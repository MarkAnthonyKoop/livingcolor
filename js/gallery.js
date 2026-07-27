// Archive gallery UI — browse every drawing and story the server has saved.
// Read-only viewer over /api/gallery (server/gallery_routes.py).

import { log } from './logger.js';
import { show, hide, isShown } from './vis.js';

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
  const open = isShown(section);
  if (open) { hide(section); return; }
  show(section);
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
    if (offset === 0) (body.films || []).forEach(addFilmCard);
    body.sessions.forEach(addCard);
    offset += body.sessions.length;
  } catch (e) {
    log('gallery', 'load failed', { error: e.message });
    $('gallery-grid').textContent = 'Could not load the gallery — try again?';
    return;
  }
  const more = $('gallery-more-btn');
  if (more) { if (offset < total) show(more); else hide(more); }
  const empty = $('gallery-grid').children.length === 0;
  if (empty) $('gallery-grid').textContent = 'Nothing saved yet — draw something and bring it to life!';
}

function addFilmCard(film) {
  const card = document.createElement('button');
  card.className = 'gallery-card gallery-film-card';
  const label = document.createElement('span');
  label.textContent = '🎬 ' + (film.project_name || 'A finished film');
  card.appendChild(label);
  card.addEventListener('click', () => showFilm(film));
  $('gallery-grid').appendChild(card);
}

function showFilm(film) {
  const box = $('gallery-detail');
  box.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = '🎬 ' + (film.project_name || 'A finished film');
  box.appendChild(title);
  const base = `/api/project/${encodeURIComponent(film.project_id)}/films/${film.job_id}`;
  const player = document.createElement('video');
  player.controls = true;
  player.playsInline = true;
  player.className = 'gallery-film-player';
  const whole = film.narrated || film.film;   // narrated mix beats silent stitch
  if (whole) {
    player.loop = true;
    player.src = `${base}/${whole}`;
  } else {
    let i = 0;                             // no stitch — chain the shots
    player.src = `${base}/${film.clips[0]}`;
    player.onended = () => {
      i = (i + 1) % film.clips.length;
      player.src = `${base}/${film.clips[i]}`;
      player.play().catch(() => {});
    };
  }
  box.appendChild(player);
  player.play().catch(() => {});
  box.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
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
