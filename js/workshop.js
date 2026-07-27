// "Earn your film" workshop UI: storyboard panel editor, mentor reviews,
// heartbeat loop, and the film request. Logic lives in workshop-core.js.

import {
  HEARTBEAT_MS, FILM_POLL_MS, createTracker, gateProgress, blankPanel,
  savablePanels, apiCreateProject, apiGetProject, apiSaveStoryboard,
  apiHeartbeat, apiReview, apiFilm, apiFilmStatus, apiFilmAvailability,
} from './workshop-core.js';
import { buildPollinationsUrl } from './story.js';
import { readStored, writeStored } from './storage.js';
import { speak } from './voice.js';
import { attachMic } from './mic.js';
import { log } from './logger.js';
import { show, hide, isShown } from './vis.js';

let project = null;
let panels = [blankPanel()];
let tracker = createTracker();
let beatTimer = null;
let filmTimer = null;

const $ = (id) => document.getElementById(id);

export function initWorkshop() {
  const btn = $('workshop-btn');
  if (!btn) return;
  btn.addEventListener('click', toggleWorkshop);
  log('init', 'workshop wired up');
}

async function toggleWorkshop() {
  const section = $('workshop-section');
  const open = isShown(section);
  if (open) {
    hide(section);
    stopHeartbeat();
    return;
  }
  show(section);
  await resumeOrCreate();
  renderPanels();
  startHeartbeat();
  showMachineState();
}

// Honest expectations: say up front whether the movie machine exists, so the
// earn-your-film promise is never a surprise dead end.
async function showMachineState() {
  const label = $('workshop-machine');
  if (!label) return;
  try {
    const res = await apiFilmAvailability();
    if (res.ok) {
      label.textContent = res.data.available
        ? '🎥 The movie machine is plugged in and ready!'
        : '🔌 The movie machine isn\'t plugged in yet — your story will be ready when it is.';
    }
  } catch (e) { /* leave the label empty */ }
}

async function resumeOrCreate() {
  const stored = readStored('workshop_project');
  if (stored) {
    const res = await apiGetProject(stored);
    if (res.ok) {
      project = res.data.project;
      if (res.data.storyboard) panels = res.data.storyboard.panels.map(p => ({ ...p }));
      showGate(res.data.gate);
      if (res.data.verdict) showVerdict(res.data.verdict, false);
      return;
    }
  }
  const subject = window._lcSubject || '';
  const res = await apiCreateProject('My Story', subject);
  if (res.ok) {
    project = res.data;
    writeStored('workshop_project', project.id);
    mentorSay('Welcome to your story workshop! 🎬 Add your first picture below — what happens at the START of your story?');
  } else {
    mentorSay('Hmm, I couldn\'t open the workshop. Try again in a moment?');
  }
}

// --- heartbeat: count real interactions, let the server do the math ---

function startHeartbeat() {
  const section = $('workshop-section');
  ['pointerdown', 'keydown', 'input'].forEach(ev =>
    section.addEventListener(ev, tracker.bump));
  if (!beatTimer) beatTimer = setInterval(beat, HEARTBEAT_MS);
  beat();
}

function stopHeartbeat() {
  if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
}

async function beat() {
  if (!project) return;
  try {
    const res = await apiHeartbeat(project.id, tracker.drain());
    if (res.ok) updateProgressBar(res.data.engaged_seconds, res.data.needed_seconds);
  } catch (e) { /* offline beat lost — server stays authoritative */ }
}

// --- storyboard editor ---

