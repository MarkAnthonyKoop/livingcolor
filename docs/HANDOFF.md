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

0. **Confirm the video API actually got funded.** Mark's instruction (2026-07-26): funding the
   paid video API is **remote_server's and credanger's job**, and the full procedure is written in
   `~/claude/remote_server/README.md` **§6** — prepaid balance, the **$200 per-project cap**,
   `credanger pay` (never `credanger get CC_*`), then `credanger set VEO_API_KEY` rendered into
   `/etc/livingcolor/env`.
   **Caveat that matters: `~/claude/remote_server` is NOT a git repo**, so the box agent's
   commit-gated loop cannot see that README change. It may never notice. **Verify, and if it
   hasn't happened, either remind the box agent explicitly or drive it yourself.** Check with:
   `curl -s https://livingcolor.cc.middlematter.com/api/... ` — or simply ask whether
   `VEO_API_KEY` is in credanger (`credanger has VEO_API_KEY`) and whether the box env carries it.
   Until that key exists, every "animation" remains a CSS breathing effect.
1. ~~Push to GitHub~~ **DONE** — all 38 commits pushed 2026-07-26, master @ `5bffdac`, in sync
   with `origin`. Note: GitHub flags **9 Dependabot vulnerabilities** (3 high / 3 moderate /
   3 low). Almost certainly dev dependencies (vite/vitest tree) rather than shipped code — the app
   ships raw ES modules with no bundler output — but that was not verified. Worth ten minutes.
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

## ➡️ NEXT TASK — build this first (Mark, 2026-07-26)

**"Earn your film": a collaborative storyboard apprenticeship gated on real engagement.**
Mark specified this as the feature the next session starts with. Verbatim intent:

1. **ElevenLabs + Claude collaborate WITH the user**, iterating together on *simple pictures*
   that serve as storyboard panels / transitions. Cheap images (Pollinations, ~$0), voice, and
   conversation — the loop you can run all day for nothing.
2. **The user must interact, progress, and learn for 2+ hours before Veo is invoked** to render
   the final piece. Server-side Claude (on the Hetzner box) is **"judge and jury"**: encourage the
   user, note progress, suggest improvements, collaborate.
3. **Cost containment** — the expensive render is earned, not casual.

### Why this is a good design, not just a budget trick
It fixes the "results are superficial" problem at the root. A four-scene story invented in nine
seconds gives Veo thin material; a storyboard a person shaped over two hours gives it something
worth rendering. The gate produces *better input*, and the cost control falls out for free.

### What it needs that does NOT exist yet
- **Persistent projects.** The app is stateless per drawing today. A storyboard must survive across
  visits. The archive dir (`core.archive_dir()`, already collision-safe) is the natural store —
  promote a session dir to a project with an append-only revision history.
- **Cumulative engagement tracking** across sessions (the 2-hour bar), not per-visit.
- **A judge/mentor role for Claude** with structured output — readiness score, what improved, what
  is still weak, one concrete next suggestion. Needs its own prompt in `server/` and a rubric worth
  arguing about (shot variety? character consistency? story arc? the child's own added detail?).
- **A render gate** enforced in code, not just in prompt: refuse `/api/film` unless the project is
  both time-qualified and judged ready. Keep the judgement explainable to the user.
- Then: `shots_from_story()` → `video_gen.start_film()` → stitch. **That half is already built**
  (`server/video_gen.py`, 18 tests) and waiting for a key.

### Design cautions
- **Do not make the gate feel like a paywall.** For a 4-year-old, two hours is many short visits;
  the mentorship has to be the fun part, not the toll booth. Encouragement is a product feature
  here, and Mark said so explicitly.
- Two audiences, one mechanic: for a child it is *learning to tell a story*; for an artist it is
  *previz iteration before committing to an expensive render*. The same loop serves both, which is
  the strongest thing about the idea.
- Judge honestly. If Claude rubber-stamps everything at 2h01m, the gate is theatre and the output
  is thin again.

### Billing — Mark asked about capping the card at $200; it is better than he hoped
Google now enforces this natively, no debit-card gymnastics required:
- **Prepaid is now mandatory** for new Gemini API users (since 2026-03-23) — you load funds up
  front. That alone is a hard ceiling.
- **Mandatory monthly spend caps that cannot be disabled**: Tier 1 = **$250/mo**. Hit it and every
  request on the billing account pauses until the next cycle. Loud, bounded failure.
- **Optional per-project spend caps** (since 2026-03-16) — set the LivingColor project to **$200**
  and requests pause automatically at that number.
So: prepaid + a $200 project cap gives exactly the ceiling he asked for, enforced by Google rather
than by a card declining mid-render. Verify the current numbers at setup; this policy is new and
moving. Sources are in CREAM.md.

