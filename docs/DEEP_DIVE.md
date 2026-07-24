# LivingColor — Deep Dive

A complete, code-grounded walkthrough of how LivingColor works: every module, every
network call, every fallback, and every design decision. Written from a full read of the
source on 2026-06-20. Pairs with the top-level `README.md` (user manual) and `CLAUDE.md`
(gotchas); this document is the engineering reference.

---

## 1. What the app is, in one paragraph

LivingColor is a **single-page, static-first web app** for young kids: you draw on an HTML5
canvas, click **Bring to Life!**, and an AI looks at your drawing, chats about it like a
warm friend, generates a polished image of it, and then animates that image. It is built to
**degrade gracefully** — every expensive capability (vision recognition, video generation,
animation) has a chain of fallbacks ending in something that *always* works in the browser
with no server and no paid quota. An **optional Flask backend** upgrades the experience by
shelling out to the user's local Claude Code subscription (better recognition, narrated
story arcs, region segmentation) and by archiving every drawing to disk.

The whole frontend is ~2,200 lines of plain ES modules (no bundler, no framework). The
backend is one 488-line Flask file.

---

## 2. The two runtime modes

The single most important thing to understand is that **the same frontend behaves very
differently depending on one localStorage flag**: `use_backend`.

### Mode A — Static / browser-only (default, `use_backend !== 'true'`)
- Runs from `file://` or any static host (GitHub Pages, etc.).
- Vision: **Gemini → Perplexity** (both called directly from the browser).
- Image: **Pollinations.ai** (free, no auth).
- Animation: **Veo → LTX → client-side "living" effect → magic particles**.
- No voice (the `/api/speak` endpoint doesn't exist), no archive, no story arcs, no region
  motion. Those features silently no-op because their `fetch('/api/...')` calls fail.

### Mode B — Local backend (`use_backend === 'true'`, Flask running on :8091)
Everything in Mode A, **plus** these server-only upgrades that take priority:
- Vision: **Claude Code (local)** is tried *first*, before Gemini.
- Prompt authoring: Claude writes the image-generation prompt (`/api/generate-prompt`).
- Animation upgrade path becomes: **narrative story arc → per-region motion → whole-image
  motion plan → living effect**.
- **Voice**: AI chat bubbles are spoken aloud via ElevenLabs (`/api/speak`).
- **Archive**: every drawing + AI image + metadata saved to disk.

The toggle lives in the settings overlay (`#use-backend-toggle`) and is read all over the
codebase via `localStorage.getItem('use_backend') === 'true'`.

> **Key insight:** there is no build-time configuration of "backend vs static." The frontend
> always assumes it *might* have a backend, optimistically calls `/api/*`, and treats any
> failure as "fall through to the browser-side path." This is why the app works identically
> whether or not Flask is up.

---

## 3. File-by-file map

### 3.1 Shell & styling
| File | Role |
|---|---|
| `index.html` | The entire DOM. Setup overlay, toolbar, canvas, chat panel, generate bar, hidden video/image/overlay elements. Loads `js/app.js` as a module and the `@gradio/client` CDN script. |
| `style.css` | Dark theme via CSS custom properties (`--bg`, `--accent`, …). ~172 rule blocks: chat bubbles, buttons, emoji grid, animations, mobile breakpoints. |
| `app.js` (root) | **Legacy monolith, 1,075 lines, NOT loaded.** Kept as a backup of the pre-modular version. `index.html` loads `js/app.js`, not this. Ignore it for understanding current behavior. |

### 3.2 Frontend modules (`js/`)
| File | Lines | Responsibility | Imports |
|---|---|---|---|
| `app.js` | 37 | Orchestrator. On `DOMContentLoaded`, wires up the canvas context and calls every module's `setup*()`/`init*()`. | everything |
| `state.js` | 71 | Shared mutable state + constants (URLs, palette). Getter/setter pattern, **no imports**. | — |
| `canvas.js` | 141 | Drawing, brush/eraser, undo history, resize, coordinate scaling, blank-detection, base64 export. | state |
| `fill.js` | 107 | Flood fill (BFS over a `Uint8Array` visited mask) + 6 pattern generators + `hslToRgb`. | state, canvas |
| `colors.js` | 75 | Palette swatches, custom picker, tool selection, brush-size slider, fill-pattern picker, suggestion chips. | state, canvas |
| `setup.js` | 108 | API-key storage + validation, setup overlay, settings gear, backend/voice toggles, **XOR key obfuscation**. | state |
| `generate.js` | 64 | Thin entry: wires the **Bring to Life!** button to `startChatFlow()`; image/video download helpers. | chat-flow |
| `chat.js` | 163 | Chat panel rendering: bubbles (text/image/video/loading), buttons, emoji grid, text input, scroll. Triggers `speak()`. | state, voice |
| `chat-flow.js` | 511 | **The brain.** Recognition fallback chain, response handling, image generation, the whole animation-selection logic, free-form chat, archive trigger. | state, setup, canvas, video, chat, logger, living, regions, story |
| `video.js` | 186 | Veo 3.1 submission + long-poll. Falls through to `storyboard.js` on any failure. | state, canvas, setup, particles, storyboard, logger |
| `storyboard.js` | 139 | LTX Video (HuggingFace Space via `@gradio/client`). Gemini writes the animation prompt. Falls to magic particles. | state, setup, canvas, particles, logger |
| `living.js` | 149 | Client-side "living image": breathing/tilt/scale transforms + 25 golden sparkles on a canvas overlay. Accepts an optional Claude motion plan. | logger |
| `regions.js` | 102 | Per-region animation: slices the image into bbox overlay `<div>`s (background-position trick), animates each independently. | logger |
| `story.js` | 175 | Narrative story arc playback: fetches scenes from Claude, preloads Pollinations stills with stagger, crossfades + narrates. | state, voice, logger |
| `morph.js` | 100 | Sketch-capture + particle-dissolve morph (tile-based). **Defined but not currently called** by the active flow. | state |
| `particles.js` | 73 | 60-particle floating "magic" overlay — final cosmetic fallback. | — |
| `voice.js` | 64 | TTS: strips emoji, POSTs to `/api/speak`, plays returned MP3. Toggle via `voice_off`. | logger |
| `logger.js` | 61 | Persistent event log in localStorage (500-entry ring), `window.lcLog` console helper, downloadable. | — |

### 3.3 Backend (`server/app.py`, 488 lines)
A Flask app that serves the static files **and** exposes `/api/*` endpoints. Every AI endpoint
shells out to the `claude` CLI in non-interactive mode. See §7.

### 3.4 Tests, config, deploy
| File | Role |
|---|---|
| `tests/*.test.js` | 42 Vitest unit tests (jsdom env): `state`, `setup` (XOR key), `canvas` (coordinate scaling, history), `fill` + `flood-fill`. |
| `vitest.config.js` | jsdom environment, globals on. |
| `package.json` | `type: module`, `npm test` → `vitest run`. Dev deps: vitest, jsdom, canvas, @testing-library/dom. **No runtime deps** — the app ships no npm packages to the browser. |
| `requirements.txt` | `flask`, `gunicorn`. |
| `Procfile` / `render.yaml` | Render.com deploy: `gunicorn server.app:app`. |
| `features.{md,html,csv}` | Feature-status tracking (three formats of the same spreadsheet). |

---

## 4. Module dependency graph

```
app.js (orchestrator — calls every setup/init on DOMContentLoaded)
├── state.js              (no imports — the root of the graph)
├── canvas.js             ← state                 (+ dynamic import('./fill.js') for fill tool)
├── fill.js               ← state, canvas
├── colors.js             ← state, canvas
├── setup.js              ← state
├── generate.js           ← chat-flow
├── chat.js               ← state, voice
├── chat-flow.js          ← state, setup, canvas, video, chat, logger, living, regions, story
├── video.js              ← state, canvas, setup, particles, storyboard, logger
├── storyboard.js         ← state, setup, canvas, particles, logger
├── living.js             ← logger
├── regions.js            ← logger
├── story.js              ← state, voice, logger
├── morph.js              ← state                 (orphaned — not wired into the flow)
├── particles.js          (no imports)
├── voice.js              ← logger
└── logger.js             (no imports)
```

**Architectural rules that hold throughout:**
- `state.js` imports nothing and is the single source of shared mutable state. Everyone else
  touches state only through its getters/setters — no globals leak (except a few deliberate
  `window._lc*` handoffs and `window.lcLog`).
- `app.js` is the **only** module that reads DOM elements for initialization.
- The one **circular dependency** between `canvas.js` and `fill.js` (canvas needs to trigger
  fill on click; fill needs `saveState` from canvas) is broken with a **dynamic
  `import('./fill.js')`** inside `startDraw()` (`canvas.js:48`). Clean trick — worth knowing.

---

## 5. The drawing engine (canvas, fill, colors)

### 5.1 Coordinate scaling — the bug that keeps coming back
`canvas.js:getPos()` is the linchpin. The canvas element's **pixel buffer** (`canvas.width`)
differs from its **CSS layout size** (`rect.width`). Every pointer event must scale:

```js
x: (e.clientX - rect.left) * (canvas.width / rect.width)
```

Without this, drawing and especially flood fill hit the wrong pixels. This is called out in
`CLAUDE.md` and covered by `tests/canvas.test.js`. **Any new pointer interaction must use
`getPos`.**

### 5.2 Drawing
- Uses **pointer events** (`pointerdown/move/up/leave`) so mouse + touch + stylus all work.
- `touchstart` is `preventDefault`ed (passive:false) so dragging doesn't scroll the page.
- A stroke is a `beginPath → moveTo → lineTo … stroke` chain with `lineCap/lineJoin = round`.
  Eraser is just a stroke with `strokeStyle = '#ffffff'` (white, not transparent — the canvas
  background is opaque white).

### 5.3 Undo history
- `saveState()` pushes a full `canvas.toDataURL()` snapshot to a 30-entry ring (`MAX_HISTORY`).
- Called **before** every destructive op (draw start, fill, clear).
- `undo()` pops and `drawImage`s the previous data URL.
- **Memory-heavy** (full PNG per step) but dead simple and reliable — an explicit tradeoff
  noted in `CLAUDE.md`.

### 5.4 Flood fill (`fill.js`)
- Classic **BFS** from the click point. A `Uint8Array(w*h)` marks visited pixels (1 byte each,
  cheap). The frontier is a flat `[x,y,x,y,…]` number array used as a stack (`pop` twice).
- **Tolerance match:** a neighbor is filled if the sum of absolute RGB deltas from the seed
  color is `< 48`. This makes fills tolerant of anti-aliased edges.
- **Patterns** are pure functions `(x, y, h) => [r,g,b]`:
  - `solid` — reads the current color through a 1×1 scratch canvas (to normalize any CSS color
    string into RGB). Early-outs if the seed already equals the fill color.
  - `rainbow` — hue from `(x+y)`.
  - `sunset` / `fire` — vertical gradient by `y/h`.
  - `ocean` — sine wave interference.
  - `forest` — `sin(x)*cos(y)` noise.
- `hslToRgb` is the standard formula, unit-tested with exact RGB expectations.

### 5.5 Canvas → AI: `getCanvasBase64()`
Before sending to any vision model, the canvas is **downscaled to 512×512 JPEG @ 0.8 quality**
on a scratch canvas and the base64 payload (sans data-URL prefix) is returned. Keeps request
sizes small. `isCanvasBlank()` samples every 16th pixel and reports blank if all are near-white
(>240 on all channels) — used to nag "draw something first."

---

## 6. The conversational flow (`chat-flow.js`) — the heart of the app

This 511-line file orchestrates the entire user-facing journey. Trace it top to bottom:

### Step 0 — `startChatFlow()` (entry, called by the button)
1. Logs the click. If `isCanvasBlank()`, nags and returns.
2. Resets video UI, hides placeholder/buttons, shows the chat input row.
3. Adds a loading bubble "Looking at your drawing…" and calls `recognizeDrawing()`.

### Step 1 — `recognizeDrawing()` — vision fallback chain
Builds a single prompt asking the model to (a) react like a warm friend to a 2-5 year old in
1-2 sentences with emoji, then (b) append four machine-parseable lines:

```
SUBJECT: <1-3 words>
COMPOSITION: <full figure | headshot | wide scene | …>
DETAILS: <body parts, action, colors, positions>
CHARACTER: <2-3 sentences of distinctive quirks — proportions, shapes, expression>
```

The CHARACTER field is the project's signature idea: **"reimagine the style, not the
character."** It captures what makes *this* drawing unique so the polished output still looks
like the kid's drawing, not a generic stock image.

Providers are tried **in order**, each logging its attempt as a faint system bubble:
1. **Claude Code (local)** — only if `use_backend`. POST `/api/recognize`, 60s timeout.
2. **Gemini 2.5 Flash** — `GEMINI_URL?key=…`, sends prompt + inline JPEG.
3. **Perplexity Sonar** — `api.perplexity.ai/chat/completions`, image as a data URL.

If all three fail → throws "All vision providers unavailable."

`parseSubjectResponse()` splits the text: lines starting with one of the four keys become the
structured fields; everything else is the friendly `message` shown to the child.

### Step 1 response — user confirms the guess
`startChatFlow` shows three buttons: **Yes! ✅ / Hmm, not quite 🤔 / It's a…**, and the
structured info is stashed on `window._lcDrawingInfo` and `window._lcSubject` (a deliberate
cross-module handoff).
- **Yes** → `startGeneration(subject)`.
- **Not quite** → 16-emoji grid (`EMOJI_ITEMS`) → `handleSubjectPicked`.
- **It's a…** → free-text input → `handleSubjectPicked`.

### Step 2 — `startGeneration()` → `generateImage()`
- Reads the style hint and the Reimagine/Faithful toggle.
- If `use_backend`: asks Claude to author the prompt (`/api/generate-prompt`).
- Otherwise builds the prompt client-side from `subject + composition + style + details +
  character`.
- Builds a **Pollinations URL**: `image.pollinations.ai/prompt/<encoded>?width=768&height=768&seed=<rand>&nologo=true`.
- Loads it as an `Image` with `referrerPolicy='no-referrer'` (**required** — Pollinations
  rejects requests carrying a Referer; see §10). On load, shows the image bubble, mirrors it
  into the hidden `#result-image` (for download/video), archives it, and kicks off video.

### Step 3 — `startVideoForChat()` — animation race
This is where the fallback design shines. It uses a `done` latch and two competing paths:
1. Calls `startVeoGeneration(prompt, null, onVideo)` (see §8). If a real video arrives,
   `onVideo` fires, swaps in a `<video>` bubble, and finishes.
2. A **30-second timeout**: if no video by then, it gives up on real video and calls
   `applyLivingToLastImage()` — the client-side animation selector.

### Step 3b — `applyLivingToLastImage()` — the animation ladder
Picks the *best available* animation, in priority order:
1. **Narrative story arc** (`use_backend` only) — `playStory()`. If it returns truthy, done.
2. **Per-region motion** (`use_backend` only) — POST `/api/region-motion`, then
   `animateRegions()`.
3. **Whole-image motion plan** (`use_backend` only) — POST `/api/motion-plan` → a JSON layer
   plan fed into `makeAlive()`.
4. **Default living effect** — `makeAlive()` with a built-in breathing/sparkle plan. Always
   works, no server, no network.

### Free-form chat (`initChatInput` / `handleFreeFormMessage` / `chatWithAI`)
The bottom input is always live. Messages are first checked for local intents
("draw again", "stop/cancel"); otherwise they go to **Perplexity Sonar** with a kid-friendly
system prompt (`chatWithAI`). **Esc** (in the box or globally) aborts current work via an
`AbortController`.

### Archive trigger (`archiveDrawing`)
Only when `use_backend`. POSTs the canvas, the AI image URL, and all metadata to `/api/archive`.

---

## 7. The Flask backend (`server/app.py`)

Serves the static site (`STATIC_DIR` = repo root) and the `/api/*` endpoints. The shared
primitive is `claude(prompt, image_b64=None)`:

- Writes any image to a temp dir, prepends `Read the image file {path} and respond.`
- Runs `claude -p --output-format json --no-session-persistence
  --dangerously-skip-permissions --add-dir <tmp>` with the prompt on **stdin**, 120s timeout.
- **Strips `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` from the env** so the CLI uses the user's
  *subscription* (OAuth) rather than billing an API key. This is the whole point of the local
  backend — it monetizes the Max plan, not pay-per-token.
- Parses the JSON envelope, raises on `is_error`, returns `result`.

### Endpoints
| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /` | Serve `index.html`. | HTML |
| `POST /api/recognize` | Vision recognition via Claude (image in). Parses the SUBJECT/COMPOSITION/DETAILS/CHARACTER block server-side. | `{message, subject, composition, details, character}` |
| `POST /api/generate-prompt` | Claude authors the image prompt (faithful vs reimagine wording). | `{prompt}` |
| `POST /api/animate-prompt` | Claude authors an animation prompt. (Defined; LTX path uses Gemini instead.) | `{prompt}` |
| `POST /api/speak` | ElevenLabs TTS (`eleven_flash_v2_5`, Laura voice). Caps text at 250 chars. | `audio/mpeg` |
| `POST /api/story` | Claude writes a **4-scene** narrative arc as JSON (`title`, `scenes[]` with `image_prompt`, `narration`, `hold_ms`). Strips ``` fences. | story JSON |
| `POST /api/region-motion` | Downloads the AI image (curl UA, no Referer), asks Claude to segment it into 2-5 animatable regions with bbox + anchor + motion vectors. | `{regions:[…]}` |
| `POST /api/motion-plan` | Claude designs a whole-image transform plan (translate/rotate/scale layers). | motion plan JSON |
| `POST /api/archive` | Save `drawing.png` + downloaded `ai_image.jpg` + `meta.json` to a timestamped session dir. | `{saved, path}` |
| `POST /api/archive-story` | Save each scene still + `story.json`. | `{saved, path, title}` |
| `GET/POST /api/archive/config` | Read/update `~/.livingcolor/config.json` (the archive dir). | config JSON |

### Configuration & secrets
- `CLAUDE_CMD` env (default `claude`).
- `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` env, **with hardcoded fallbacks in the source**
  (the `sk_…` key and the "Laura" voice). See §11 security notes.
- Archive dir from `~/.livingcolor/config.json`, default `/mnt/d/livingcolor` (a WSL path — a
  tell that the backend was originally developed on Windows/WSL).
- Dev server: `:8091`, `debug=True`. Prod: gunicorn on `$PORT`.

---

## 8. Video generation (`video.js` + `storyboard.js`)

### Veo 3.1 (`video.js`)
- POST to `VEO_URL?key=<geminiKey>` with the prompt **and the canvas JPEG** as the seed image,
  `durationSeconds: 6`, `16:9`. This is a **long-running operation** — the response is an op
  name, not a video.
- `pollVeoOperation()` polls `VEO_POLL_URL + opName` every **5s**, up to **120 attempts**
  (~10 min ceiling). On HTTP 429 during polling it waits 10s and continues. On `done` it reads
  `response.generateVideoResponse.generatedSamples[0].video.bytesBase64Encoded`, builds a Blob,
  and shows a `<video>` via `showGeneratedVideo()` → fires the chat callback.
- **Routing:** 429 / 401 / 403 / any non-OK status → `startVideoFallback(prompt)` (LTX). No
  API key at all → straight to fallback.
- Abortable via a stored `AbortController` (`getVeoAbort/setVeoAbort`).

> Note the timing interplay: `chat-flow.js` only waits **30s** before switching to the
> client-side living effect, but Veo polling can run for minutes. So in practice, when Veo is
> slow, the user sees the living effect first; if the real video later resolves, the `done`
> latch in `startVideoForChat` has already fired, so the late video is dropped. The latch
> guarantees the user never gets two animations.

### LTX Video (`storyboard.js`)
Despite the filename, this module is the **LTX fallback** (the name is historical — it used to
do a cross-fading storyboard).
- Dynamically imports `@gradio/client` from jsDelivr and connects to the
  `Lightricks/ltx-video-distilled` HuggingFace Space.
- **Mode-aware:** *faithful* → `/image_to_video` seeded with the canvas; *reimagine* →
  `/text_to_video`. Gemini writes the animation prompt first (`getAnimationPrompt`), with
  different instructions per mode (subtle vs cinematic).
- On success, shows the blob `<video>`. On quota/any error → `startMagicEffect()` (particles).

---

## 9. Client-side animation (the always-works tier)

These run entirely in the browser via `requestAnimationFrame`, no server, no quota. They are
what makes the app feel alive even fully offline-of-AI.

### `living.js` — "living image"
- Wraps the image's parent in `position:relative; overflow:hidden`, adds a transparent canvas
  overlay for **25 golden sparkles** (warm hue 40-100) that drift upward and respawn.
- Applies CSS `transform` to the image from a **motion plan**: layers of `translate/rotate/
  scale` transforms, each an oscillator `value = sin(phase·2π) · amplitude` (or linear/ease
  easings). The default plan is gentle breathing: ±4px y, ±0.6° rotate, ±1.5% scale.
- A Claude-designed plan (`/api/motion-plan`) can override the default, but the **structure is
  identical** — Claude just fills in amplitudes/periods suited to the subject (a bird flaps
  faster than a fish swims).

### `regions.js` — per-region motion
The cleverest visual trick. Given a plan of regions (each a `bbox` fraction + `anchor` +
motions), it creates one absolutely-positioned `<div>` per region whose **background is the
full image**, offset with `background-position` so each div shows just its slice. Then it
animates each div's `transform` independently around its anchor. Result: a butterfly's wings
flap, a cat's tail wags — all from a *single still image*, no per-part assets. The region plan
comes from Claude segmenting the image (`/api/region-motion`).

### `story.js` — narrative story arc (the newest, richest path)
- Fetches a 4-scene arc from Claude (`/api/story`), 120s timeout.
- Builds a Pollinations URL per scene, **sharing one random seed across all scenes** for
  character consistency. `sanitizePrompt()` normalizes smart quotes/dashes and strips
  non-ASCII (Pollinations chokes on weird Unicode); caps prompt length at 400 chars.
- **Staggered preload:** scene 1 is awaited; scenes 2…N start loading at 4s intervals (with a
  `&retry=1` fallback) because Pollinations rate-limits parallel hits. Also fires
  `/api/archive-story` to persist the arc.
- Playback: crossfade (opacity 0 → swap `src` → force reflow → opacity 1) per scene, speak the
  narration, hold `clamp(2500, hold_ms, 6000)`. Cancellable via a shared `ctrl` object that
  also tracks timers.

### `particles.js` — magic particles
60 floating particles, the last cosmetic resort when even LTX fails. Pure eye-candy on the
`#sketch-overlay` canvas.

### `morph.js` — sketch dissolve (orphaned)
A tile-based particle-dissolve that explodes the sketch outward. Fully implemented and
unit-test-adjacent but **not wired into the current flow** — a remnant of an earlier
sketch→image transition. Safe to revive or delete.

---

## 10. Cross-cutting concerns & non-obvious mechanics

### `referrerpolicy="no-referrer"` everywhere images load from Pollinations
Pollinations rejects requests that carry a `Referer` header from `file://` and some localhosts.
Set in three places: the static `#result-image` in `index.html`, dynamically-created `Image`
objects in `chat-flow.js` / `story.js`, and chat `<img>`s in `chat.js`. Server-side downloads
in `app.py` use a bare `curl/8` User-Agent and no Referer for the same reason.

### XOR key obfuscation (`setup.js`)
The default Gemini key is stored as a byte array `_p` XOR'd with `"LivingColor"`. `_dk()`
reconstructs it at runtime. This is **not security** — it only defeats GitHub's automated
secret scanners so the repo can ship a working default key. A user-provided key in
localStorage (`gemini_key`) always wins. To rotate: XOR the new key with `"LivingColor"` and
replace `_p` (documented in `CLAUDE.md`).

Similarly, the **Perplexity key is split into string fragments** in `chat-flow.js`
(`'pplx-' + '…' + '…'`) so scanners don't match a contiguous key. Same anti-scanner motive.

### Persistent logging (`logger.js`)
Every meaningful event (`log(category, event, data)`) goes to a 500-entry localStorage ring
**and** `console.log`. The faint system bubbles in chat are a *separate* surface — they're
appended by `logStep()` in chat-flow, which calls both `log()` and `appendMessage({role:
'system'})`. Download via the settings gear or `window.lcLog.download()` from the console.
This is the primary debugging tool — when something misbehaves, the log shows exactly which
provider was tried and why it fell through.

### State handoffs via `window`
The structured drawing info crosses the recognition→generation boundary via
`window._lcSubject` and `window._lcDrawingInfo` rather than `state.js`. Minor inconsistency
with the "everything through state" rule, but intentional and contained.

### Abort / Esc semantics
- Veo has its own `AbortController` in state.
- Free-form chat has `activeAbortController`.
- `story.js` uses a plain `{cancelled, _timers}` object.
- Each new generation calls `stopLiving() / stopRegionAnimation() / stopStory()` so animations
  never stack.

---

## 11. Security & secrets posture (read before deploying)

This is a hobby/kids app and the secret handling reflects that — **do not treat it as
production-secure**:
- **Embedded Gemini key** (XOR'd) ships in the repo. Anyone can extract it; it's rate-limited
  and disposable by design.
- **Embedded Perplexity key** (string-split) ships in the repo. Same caveat.
- **Hardcoded ElevenLabs key** as a fallback default in `server/app.py:17`. This one is a
  *real* `sk_…` key in plaintext — if you push this server publicly, rotate it and move it to
  an env var only.
- The Flask backend runs Claude Code with `--dangerously-skip-permissions`. Fine for a
  trusted local machine; **never expose this server to the internet** as-is — it's an arbitrary
  Claude invocation surface tied to your subscription.
- `debug=True` in the dev server leaks stack traces. The Render/gunicorn path avoids this.

**Bottom line:** the static frontend is safe to host publicly (keys are throwaway). The Flask
backend is a *local-only* power-up and should stay on localhost.

---

## 12. How to run, test, and develop

### Static (no backend)
```bash
cd ~/claude/livingcolor
python3 -m http.server 8090
# open http://localhost:8090
```
Works immediately with the embedded keys. Vision = Gemini→Perplexity, animation = Veo→LTX→
living effect.

### With the local Claude Code backend
```bash
pip install -r requirements.txt        # flask, gunicorn
python3 server/app.py                   # dev server on :8091, debug
# open http://localhost:8091, then settings gear → enable "local Claude Code backend"
```
Requires the `claude` CLI on PATH and a logged-in subscription. Unlocks recognition-via-Claude,
story arcs, region motion, voice, and archiving.

### Tests
```bash
npm install      # vitest, jsdom, canvas, @testing-library/dom (node_modules not committed)
npm test         # vitest run — 42 tests
```
Tests are pure unit tests in jsdom: state getters/setters & constants, XOR key reconstruction
(asserts `^AIzaSy[A-Za-z0-9_-]{33}$`), coordinate scaling & history in canvas, `hslToRgb`, and
flood-fill behavior. They test **observable behavior**, not implementation, per the repo's
testing standard.

### Smoke test (manual)
Per `CLAUDE.md`: serve, draw a shape, click Bring to Life (expect status messages → generated
image → particle/living effect), then exercise undo/clear/eraser/paint-bucket-patterns, and
watch the console for import errors.

---

## 13. Feature status (synthesized from `FEATURES.md` + git history, 2026-06-20)

**Solid / done:** all drawing tools, the three-provider vision chain, character preservation,
toddler chat + buttons + emoji grid + free-form chat, Pollinations image gen, the client-side
living effect, magic particles, conversation logging, ElevenLabs voice, drawing archive,
per-region motion, and narrative story arcs (the two newest commits). 42/42 unit tests pass.

**Works but quota-limited:** Veo 3.1 (free Gemini video tier exhausts fast) and LTX Video
(free HF ZeroGPU). Both are best-effort — the living-effect fallback always catches them.

**In progress / planned:** Wan2GP local GPU video (blocked on a CUDA driver update), a gallery
view of the archive, Suno song generation, and the Render cloud deploy (configs ready, needs
GitHub OAuth).

### Recent trajectory (git log)
The last ~12 commits show the project evolving its **animation sophistication**: from a simple
client-side living effect → Claude-designed motion plans → drawing archive + voice → per-region
segmented motion → full narrative story arcs. The consistent theme is **"make the still image
feel progressively more alive,"** always layered behind graceful fallbacks.

---

## 14. Quick reference — the fallback chains in one glance

```
VISION RECOGNITION (chat-flow.js → recognizeDrawing)
  Claude Code (/api/recognize, backend only)
    → Gemini 2.5 Flash (browser)
      → Perplexity Sonar (browser)
        → throw "All vision providers unavailable"

IMAGE GENERATION (chat-flow.js → generateImage)
  Claude prompt (/api/generate-prompt, backend only) ─┐
  client-side prompt assembly ────────────────────────┴→ Pollinations.ai (always)

VIDEO (video.js / storyboard.js)
  Veo 3.1 (Gemini key)
    → LTX Video (HuggingFace Space)
      → magic particles

CLIENT-SIDE ANIMATION (chat-flow.js → applyLivingToLastImage, fires at 30s if no video)
  story arc (/api/story, backend)
    → per-region motion (/api/region-motion, backend)
      → whole-image motion plan (/api/motion-plan, backend)
        → default living effect (always works)
```

Each arrow is "on any failure, fall through." The last item in every chain needs no server and
no paid quota — which is why LivingColor always produces *something* delightful.