function renderPanels() {
  const list = $('workshop-panels');
  list.innerHTML = '';
  panels.forEach((panel, i) => {
    const card = document.createElement('div');
    card.className = 'workshop-card';

    const img = document.createElement('img');
    img.referrerPolicy = 'no-referrer';
    img.alt = 'Panel ' + (i + 1);
    if (panel.image_url) img.src = panel.image_url;
    card.appendChild(img);

    const prompt = document.createElement('textarea');
    prompt.placeholder = 'What do we SEE in this picture?';
    prompt.value = panel.prompt;
    prompt.addEventListener('input', () => { panel.prompt = prompt.value; });
    card.appendChild(prompt);

    const narration = document.createElement('input');
    narration.placeholder = 'What do we HEAR? (the words read aloud)';
    narration.value = panel.narration;
    narration.addEventListener('input', () => { panel.narration = narration.value; });
    card.appendChild(narration);

    const row = document.createElement('div');
    row.className = 'workshop-card-actions';
    row.appendChild(button('Paint it! 🎨', () => paintPanel(panel, img)));
    row.appendChild(button('✕', () => { panels.splice(i, 1); renderPanels(); }, 'secondary'));
    card.appendChild(row);
    list.appendChild(card);
  });
  const add = button('+ Add a picture', () => {
    panels.push(blankPanel());
    renderPanels();
  });
  add.className = 'action-btn workshop-add';
  list.appendChild(add);
}

