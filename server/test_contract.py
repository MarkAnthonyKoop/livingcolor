"""The consumer half of the client/server archive contract.

tests/contract.test.js asserts js/story.js EMITS this exact payload; this file
asserts the server ACCEPTS it and stores every field. Both read the same
fixture, so a drift on either side fails on both sides at once.
"""
import json
import pathlib

import pytest

from server import core

FIXTURE = pathlib.Path(__file__).resolve().parent.parent / 'tests' / 'contract' / 'archive_story_payload.json'


@pytest.fixture()
def payload():
    data = json.loads(FIXTURE.read_text())
    data.pop('_comment', None)
    return data


def test_server_accepts_the_client_contract_payload(client, payload, monkeypatch):
    monkeypatch.setattr(core, 'fetch_image', lambda url, dest=None, **k: (
        dest.write_bytes(b'jpeg') if dest is not None else b'jpeg'))
    r = client.post('/api/archive-story', json=payload)
    assert r.status_code == 200, r.get_data(as_text=True)[:300]
    body = r.get_json()
    assert body['title'] == payload['title']
    # one saved image per scene, plus the manifest
    assert 'story.json' in body['saved']
    assert sum(1 for s in body['saved'] if s.startswith('scene_')) == len(payload['scenes'])


def test_stored_manifest_preserves_every_scene_field(client, payload, monkeypatch):
    monkeypatch.setattr(core, 'fetch_image', lambda url, dest=None, **k: (
        dest.write_bytes(b'jpeg') if dest is not None else b'jpeg'))
    r = client.post('/api/archive-story', json=payload)
    stored = json.loads((pathlib.Path(r.get_json()['path']) / 'story.json').read_text())

    assert stored['title'] == payload['title']
    assert len(stored['scenes']) == len(payload['scenes'])
    for got, want in zip(stored['scenes'], payload['scenes']):
        assert got['narration'] == want['narration']
        assert got['image_prompt'] == want['image_prompt']
        assert got['hold_ms'] == want['hold_ms']


def test_contract_scene_urls_pass_the_ssrf_allowlist(payload):
    """Every URL the client sends must survive the server's own guard —
    otherwise archiving silently fails for real stories."""
    for scene in payload['scenes']:
        core._check_image_url(scene['image_url'])   # must not raise


def test_fixture_declares_the_fields_the_handler_reads(payload):
    """Guards against the fixture drifting away from the handler's expectations."""
    assert set(payload) == {'subject', 'title', 'scenes'}
    for scene in payload['scenes']:
        assert set(scene) == {'narration', 'image_prompt', 'image_url', 'hold_ms'}
