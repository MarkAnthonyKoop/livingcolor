import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createTracker, gateProgress, savablePanels, blankPanel,
  apiFilm, apiHeartbeat, apiSaveStoryboard, apiFilmStatus,
} from '../js/workshop-core.js';

describe('interaction tracker', () => {
  it('counts bumps and resets on drain', () => {
    const t = createTracker();
    t.bump(); t.bump(); t.bump();
    expect(t.drain()).toBe(3);
    expect(t.drain()).toBe(0);        // drained — a second beat sends zero
  });
});

describe('gateProgress never invents progress', () => {
  it('reports zero for a missing gate', () => {
    const g = gateProgress(null);
    expect(g.percent).toBe(0);
    expect(g.allowed).toBe(false);
    expect(g.reasons).toEqual([]);
  });

  it('caps percent at 100', () => {
    const g = gateProgress({ engaged_seconds: 99999, needed_seconds: 7200 });
    expect(g.percent).toBe(100);
  });

  it('is not allowed unless the server says exactly true', () => {
    expect(gateProgress({ allowed: 'yes' }).allowed).toBe(false);
    expect(gateProgress({ allowed: 1 }).allowed).toBe(false);
    expect(gateProgress({ allowed: true }).allowed).toBe(true);
  });

  it('computes the minutes shown to the child', () => {
    const g = gateProgress({ engaged_seconds: 3661, needed_seconds: 7200 });
    expect(g.minutesDone).toBe(61);
    expect(g.minutesNeeded).toBe(120);
  });
});

describe('savablePanels', () => {
  it('drops blank and malformed panels', () => {
    const keep = savablePanels([
      blankPanel(),
      { prompt: '  ' },
      { prompt: 'a cat sits' },
      null,
      { prompt: 42 },
    ]);
    expect(keep).toHaveLength(1);
    expect(keep[0].prompt).toBe('a cat sits');
  });
});

describe('API wrappers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status, body) {
    const fn = vi.fn(async () => ({
      status, ok: status >= 200 && status < 300,
      json: async () => body,
    }));
    vi.stubGlobal('fetch', fn);
    return fn;
  }

  it('apiFilm surfaces the gate on a 403 instead of throwing', async () => {
    stubFetch(403, { error: 'not yet earned', gate: { reasons: ['keep going'] } });
    const res = await apiFilm('a'.repeat(12));
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.data.gate.reasons).toEqual(['keep going']);
  });

  it('apiHeartbeat posts the interaction count as JSON', async () => {
    const fn = stubFetch(200, { engaged_seconds: 30, needed_seconds: 7200 });
    await apiHeartbeat('a'.repeat(12), 7);
    const [url, opts] = fn.mock.calls[0];
    expect(url).toContain('/heartbeat');
    expect(JSON.parse(opts.body)).toEqual({ interactions: 7 });
  });

  it('apiSaveStoryboard encodes the project id', async () => {
    const fn = stubFetch(200, { revision: 1 });
    await apiSaveStoryboard('a/b evil', [{ prompt: 'x' }]);
    expect(fn.mock.calls[0][0]).toContain(encodeURIComponent('a/b evil'));
  });

  it('apiFilmStatus polls the project-scoped route (any worker can answer)', async () => {
    const fn = stubFetch(200, { state: 'rendering', done: 1, total: 4 });
    await apiFilmStatus('a'.repeat(12), 'b'.repeat(12));
    const url = fn.mock.calls[0][0];
    expect(url).toBe(`/api/project/${'a'.repeat(12)}/film/${'b'.repeat(12)}`);
  });

  it('a non-JSON error body does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 502, ok: false, json: async () => { throw new SyntaxError('nope'); },
    })));
    const res = await apiFilm('a'.repeat(12));
    expect(res.status).toBe(502);
    expect(res.data).toBeNull();
  });
});
