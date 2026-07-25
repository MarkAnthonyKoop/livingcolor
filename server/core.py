"""Shared backend core: config, the claude() CLI wrapper, and fetch/parse helpers."""

import os
import json
import subprocess
import tempfile
import base64
import urllib.parse
import urllib.request
from pathlib import Path

CLAUDE_CMD = os.environ.get('CLAUDE_CMD', 'claude')
ELEVENLABS_KEY = os.environ.get('ELEVENLABS_API_KEY', '')  # from /etc/livingcolor/env; never commit a key here
ELEVENLABS_VOICE = os.environ.get('ELEVENLABS_VOICE_ID', 'FGY2WhTYpPnrIDTdsKH5')  # Laura

# Hosts we will download client-supplied image URLs from. Everything else is
# rejected — urlopen would otherwise honor file:// and internal-network URLs.
ALLOWED_IMAGE_HOSTS = {'image.pollinations.ai'}


def fetch_image(url, dest=None, timeout=60):
    """Fetch an image URL and return its bytes, optionally also writing them to
    dest. Only https on ALLOWED_IMAGE_HOSTS is permitted."""
    parts = urllib.parse.urlparse(url)
    if parts.scheme != 'https' or parts.hostname not in ALLOWED_IMAGE_HOSTS:
        raise ValueError(f'refusing to fetch from {parts.scheme}://{parts.hostname}')
    req = urllib.request.Request(url, headers={'User-Agent': 'curl/8'})  # No Referer; Pollinations rejects it
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if dest is not None:
        dest.write_bytes(body)
    return body


def parse_claude_json(text):
    """Parse Claude's JSON reply, tolerating a wrapping markdown code fence —
    including a closing fence on the same line as the JSON."""
    text = text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1] if '\n' in text else ''
    if text.endswith('```'):
        text = text[:-3]
    return json.loads(text.strip())


# --- Drawing archive: configurable storage location ---
CONFIG_DIR = Path.home() / '.livingcolor'
CONFIG_FILE = CONFIG_DIR / 'config.json'


def get_config():
    """Load config from ~/.livingcolor/config.json, creating defaults if needed."""
    CONFIG_DIR.mkdir(exist_ok=True)
    if not CONFIG_FILE.exists():
        default = {'archive_dir': '/mnt/d/livingcolor'}
        CONFIG_FILE.write_text(json.dumps(default, indent=2))
        return default
    return json.loads(CONFIG_FILE.read_text())


def archive_dir():
    """Return the archive directory, creating it if needed."""
    d = Path(get_config().get('archive_dir', str(Path.home() / 'livingcolor')))
    d.mkdir(parents=True, exist_ok=True)
    return d


def claude(prompt, image_b64=None):
    """Run Claude Code in non-interactive mode. Returns response text."""
    with tempfile.TemporaryDirectory() as tmpdir:
        img_path = None
        if image_b64:
            img_path = os.path.join(tmpdir, 'drawing.png')
            with open(img_path, 'wb') as f:
                f.write(base64.b64decode(image_b64))

        full_prompt = prompt
        if img_path:
            full_prompt = f'Read the image file {img_path} and respond.\n\n{prompt}'

        env = os.environ.copy()
        env.pop('ANTHROPIC_API_KEY', None)
        env.pop('CLAUDE_API_KEY', None)

        result = subprocess.run(
            [CLAUDE_CMD, '-p', '--output-format', 'json',
             '--no-session-persistence', '--dangerously-skip-permissions',
             '--add-dir', tmpdir],
            input=full_prompt, capture_output=True, text=True,
            timeout=120, cwd=tmpdir, env=env
        )

        if result.returncode != 0:
            raise RuntimeError(f'Claude Code error: {result.stderr[:200]}')

        data = json.loads(result.stdout)
        if data.get('is_error'):
            raise RuntimeError(data.get('result', 'Unknown error'))
        return data.get('result', '')
