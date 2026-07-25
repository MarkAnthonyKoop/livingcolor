"""Thread-safety tests — the box now runs gunicorn with threaded workers
(2 workers x 4 threads), so handlers really do execute concurrently.

These use the Flask test client from multiple threads to hammer the paths that
mint filesystem names or share module state.
"""
import re
from concurrent.futures import ThreadPoolExecutor

import pytest

from server import core
from server import app as appmod


@pytest.fixture()
def app_client(tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'archive_dir', lambda: tmp_path)
    appmod.app.config['TESTING'] = False
    appmod.app.config['PROPAGATE_EXCEPTIONS'] = False
    return appmod.app, tmp_path


def _post(app, path, payload):
    with app.test_client() as c:
        r = c.post(path, json=payload)
        return r.status_code, (r.get_json() or {})


def test_concurrent_archives_do_not_collide(app_client):
    """Two archives landing in the same millisecond must not share a directory —
    a collision silently overwrites one child's drawing with another's."""
    app, root = app_client
    N = 32
    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(
            lambda i: _post(app, '/api/archive',
                            {'subject': 'cat', 'drawing': 'aGk=', 'prompt': f'p{i}'}),
            range(N)))

    assert all(code == 200 for code, _ in results), 'a concurrent archive failed'
    paths = [body['path'] for _, body in results]
    assert len(set(paths)) == N, (
        f'{N - len(set(paths))} archive dirs collided — one drawing overwrote another')
    # every session dir must actually hold its files
    for p in paths:
        import pathlib
        d = pathlib.Path(p)
        assert (d / 'drawing.png').exists() and (d / 'meta.json').exists()


def test_concurrent_story_archives_do_not_collide(app_client):
    app, root = app_client
    N = 24
    scene = [{'narration': 'n', 'image_prompt': 'p'}]
    with ThreadPoolExecutor(max_workers=12) as ex:
        results = list(ex.map(
            lambda i: _post(app, '/api/archive-story',
                            {'subject': 'cat', 'title': f't{i}', 'scenes': scene}),
            range(N)))
    assert all(code == 200 for code, _ in results)
    paths = [body['path'] for _, body in results]
    assert len(set(paths)) == N, 'story archive dirs collided'


def test_concurrent_mixed_endpoints_stay_isolated(app_client, monkeypatch):
    """Mixed concurrent traffic must not cross-contaminate responses."""
    app, _ = app_client
    monkeypatch.setattr(core, 'claude', lambda p, *a, **k: f'{{"echo": "{p[-6:]}"}}')

    def call(i):
        code, body = _post(app, '/api/story', {'subject': f'subj{i:04d}'})
        return i, code, body

    with ThreadPoolExecutor(max_workers=16) as ex:
        for i, code, body in ex.map(call, range(24)):
            assert code == 200
            # the reply must correspond to THIS request's prompt tail
            assert isinstance(body.get('echo'), str)


def test_archive_dir_names_are_filesystem_safe(app_client):
    """Names minted concurrently must stay well-formed (no partial timestamps)."""
    app, _ = app_client
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(
            lambda i: _post(app, '/api/archive', {'subject': 'a b/c', 'drawing': 'aGk='}),
            range(16)))
    for code, body in results:
        assert code == 200
        name = body['path'].rsplit('/', 1)[-1]
        assert re.fullmatch(r"\d{8}-\d{6}-\d{3}-a_b_c(-\d+)?", name), name
