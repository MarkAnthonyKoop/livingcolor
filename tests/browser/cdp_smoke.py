#!/usr/bin/env python3
"""Headless real-Chrome smoke test of the live site via the DevTools protocol.

Unlike live_browser_test.py (real mouse, takes the screen, idle-gated), this
drives a THROWAWAY headless Chrome — runs anytime, disturbs nothing, and is
deterministic: elements are found by DOM, not coordinates. It draws on the
real canvas with synthesized input events, clicks Bring to Life, and waits
for the chat flow to produce a recognition message from the live backend.

    ~/claude/.venv/bin/python tests/browser/cdp_smoke.py
    ~/claude/.venv/bin/python tests/browser/cdp_smoke.py --url http://localhost:8123 --no-generate

Needs: websockets (in the ~/claude/.venv), Chrome. Exit 0 on pass.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 9224
SHOTS = Path('/tmp/livingcolor_cdp_smoke')


class Tab:
    def __init__(self, ws):
        self.ws = ws
        self.msg_id = 0

    async def call(self, method, **params):
        self.msg_id += 1
        await self.ws.send(json.dumps({'id': self.msg_id, 'method': method,
                                       'params': params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get('id') == self.msg_id:
                if 'error' in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result', {})

    async def js(self, expression):
        r = await self.call('Runtime.evaluate', expression=expression,
                            returnByValue=True, awaitPromise=True)
        return r.get('result', {}).get('value')

    async def shot(self, label):
        SHOTS.mkdir(exist_ok=True)
        r = await self.call('Page.captureScreenshot', format='png')
        (SHOTS / f'{label}.png').write_bytes(base64.b64decode(r['data']))


async def draw_on_canvas(tab):
    """A toddler's lopsided box + two eyes, via synthesized mouse events on
    the real canvas element."""
    box = await tab.js(
        "JSON.stringify(document.getElementById('drawing-canvas').getBoundingClientRect())")
    r = json.loads(box)
    cx, cy = r['x'] + r['width'] / 2, r['y'] + r['height'] / 2
    s = min(r['width'], r['height']) / 4

    async def stroke(x1, y1, x2, y2):
        await tab.call('Input.dispatchMouseEvent', type='mousePressed',
                       x=x1, y=y1, button='left', clickCount=1)
        for i in range(1, 9):
            await tab.call('Input.dispatchMouseEvent', type='mouseMoved',
                           x=x1 + (x2 - x1) * i / 8, y=y1 + (y2 - y1) * i / 8,
                           button='left')
        await tab.call('Input.dispatchMouseEvent', type='mouseReleased',
                       x=x2, y=y2, button='left', clickCount=1)

    await stroke(cx - s, cy - s, cx + s, cy - s)
    await stroke(cx + s, cy - s, cx + s, cy + s)
    await stroke(cx + s, cy + s, cx - s, cy + s)
    await stroke(cx - s, cy + s, cx - s, cy - s)
    await stroke(cx - s / 2, cy - s / 3, cx - s / 4, cy - s / 3)
    await stroke(cx + s / 4, cy - s / 3, cx + s / 2, cy - s / 3)


async def run(url, generate):
    import websockets
    tabs = json.load(urllib.request.urlopen(f'http://localhost:{PORT}/json'))
    ws_url = next(t['webSocketDebuggerUrl'] for t in tabs
                  if t['url'].startswith(url.rstrip('/')))
    async with websockets.connect(ws_url, max_size=32 * 1024 * 1024) as ws:
        tab = Tab(ws)
        await tab.call('Page.enable')
        title = await tab.js('document.title')
        assert 'LivingColor' in title, f'unexpected title: {title}'

        blank = await tab.js(
            "import('/js/canvas.js').then(m => m.isCanvasBlank())")
        assert blank is True, 'canvas should start blank'
        await draw_on_canvas(tab)
        blank = await tab.js(
            "import('/js/canvas.js').then(m => m.isCanvasBlank())")
        assert blank is False, 'drawing did not reach the canvas'
        await tab.shot('01_drawn')
        print('PASS: real canvas received the drawing')

        if not generate:
            return

        await tab.js("document.getElementById('generate-btn').click()")
        deadline = time.time() + 90
        while time.time() < deadline:
            n = await tab.js(
                "document.querySelectorAll('#chat-messages .chat-msg, #chat-messages > *').length")
            msg = await tab.js(
                "document.getElementById('chat-messages').innerText.slice(0, 200)")
            if msg and len(msg.strip()) > 20 and 'Looking at' not in msg:
                await tab.shot('02_recognized')
                print(f'PASS: live recognition replied: {msg.strip()[:120]!r}')
                return
            await asyncio.sleep(3)
        raise AssertionError('no recognition reply within 90s')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='https://livingcolor.cc.middlematter.com')
    ap.add_argument('--no-generate', action='store_true')
    args = ap.parse_args()

    profile = tempfile.mkdtemp(prefix='lc_cdp_')
    proc = subprocess.Popen(
        [CHROME, '--headless', f'--remote-debugging-port={PORT}',
         f'--user-data-dir={profile}', '--window-size=1280,900', args.url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(4)
        asyncio.run(run(args.url, not args.no_generate))
        print(f'done — screenshots in {SHOTS}')
        return 0
    finally:
        proc.terminate()


if __name__ == '__main__':
    sys.exit(main())
