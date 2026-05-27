# LivingColor

Draw something on canvas, then watch AI bring it to life as a polished artwork, animated storyboard, or video.

## User Manual

1. Open `index.html` in a browser (or serve with any HTTP server -- `python3 -m http.server`).
2. Draw on the left canvas with the pencil, eraser, or paint-bucket tools.
3. Optionally type a style hint ("watercolor", "pixel art", "3D render") or click a suggestion chip.
4. Click **Bring to Life**. The app will:
   - Analyze your drawing with Gemini Vision
   - Generate a polished image via Pollinations.ai
   - Play a particle-dissolve morph from sketch to result
   - Attempt video generation (Veo, then storyboard, then LTX, then magic particles)
5. Download the result image or video with the buttons below the result panel.

An embedded API key works out of the box. To use your own, click the gear icon and paste a Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## Reference

### Drawing Tools

| Tool | Shortcut | Description |
|------|----------|-------------|
| Pencil | default | Freehand drawing in selected color |
| Eraser | toolbar | Draws in white |
| Fill | toolbar | Flood fill with solid color or pattern (rainbow, sunset, ocean, fire, forest) |
| Brush size | slider | 1-80px |
| Undo | Ctrl+Z | Reverts to previous canvas state (30 levels) |
| Clear | toolbar | Fills canvas white |

### Color Palette

16 preset swatches plus a custom color picker. Clicking a swatch while using the eraser auto-switches to pencil.

### Suggestion Chips

Pre-filled style hints: smiley face, cat, house, tree, flower, sunset, heart, mountains, dragon, car.

### APIs Used

- **Gemini 2.5 Flash** -- drawing analysis (vision) and storyboard prompt generation
- **Pollinations.ai** -- free image generation from text prompts
- **Google Veo 3.1** -- video generation from image + prompt (requires Veo-enabled key)
- **LTX Video (Lightricks)** -- free video fallback via HuggingFace Spaces / Gradio client

### Video Fallback Chain

1. **Veo** -- best quality, requires paid/quota key
2. **Storyboard** -- Gemini generates 4 scene prompts, Pollinations renders frames, cross-fade animation
3. **LTX Video** -- free HuggingFace Space, ~30s generation
4. **Magic particles** -- purely local canvas animation as last resort

### File Structure

```
index.html          -- single-page app shell
style.css           -- dark theme, responsive layout
app.js              -- legacy monolith (backup, not loaded)
js/
  app.js            -- thin orchestrator, imports and calls init
  state.js          -- shared mutable state (canvas, colors, tool, history)
  canvas.js         -- canvas setup, drawing, brush, eraser, undo, clear
  fill.js           -- flood fill with pattern support, hslToRgb
  colors.js         -- color swatches, tool selection, suggestion chips
  setup.js          -- API key management, setup overlay, settings gear
  generate.js       -- generate flow: analyze, build prompt, load image, download
  morph.js          -- sketch capture and particle-dissolve animation
  video.js          -- Veo generation and polling
  storyboard.js     -- storyboard generation, frame loading, LTX fallback
  particles.js      -- floating magic particle effect
```

## Architecture

### Module Dependency Graph

```
app.js (orchestrator)
  +-- state.js        (shared state, no dependencies)
  +-- canvas.js       (depends on: state)
  +-- fill.js         (depends on: state, canvas)
  +-- colors.js       (depends on: state, canvas)
  +-- setup.js        (depends on: state)
  +-- generate.js     (depends on: state, canvas, setup, video, morph)
  +-- morph.js        (depends on: state)
  +-- video.js        (depends on: state, canvas, setup, storyboard, particles)
  +-- storyboard.js   (depends on: state, setup, particles)
  +-- particles.js    (no dependencies)
```

### Design Decisions

- **ES modules with `type="module"`** -- enables clean import/export without bundler.
- **Getter/setter state module** -- avoids global variables while keeping state shared across modules. Each module imports only the state accessors it needs.
- **No build step** -- the app runs directly from static files. The Gradio client is loaded from CDN via dynamic `import()` only when LTX fallback is needed.
- **Pollinations.ai for images** -- free, no API key required, just URL-encode the prompt.
- **Embedded API key** -- XOR-obfuscated default key allows zero-config usage. Users can override via the settings gear.
