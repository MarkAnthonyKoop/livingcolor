"""Tests for the mentor verdict shape and the /api/film render gate.

The gate is the product: "earn your film" is theatre unless these refusal
paths genuinely refuse.

Run:  PYTHONPATH=~/claude/livingcolor ~/claude/.venv/bin/python -m pytest server/test_film_gate.py -q
"""
import json
import time

import pytest

from server import core, mentor, projects, video_gen


@pytest.fixture(autouse=True)
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'archive_dir', lambda: tmp_path)


def make_project(engaged=0, revision_count=0):
    return {'id': 'a' * 12, 'engaged_seconds': engaged,
            'revision_count': revision_count, 'subject': 'cat'}


# --- film_gate: pure logic, cannot be sweet-talked ---

def test_gate_refuses_without_time():
    g = mentor.film_gate(make_project(engaged=100, revision_count=1),
                         {'readiness': 10, 'revision': 1})
    assert not g['allowed'] and not g['time_ok'] and g['judged_ok']
    assert any('minutes' in r for r in g['reasons'])


def test_gate_refuses_without_verdict():
    g = mentor.film_gate(make_project(engaged=99999), None)
    assert not g['allowed'] and not g['judged_ok']


def test_gate_refuses_stale_verdict():
    """A passing review then a storyboard edit must invalidate the pass."""
    g = mentor.film_gate(make_project(engaged=99999, revision_count=3),
                         {'readiness': 10, 'revision': 2})
    assert not g['allowed']
    assert any('changed since' in r for r in g['reasons'])


def test_gate_refuses_low_readiness():
    g = mentor.film_gate(make_project(engaged=99999, revision_count=1),
                         {'readiness': 6, 'revision': 1, 'suggestion': 'add a twist'})
    assert not g['allowed']
    assert any('add a twist' in r for r in g['reasons'])


def test_gate_passes_when_earned():
    g = mentor.film_gate(make_project(engaged=99999, revision_count=1),
                         {'readiness': 7, 'revision': 1})
    assert g['allowed'] and g['reasons'] == []


def test_gate_thresholds_come_from_env(monkeypatch):
    monkeypatch.setenv('LIVINGCOLOR_GATE_SECONDS', '60')
    monkeypatch.setenv('LIVINGCOLOR_GATE_READINESS', '9')
    g = mentor.film_gate(make_project(engaged=61, revision_count=1),
                         {'readiness': 8, 'revision': 1})
    assert g['time_ok'] and not g['allowed']


# --- verdict coercion: malformed Claude output must never open the gate ---

@pytest.mark.parametrize('raw', [{}, {'readiness': 'ten'}, {'readiness': None},
                                 {'readiness': [10]}])
def test_bad_readiness_coerces_to_zero(raw):
    assert mentor._coerce_verdict(raw)['readiness'] == 0


def test_readiness_clamped_and_lists_cleaned():
    v = mentor._coerce_verdict({'readiness': 99, 'improved': 'not a list',
                                'weak': [1, {'x': 2}], 'suggestion': 42})
    assert v['readiness'] == 10
    assert v['improved'] == []
    assert all(isinstance(w, str) for w in v['weak'])
    assert v['suggestion'] == ''


# --- mentor.review pins the verdict to the judged revision ---

def test_review_persists_pinned_verdict(monkeypatch):
    p = projects.create('F', 'cat')
    projects.save_revision(p['id'], [{'prompt': 'cat sits'}])
    projects.save_revision(p['id'], [{'prompt': 'cat flies'}])
    monkeypatch.setattr(core, 'claude', lambda *a, **k: json.dumps(
        {'readiness': 5, 'weak': ['no ending'], 'suggestion': 'add an ending'}))
    verdict = mentor.review(projects.load(p['id']),
                            projects.load_revision(p['id']))
    assert verdict['revision'] == 2
    assert projects.latest_verdict(p['id'])['readiness'] == 5


