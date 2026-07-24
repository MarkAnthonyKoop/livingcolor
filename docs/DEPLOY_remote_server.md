# Deploying LivingColor on `remote_server` (Hetzner)

Status: **plan** (2026-06-25). Not yet executed — waits on the Hetzner box being provisioned by
`~/claude/remote_server/` (which itself waits on Mark's Hetzner API token). This doc is the
migration recipe so it's a one-shot when creds land.

## Why move off Render

LivingColor's backend (`server/app.py`) is a Flask app whose "smart" features **shell out to the
`claude` CLI** (`CLAUDE_CMD`, default `claude`) running on the user's subscription. Render's free
plan can't host a logged-in `claude` CLI cleanly, and it sleeps. The shared `remote_server` box
gives us:
- a persistent host with the **`claude` CLI installed and authed** via `CLAUDE_CODE_OAUTH_TOKEN`
  (smart features bill Mark's subscription, no API key),
- real **disk** for the server-side drawing archive (`~/.livingcolor/config.json` → `archive_dir`),
- automatic **TLS + a subdomain** via the box's Caddy reverse proxy,
- co-tenancy with `renway` and the marketing cron — one ~$5/mo box, many apps.

Render can stay as a fallback; this is additive.

## Runtime shape (already in the repo)

- Start command (unchanged): `gunicorn server.app:app --bind 0.0.0.0:$PORT`  (see `Procfile`)
- Deps: `flask==3.1.1`, `gunicorn==23.0.0`  (`requirements.txt`)
- Listens on `$PORT` (default 8091; `server/app.py:486`).

So the `remote_server` deploy contract fits directly:
```
./deploy.sh livingcolor --subdomain livingcolor      # from ~/claude/remote_server/, once provisioned
```
That renders a systemd unit running gunicorn + a Caddy site block for the subdomain.

## Environment variables to set on the server (in `/etc/livingcolor/env`)

| Var | Purpose | Source |
|-----|---------|--------|
| `CLAUDE_CODE_OAUTH_TOKEN` | headless `claude` brain on Mark's subscription | `claude setup-token` |
| `ELEVENLABS_API_KEY` | TTS voice | **ROTATE FIRST — see security note** |
| `ELEVENLABS_VOICE_ID` | voice (default Laura `FGY2WhTYpPnrIDTdsKH5`) | optional |
| `GEMINI_API_KEY` | Veo video (optional, quota-limited) | existing |
| `PERPLEXITY_API_KEY` | (declared in `render.yaml`) | existing |
| `CLAUDE_CMD` | path to the `claude` binary if not on PATH | optional |
| `PORT` | gunicorn bind port behind Caddy | set by deploy |

The archive location lives in `~/.livingcolor/config.json` (`archive_dir`) — point it at a real
path on the box (e.g. `/var/lib/livingcolor`) rather than the WSL-era default `/mnt/d/livingcolor`.

## ⚠️ Security action required before deploy (Mark)

`server/app.py:17` hardcodes a **live ElevenLabs API key** as the env fallback:
```python
ELEVENLABS_KEY = os.environ.get('ELEVENLABS_API_KEY', 'sk_adb35…c108e9d7cccb')
```
This key is committed to a public GitHub repo and must be treated as **compromised**:
1. **Rotate it** in the ElevenLabs dashboard (revoke the old, mint a new one).
2. **Remove the literal** from `app.py:17` → `os.environ.get('ELEVENLABS_API_KEY')` (env-only).
3. Store the new key in **`credanger`** (`credanger set ELEVENLABS_API_KEY`) — the one secret
   store (`~/claude/credanger/`). Deploy renders it into `/etc/livingcolor/env` via
   `credanger export-env livingcolor`; for local dev, `export $(credanger env livingcolor)`.
Same applies to any frontend keys hidden via the `setup.js` XOR "obfuscation" (README §Architecture
decisions) — obfuscation is not secrecy; anything client-side is public.

I left `app.py` unchanged (rotation is yours to do, and removing the literal breaks TTS until the
env var is set) — but it's the first step once you're back.

## Sequence once Mark returns

1. Provide `HCLOUD_TOKEN` + domain → `remote_server` provisions the box.
2. `claude setup-token` → put `CLAUDE_CODE_OAUTH_TOKEN` in the box env; verify `claude -p` works there.
3. Rotate ElevenLabs key; set env vars in `/etc/livingcolor/env`.
4. `./deploy.sh livingcolor --subdomain livingcolor`; point DNS; verify TLS + a test drawing → TTS.
