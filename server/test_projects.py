"""Tests for the persistent project store + engagement accrual.

Run:  PYTHONPATH=~/claude/livingcolor ~/claude/.venv/bin/python -m pytest server/test_projects.py -q
"""
import pytest

from server import core, projects


@pytest.fixture(autouse=True)
def sandbox(tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'archive_dir', lambda: tmp_path)


@pytest.fixture()
def clock(monkeypatch):
    """Controllable wall-clock for engagement math."""
    state = {'t': 1000.0}
    monkeypatch.setattr(projects, '_now', lambda: state['t'])
    return state


# --- store ---

def test_create_load_roundtrip():
    p = projects.create('My Film', 'a brave cat')
    assert projects.ID_RE.match(p['id'])
    loaded = projects.load(p['id'])
    assert loaded == p
    assert loaded['engaged_seconds'] == 0
    assert loaded['revision_count'] == 0


def test_list_projects_summarizes():
    a = projects.create('A', 'cat')
    b = projects.create('B', 'dog')
    ids = {p['id'] for p in projects.list_projects()}
    assert ids == {a['id'], b['id']}


@pytest.mark.parametrize('bad', ['../../etc', 'x' * 12, '', None, 'ABCDEF123456'])
def test_bad_project_ids_rejected(bad):
    with pytest.raises(ValueError):
        projects.load(bad)


def test_load_unknown_but_wellformed_id_is_none():
    assert projects.load('0' * 12) is None


# --- revisions: append-only ---

def test_revisions_append_and_load():
    p = projects.create('F', 'cat')
    projects.save_revision(p['id'], [{'prompt': 'cat sits'}])
    proj, rev = projects.save_revision(p['id'], [{'prompt': 'cat flies'}], 'made it fly')
    assert proj['revision_count'] == 2
    assert rev['revision'] == 2
    # both revisions remain readable — history is append-only
    assert projects.load_revision(p['id'], 1)['panels'][0]['prompt'] == 'cat sits'
    latest = projects.load_revision(p['id'])
    assert latest['revision'] == 2
    assert latest['note'] == 'made it fly'


def test_save_revision_validates_and_caps():
    p = projects.create('F', 'cat')
    with pytest.raises(ValueError):
        projects.save_revision(p['id'], 'not a list')
    with pytest.raises(ValueError):
        projects.save_revision(p['id'], [42, None])          # no valid panels
    _, rev = projects.save_revision(
        p['id'], [{'prompt': f'p{i}'} for i in range(50)])
    assert len(rev['panels']) == projects.MAX_PANELS
    _, rev = projects.save_revision(p['id'], [{'prompt': 'x' * 99999}])
    assert len(rev['panels'][0]['prompt']) == projects.MAX_TEXT


# --- engagement: credit is bounded by attended wall-clock ---

def test_first_heartbeat_credits_nothing(clock):
    p = projects.create('F', 'cat')
    p = projects.heartbeat(p['id'], interactions=5)
    assert p['engaged_seconds'] == 0


def test_heartbeat_credits_elapsed(clock):
    p = projects.create('F', 'cat')
    projects.heartbeat(p['id'], 1)
    clock['t'] += 30
    p = projects.heartbeat(p['id'], 3)
    assert p['engaged_seconds'] == 30


def test_idle_heartbeat_credits_nothing(clock):
    p = projects.create('F', 'cat')
    projects.heartbeat(p['id'], 1)
    clock['t'] += 30
    p = projects.heartbeat(p['id'], 0)      # no interactions since last beat
    assert p['engaged_seconds'] == 0


def test_long_gap_credits_nothing(clock):
    """User closed the tab for an hour — that hour must not count."""
    p = projects.create('F', 'cat')
    projects.heartbeat(p['id'], 1)
    clock['t'] += 3600
    p = projects.heartbeat(p['id'], 1)
    assert p['engaged_seconds'] == 0


def test_heartbeat_spam_cannot_beat_wall_clock(clock):
    """100 beats inside 10 real seconds credit at most those 10 seconds."""
    p = projects.create('F', 'cat')
    projects.heartbeat(p['id'], 1)
    for _ in range(100):
        clock['t'] += 0.1
        p = projects.heartbeat(p['id'], 99)
    assert p['engaged_seconds'] <= 10.01


def test_heartbeat_bad_interactions_types(clock):
    p = projects.create('F', 'cat')
    projects.heartbeat(p['id'], 1)
    clock['t'] += 10
    p = projects.heartbeat(p['id'], {'evil': True})
    assert p['engaged_seconds'] == 0        # non-int coerces to 0 interactions


def test_heartbeat_unknown_project():
    assert projects.heartbeat('0' * 12, 1) is None


# --- verdicts ---

def test_verdicts_append_and_latest():
    p = projects.create('F', 'cat')
    assert projects.latest_verdict(p['id']) is None
    projects.append_verdict(p['id'], {'readiness': 3, 'revision': 1})
    projects.append_verdict(p['id'], {'readiness': 8, 'revision': 2})
    assert projects.latest_verdict(p['id'])['readiness'] == 8
