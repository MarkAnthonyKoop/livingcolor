#!/usr/bin/env python3
"""Real-browser end-to-end test of the LIVE LivingColor site.

Everything else we test is unit tests or curl; this is the only harness that
exercises what a child actually experiences — a real mouse drawing on the real
canvas in a real browser against the deployed app.

Politeness: it takes over the screen, so it refuses to start unless the Mac has
been idle for --idle-secs (default 120). Run it when nobody is at the machine.

    python3 tests/browser/live_browser_test.py            # full flow
    python3 tests/browser/live_browser_test.py --idle-secs 0 --no-generate

Requires ~/claude/computer_control (realclick + screencapture) and Chrome.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

CC = Path.home() / 'claude' / 'computer_control'
URL = 'https://livingcolor.cc.middlematter.com'
SHOTS = Path('/tmp/livingcolor_browser_test')


def cc(*args: str) -> str:
    """Run a computer_control command and return stdout."""
    r = subprocess.run(['/opt/homebrew/bin/python3', str(CC / 'cc.py'), *args],
                       capture_output=True, text=True, cwd=str(CC))
    if r.returncode != 0:
        raise RuntimeError(f'cc {args[0]} failed: {r.stderr.strip()[:200]}')
    return r.stdout.strip()


def idle_seconds() -> float:
    return float(cc('idle'))


def shot(label: str) -> Path:
    SHOTS.mkdir(exist_ok=True)
    path = SHOTS / f'{label}.png'
    cc('shot', str(path))
    return path


def drag(x1: int, y1: int, x2: int, y2: int, steps: int = 12) -> None:
    """Draw a stroke with a real mouse drag (CGEvent down/move/up)."""
    subprocess.run([str(CC / 'realdrag'), str(x1), str(y1), str(x2), str(y2),
                    str(steps)], check=False)


def draw_shape(cx: int, cy: int, r: int = 90) -> None:
    """A crude closed shape a toddler might draw — a lopsided box."""
    drag(cx - r, cy - r, cx + r, cy - r)
    drag(cx + r, cy - r, cx + r, cy + r)
    drag(cx + r, cy + r, cx - r, cy + r)
    drag(cx - r, cy + r, cx - r, cy - r)
    drag(cx - r // 2, cy - r // 3, cx - r // 4, cy - r // 3)   # an eye
    drag(cx + r // 4, cy - r // 3, cx + r // 2, cy - r // 3)   # another


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--idle-secs', type=float, default=120,
                    help='refuse to run unless the Mac has been idle this long')
    ap.add_argument('--no-generate', action='store_true',
                    help='draw only; do not click Bring to Life (no AI spend)')
    ap.add_argument('--url', default=URL)
    args = ap.parse_args()

    idle = idle_seconds()
    if idle < args.idle_secs:
        print(f'REFUSING: Mac idle only {idle:.0f}s (<{args.idle_secs:.0f}s). '
              f'Someone is using it — run later or pass --idle-secs 0.')
        return 2

    print(f'Mac idle {idle:.0f}s — starting. Screenshots → {SHOTS}')
    cc('open', 'Google Chrome')
    time.sleep(2)
    # Pin the window to a known place and size — without this, a stray
    # Terminal or video window under the cursor swallows the clicks and the
    # coordinate map below is meaningless (cost us one inconclusive run).
    subprocess.run(['osascript', '-e',
                    'tell application "Google Chrome" to activate', '-e',
                    'tell application "Google Chrome" to set bounds of front window '
                    'to {0, 25, 1200, 875}'], check=False, capture_output=True)
    time.sleep(1)
    cc('combo', 'cmd', 'l')
    cc('type', args.url)
    cc('key', 'return')
    time.sleep(6)
    shot('01_loaded')

    # Coordinates assume the pinned {0,25,1200,875} window: canvas center
    # ~(300, 547), Bring to Life button ~(1075, 788). The drawing just needs
    # to be *somewhere* on the canvas — charming misreads are the product.
    draw_shape(300, 520, 70)
    time.sleep(1)
    shot('02_drawn')

    if args.no_generate:
        print('drew a shape; skipping generation (--no-generate)')
        return 0

    # "Bring to Life" sits under the canvas; click by finding it visually is
    # brittle, so we use the keyboard path the app also supports.
    print('clicking Bring to Life…')
    subprocess.run(['osascript', '-e',
                    'tell application "Google Chrome" to activate'],
                   check=False, capture_output=True)   # reclaim focus
    time.sleep(1)
    drag(300, 700, 300, 700, 1)          # focus the page
    cc('click', '1075', '788')
    for i in range(6):
        time.sleep(15)
        shot(f'03_generating_{i}')
    shot('04_final')
    print(f'done — inspect {SHOTS}/*.png (04_final should show art + story)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
