"""Unit tests for server/app.py helpers + endpoints (claude/urlopen mocked).

Run:  PYTHONPATH=~/claude/livingcolor ~/claude/.venv/bin/python -m pytest server/test_app.py -q
"""
import json

import pytest

from server import core
from server import app as appmod


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'archive_dir', lambda: tmp_path)
    appmod.app.config['TESTING'] = True
    with appmod.app.test_client() as c:
        yield c


# --- parse_claude_json ---

@pytest.mark.parametrize('raw', [
    '{"a": 1}',
    '```json\n{"a": 1}\n```',
    '```json\n{"a": 1}```',        # closing fence on the same line as the JSON
    '```\n{"a": 1}\n```\n',
    '  {"a": 1}  ',
])
def test_parse_claude_json_variants(raw):
    assert core.parse_claude_json(raw) == {'a': 1}


def test_parse_claude_json_invalid_raises():
    with pytest.raises(json.JSONDecodeError):
        core.parse_claude_json('not json at all')


# --- fetch_image ---

@pytest.mark.parametrize('url', [
    'file:///etc/passwd',
    'http://169.254.169.254/latest/meta-data',
    'https://evil.com/x.jpg',
    'https://image.pollinations.ai.evil.com/x',
    'ftp://image.pollinations.ai/x',
])
def test_fetch_image_refuses_disallowed(url):
    with pytest.raises(ValueError, match='refusing to fetch'):
        core.fetch_image(url)


def test_fetch_image_allows_pollinations_and_writes_dest(tmp_path, monkeypatch):
    class FakeResponse:
        def read(self):
            return b'jpegbytes'
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
    monkeypatch.setattr(core.urllib.request, 'urlopen', lambda req, timeout: FakeResponse())
    dest = tmp_path / 'img.jpg'
    body = core.fetch_image('https://image.pollinations.ai/prompt/cat', dest)
    assert body == b'jpegbytes'
    assert dest.read_bytes() == b'jpegbytes'


# --- /api/story ---

def test_story_parses_same_line_fence(client, monkeypatch):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: '```json\n{"title": "T", "scenes": []}```')
    r = client.post('/api/story', json={'subject': 'cat'})
    assert r.status_code == 200
    assert r.get_json()['title'] == 'T'


def test_story_invalid_json_returns_payload_not_crash(client, monkeypatch):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: 'sorry, no JSON here')
    r = client.post('/api/story', json={'subject': 'cat'})
    assert r.status_code == 500
    body = r.get_json()
    assert 'invalid JSON' in body['error']
    assert body['raw'].startswith('sorry')


def test_story_decode_error_inside_claude_no_unboundlocal(client, monkeypatch):
    def boom(*a, **k):
        raise json.JSONDecodeError('bad', 'doc', 0)
    monkeypatch.setattr(core, 'claude', boom)
    r = client.post('/api/story', json={'subject': 'cat'})
    assert r.status_code == 500
    assert r.get_json()['raw'] == ''  # handler must not raise UnboundLocalError


# --- SSRF via endpoints ---

def test_archive_story_refuses_bad_scene_urls(client):
    r = client.post('/api/archive-story', json={
        'subject': 's', 'title': 't',
        'scenes': [{'narration': 'n', 'image_prompt': 'p',
                    'image_url': 'file:///etc/passwd', 'hold_ms': 4000}],
    })
    assert r.status_code == 200
    saved = r.get_json()['saved']
    assert any('failed' in s and 'refusing to fetch' in s for s in saved)
    assert 'story.json' in saved


def test_archive_refuses_bad_ai_image_url(client):
    r = client.post('/api/archive', json={
        'subject': 's', 'ai_image_url': 'http://169.254.169.254/latest',
    })
    assert r.status_code == 200
    assert any('ai_image_failed' in s for s in r.get_json()['saved'])


def test_region_motion_refuses_bad_url(client):
    r = client.post('/api/region-motion', json={'image_url': 'file:///etc/passwd'})
    assert r.status_code == 500
    assert 'refusing to fetch' in r.get_json()['error']


def test_region_motion_requires_url(client):
    r = client.post('/api/region-motion', json={})
    assert r.status_code == 400
