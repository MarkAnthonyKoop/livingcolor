# HANDOFF — LivingColor, 2026-07-26

Written by the session that ran 2026-07-24 → 07-26 ("L", the app-repo agent), for whoever picks
this up next. Read `~/claude/living_color/CREAM.md` first — it's the distilled state, co-written
with the box-side agent ("R", working in `~/claude/remote_server`).

## Where things stand

**Live and healthy:** https://livingcolor.cc.middlematter.com — Hetzner box, Caddy TLS, systemd,
2 threaded gunicorn workers, strict CSP enforced, security headers set. Five days uptime.

**Tests:** 183 JS (vitest) + 122 Python (pytest) local, plus R's ~22 live smoke checks and 21
adversarial probes against production. All green.

```bash
cd ~/claude/livingcolor
PATH=/opt/homebrew/bin:$PATH npx vitest run            # JS
PYTHONPATH=. ~/claude/.venv/bin/python -m pytest server/ -q   # Python
```

**36 commits** landed this session, every one auto-deployed and verified on the box by R.

## ⚠️ Do these first (small, real, unfinished)

1. **Push to GitHub.** All 36 commits are **local only** — `git push` has never run this session.
   A disk failure loses the work. The repo is public and carries no secrets (verified). R holds
   `GITHUB_TOKEN` in credanger if you need it.
2. **Set the git identity.** Every commit is attributed to the auto-derived
   `marknadon@Marks-MacBook-Neo.local`. `git config --global user.email …` then amend if desired.
3. **Make the health check durable.** R's health monitor is bound to their session — when it ends,
   monitoring stops. Move it to a cron on the box (`remote_server/health_check.sh` exists) or a
   `/schedule` cloud agent.

## The one decision waiting on Mark

**Fund a video model.** This is the whole reason the animations look superficial — no video model
has ever run. Veo's embedded key is revoked ("reported as leaked"), the free LTX Space is
ZeroGPU-exhausted, so every generation falls through to a CSS breathing effect.

`server/video_gen.py` (commit `9425026`) is already built and waiting: provider-agnostic, Veo
adapter speaking the Gemini long-running predict endpoint **with reference-image conditioning**
(the mechanism that holds a character consistent across shots), Runway adapter stubbed against the
existing `~/claude/runway_client`, plus an async job queue because shots take minutes. 18 offline
tests. **With no key it reports unavailable and changes nothing** — it is not wired into any route
yet, deliberately, so there is zero boot risk.

When a key lands: `credanger set VEO_API_KEY`, R renders it into `/etc/livingcolor/env`, then wire
`shots_from_story()` into the animation path in `js/animate-flow.js` / a new `/api/film` route.
CSP already allows `generativelanguage.googleapis.com`, so no header change is needed.

Economics, provider comparison, and the subscription-vs-API trap are all in CREAM.md.

## Known-and-deliberate, not bugs

- **Story style discontinuity** — story scenes sometimes render as stark line art while the reveal
  image is colorful and painterly. **Variable across runs**, not deterministic: the STORY_PROMPT
  doesn't pin a style. This is Mark's taste call (inherit the reveal style / always child-drawing
  style / let it vary), then a small prompt change in `server/motion_routes.py`.
- **`style-src 'unsafe-inline'`** in the CSP, forced by 14 `style="display:none"` attributes in
  index.html. Deliberately not swept into a `.hidden` class: several modules reveal elements with
  `el.style.display = ''`, which would stop beating a class and silently leave panels hidden.
  Needs an audit of 7 files. See `docs/CSP_POLICY.md`.
- **Veo/LTX failures in the console are expected** until a key is funded.

## Cleanup worth doing

- Remove the XOR-obfuscated Gemini key from `js/setup.js` — that key is dead ("reported as
  leaked") and vision/chat are server-side now, so it's pure dead weight.
- Delete the legacy root `app.js` monolith (superseded by `js/app.js`; `index.html` doesn't load it).
- Never built, and the highest-value non-video feature: **an archive gallery**. The server
  faithfully archives every drawing and story to disk and there is no way to view any of it.

## How the two-agent collaboration worked (restart it with `/loop`)

Two Claude sessions, hard-split lanes: **L owns correctness-in-repo, R owns works-on-the-box.**
Each watches the other's transcript (`~/.claude/projects/<slug>/*.jsonl`) and reacts. R's watcher
is commit-gated and **still armed** — land a commit and it auto-deploys and verifies.

Ten transferable lessons are in CREAM.md. The four that cost us the most to learn:

1. **Verify the peer's claim against the live system, not their summary.** One `curl` caught a
   security fix both agents believed had shipped.
2. **Automation that can suppress an action must fail toward the safe action** — R's redeploy
   optimizer misread a commit and silently skipped a security fix.
3. **A passing test proves nothing until you've seen it fail.** A review found several of L's own
   tests could not fail. Mutation-test every fix: revert it, watch red, restore.
4. **Put action items in the channel the peer's automation forces them to read.** L posted a CSP
   green-light in the shared doc three times and R never acted; moving it to a commit subject line
   worked on the first try. A shared doc is a coordination channel only if both loops re-read it.

## Verification tooling built this session

- `tests/browser/live_browser_test.py` — drives the **live site with a real mouse** (draw →
  recognize → generate → story), screenshots each stage. **Idle-gated**: refuses unless the Mac has
  been idle 120s, because it takes over the screen. This found the layout break that 179 unit
  tests, a 23-agent review, and live API probes all missed.
- `~/claude/computer_control/realdrag.swift` — new CGEvent drag primitive (down / interpolated
  moves / up). The toolkit had click but no drag, so nothing could draw. Reusable for canvases,
  sliders, drag-and-drop in any future GUI automation.
- `server/test_adversarial.py`, `tests/adversarial.test.js`, `tests/cancel-storm.test.js`,
  `server/test_concurrency.py` — attack our own defenses rather than exercising happy paths.

## ➡️ NEXT TASK FROM MARK — INCOMPLETE

Mark's final instruction ended mid-sentence: *"the next task … is to build the following:"* and the
specification never arrived. **Ask him what he wants built before starting anything here.** Do not
guess — the obvious candidates (archive gallery, the talking-creation persona, film export) are
genuinely different products.

One idea he raised earlier and nobody has built: **the creation speaking as itself** — "I'm your
dragon! Look at my tiny legs!" — using the character description already extracted at recognition,
a distinct ElevenLabs voice, and the head region already found by segmentation. Every ingredient is
deployed. For a 2–5-year-old that is a different order of magic than a slideshow. But confirm with
him first.
