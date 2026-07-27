"""Tests for the shot-based video pipeline (no network, no API key)."""
import time
from pathlib import Path

import pytest

from server import video_gen as vg


# --- shot list from a story -------------------------------------------------

STORY = {
    'title': 'T',
    'scenes': [
        {'image_prompt': 'a cat on a hill', 'narration': 'n1', 'hold_ms': 4000},
        {'image_prompt': 'the cat leaps', 'narration': 'n2', 'hold_ms': 4000},
    ],
}


def test_shots_from_story_maps_scenes_to_shots():
    shots = vg.shots_from_story(STORY, reference_image='b64', duration_s=6)
    assert [s.prompt for s in shots] == ['a cat on a hill', 'the cat leaps']
    assert all(s.duration_s == 6 and s.reference_image == 'b64' for s in shots)
    assert shots[0].narration == 'n1'


@pytest.mark.parametrize('story', [
    None, {}, {'scenes': None}, {'scenes': 'text'}, {'scenes': [None]},
    {'scenes': [{'image_prompt': 12345}]},          # non-string prompt
    {'scenes': [{'image_prompt': '   '}]},          # blank prompt
    {'scenes': [{'narration': 'no prompt'}]},
])
def test_shots_from_story_rejects_malformed_input(story):
    assert vg.shots_from_story(story) == []


def test_character_sheet_folds_into_every_shot_prompt():
    story = dict(STORY, character_sheet='Milo, an orange cat with one bent ear')
    shots = vg.shots_from_story(story)
    assert all(s.prompt.startswith('Milo, an orange cat with one bent ear. ')
               for s in shots)
    # the scene's own prompt survives after the pin
    assert shots[0].prompt.endswith('a cat on a hill')


@pytest.mark.parametrize('sheet', [None, '', '   ', 42, ['list']])
def test_missing_or_malformed_character_sheet_changes_nothing(sheet):
    story = dict(STORY)
    if sheet is not None:
        story['character_sheet'] = sheet
    assert [s.prompt for s in vg.shots_from_story(story)] == \
        ['a cat on a hill', 'the cat leaps']


def test_shot_serializes_without_leaking_reference_bytes():
    d = vg.Shot('p', 8, reference_image='SECRETB64').to_dict()
    assert d['has_reference'] is True
    assert 'SECRETB64' not in str(d)


# --- provider selection -----------------------------------------------------

