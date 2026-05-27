# CLAUDE.md -- LivingColor

## Gotchas

### Pollinations referrerPolicy
The `<img>` tag for Pollinations results MUST have `referrerpolicy="no-referrer"` (set in `index.html` on `#result-image`). Without it, Pollinations rejects requests from `file://` and some localhost origins. The storyboard image loader in `storyboard.js` also sets `img.referrerPolicy = 'no-referrer'` on dynamically created Image objects.

### XOR Key Obfuscation
The `_p` array in `setup.js` is the default Gemini API key XOR'd byte-by-byte with the string `"LivingColor"` (the `_s` constant). The `_dk()` function reconstructs it. This is not security -- it just prevents casual scraping. If you need to update the embedded key, XOR the new key with "LivingColor" and replace the `_p` array.

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

## Smoke Test
1. Serve with `python3 -m http.server` and open in browser.
2. Draw a simple shape (circle, star).
3. Click "Bring to Life" -- should show status messages, then a generated image with particle dissolve.
4. Test undo (Ctrl+Z), clear, eraser, paint bucket with rainbow pattern.
5. Check browser console for any import errors or missing exports.

## Module Boundaries
See README Architecture section for the dependency graph. Key rule: `state.js` has no imports. `app.js` is the only file that touches the DOM for init. All other modules export functions that `app.js` or each other call.

## Files
- `app.js` (root) is the old monolith kept as backup. Not loaded by `index.html`.
- `js/app.js` is the active orchestrator.