function button(label, onClick, secondary) {
  const b = document.createElement('button');
  b.className = 'action-btn' + (secondary ? ' secondary' : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function paintPanel(panel, img) {
  if (!panel.prompt.trim()) return;
  const url = buildPollinationsUrl(panel.prompt, Math.floor(Math.random() * 999999));
  panel.image_url = url;
  img.src = url;
}

async function saveStoryboard() {
  const keep = savablePanels(panels);
  if (!project || !keep.length) {
    mentorSay('Add at least one picture with a description first! ✏️');
    return null;
  }
  const res = await apiSaveStoryboard(project.id, keep);
  if (!res.ok) {
    mentorSay('I couldn\'t save that — try again?');
    return null;
  }
  project.revision_count = res.data.revision;
  return res.data.revision;
}

// --- mentor ---

async function askMentor() {
  if ((await saveStoryboard()) === null) return;
  mentorSay('Let me look at your story… 🤔');
  const res = await apiReview(project.id);
  if (!res.ok) {
    mentorSay('I couldn\'t reach your mentor right now. Keep creating and try again soon!');
    return;
  }
  showVerdict(res.data.verdict, true);
  showGate(res.data.gate);
}

function showVerdict(v, aloud) {
  const parts = [v.encouragement];
  if (v.improved && v.improved.length) parts.push('Better than before: ' + v.improved.join(', ') + ' 🌱');
  if (v.suggestion) parts.push('Try this next: ' + v.suggestion);
  mentorSay(parts.filter(Boolean).join('\n'), aloud);
  const meter = $('workshop-readiness');
  if (meter) meter.textContent = '⭐ Story power: ' + v.readiness + '/10';
}

function mentorSay(text, aloud) {
  const box = $('workshop-mentor');
  if (box) box.textContent = text;
  if (aloud) speak(text);
}

// --- the film request ---

async function requestFilm() {
  if (!project) return;
  await saveStoryboard();
  const res = await apiFilm(project.id);
  if (res.status === 403) {
    const g = gateProgress(res.data && res.data.gate);
    mentorSay(g.reasons.join('\n') || 'Not quite yet — keep going!', true);
    return;
  }
  if (res.status === 503) {
    mentorSay('The movie machine isn\'t plugged in yet — your story is SAVED and ready for the day it is! 🌟');
    return;
  }
  if (!res.ok) {
    mentorSay('Something went wrong starting your film. Try again?');
    return;
  }
  mentorSay('🎉 YOU EARNED YOUR FILM! The movie machine is working on ' + res.data.shots + ' scenes — this takes a few minutes…', true);
  pollFilm(res.data.job_id);
}

function pollFilm(jobId) {
  if (filmTimer) clearInterval(filmTimer);
  filmTimer = setInterval(async () => {
    let res;
    try {
      res = await apiFilmStatus(project.id, jobId);
    } catch (e) {
      return;                    // transient network blip — keep polling
    }
    if (!res.ok) { clearInterval(filmTimer); filmTimer = null; return; }
    const s = res.data;
    if (s.state === 'done' || s.state === 'failed') {
      clearInterval(filmTimer); filmTimer = null;
      if (s.state === 'done') {
        mentorSay('🎬 Your film is rendered! (' + s.clips + ' scenes) Here it comes…', true);
        playFilm(jobId);
      } else {
        mentorSay('The movie machine had trouble: ' + (s.error || 'unknown'), true);
      }
    } else {
      mentorSay('Rendering scene ' + Math.min(s.done + 1, s.total) + ' of ' + s.total + '… 🎥');
    }
  }, FILM_POLL_MS);
}

// --- film playback: chain the shots back-to-back, loop the whole film ---

export async function playFilm(jobId) {
  const player = $('workshop-film');
  if (!player || !project) return;
  const res = await fetch(`/api/project/${encodeURIComponent(project.id)}/films`);
  if (!res.ok) return;
  const films = (await res.json()).films || [];
  const film = films.find(f => f.job_id === jobId) || films[films.length - 1];
  if (!film || !film.clips.length) return;
  const base = `/api/project/${encodeURIComponent(project.id)}/films/${film.job_id}`;
  const whole = film.narrated || film.film;   // narrated mix beats silent stitch
  if (whole) {
    show(player);
    player.loop = true;
    player.src = `${base}/${whole}`;
    player.play().catch(() => {});
    // live TTS only when the file itself carries no narration track
    if (!film.narrated && (film.narrations || [])[0]) speak(film.narrations.join(' '));
    return;
  }
  const urls = film.clips.map(c => `${base}/${c}`);
  const narrations = film.narrations || [];
  let i = 0;
  const startClip = () => {
    player.src = urls[i];
    player.play().catch(() => {});     // autoplay may need the user's tap
    if (narrations[i]) speak(narrations[i]);   // the storyteller's own words
  };
  show(player);
  player.onended = () => {
    i = (i + 1) % urls.length;         // loop the film
    startClip();
  };
  startClip();
}

// --- progress display ---

function updateProgressBar(engaged, needed) {
  showGate({ engaged_seconds: engaged, needed_seconds: needed });
}

function showGate(gate) {
  const g = gateProgress(gate);
  const fill = $('workshop-progress-fill');
  const label = $('workshop-progress-label');
  if (fill) fill.style.width = g.percent + '%';
  if (label) {
    label.textContent = g.allowed
      ? 'Your film is EARNED! 🌟'
      : `Creating time: ${g.minutesDone} of ${g.minutesNeeded} minutes`;
  }
}

// --- mentor chat: the collaborative loop, by keyboard or voice ---

async function sendChat() {
  const input = $('workshop-chat-input');
  const text = (input?.value || '').trim();
  if (!text || !project) return;
  input.value = '';
  mentorSay('…');
  try {
    const res = await fetch(`/api/project/${encodeURIComponent(project.id)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = res.ok ? await res.json() : null;
    if (data && data.reply) mentorSay(data.reply, true);
    else mentorSay('I didn\'t catch that — tell me again?');
  } catch (e) {
    mentorSay('I couldn\'t hear you just now. Try again in a moment!');
  }
}

// Buttons in the static HTML.
export function wireWorkshopButtons() {
  $('workshop-save-btn')?.addEventListener('click', async () => {
    if (await saveStoryboard() !== null) mentorSay('Saved! Your story is safe. 💾');
  });
  $('workshop-review-btn')?.addEventListener('click', askMentor);
  $('workshop-film-btn')?.addEventListener('click', requestFilm);
  $('workshop-chat-send')?.addEventListener('click', sendChat);
  $('workshop-chat-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
  });
  attachMic($('workshop-mic-btn'), $('workshop-chat-input'), () => sendChat());
}
