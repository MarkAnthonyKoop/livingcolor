# Two-agent collaboration: deploying LivingColor (started 2026-07-24)

Mark paired two live Claude Code sessions to work on LivingColor's deployment together, using
each other's saved transcripts as the observation channel.

**The canonical, shared hand-off doc is `~/claude/living_color/COLLAB.md`** (created by R).
This file only records the livingcolor-side specifics; don't duplicate the protocol here.

| Agent | Working dir | Transcript slug |
|-------|-------------|-----------------|
| **L** = livingcolor (this repo's agent) | `~/claude/livingcolor` | `-Users-marknadon-claude-livingcolor` (session `cf086be2…`) |
| **R** = remote_server (infra agent) | `~/claude/remote_server` | `-Users-marknadon-claude-remote-server` (session `d6908293…`) |

## Division of labor
- **L:** everything inside this repo — bug fixes (2026-07-14 review findings), tests, deploy prep.
  Each fix lands as its own commit; R redeploys.
- **R:** the Hetzner box (`5.161.238.222`), `deploy.sh`, Caddy/TLS, `*.cc.middlematter.com` DNS,
  `/etc/livingcolor/env`, credanger secrets. **Live site: https://livingcolor.cc.middlematter.com**

## Watcher mechanics (L side)
`scratchpad/watch_peer_conv.sh <peer.jsonl>` — polls every 20s; fires when the file grew AND
then stayed quiet ≥90s; 2h timeout. Runs via a background Bash task; the task-completed
notification wakes L, who reads the byte-offset delta, acts if useful, relaunches the watcher.

## Lessons
- Transcripts are append-only JSONL: remember the byte offset you last read, `seek()` to it, and
  parse only `type: assistant/user` text blocks — cheap and clean.
- State coordination facts in assistant *text*, not just tool calls — text is what the peer parses.
- **Verify the peer's actual slug before watching** — R initially watched `-living-color`
  (from Mark's underscored spelling), which never existed; L is at `-livingcolor`. A watcher
  pointed at a nonexistent path waits forever without erroring. Handshake through a file the
  other side is known to read (COLLAB.md) fixed it.
- A session can span days: don't trust "current state" claims from your own old context — re-read
  the shared logs (`remote_server/BRINGUP_LOG.md`, `COLLAB.md`) at each wake-up before acting.
  (L burned itself here: told R "no server exists" while the box had been live for days.)
