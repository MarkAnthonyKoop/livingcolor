# CLAUDE.md -- LivingColor

## Gotchas

### Pollinations referrerPolicy
The `<img>` tag for Pollinations results MUST have `referrerpolicy="no-referrer"` (set in `index.html` on `#result-image`). Without it, Pollinations rejects requests from `file://` and some localhost origins. The storyboard image loader in `storyboard.js` also sets `img.referrerPolicy = 'no-referrer'` on dynamically created Image objects.

### No embedded Gemini key (removed 2026-07-26)
There is no default API key anymore — the old XOR-obfuscated key in `setup.js` was revoked
(Google reported it as leaked) and has been deleted. `getApiKey()` returns the user's stored key
or `''`; every caller (`providers.js`, `video.js`, `storyboard.js`) treats an empty key as
"skip Gemini/Veo and fall back" (vision/chat run server-side on Claude). A user can still paste
their own key in settings for the direct-Gemini paths.

### Coordinate Scaling for Flood Fill
`getPos()` in `canvas.js` scales mouse coordinates by `(canvas.width / rect.width)` to account for CSS-scaled canvases. The canvas element's pixel dimensions differ from its CSS layout dimensions. Without this scaling, flood fill and drawing would hit wrong coordinates. This same fix applies to all pointer events.

### Veo -> Storyboard -> LTX -> Particles Fallback Chain
When video generation is triggered (in `generate.js` via `startVeoGeneration`):
1. **Veo** is attempted first. If it returns 429 (quota), it falls through.
2. **Storyboard** -- Gemini generates 4 scene prompts, Pollinations renders each as a still, then they cross-fade in a loop. This runs in parallel with Veo (storyboard starts immediately from `loadResultImage`).
3. **LTX Video** -- free HuggingFace Space via Gradio client dynamic import. Only triggered if both Veo and storyboard fail.
4. **Magic particles** -- purely cosmetic floating particle overlay as last resort.

The storyboard runs in parallel with Veo (both start from `loadResultImage`). If Veo succeeds, it replaces the storyboard with real video.

### Rate Limit Behaviors
- Gemini 429/503 during drawing analysis: returns null, falls back to user's style hint as the prompt.
- Gemini 401/403: clears stored key, shows setup overlay.
- Veo 429: triggers fallback chain (storyboard then LTX).
- Veo polling 429: waits 10 seconds then retries (up to 120 attempts total).

### Canvas History
Undo history stores full canvas `toDataURL()` snapshots (up to 30). This is memory-heavy for large canvases but simple and reliable. `saveState()` is called before every destructive operation (draw start, fill, clear).

## Deployment & the two-agent workflow (2026-07-26)
This app is **deployed**: https://livingcolor.cc.middlematter.com (Hetzner box owned by
`~/claude/remote_server`). A second Claude session ("R") works that box and **auto-deploys every
commit you land here**, then verifies it live. Practical consequences for you:
- **Commit messages are a communication channel** to that agent — its loop is commit-gated, so an
  action item in a commit subject reaches it reliably; a note in a shared doc may not.
- Anything touching `server/` or `js/` gets redeployed; docs/test-only commits are skipped.
- Before claiming something is fixed in production, **probe production** (`curl`), don't trust a
  summary — that gap once hid an undeployed security fix.
- Read `docs/HANDOFF.md` and `~/claude/living_color/CREAM.md` before starting work.

## Testing conventions established 2026-07-25
- **Mutation-test every fix**: revert it, confirm the test goes red, restore. Several tests here
  were once written that *could not fail* (assertions accepting the outcome they forbade, stubs
  that prevented the code under test from running). A green suite means nothing without this.
- Adversarial suites live beside the normal ones (`server/test_adversarial.py`,
  `tests/adversarial.test.js`) and attack our own defenses rather than exercising happy paths.
- `tests/browser/live_browser_test.py` drives the real site with a real mouse. It is **idle-gated**
  (refuses unless the Mac is idle 120s) because it seizes the screen. Only this class of test finds
  real-UI bugs — it caught a layout break that 179 unit tests and a 23-agent review all missed.

## Smoke Test
1. Serve with `python3 -m http.server` and open in browser.
2. Draw a simple shape (circle, star).
3. Click "Bring to Life" -- should show status messages, then a generated image with particle dissolve.
4. Test undo (Ctrl+Z), clear, eraser, paint bucket with rainbow pattern.
5. Check browser console for any import errors or missing exports.

## Module Boundaries
See README Architecture section for the dependency graph. Key rule: `state.js` has no imports. `app.js` is the only file that touches the DOM for init. All other modules export functions that `app.js` or each other call.

## Files
- `js/app.js` is the active orchestrator. (The old root `app.js` monolith was deleted
  2026-07-26 — recover from git history if ever needed.)