def test_project_chat_grounds_in_the_storyboard(client, monkeypatch):
    pid = client.post('/api/project', json={'subject': 'a cat'}).get_json()['id']
    client.post(f'/api/project/{pid}/storyboard',
                json={'panels': [{'prompt': 'cat on a unicycle'}]})
    seen = {}
    def fake_claude(prompt, *a, **k):
        seen['prompt'] = prompt
        return 'What a wobbly ride! 🚲'
    monkeypatch.setattr(core, 'claude', fake_claude)
    r = client.post(f'/api/project/{pid}/chat', json={'message': 'is my story good?'})
    assert r.get_json()['reply'] == 'What a wobbly ride! 🚲'
    assert 'cat on a unicycle' in seen['prompt']       # grounded in THEIR panels
    assert 'is my story good?' in seen['prompt']
    assert client.post(f'/api/project/{pid}/chat', json={}).status_code == 400
    assert client.post('/api/project/000000000000/chat',
                       json={'message': 'x'}).status_code == 404


def test_revision_history_is_fetchable(client):
    pid = client.post('/api/project', json={}).get_json()['id']
    client.post(f'/api/project/{pid}/storyboard', json={'panels': [{'prompt': 'v1'}]})
    client.post(f'/api/project/{pid}/storyboard', json={'panels': [{'prompt': 'v2'}]})
    r1 = client.get(f'/api/project/{pid}/storyboard/1')
    assert r1.get_json()['panels'][0]['prompt'] == 'v1'
    assert client.get(f'/api/project/{pid}/storyboard/2').get_json()['revision'] == 2
    assert client.get(f'/api/project/{pid}/storyboard/3').status_code == 404
    assert client.get(f'/api/project/{pid}/storyboard/0').status_code == 404


# --- routes ---

def test_project_lifecycle_over_http(client):
    r = client.post('/api/project', json={'name': 'F', 'subject': 'cat'})
    pid = r.get_json()['id']
    r = client.post(f'/api/project/{pid}/storyboard',
                    json={'panels': [{'prompt': 'cat sits'}]})
    assert r.get_json()['revision'] == 1
    r = client.get(f'/api/project/{pid}')
    body = r.get_json()
    assert body['gate']['allowed'] is False
    assert body['storyboard']['panels'][0]['prompt'] == 'cat sits'


@pytest.mark.parametrize('path', ['/api/project/{pid}', '/api/project/{pid}/film',
                                  '/api/project/{pid}/heartbeat',
                                  '/api/project/{pid}/review'])
@pytest.mark.parametrize('pid', ['..%2f..%2fetc', 'zzzzzzzzzzzz', '0' * 12])
def test_bad_ids_404_everywhere(client, path, pid):
    url = path.format(pid=pid)
    r = client.get(url) if url.endswith(pid) and 'film' not in url and \
        'heartbeat' not in url and 'review' not in url else client.post(url, json={})
    # %2f traversal decodes to a path that falls off these routes entirely
    # (405 from the static route) — either way it must never reach a project.
    assert r.status_code in (404, 405)


def test_film_refuses_with_reasons(client):
    pid = client.post('/api/project', json={}).get_json()['id']
    client.post(f'/api/project/{pid}/storyboard',
                json={'panels': [{'prompt': 'x'}]})
    r = client.post(f'/api/project/{pid}/film')
    assert r.status_code == 403
    assert r.get_json()['gate']['reasons']


def _earn(client, monkeypatch, pid):
    """Legitimately satisfy the gate: real verdict on the current revision."""
    monkeypatch.setenv('LIVINGCOLOR_GATE_SECONDS', '0')
    projects.append_verdict(pid, {'readiness': 10, 'revision': 1})