def test_no_key_means_unavailable_and_a_clear_error(monkeypatch):
    monkeypatch.delenv('VEO_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    p = vg.VeoProvider()
    assert p.available() is False
    with pytest.raises(vg.ProviderUnavailable, match='VEO_API_KEY'):
        p.render(vg.Shot('x'))


def test_provider_is_selectable_by_env(monkeypatch):
    monkeypatch.setenv('LIVINGCOLOR_VIDEO_PROVIDER', 'runway')
    assert vg.get_provider().name == 'runway'
    monkeypatch.setenv('LIVINGCOLOR_VIDEO_PROVIDER', 'veo')
    assert vg.get_provider().name == 'veo'
    assert vg.get_provider('runway').name == 'runway'


def test_unknown_provider_degrades_to_unavailable(monkeypatch):
    monkeypatch.setenv('LIVINGCOLOR_VIDEO_PROVIDER', 'nonesuch')
    assert vg.get_provider().available() is False


# --- job queue --------------------------------------------------------------

class FakeProvider(vg.BaseProvider):
    name = 'fake'

    def __init__(self, fail_on=None):
        self.fail_on = fail_on or set()
        self.calls = []

    def available(self):
        return True

    def render(self, shot):
        self.calls.append(shot.prompt)
        if shot.prompt in self.fail_on:
            raise RuntimeError('render exploded')
        return b'mp4:' + shot.prompt.encode()


def _await(job_id, timeout=3):
    end = time.time() + timeout
    while time.time() < end:
        st = vg.job_status(job_id)
        if st['state'] in ('done', 'failed'):
            return st
        time.sleep(0.01)
    raise AssertionError(f'job did not settle: {vg.job_status(job_id)}')


def test_job_renders_every_shot_and_reports_progress():
    p = FakeProvider()
    shots = vg.shots_from_story(STORY)
    st = _await(vg.start_film(shots, p))
    assert st['state'] == 'done'
    assert st['done'] == 2 and st['clips'] == 2
    assert p.calls == ['a cat on a hill', 'the cat leaps']


def test_one_failed_shot_does_not_kill_the_film():
    p = FakeProvider(fail_on={'the cat leaps'})
    st = _await(vg.start_film(vg.shots_from_story(STORY), p))
    assert st['state'] == 'done'          # the good shot survived
    assert st['clips'] == 1
    assert 'shot 2' in st['error']


def test_all_shots_failing_marks_the_job_failed():
    p = FakeProvider(fail_on={'a cat on a hill', 'the cat leaps'})
    st = _await(vg.start_film(vg.shots_from_story(STORY), p))
    assert st['state'] == 'failed'
    assert st['clips'] == 0


def test_status_never_returns_raw_clip_bytes():
    st = _await(vg.start_film(vg.shots_from_story(STORY), FakeProvider()))
    assert st['clips'] == 2                # a count, not the payload
    assert not isinstance(st['clips'], list)


def test_unknown_job_id_is_none():
    assert vg.job_status('nope') is None


# --- job eviction: _jobs must not grow forever ------------------------------

def test_finished_jobs_evicted_beyond_cap(monkeypatch):
    """Eviction must happen on the real path (start_film), not just exist."""
    monkeypatch.setattr(vg, 'MAX_FINISHED_JOBS', 3)
    with vg._lock:
        vg._jobs.clear()
        for i in range(6):
            vg._jobs[f'old{i}'] = {'id': f'old{i}', 'state': 'done', 'clips': []}
        vg._jobs['active'] = {'id': 'active', 'state': 'rendering', 'clips': []}

    class NoopProvider(vg.BaseProvider):
        def available(self):
            return True
        def render(self, shot):
            return b'x'

    job_id = vg.start_film([], provider=NoopProvider())
    with vg._lock:
        finished = [j for j in vg._jobs.values()
                    if j['state'] == 'done' and j['id'].startswith('old')]
        assert len(finished) == 3            # start_film evicted the overflow
        assert 'active' in vg._jobs          # running jobs are never evicted
        assert job_id in vg._jobs
        vg._jobs.clear()


# --- stitching: optional, must never fail the film ---------------------------

def _render_two_shots(tmp_path, monkeypatch):
    class P(vg.BaseProvider):
        name = 'fake'
        def available(self):
            return True
        def render(self, shot):
            return b'clipbytes'
    job = vg.start_film([vg.Shot('a'), vg.Shot('b')], provider=P(),
                        save_root=tmp_path)
    for _ in range(100):
        s = vg.job_status(job)
        if s and s['state'] in ('done', 'failed'):
            return job, s
        time.sleep(0.02)
    raise AssertionError('job never finished')


def test_no_ffmpeg_still_finishes_with_shots(tmp_path, monkeypatch):
    monkeypatch.setattr(vg.shutil, 'which', lambda n: None)
    job, s = _render_two_shots(tmp_path, monkeypatch)
    d = tmp_path / job
    assert s['state'] == 'done'
    assert sorted(p.name for p in d.glob('shot_*.mp4')) == ['shot_01.mp4', 'shot_02.mp4']
    assert not (d / 'film.mp4').exists()


def test_ffmpeg_failure_still_finishes(tmp_path, monkeypatch):
    monkeypatch.setattr(vg.shutil, 'which', lambda n: '/fake/ffmpeg')
    def boom(*a, **k):
        raise vg.subprocess.SubprocessError('exploded')
    monkeypatch.setattr(vg.subprocess, 'run', boom)
    job, s = _render_two_shots(tmp_path, monkeypatch)
    assert s['state'] == 'done'
    assert not (tmp_path / job / 'film.mp4').exists()
    assert not (tmp_path / job / 'concat.txt').exists()   # cleaned up


def test_stitch_invoked_on_real_path(tmp_path, monkeypatch):
    """start_film must actually call the stitcher (stub writes the file)."""
    calls = {}
    monkeypatch.setattr(vg.shutil, 'which', lambda n: '/fake/ffmpeg')
    def fake_run(cmd, **kw):
        calls['cmd'] = cmd
        Path(cmd[-1]).write_bytes(b'stitched')
        return None
    monkeypatch.setattr(vg.subprocess, 'run', fake_run)
    job, s = _render_two_shots(tmp_path, monkeypatch)
    assert (tmp_path / job / 'film.mp4').read_bytes() == b'stitched'
    assert '-c' in calls['cmd'] and 'concat' in calls['cmd']


@pytest.mark.skipif(not __import__('shutil').which('ffmpeg'),
                    reason='ffmpeg not installed')
def test_stitch_with_real_ffmpeg(tmp_path):
    """Two real 0.3s clips concat into one playable film.mp4."""
    import shutil as _sh
    import subprocess as _sp
    ffmpeg = _sh.which('ffmpeg')
    d = tmp_path / 'job'
    d.mkdir()
    for i, color in enumerate(['red', 'blue'], 1):
        _sp.run([ffmpeg, '-y', '-f', 'lavfi', '-i',
                 f'color=c={color}:s=64x64:d=0.3', '-pix_fmt', 'yuv420p',
                 str(d / f'shot_{i:02d}.mp4')], capture_output=True, check=True)
    assert vg.stitch_clips(d, ['shot_01.mp4', 'shot_02.mp4']) is True
    out = d / 'film.mp4'
    assert out.stat().st_size > 0
    probe = _sp.run([ffmpeg.replace('ffmpeg', 'ffprobe'), '-v', 'error',
                     '-show_entries', 'format=duration', '-of', 'csv=p=0',
                     str(out)], capture_output=True, text=True)
    assert float(probe.stdout.strip()) > 0.5   # both clips present
