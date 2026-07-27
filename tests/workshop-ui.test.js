// DOM tests for the workshop UI: open → create project, edit → save, and the
// film button relaying the server's gate refusal. Fetch is stubbed per-route.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/voice.js', () => ({
  speak: vi.fn(), stopSpeaking: vi.fn(),
  isVoiceEnabled: () => false, setVoiceEnabled: vi.fn(),
}));

const PID = 'abcdef123456';

// workshop.js holds module-level state (the panels being edited), so each
// test gets a fresh module instance.
let initWorkshop, wireWorkshopButtons;

function mountDom() {
  document.body.innerHTML = `
    <button id="workshop-btn"></button>
    <section id="workshop-section" hidden>
      <div class="workshop-progress"><div id="workshop-progress-fill"></div></div>
      <p id="workshop-progress-label"></p>
      <p id="workshop-readiness"></p>
      <p id="workshop-machine"></p>
      <div id="workshop-mentor"></div>
      <div id="workshop-panels"></div>
      <video id="workshop-film" hidden></video>
      <button id="workshop-mic-btn"></button>
      <input id="workshop-chat-input" />
      <button id="workshop-chat-send"></button>
      <button id="workshop-save-btn"></button>
      <button id="workshop-review-btn"></button>
      <button id="workshop-film-btn"></button>
    </section>`;
}