def test_film_earned_but_no_provider_is_503(client, monkeypatch):
    pid = client.post('/api/project', json={}).get_json()['id']
    client.post(f'/api/project/{pid}/storyboard', json={'panels': [{'prompt': 'x'}]})
    _earn(client, monkeypatch, pid)
    monkeypatch.delenv('VEO_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    r = client.post(f'/api/project/{pid}/film')
    assert r.status_code == 503


def test_film_availability_reports_without_leaking(client, monkeypatch):
    monkeypatch.setenv('VEO_API_KEY', 'sk-SECRETVALUE')
    monkeypatch.setenv('VEO_MODEL', 'veo-3.1-fast-generate-preview')
    r = client.get('/api/film-availability')
    body = r.get_json()
    assert body == {'provider': 'veo', 'available': True,
                    'model': 'veo-3.1-fast-generate-preview'}
    assert 'SECRETVALUE' not in r.get_data(as_text=True)
    monkeypatch.delenv('VEO_API_KEY')
    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    assert client.get('/api/film-availability').get_json()['available'] is False


class FakeProvider(video_gen.BaseProvider):
    name = 'fake'
    def available(self):
        return True
    def render(self, shot):
        return b'mp4bytes'


def test_film_earned_with_provider_starts_job(client, monkeypatch):
    pid = client.post('/api/project', json={}).get_json()['id']
    client.post(f'/api/project/{pid}/storyboard',
                json={'panels': [{'prompt': 'x', 'narration': 'hi'}]})
    _earn(client, monkeypatch, pid)
    monkeypatch.setattr(video_gen, 'get_provider', lambda *a, **k: FakeProvider())
    r = client.post(f'/api/project/{pid}/film')
    assert r.status_code == 200
    job_id = r.get_json()['job_id']
    for _ in range(50):
        status = client.get(f'/api/film/{job_id}').get_json()
        if status['state'] == 'done':
            break
        time.sleep(0.05)
    assert status['state'] == 'done' and status['clips'] == 1

    # the film survived to disk and is servable — the whole point of paying
    films = client.get(f'/api/project/{pid}/films').get_json()['films']
    assert films == [{'job_id': job_id, 'clips': ['shot_01.mp4'],
                      'narrations': ['hi'], 'film': None, 'narrated': None}]

    # a narrated mix dropped beside the shots becomes listed and servable
    from server import projects
    job_dir = projects.projects_dir() / pid / 'films' / job_id
    (job_dir / 'film_narrated.mp4').write_bytes(b'narratedbytes')
    films = client.get(f'/api/project/{pid}/films').get_json()['films']
    assert films[0]['narrated'] == 'film_narrated.mp4'
    r = client.get(f'/api/project/{pid}/films/{job_id}/film_narrated.mp4')
    assert r.status_code == 200 and r.data == b'narratedbytes'
    r = client.get(f'/api/project/{pid}/films/{job_id}/shot_01.mp4')
    assert r.status_code == 200
    assert r.mimetype == 'video/mp4'
    assert r.data == b'mp4bytes'


def test_film_clips_survive_restart(client, monkeypatch):
    """The films listing reads disk, not the in-memory job table."""
    pid = client.post('/api/project', json={}).get_json()['id']
    client.post(f'/api/project/{pid}/storyboard', json={'panels': [{'prompt': 'x'}]})
    _earn(client, monkeypatch, pid)
    monkeypatch.setattr(video_gen, 'get_provider', lambda *a, **k: FakeProvider())
    job_id = client.post(f'/api/project/{pid}/film').get_json()['job_id']
    for _ in range(50):
        if client.get(f'/api/film/{job_id}').get_json()['state'] == 'done':
            break
        time.sleep(0.05)
    with video_gen._lock:
        video_gen._jobs.clear()          # simulate a worker restart
    assert client.get(f'/api/film/{job_id}').status_code == 404   # memory gone
    films = client.get(f'/api/project/{pid}/films').get_json()['films']
    assert films and films[0]['clips'] == ['shot_01.mp4']         # disk remains


def test_clip_serving_refuses_symlink_escape(client, tmp_path_factory):
    from server import projects
    pid = client.post('/api/project', json={}).get_json()['id']
    outside = tmp_path_factory.mktemp('outside')
    (outside / 'shot_01.mp4').write_bytes(b'secret outside bytes')
    films_root = projects.projects_dir() / pid / 'films'
    films_root.mkdir(parents=True)
    (films_root / ('b' * 12)).symlink_to(outside)
    r = client.get(f'/api/project/{pid}/films/{"b" * 12}/shot_01.mp4')
    assert r.status_code == 404
    assert b'secret' not in r.data


@pytest.mark.parametrize('job,clip', [
    ('..', 'shot_01.mp4'),
    ('zzzzzzzzzzzz', 'shot_01.mp4'),
    ('a' * 12, '../project.json'),
    ('a' * 12, 'film.json'),             # metadata is not servable
    ('a' * 12, 'shot_1.mp4'),
    ('a' * 12, 'shot_01.mp4.orig'),
    ('a' * 12, 'film_narrated.mp4.bak'),
    ('a' * 12, 'concat.txt'),
])
def test_clip_serving_refuses_hostile_paths(client, job, clip):
    pid = client.post('/api/project', json={}).get_json()['id']
    r = client.get(f'/api/project/{pid}/films/{job}/{clip}')
    assert r.status_code in (404, 405)
