"""Persistent storyboard projects — the store behind "earn your film".

A project survives across visits: an append-only revision history of the
storyboard, cumulative engagement time, and the mentor's verdicts. Lives under
archive_dir()/projects/<id>/ so it rides the same disk the archive already
uses.

Layout:
    projects/<id>/project.json        current state (engagement, counters)
    projects/<id>/revisions/0001.json append-only storyboard snapshots
    projects/<id>/verdicts.jsonl      append-only mentor verdicts

Engagement is credited from client heartbeats, but bounded by real wall-clock:
each beat credits at most the elapsed time since the previous beat, and a gap
longer than MAX_GAP_S credits nothing (the user was away). Spamming heartbeats
therefore gains nothing — engaged_seconds can never exceed attended time.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import time
import uuid
from contextlib import contextmanager

from server import core

ID_RE = re.compile(r'^[a-f0-9]{12}$')
MAX_GAP_S = 90       # a heartbeat gap longer than this credits zero
MAX_PANELS = 12
MAX_TEXT = 2000      # per-field cap on client strings


def _now():
    return time.time()


def projects_dir():
    d = core.archive_dir() / 'projects'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _dir_for(project_id):
    if not isinstance(project_id, str) or not ID_RE.match(project_id):
        raise ValueError('bad project id')
    return projects_dir() / project_id


@contextmanager
def _locked(pdir):
    """Cross-process lock for read-modify-write of project.json."""
    if not (pdir / 'project.json').exists():
        raise FileNotFoundError(f'no such project: {pdir.name}')
    with open(pdir / '.lock', 'w') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _write_json(path, obj):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj, indent=2))
    os.replace(tmp, path)


def create(name, subject):
    project_id = uuid.uuid4().hex[:12]
    pdir = projects_dir() / project_id
    (pdir / 'revisions').mkdir(parents=True)
    project = {
        'id': project_id,
        'name': core.as_text(name, 'My Story')[:MAX_TEXT],
        'subject': core.as_text(subject)[:MAX_TEXT],
        'created_ts': _now(),
        'engaged_seconds': 0.0,
        'last_beat_ts': None,
        'revision_count': 0,
    }
    _write_json(pdir / 'project.json', project)
    return project


def load(project_id):
    pdir = _dir_for(project_id)
    path = pdir / 'project.json'
    if not path.exists():
        return None
    return json.loads(path.read_text())


def list_projects():
    out = []
    for entry in sorted(projects_dir().iterdir()):
        path = entry / 'project.json'
        if entry.is_dir() and path.exists():
            p = json.loads(path.read_text())
            out.append({k: p.get(k) for k in
                        ('id', 'name', 'subject', 'created_ts',
                         'engaged_seconds', 'revision_count')})
    return out


def heartbeat(project_id, interactions):
    """Credit engagement for one heartbeat. Returns the updated project.

    Credit = elapsed since the previous beat, but only when the user actually
    interacted since then and the gap is small enough to mean "still here".
    """
    pdir = _dir_for(project_id)
    if not (pdir / 'project.json').exists():
        return None
    with _locked(pdir):
        project = load(project_id)
        if project is None:
            return None
        now = _now()
        last = project.get('last_beat_ts')
        try:
            interactions = int(interactions)
        except (TypeError, ValueError):
            interactions = 0
        if last is not None and interactions > 0:
            elapsed = now - last
            if 0 < elapsed <= MAX_GAP_S:
                project['engaged_seconds'] = round(
                    project.get('engaged_seconds', 0.0) + elapsed, 2)
        project['last_beat_ts'] = now
        _write_json(pdir / 'project.json', project)
        return project


def _clean_panel(p):
    if not isinstance(p, dict):
        return None
    return {
        'prompt': core.as_text(p.get('prompt'))[:MAX_TEXT],
        'narration': core.as_text(p.get('narration'))[:MAX_TEXT],
        'image_url': core.as_text(p.get('image_url'))[:MAX_TEXT],
        'note': core.as_text(p.get('note'))[:MAX_TEXT],
    }


def save_revision(project_id, panels, note=''):
    """Append a storyboard snapshot; returns (project, revision) or None."""
    if not isinstance(panels, list):
        raise ValueError('panels must be a list')
    cleaned = [c for c in (_clean_panel(p) for p in panels[:MAX_PANELS]) if c]
    if not cleaned:
        raise ValueError('no valid panels')
    pdir = _dir_for(project_id)
    if not (pdir / 'project.json').exists():
        return None
    with _locked(pdir):
        project = load(project_id)
        if project is None:
            return None
        num = project['revision_count'] + 1
        revision = {'revision': num, 'saved_ts': _now(),
                    'note': core.as_text(note)[:MAX_TEXT], 'panels': cleaned}
        _write_json(pdir / 'revisions' / f'{num:04d}.json', revision)
        project['revision_count'] = num
        _write_json(pdir / 'project.json', project)
        return project, revision


def load_revision(project_id, num=None):
    """Load one revision (default: latest). None if it doesn't exist."""
    pdir = _dir_for(project_id)
    if num is None:
        project = load(project_id)
        if not project or not project['revision_count']:
            return None
        num = project['revision_count']
    path = pdir / 'revisions' / f'{int(num):04d}.json'
    if not path.exists():
        return None
    return json.loads(path.read_text())


def append_verdict(project_id, verdict):
    pdir = _dir_for(project_id)
    with _locked(pdir):
        with open(pdir / 'verdicts.jsonl', 'a') as f:
            f.write(json.dumps(verdict) + '\n')


def latest_verdict(project_id):
    path = _dir_for(project_id) / 'verdicts.jsonl'
    if not path.exists():
        return None
    lines = [ln for ln in path.read_text().splitlines() if ln.strip()]
    return json.loads(lines[-1]) if lines else None
