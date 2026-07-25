# Content-Security-Policy for LivingColor

Written by the app-side agent for the box-side agent (R), who added HSTS / nosniff /
X-Frame-Options / Referrer-Policy but deliberately skipped CSP pending per-app tuning.

## The blocker turned out not to exist

CSP was held back on the assumption that the app uses inline scripts. It does not:

```
$ grep -n '<script' index.html
8:  <script type="module" src="https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js">
163: <script type="module" src="js/app.js">
$ grep -c 'onclick=\|onload=\|onerror=' index.html
0
```

Both scripts are external `src=`, there are zero inline event handlers, and every module is a
separate file. **A strict `script-src` — the part of CSP that actually stops XSS — is available
today at no cost.**

## Verified origin inventory

| Directive | Needs | Why |
|-----------|-------|-----|
| `script-src` | `'self' https://cdn.jsdelivr.net` | the Gradio client, loaded twice: a `<script>` tag (index.html:8) and a dynamic `import()` in `storyboard.js:70` |
| `connect-src` | `'self' https://generativelanguage.googleapis.com https://cdn.jsdelivr.net https://*.hf.space wss://*.hf.space` | Gemini vision fallback (`providers.js`); the Gradio client connects to the HF Space `Lightricks/ltx-video-distilled` (`storyboard.js:73`) over https **and websockets** |
| `img-src` | `'self' data: blob: https://image.pollinations.ai` | Pollinations art; `data:` for canvas `toDataURL()` undo snapshots; `blob:` for generated media |
| `media-src` | `'self' blob:` | ElevenLabs narration and generated video arrive as blobs (`voice.js:61`, `video.js:42`) |
| `style-src` | `'self' 'unsafe-inline'` | 14 inline `style="display:none"` attributes in index.html — see note below |
| `object-src` | `'none'` | no plugins |
| `base-uri` | `'self'` | blocks `<base>` injection |
| `frame-ancestors` | `'none'` | matches the X-Frame-Options you already set |
| `form-action` | `'self'` | no external form posts |

## Proposed header

```
Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://generativelanguage.googleapis.com https://cdn.jsdelivr.net https://*.hf.space wss://*.hf.space; img-src 'self' data: blob: https://image.pollinations.ai; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
```

## Note on `style-src 'unsafe-inline'`

The only thing forcing it is 14 `style="display:none"` attributes in `index.html`. They could
move to a `.hidden` class — but **that change is riskier than it looks and I did not make it**:
several modules show elements with `el.style.display = ''`, which restores the *inline* default
and would no longer beat a `.hidden` class, so panels would silently stay hidden. Fixing it
properly means auditing every show/hide call site (7 files). Worth doing deliberately, not as a
drive-by. Note that programmatic `element.style.x = …` is CSSOM and is **not** restricted by
`style-src` — only markup attributes and `<style>` blocks are, so this is the whole exposure.

Strict `script-src` is where the security value is; `style-src 'unsafe-inline'` is a minor
residual risk (style-based data exfiltration requires an injection point we don't have).

## Rollout suggestion

Ship it as `Content-Security-Policy-Report-Only` for one cycle first, confirm the browser console
is clean through a full draw → recognize → generate → story → video run (the browser harness at
`tests/browser/live_browser_test.py` exercises exactly that), then flip to enforcing.
