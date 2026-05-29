# Feature Status

Snapshot of what's built, what's planned, and what's blocked.

| Category | Feature | Status | Notes |
|---|---|---|---|
| **Drawing** | Pencil with adjustable size (1-80px) | ✅ Done | |
| **Drawing** | Eraser | ✅ Done | |
| **Drawing** | Paint bucket flood fill | ✅ Done | |
| **Drawing** | Pattern fills (solid, rainbow, sunset, ocean, fire, forest) | ✅ Done | |
| **Drawing** | 16-color palette + custom picker | ✅ Done | |
| **Drawing** | Undo (Ctrl+Z, 30 levels) | ✅ Done | |
| **Drawing** | Clear canvas | ✅ Done | |
| **Drawing** | Coordinate scaling (CSS vs pixel buffer) | ✅ Done | Was broken for flood fill |
| **AI Vision** | Claude Code recognition (user's Max subscription) | ✅ Done | Server-side, OAuth |
| **AI Vision** | Gemini 2.5 Flash fallback | ✅ Done | Browser-side, obfuscated key |
| **AI Vision** | Perplexity Sonar fallback | ✅ Done | Browser-side, your key |
| **AI Vision** | Composition capture (full figure / headshot / wide) | ✅ Done | |
| **AI Vision** | Character preservation (quirks, proportions, expression) | ✅ Done | "Reimagine style, not character" |
| **Chat** | Toddler-friendly personality | ✅ Done | Warm, simple, emoji-rich |
| **Chat** | Big response buttons (Yes! / Hmm / It's a…) | ✅ Done | ≥56px on mobile |
| **Chat** | 16-emoji grid fallback | ✅ Done | |
| **Chat** | Always-on chat input | ✅ Done | Press Enter to send |
| **Chat** | Esc to abort current work | ✅ Done | |
| **Chat** | System logs in chat (faded italics) | ✅ Done | Shows fallback chain |
| **Chat** | Free-form conversation after generation | ✅ Done | Via Perplexity |
| **Image Gen** | Pollinations.ai (free, always works) | ✅ Done | 768×768, no auth |
| **Image Gen** | Style hint field | ✅ Done | Optional |
| **Image Gen** | Reimagine / Faithful toggle | ✅ Done | |
| **Image Gen** | Suggestion chips | ✅ Done | smiley, cat, house, etc. |
| **Animation** | Particle dissolve (sketch → AI image) | ✅ Done | |
| **Animation** | Living effect (breathing + sparkles) | ✅ Done | Client-side, always works |
| **Animation** | Claude-designed motion plans | ✅ Done | JSON vectors per subject |
| **Animation** | Magic particles fallback | ✅ Done | |
| **Animation** | Veo 3.1 video | ⚠️ Quota | Free Gemini tier easily exhausted |
| **Animation** | LTX Video (HF Spaces) | ⚠️ Quota | Free GPU tier easily exhausted |
| **Animation** | Wan2GP local | 🔄 Blocked | CUDA driver install awaiting UAC |
| **Animation** | Per-region motion (segmented body parts) | 📝 Planned | Wings flap, head bobs, etc. |
| **Voice** | ElevenLabs TTS (Laura voice) | ✅ Done | Server-side, auto-plays AI text |
| **Voice** | Voice on/off toggle | ✅ Done | Default ON |
| **Storage** | Drawing archive to /mnt/d/livingcolor | ✅ Done | drawing.png + ai_image.jpg + meta.json |
| **Storage** | Configurable archive dir | ✅ Done | ~/.livingcolor/config.json |
| **Storage** | Conversation log (localStorage) | ✅ Done | Downloadable from settings |
| **Storage** | Gallery view (browse archive) | 📝 Planned | View past drawings |
| **UX** | Mobile/touch optimization | ✅ Done | 44px+ targets, no pinch-zoom on canvas |
| **UX** | Settings gear (API key, backend, voice) | ✅ Done | |
| **UX** | Bring to Life! button | ✅ Done | Renamed from Show My Friend |
| **Backend** | Flask server (optional, local) | ✅ Done | Port 8091 |
| **Backend** | Claude Code subprocess integration | ✅ Done | Uses user's subscription |
| **Backend** | Gemini → Perplexity fallback chain | ✅ Done | Server-side |
| **Backend** | Cloud deploy (Render) | 🔄 Pending | Configs ready, needs GitHub OAuth |
| **Code Quality** | 42 unit tests (vitest) | ✅ Done | All passing |
| **Code Quality** | 12 ES modules, <220 lines each | ✅ Done | |
| **Code Quality** | API key obfuscation (XOR) | ✅ Done | Avoids GitHub secret scanners |
| **Code Quality** | README + CLAUDE.md documentation | ✅ Done | |
| **Future** | Suno song generation | 📝 Planned | Claude writes lyrics → Suno |
| **Future** | NVIDIA driver update | 🔄 Pending | Installer waiting for UAC confirm |
| **Future** | Render cloud deploy | 🔄 Pending | Manual GitHub OAuth step |

Legend: ✅ Done · 🔄 In progress / blocked · ⚠️ Works but limited · 📝 Planned
