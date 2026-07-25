# LivingColor

Draw something, then watch AI bring it to life. The AI sees your drawing, reacts in a kid-friendly chat, generates a polished version, and animates it.

## User Manual

1. Open `index.html` in a browser (or `python3 -m http.server 8090` for local serving).
2. Draw on the canvas — pencil, eraser, paint bucket (with patterns: solid, rainbow, sunset, ocean, fire, forest).
3. Click **Bring to Life! ✨**.
4. The AI guesses what you drew and asks if it got it right. Click **Yes! ✅** / **Hmm 🤔** / **It's a…** or pick an emoji from the grid.
5. A polished AI image appears, then animation kicks in: either a real video (Veo / LTX) or a client-side "living" effect (breathing + sparkles).
6. Chat freely with the AI any time using the input at the bottom. Press **Esc** to stop current work.

Optional: toggle **Reimagine** (default, AI creates magical interpretation) vs **Faithful** (preserves your drawing's style).

## Features

### Drawing tools
- **Pencil** with adjustable brush size (1-80px)
- **Eraser**
- **Paint bucket** with flood fill + 6 patterns (solid / rainbow / sunset / ocean / fire / forest)
- 16-color palette + custom color picker
- **Undo** (Ctrl+Z, 30 levels)
- **Clear canvas**

### AI conversation
- **Vision recognition** with character preservation — captures composition (full figure / headshot / wide scene), details (body parts, action), and character (proportions, quirks, expression)
- **Toddler-friendly chat** — warm, simple, emoji-rich personality
- **Always-on chat input** — type anytime, press Enter or click → to send
- **System log messages** — see which AI provider is being tried ("Trying Gemini Vision… / Gemini rate limited, trying Perplexity…")
- **Emoji grid fallback** if AI guesses wrong — 16 common subjects

### AI providers (fallback chain)
1. **Local Claude Code** (your Max subscription) — when Flask backend is running and toggle is on
2. **Gemini 2.5 Flash Vision** — browser-side, obfuscated key
3. **Perplexity Sonar** — browser-side, your API key (split to avoid scanners)

### Image generation
- **Pollinations.ai** — free, no auth, 768×768 polished image
- Composition + character preserved from the original drawing
- Optional style hint ("watercolor", "pixel art", etc.)

### Animation (video fallback chain)
1. **Veo 3.1** — best, 6-sec AI video, via Gemini key (subject to quota)
2. **LTX Video** — free 2-sec via HuggingFace Spaces (subject to GPU quota)
3. **Wan2GP local** — runs on your RTX 3060+ (in progress, needs CUDA 13 driver)
4. **Client-side "living" effect** — breathing scale + tilt + golden sparkles on the still image

### Persistence
- **Conversation log** — every event captured to localStorage with timestamps. Click gear icon → **Download conversation log** for debugging.
- **Drawing archive** (when Flask running) — saves human drawings + AI outputs to `/mnt/d/livingcolor/` (configurable, see Architecture)

## Architecture

### Files
```
livingcolor/
  index.html                — single-page app shell
  style.css                 — dark theme, chat bubbles, animations
  app.js                    — legacy monolith (backup, not loaded)
  js/
    app.js                  — orchestrator, imports all modules
    state.js                — shared mutable state (canvas, history, chat)
    canvas.js               — drawing, undo, resize, getPos
    fill.js                 — flood fill + 6 patterns (rainbow, sunset, ocean, fire, forest)
    colors.js               — color swatches, tool selection, suggestion chips
    setup.js                — API key management + backend toggle + settings overlay
    generate.js             — wraps startChatFlow as the main entry
    chat.js                 — chat UI rendering (bubbles, buttons, emoji grid)
    chat-flow.js            — conversational flow orchestration, free-form input
    providers.js            — AI provider calls (recognition, prompt generation)
    animate-flow.js         — animation fallback chain (story → regions → motion plan)
    story.js                — story-arc playback (scenes, crossfades, narration)
    voice.js                — TTS via /api/speak (epoch-guarded cancellation)
    regions.js              — per-region animation from Claude segmentation
    morph.js                — sketch capture + particle dissolve animation
    living.js               — breathing + sparkles + tilt effect on still images
    video.js                — Veo generation and polling
    storyboard.js           — LTX Video fallback
    particles.js            — magic particle effect (final fallback)
    logger.js               — persistent conversation log in localStorage
  server/
    app.py                  — thin Flask shell: static + blueprint registration
    core.py                 — config, claude() CLI wrapper, fetch_image allowlist, parse_claude_json
    ai_routes.py            — /api/recognize, /api/chat, /api/generate-prompt, /api/animate-prompt, /api/speak
    motion_routes.py        — /api/story, /api/region-motion, /api/motion-plan
    archive_routes.py       — /api/archive, /api/archive-story, /api/archive/config
    test_app.py             — 19 pytest tests (helpers + endpoint contracts, claude/urlopen mocked)
  tests/                    — 51 vitest tests (state, setup, canvas, fill, flood-fill, story)
  vitest.config.js
  package.json
```

### Module dependency graph
```
app.js (orchestrator)
├── state.js                (shared state, no deps)
├── canvas.js               ← state
├── fill.js                 ← state, canvas
├── colors.js               ← state, canvas
├── setup.js                ← state
├── generate.js             ← chat-flow
├── chat.js                 ← state
├── chat-flow.js            ← state, canvas, video, chat, providers, animate-flow, living, regions, story, logger
├── providers.js            ← state, setup, canvas, chat, logger
├── animate-flow.js         ← chat, living, regions, story, logger
├── story.js                ← state, voice, logger
├── voice.js                ← logger
├── morph.js                ← state, canvas
├── living.js               ← logger
├── video.js                ← state, canvas, setup, storyboard, particles, logger
├── storyboard.js           ← state, setup, particles, logger
├── particles.js            (no deps)
└── logger.js               (no deps)
```

### Architecture decisions
- **Static-first** — works on GitHub Pages with zero server, browser handles everything
- **Optional Flask backend** — adds Claude Code via user's subscription (CLI shellout) and drawing archive
- **ES modules with `type="module"`** — no bundler, clean imports
- **State module with getters/setters** — shared state without globals
- **API key obfuscation** — XOR encoding in setup.js avoids GitHub secret scanners
- **`referrerpolicy="no-referrer"`** on Pollinations images — they reject requests with a Referer header
- **Cross-origin fetch** uses `gradio_client` CDN for LTX, direct fetch for everything else

### Status (2026-07-24)
- 🚀 **Deployed**: https://livingcolor.cc.middlematter.com (Hetzner box, Caddy TLS, systemd; see
  `docs/DEPLOY_remote_server.md` + `~/claude/remote_server/`)
