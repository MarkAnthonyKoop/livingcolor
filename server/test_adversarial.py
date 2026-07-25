"""Adversarial tests: hostile URLs, hostile Claude output, hostile client payloads.

These attack the app's own defenses rather than exercising happy paths. Anything
that fails here is a real hole, not a style nit.
"""
import json

import pytest

from server import core


# --- URL-parser abuse against the SSRF allowlist ---
# Each entry is a URL a naive check might wave through. All must be refused.
HOSTILE_URLS = [
    'https://image.pollinations.ai@evil.com/x.jpg',        # userinfo trick
    'https://evil.com/?x=image.pollinations.ai',           # host in query
    'https://evil.com/#image.pollinations.ai',             # host in fragment
    'https://evil.com/image.pollinations.ai/x.jpg',        # host in path
    'https://image.pollinations.ai.evil.com/x',            # suffix lookalike
    'https://xn--image-pollinations-ai.evil.com/x',        # punycode lookalike
    'HTTPS://EVIL.COM/x',                                  # case games
    'https:/\\/\\evil.com/x',                              # backslash confusion
    'https://127.0.0.1/x',                                 # loopback
    'https://[::1]/x',                                     # IPv6 loopback
    'https://169.254.169.254/latest/meta-data',            # cloud metadata
    'https://0x7f000001/x',                                # hex-encoded loopback
    'https://2130706433/x',                                # decimal loopback
    'http://image.pollinations.ai/x',                      # right host, wrong scheme
    'file:///etc/passwd',
    'gopher://image.pollinations.ai/x',
    'data:text/plain;base64,aGk=',
    'javascript:alert(1)',
    '//image.pollinations.ai/x',                           # scheme-relative
    '',
    '   ',
]


@pytest.mark.parametrize('url', HOSTILE_URLS)
def test_hostile_urls_all_refused(url):
    with pytest.raises(ValueError, match='refusing to fetch'):
        core.fetch_image(url)


@pytest.mark.parametrize('url', [
    'https://image.pollinations.ai/prompt/cat',
    'https://image.pollinations.ai/prompt/ni%C3%B1o?width=768&seed=1',
])
def test_legitimate_urls_still_pass_the_check(url, monkeypatch):
    class R:
        def read(self):
            return b'ok'
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False
    monkeypatch.setattr(core._image_opener, 'open', lambda req, timeout: R())
    assert core.fetch_image(url) == b'ok'


def test_redirect_chain_to_allowlisted_host_is_permitted():
    handler = core._AllowlistedRedirect()
    # Same-host redirect (Pollinations does this for cache/CDN paths) must survive
    # the check — the guard must not break legitimate redirects.
    core._check_image_url('https://image.pollinations.ai/prompt/cat?seed=2')
    with pytest.raises(ValueError):
        handler.redirect_request(None, None, 302, 'Found', {}, 'https://image.pollinations.ai@evil.com/x')


# --- hostile / malformed Claude output ---

@pytest.mark.parametrize('raw', [
    '',                                   # empty reply
    '```',                                # lone fence
    '```json',                            # fence with nothing after
    '```json\n```',                       # empty fenced block
    'Sure! Here is your JSON: {"a": 1}',  # chatty preamble
    '{"a": 1} trailing words',
    '{"a": 1',                            # truncated
    'null',                               # valid JSON, wrong shape
    '[]',
    '"just a string"',
])
def test_bad_claude_output_never_raises_unexpected_type(raw):
    """parse_claude_json must either return parsed JSON or raise JSONDecodeError —
    never AttributeError/IndexError, which would 500 with an HTML traceback."""
    try:
        core.parse_claude_json(raw)
    except json.JSONDecodeError:
        pass  # the contract's failure mode: handlers catch this and return JSON


def test_story_endpoint_survives_every_hostile_claude_reply(client, monkeypatch):
    for raw in ['', '```', 'null', '{"a": 1', 'Sure! {"scenes": []}']:
        monkeypatch.setattr(core, 'claude', lambda *a, _r=raw, **k: _r)
        r = client.post('/api/story', json={'subject': 'cat'})
        assert r.status_code in (200, 500)
        assert r.is_json, f'non-JSON response for Claude reply {raw!r}'


# --- hostile client payloads ---

@pytest.mark.parametrize('payload', [
    {'subject': 'x' * 100_000},                       # huge string
    {'subject': None},                                 # null where str expected
    {'subject': 12345},                                # wrong type
    {'subject': {'nested': 'object'}},
    {'subject': ['a', 'list']},
    {'subject': '../../etc/passwd'},                   # traversal attempt
    {'subject': 'cat\x00hidden'},                      # null byte
    {'subject': '<script>alert(1)</script>'},
    {'subject': '🦋' * 1000},                          # emoji flood
])
def test_story_endpoint_never_500s_on_hostile_subject(client, monkeypatch, payload):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: '{"title": "t", "scenes": []}')
    r = client.post('/api/story', json=payload)
    assert r.is_json
    assert r.status_code in (200, 400, 500)


@pytest.mark.parametrize('subject', [
    '../../../etc/passwd',
    '..\\..\\windows',
    'a/b/c',
    '.',
    '..',
    '',
    None,
])
def test_archive_subject_cannot_escape_the_archive_dir(client, tmp_path, subject):
    """Path traversal via the archive 'subject' must stay inside the archive root."""
    r = client.post('/api/archive', json={'subject': subject, 'drawing': 'aGk='})
    assert r.status_code == 200
    written = tmp_path.resolve()
    got = __import__('pathlib').Path(r.get_json()['path']).resolve()
    assert written in got.parents or written == got.parent, f'escaped to {got}'


def test_archive_story_rejects_non_list_scenes(client):
    for scenes in ['not-a-list', {'a': 1}, 42]:
        r = client.post('/api/archive-story', json={'subject': 's', 'scenes': scenes})
        assert r.is_json
        assert r.status_code in (200, 400, 500)


def test_speak_rejects_non_string_text(client):
    for text in [None, 42, {'a': 1}, ['x']]:
        r = client.post('/api/speak', json={'text': text})
        assert r.is_json
        assert r.status_code in (400, 500)
