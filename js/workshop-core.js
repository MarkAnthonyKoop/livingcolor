// "Earn your film" workshop — pure logic, no DOM. The UI lives in workshop.js.
//
// Talks to the project endpoints (server/project_routes.py) and tracks real
// engagement: interactions are counted client-side and drained into a
// heartbeat; the SERVER decides how much time they earn (bounded by real
// wall-clock — see server/projects.py), so nothing here is trusted.

export const HEARTBEAT_MS = 30000;
export const FILM_POLL_MS = 8000;

// Counts user interactions between heartbeats.
export function createTracker() {
  let count = 0;
  return {
    bump() { count++; },
    drain() { const n = count; count = 0; return n; },
    peek() { return count; },
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
  return { status: res.status, ok: res.ok, data };
}

export function apiCreateProject(name, subject) {
  return postJson('/api/project', { name, subject });
}

export async function apiGetProject(id) {
  const res = await fetch('/api/project/' + encodeURIComponent(id));
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, ok: res.ok, data };
}

export function apiSaveStoryboard(id, panels, note) {
  return postJson(`/api/project/${encodeURIComponent(id)}/storyboard`, { panels, note });
}

export function apiHeartbeat(id, interactions) {
  return postJson(`/api/project/${encodeURIComponent(id)}/heartbeat`, { interactions });
}

export function apiReview(id) {
  return postJson(`/api/project/${encodeURIComponent(id)}/review`, {});
}

export function apiFilm(id) {
  return postJson(`/api/project/${encodeURIComponent(id)}/film`, {});
}

export async function apiFilmStatus(jobId) {
  const res = await fetch('/api/film/' + encodeURIComponent(jobId));
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, ok: res.ok, data };
}

// Shape the server's gate object for display. Never invents progress: with no
// gate it reports zero.
export function gateProgress(gate) {
  const g = gate || {};
  const need = g.needed_seconds > 0 ? g.needed_seconds : 1;
  const engaged = Math.max(0, g.engaged_seconds || 0);
  return {
    percent: Math.min(100, Math.round((engaged / need) * 100)),
    minutesDone: Math.floor(engaged / 60),
    minutesNeeded: Math.ceil(need / 60),
    readiness: typeof g.readiness === 'number' ? g.readiness : null,
    neededReadiness: g.needed_readiness || null,
    allowed: g.allowed === true,
    reasons: Array.isArray(g.reasons) ? g.reasons : [],
  };
}

// A fresh panel; the UI binds inputs straight onto these objects.
export function blankPanel() {
  return { prompt: '', narration: '', image_url: '', note: '' };
}

// Only panels with a prompt are worth saving; empty storyboards must not
// burn a revision (the server would 400 anyway).
export function savablePanels(panels) {
  return (panels || []).filter(p => p && typeof p.prompt === 'string' && p.prompt.trim());
}
