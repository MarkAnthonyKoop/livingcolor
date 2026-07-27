// DOM tests for the gallery viewer: listing, pagination visibility, detail
// view, and that every image URL stays on the server's /api/gallery path.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let initGallery;

function mountDom() {
  document.body.innerHTML = `
    <button id="gallery-btn"></button>
    <section id="gallery-section" style="display:none">
      <div id="gallery-grid"></div>
      <button id="gallery-more-btn" style="display:none"></button>
      <div id="gallery-detail"></div>
    </section>`;
}

const SESSIONS = [
  { name: '20260726-120000-000-story-dog', kind: 'story', subject: 'dog',
    title: 'Dog Tale', files: ['scene_01.jpg', 'scene_02.jpg'],
    narrations: ['a dog barks', 'the dog flies'] },
  { name: '20260725-120000-000-cat', kind: 'drawing', subject: 'cat',
    title: '', files: ['ai_image.jpg', 'drawing.png'], narrations: [] },
];

function stubGallery(total = 2, sessions = SESSIONS) {
  const fn = vi.fn(async (url) => ({
    ok: true, status: 200,
    json: async () => ({ total, offset: 0, sessions }),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function openGallery() {
  document.getElementById('gallery-btn').click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.gallery-card').length).toBeGreaterThan(0));
}

beforeEach(async () => {
  vi.resetModules();
  ({ initGallery } = await import('../js/gallery.js'));
  mountDom();
  initGallery();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('gallery listing', () => {
  it('renders a card per session with an on-path thumbnail', async () => {
    stubGallery();
    await openGallery();
    const cards = document.querySelectorAll('.gallery-card');
    expect(cards).toHaveLength(2);
    for (const img of document.querySelectorAll('.gallery-card img')) {
      expect(new URL(img.src, 'http://localhost/').pathname.startsWith('/api/gallery/')).toBe(true);
    }
    expect(cards[0].textContent).toContain('Dog Tale');
  });

  it('hides "show more" when everything is on one page', async () => {
    stubGallery(2);
    await openGallery();
    expect(document.getElementById('gallery-more-btn').style.display).toBe('none');
  });

  it('shows "show more" when the archive is bigger than the page', async () => {
    stubGallery(50);
    await openGallery();
    expect(document.getElementById('gallery-more-btn').style.display).not.toBe('none');
  });

  it('says so when the archive is empty', async () => {
    stubGallery(0, []);
    document.getElementById('gallery-btn').click();
    await vi.waitFor(() =>
      expect(document.getElementById('gallery-grid').textContent).toMatch(/Nothing saved/i));
  });
});

describe('detail view', () => {
  it('shows every image and pairs story narrations with scenes', async () => {
    stubGallery();
    await openGallery();
    document.querySelectorAll('.gallery-card')[0].click();
    const detail = document.getElementById('gallery-detail');
    expect(detail.querySelectorAll('img')).toHaveLength(2);
    expect(detail.textContent).toContain('a dog barks');
    expect(detail.textContent).toContain('the dog flies');
  });

  it('a hostile session name cannot escape the API path', async () => {
    const evil = [{ name: '../../etc', kind: 'drawing', subject: 'x', title: '',
                    files: ['drawing.png'], narrations: [] }];
    stubGallery(1, evil);
    await openGallery();
    document.querySelector('.gallery-card').click();
    const img = document.querySelector('#gallery-detail img');
    const path = new URL(img.src, 'http://localhost/').pathname;
    // encodeURIComponent keeps the name a single path segment (the server
    // 404s it anyway, but the client must not build a traversing URL)
    expect(path.startsWith('/api/gallery/')).toBe(true);
    expect(path).not.toContain('/etc/');
  });
});
