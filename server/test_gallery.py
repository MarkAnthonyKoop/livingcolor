"""Tests for the archive gallery — listing, pagination, and (adversarially)
the file-serving path, which is an arbitrary-file-read primitive if wrong.

Run:  PYTHONPATH=~/claude/livingcolor ~/claude/.venv/bin/python -m pytest server/test_gallery.py -q
"""
import json

import pytest

from server import core


def make_session(base, name, files=('drawing.png', 'ai_image.jpg'),
                 meta=None, story=None):
    d = base / name
    d.mkdir(parents=True)
    for f in files:
        (d / f).write_bytes(b'\x89PNG fake image bytes')
    if meta is not None:
        (d / 'meta.json').write_text(json.dumps(meta))
    if story is not None:
        (d / 'story.json').write_text(json.dumps(story))
    return d


@pytest.fixture()
def archive(tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'archive_dir', lambda: tmp_path)
    return tmp_path


def test_gallery_lists_newest_first(client, archive):
    make_session(archive, '20260725-120000-000-cat', meta={'subject': 'cat'})
    make_session(archive, '20260726-120000-000-story-dog',
                 files=('scene_01.jpg', 'scene_02.jpg'),
                 story={'title': 'Dog Tale', 'subject': 'dog',
                        'scenes': [{'narration': 'a dog barks'}]})
    body = client.get('/api/gallery').get_json()
    assert body['total'] == 2
    assert [s['name'] for s in body['sessions']] == [
        '20260726-120000-000-story-dog', '20260725-120000-000-cat']
    story = body['sessions'][0]
    assert story['kind'] == 'story' and story['title'] == 'Dog Tale'
    assert story['narrations'] == ['a dog barks']
    assert body['sessions'][1]['kind'] == 'drawing'


def test_gallery_pagination_and_limits(client, archive):
    for i in range(5):
        make_session(archive, f'20260726-12000{i}-000-s{i}')
    body = client.get('/api/gallery?offset=2&limit=2').get_json()
    assert body['total'] == 5
    assert len(body['sessions']) == 2
    assert client.get('/api/gallery?offset=x').status_code == 400
    # limit is clamped, not honored blindly
    assert client.get('/api/gallery?limit=99999').status_code == 200


def test_gallery_hides_non_session_dirs(client, archive):
    """projects/ (workshop store) and stray dirs must never appear."""
    make_session(archive, '20260726-120000-000-cat')
    (archive / 'projects' / 'aaaabbbbcccc').mkdir(parents=True)
    (archive / 'stray-dir').mkdir()
    body = client.get('/api/gallery').get_json()
    assert [s['name'] for s in body['sessions']] == ['20260726-120000-000-cat']


def test_gallery_survives_corrupt_meta(client, archive):
    d = make_session(archive, '20260726-120000-000-cat')
    (d / 'meta.json').write_text('{not json')
    body = client.get('/api/gallery').get_json()
    assert body['sessions'][0]['subject'] == ''


def test_gallery_lists_project_films(client, archive):
    pid = 'a' * 12
    job = 'b' * 12
    d = archive / 'projects' / pid / 'films' / job
    d.mkdir(parents=True)
    (d / 'shot_01.mp4').write_bytes(b'clip')
    (d / 'film.mp4').write_bytes(b'stitched')
    (archive / 'projects' / pid / 'project.json').write_text(
        json.dumps({'id': pid, 'name': 'Boing'}))
    body = client.get('/api/gallery').get_json()
    assert body['films'] == [{'project_id': pid, 'project_name': 'Boing',
                              'job_id': job, 'clips': ['shot_01.mp4'],
                              'film': 'film.mp4', 'narrated': None}]
    # films ride only the first page — pagination doesn't repeat them
    assert client.get('/api/gallery?offset=1').get_json()['films'] == []


def test_gallery_films_ignore_malformed_dirs(client, archive):
    (archive / 'projects' / 'not-a-project-id' / 'films' / 'x').mkdir(parents=True)
    (archive / 'projects' / ('c' * 12) / 'films' / 'BADJOB').mkdir(parents=True)
    assert client.get('/api/gallery').get_json()['films'] == []


def test_gallery_file_serves_image(client, archive):
    make_session(archive, '20260726-120000-000-cat')
    r = client.get('/api/gallery/20260726-120000-000-cat/drawing.png')
    assert r.status_code == 200
    assert r.mimetype == 'image/png'
    assert r.data.startswith(b'\x89PNG')


@pytest.mark.parametrize('session,filename', [
    ('..', 'drawing.png'),
    ('%2e%2e', 'drawing.png'),
    ('projects', 'drawing.png'),
    ('20260726-120000-000-cat', 'meta.json'),      # metadata is not servable
    ('20260726-120000-000-cat', 'story.json'),
    ('20260726-120000-000-cat', '../../etc/passwd'),
    ('20260726-120000-000-cat', '..%2f..%2fetc%2fpasswd'),
    ('20260726-120000-000-cat', 'drawing.png.bak'),
    ('20260726-120000-000-cat', 'scene_1.jpg'),    # wrong digit count
    ('20260726-120000-000-キャット', 'drawing.png'),
])
def test_gallery_file_refuses_hostile_paths(client, archive, session, filename):
    make_session(archive, '20260726-120000-000-cat')
    r = client.get(f'/api/gallery/{session}/{filename}')
    assert r.status_code in (404, 405)
    assert b'PNG' not in r.data


def test_gallery_file_refuses_symlink_escape(client, archive, tmp_path_factory):
    """A symlinked session dir pointing outside the archive must not serve."""
    outside = tmp_path_factory.mktemp('outside')
    (outside / 'drawing.png').write_bytes(b'\x89PNG secret outside bytes')
    (archive / '20260726-120000-000-evil').symlink_to(outside)
    r = client.get('/api/gallery/20260726-120000-000-evil/drawing.png')
    assert r.status_code == 404