// Routes requests like the real server; records every call.
function stubServer(overrides = {}) {
  const calls = [];
  const routes = {
    'GET /api/film-availability': { status: 200, body: { provider: 'veo', available: false } },
    'POST /api/project': { status: 200, body: { id: PID, name: 'My Story', revision_count: 0 } },
    [`POST /api/project/${PID}/heartbeat`]: { status: 200, body: { engaged_seconds: 60, needed_seconds: 7200 } },
    [`POST /api/project/${PID}/storyboard`]: { status: 200, body: { revision: 1 } },
    [`POST /api/project/${PID}/film`]: {
      status: 403,
      body: { error: 'not yet earned', gate: { reasons: ['Keep creating!'], needed_seconds: 7200 } },
    },
    ...overrides,
  };
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const key = `${opts.method || 'GET'} ${url}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : null });
    const route = routes[key] || { status: 404, body: { error: 'no route: ' + key } };
    return { status: route.status, ok: route.status < 300, json: async () => route.body };
  }));
  return calls;
}

async function openWorkshop() {
  document.getElementById('workshop-btn').click();
  await vi.waitFor(() => {
    expect(document.getElementById('workshop-section').hidden).toBe(false);
    expect(document.querySelector('#workshop-panels textarea')).toBeTruthy();
  });
}

beforeEach(async () => {
  vi.resetModules();
  ({ initWorkshop, wireWorkshopButtons } = await import('../js/workshop.js'));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  mountDom();
  initWorkshop();
  wireWorkshopButtons();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('workshop open', () => {
  it('creates a project, remembers it, and greets the storyteller', async () => {
    const calls = stubServer();
    await openWorkshop();
    expect(calls.some(c => c.key === 'POST /api/project')).toBe(true);
    expect(localStorage.getItem('workshop_project')).toBe(PID);
    expect(document.getElementById('workshop-mentor').textContent).toMatch(/workshop/i);
  });

  it('resumes a stored project instead of creating a new one', async () => {
    localStorage.setItem('workshop_project', PID);
    const calls = stubServer({
      // the on-open heartbeat repaints progress, so it must agree with GET
      [`POST /api/project/${PID}/heartbeat`]: {
        status: 200, body: { engaged_seconds: 600, needed_seconds: 7200 },
      },
      [`GET /api/project/${PID}`]: {
        status: 200,
        body: {
          project: { id: PID, revision_count: 1 },
          storyboard: { panels: [{ prompt: 'a cat sits', narration: '', image_url: '', note: '' }] },
          verdict: null,
          gate: { engaged_seconds: 600, needed_seconds: 7200, reasons: [] },
        },
      },
    });
    await openWorkshop();
    expect(calls.some(c => c.key === 'POST /api/project')).toBe(false);
    expect(document.querySelector('#workshop-panels textarea').value).toBe('a cat sits');
    expect(document.getElementById('workshop-progress-label').textContent).toContain('10 of 120');
  });
});

describe('movie machine state', () => {
  it('tells the truth when video is not configured', async () => {
    stubServer();
    await openWorkshop();
    await vi.waitFor(() =>
      expect(document.getElementById('workshop-machine').textContent).toMatch(/isn't plugged in/));
  });

  it('celebrates when video is available', async () => {
    stubServer({
      'GET /api/film-availability': { status: 200, body: { provider: 'veo', available: true } },
    });
    await openWorkshop();
    await vi.waitFor(() =>
      expect(document.getElementById('workshop-machine').textContent).toMatch(/ready/));
  });
});

describe('saving', () => {
  it('refuses an empty storyboard without burning a request', async () => {
    const calls = stubServer();
    await openWorkshop();
    document.getElementById('workshop-save-btn').click();
    await vi.waitFor(() =>
      expect(document.getElementById('workshop-mentor').textContent).toMatch(/at least one/i));
    expect(calls.some(c => c.key.includes('/storyboard'))).toBe(false);
  });

  it('saves typed panels', async () => {
    const calls = stubServer();
    await openWorkshop();
    const ta = document.querySelector('#workshop-panels textarea');
    ta.value = 'a brave cat';
    ta.dispatchEvent(new Event('input'));
    document.getElementById('workshop-save-btn').click();
    await vi.waitFor(() =>
      expect(document.getElementById('workshop-mentor').textContent).toMatch(/saved/i));
    const save = calls.find(c => c.key.includes('/storyboard'));
    expect(save.body.panels[0].prompt).toBe('a brave cat');
  });
});

describe('mentor chat', () => {
  it('sends the message to the project chat route and shows the reply', async () => {
    const calls = stubServer({
      [`POST /api/project/${PID}/chat`]: {
        status: 200, body: { reply: 'Try a close-up of the cat! 🐱' },
      },
    });
    await openWorkshop();
    const input = document.getElementById('workshop-chat-input');
    input.value = 'what should I add?';
    document.getElementById('workshop-chat-send').click();
    await vi.waitFor(() =>
      expect(document.getElementById('workshop-mentor').textContent).toContain('close-up'));
    const chat = calls.find(c => c.key.includes('/chat'));
    expect(chat.body.message).toBe('what should I add?');
    expect(input.value).toBe('');           // cleared for the next thought
  });

  it('hides the mic button when the browser has no recognizer', async () => {
    stubServer();
    await openWorkshop();
    // jsdom has no SpeechRecognition — attachMic must hide the button, not throw
    expect(document.getElementById('workshop-mic-btn').hidden).toBe(true);
  });
});

describe('film playback', () => {
  it('plays the rendered shots from the project films API', async () => {
    stubServer({
      [`GET /api/project/${PID}/films`]: {
        status: 200,
        body: { films: [{ job_id: 'c'.repeat(12), clips: ['shot_01.mp4', 'shot_02.mp4'] }] },
      },
    });
    await openWorkshop();
    const mod = await import('../js/workshop.js');
    window.HTMLMediaElement.prototype.play = vi.fn(async () => {});
    await mod.playFilm('c'.repeat(12));
    const player = document.getElementById('workshop-film');
    expect(player.hidden).toBe(false);
    const path = new URL(player.src, 'http://localhost/').pathname;
    expect(path).toBe(`/api/project/${PID}/films/${'c'.repeat(12)}/shot_01.mp4`);
  });
});

describe('the film button', () => {
  it('relays the server refusal reasons — the gate is visible, not silent', async () => {
    stubServer();
    await openWorkshop();
    const ta = document.querySelector('#workshop-panels textarea');
    ta.value = 'a brave cat';
    ta.dispatchEvent(new Event('input'));
    document.getElementById('workshop-film-btn').click();
    await vi.waitFor(() =>
      expect(document.getElementById('workshop-mentor').textContent).toContain('Keep creating!'));
  });
});
