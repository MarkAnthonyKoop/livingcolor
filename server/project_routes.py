"""REST endpoints for "earn your film" projects: storyboard revisions,
engagement heartbeats, mentor reviews, and the gated /api/film."""

from __future__ import annotations

import base64
import json
import re

from flask import Blueprint, jsonify, request, send_file

from server import core, mentor, projects, video_gen

project_bp = Blueprint('project', __name__)


def _load_or_none(project_id):
    try:
        return projects.load(project_id)
    except ValueError:
        return None


@project_bp.route('/api/project', methods=['POST'])
def create_project():
    data = request.get_json(silent=True) or {}
    project = projects.create(data.get('name'), data.get('subject'))
    return jsonify(project)


@project_bp.route('/api/projects', methods=['GET'])
def list_projects():
    return jsonify({'projects': projects.list_projects()})


@project_bp.route('/api/project/<project_id>', methods=['GET'])
def get_project(project_id):
    project = _load_or_none(project_id)
    if project is None:
        return jsonify({'error': 'no such project'}), 404
    verdict = projects.latest_verdict(project_id)
    return jsonify({
        'project': project,
        'storyboard': projects.load_revision(project_id),
        'verdict': verdict,
        'gate': mentor.film_gate(project, verdict),
    })


@project_bp.route('/api/project/<project_id>/storyboard', methods=['POST'])
def save_storyboard(project_id):
    data = request.get_json(silent=True) or {}
    try:
        result = projects.save_revision(project_id, data.get('panels'),
                                        data.get('note'))
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    if result is None:
        return jsonify({'error': 'no such project'}), 404
    project, revision = result
    return jsonify({'project': project, 'revision': revision['revision']})


@project_bp.route('/api/project/<project_id>/heartbeat', methods=['POST'])
def heartbeat(project_id):
    data = request.get_json(silent=True) or {}
    try:
        project = projects.heartbeat(project_id, data.get('interactions'))
    except ValueError:
        project = None
    if project is None:
        return jsonify({'error': 'no such project'}), 404
    return jsonify({
        'engaged_seconds': project['engaged_seconds'],
        'needed_seconds': mentor.gate_seconds(),
    })


@project_bp.route('/api/project/<project_id>/review', methods=['POST'])
def review(project_id):
    project = _load_or_none(project_id)
    if project is None:
        return jsonify({'error': 'no such project'}), 404
    revision = projects.load_revision(project_id)
    if revision is None:
        return jsonify({'error': 'save a storyboard first'}), 400
    try:
        verdict = mentor.review(project, revision)
    except Exception as e:
        return jsonify({'error': f'mentor unavailable: {e}'}), 500
    return jsonify({'verdict': verdict,
                    'gate': mentor.film_gate(project, verdict)})


@project_bp.route('/api/project/<project_id>/film', methods=['POST'])
def film(project_id):
    """The earned render. Refuses — with reasons — until the gate passes."""
    project = _load_or_none(project_id)
    if project is None:
        return jsonify({'error': 'no such project'}), 404
    verdict = projects.latest_verdict(project_id)
    gate = mentor.film_gate(project, verdict)
    if not gate['allowed']:
        return jsonify({'error': 'not yet earned', 'gate': gate}), 403

    provider = video_gen.get_provider()
    if not provider.available():
        return jsonify({'error': 'video rendering is not configured yet',
                        'gate': gate}), 503

    revision = projects.load_revision(project_id)
    reference = _reference_image(revision)
    shots = [video_gen.Shot(p['prompt'], reference_image=reference,
                            narration=p['narration'])
             for p in revision['panels'] if p.get('prompt')]
    if not shots:
        return jsonify({'error': 'storyboard has no renderable panels'}), 400
    films_root = projects.projects_dir() / project_id / 'films'
    job_id = video_gen.start_film(shots, provider, save_root=films_root)
    return jsonify({'job_id': job_id, 'shots': len(shots), 'gate': gate})


def _reference_image(revision):
    """First panel image as base64 — the character anchor across shots.
    Optional: a fetch failure must not block an earned film."""
    for p in revision.get('panels', []):
        url = p.get('image_url')
        if url:
            try:
                return base64.b64encode(core.fetch_image(url)).decode()
            except Exception:
                return None
    return None


@project_bp.route('/api/film-availability', methods=['GET'])
def film_availability():
    """Is the movie machine plugged in? Lets the workshop tell the truth
    about the render tier, and lets ops verify a funded key reached the box.
    Reports presence only — never the key."""
    provider = video_gen.get_provider()
    return jsonify({'provider': provider.name, 'available': provider.available()})


@project_bp.route('/api/film/<job_id>', methods=['GET'])
def film_status(job_id):
    status = video_gen.job_status(job_id)
    if status is None:
        return jsonify({'error': 'no such job'}), 404
    return jsonify(status)


JOB_RE = re.compile(r'^[a-f0-9]{12}$')
CLIP_RE = re.compile(r'^shot_\d{2}\.mp4$')


@project_bp.route('/api/project/<project_id>/films', methods=['GET'])
def list_films(project_id):
    """Films rendered for this project — survives server restarts because it
    reads the disk, not the in-memory job table."""
    if _load_or_none(project_id) is None:
        return jsonify({'error': 'no such project'}), 404
    films_root = projects.projects_dir() / project_id / 'films'
    films = []
    if films_root.is_dir():
        for d in sorted(films_root.iterdir()):
            if d.is_dir() and JOB_RE.match(d.name):
                clips = sorted(f.name for f in d.iterdir() if CLIP_RE.match(f.name))
                narrations = []
                try:
                    meta = json.loads((d / 'film.json').read_text())
                    narrations = [str(s.get('narration', ''))[:300]
                                  for s in meta.get('shots', [])
                                  if isinstance(s, dict)]
                except (OSError, ValueError):
                    pass
                films.append({'job_id': d.name, 'clips': clips,
                              'narrations': narrations})
    return jsonify({'films': films})


@project_bp.route('/api/project/<project_id>/films/<job_id>/<clip>', methods=['GET'])
def serve_clip(project_id, job_id, clip):
    """Serve one rendered shot. Allowlist-first, containment-checked."""
    if _load_or_none(project_id) is None or not JOB_RE.match(job_id) \
            or not CLIP_RE.match(clip):
        return jsonify({'error': 'not found'}), 404
    base = projects.projects_dir().resolve()
    path = (base / project_id / 'films' / job_id / clip).resolve()
    if not path.is_relative_to(base) or not path.is_file():
        return jsonify({'error': 'not found'}), 404
    return send_file(path, mimetype='video/mp4', max_age=86400)
