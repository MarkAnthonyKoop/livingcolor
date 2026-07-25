"""Endpoint tests for ai_routes + motion-plan (claude/urlopen mocked)."""
import json

from server import core
from server import ai_routes


CLAUDE_RECOGNIZE_REPLY = (
    'Wow, is that a fluffy cat? 🐱\n'
    'SUBJECT: cat\n'
    'COMPOSITION: full figure\n'
    'DETAILS: an orange cat with a long tail\n'
    'CHARACTER: Oblong head, tiny legs, huge grin.'
)


def test_recognize_parses_fields_and_message(client, monkeypatch):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: CLAUDE_RECOGNIZE_REPLY)
    r = client.post('/api/recognize', json={'image': 'aGk='})
    assert r.status_code == 200
    body = r.get_json()
    assert body['subject'] == 'cat'
    assert body['composition'] == 'full figure'
    assert body['details'] == 'an orange cat with a long tail'
    assert body['character'] == 'Oblong head, tiny legs, huge grin.'
    assert body['message'] == 'Wow, is that a fluffy cat? 🐱'  # meta lines stripped


def test_recognize_claude_failure_is_500_json(client, monkeypatch):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: (_ for _ in ()).throw(RuntimeError('boom')))
    r = client.post('/api/recognize', json={'image': 'aGk='})
    assert r.status_code == 500
    assert 'boom' in r.get_json()['error']


def test_chat_requires_message(client):
    assert client.post('/api/chat', json={}).status_code == 400


def test_chat_returns_trimmed_reply(client, monkeypatch):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: '  Nice drawing! 🎨  ')
    r = client.post('/api/chat', json={'message': 'look at my cat'})
    assert r.status_code == 200
    assert r.get_json()['reply'] == 'Nice drawing! 🎨'


def test_generate_prompt_modes_shape_the_instruction(client, monkeypatch):
    seen = []
    monkeypatch.setattr(core, 'claude', lambda p, *a, **k: seen.append(p) or 'a prompt')
    r = client.post('/api/generate-prompt', json={'subject': 'cat', 'mode': 'faithful'})
    assert r.status_code == 200 and r.get_json()['prompt'] == 'a prompt'
    assert 'faithfully' in seen[0]
    client.post('/api/generate-prompt', json={'subject': 'cat', 'mode': 'reimagine'})
    assert 'magical' in seen[1]


def test_animate_prompt(client, monkeypatch):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: 'gentle sway')
    r = client.post('/api/animate-prompt', json={'subject': 'cat'})
    assert r.status_code == 200 and r.get_json()['prompt'] == 'gentle sway'


def test_speak_requires_text_and_key(client, monkeypatch):
    assert client.post('/api/speak', json={}).status_code == 400
    monkeypatch.setattr(core, 'ELEVENLABS_KEY', '')
    assert client.post('/api/speak', json={'text': 'hello'}).status_code == 503


def test_speak_caps_text_and_returns_audio(client, monkeypatch):
    monkeypatch.setattr(core, 'ELEVENLABS_KEY', 'k')
    sent = {}

    def fake_urlopen(req, timeout):
        sent['payload'] = json.loads(req.data.decode())
        class R:
            def read(self):
                return b'mp3bytes'
        return R()
    monkeypatch.setattr(ai_routes.urllib.request, 'urlopen', fake_urlopen)
    r = client.post('/api/speak', json={'text': 'x' * 1000})
    assert r.status_code == 200
    assert r.mimetype == 'audio/mpeg'
    assert r.data == b'mp3bytes'
    assert len(sent['payload']['text']) == 250  # cost-control cap


def test_motion_plan_parses_fenced_json(client, monkeypatch):
    monkeypatch.setattr(core, 'claude', lambda *a, **k: '```json\n{"duration_ms": 4000, "layers": []}```')
    r = client.post('/api/motion-plan', json={'subject': 'cat'})
    assert r.status_code == 200
    assert r.get_json()['duration_ms'] == 4000