- ✅ Security hardening verified in prod: all client-URL fetches allowlisted (SSRF closed); no
  third-party API keys in client JS (chat/vision/TTS are server-side)
- ✅ Stop/cancel correctness: Escape or "stop" halts story + narration; no stale TTS; no phantom archives
- ✅ Suites: 51/51 vitest + 19/19 pytest; live smoke + health monitor run from `remote_server`
- ✅ File-size caps met: server split into blueprints, chat-flow split into modules (2026-07-24)
- 📝 Two-agent build/deploy flow documented in `docs/AGENT_COLLAB.md`

### Status (2026-05-28)
- ✅ Drawing tools (all working)
- ✅ Chat-based conversation with composition + character preservation
- ✅ Image generation (Pollinations, always works)
- ✅ Client-side "living" effect on still images (breathing + sparkles)
- ✅ Conversation log (localStorage + downloadable)
- ✅ 42/42 unit tests passing
- ⚠️ Veo video — requires Gemini key with quota (free tier easily exhausted)
- ⚠️ LTX Video — requires HuggingFace ZeroGPU quota (free, exhausted easily)
- 🔄 Wan2GP local — installed, blocked on CUDA driver update (in progress)
- 📝 Drawing archive — see CLAUDE.md, runs server-side only
- 📝 Vector motion — Claude Code generates motion plan, frontend animates (in progress)
