"""Archive gallery — finally a way to SEE what the archive faithfully saves.

Read-only views over archive_dir(): a paginated listing of archived sessions
(drawings and stories) and a file server for their images. The file server is
allowlist-first: session names must match the exact timestamp shape the
archiver generates (which structurally excludes `projects/` and any crafted
name), filenames must match a fixed pattern, and the resolved path must still
live inside the archive dir. Nothing here writes.
"""

import json
import re

from flask import Blueprint, jsonify, request, send_file

from server import core

gallery_bp = Blueprint('gallery', __name__)

# 20260726-190001-123-subject or ...-subject-2 (collision suffix). The leading
# timestamp is mandatory — names like "projects" or ".." can never match.
SESSION_RE = re.compile(r'^\d{8}-\d{6}-\d{3}-[A-Za-z0-9_\-]{1,80}$')
FILE_RE = re.compile(r'^(drawing\.png|ai_image\.jpg|scene_\d{2}\.jpg)$')
MAX_LIMIT = 60

MIMETYPES = {'.png': 'image/png', '.jpg': 'image/jpeg'}


def _session_summary(entry):
    """One gallery card's worth of metadata; never raises on a corrupt dir."""
    files = {f.name for f in entry.iterdir() if f.is_file()}
    info = {'name': entry.name, 'files': sorted(files & {
        'drawing.png', 'ai_image.jpg'} | {f for f in files
                                          if FILE_RE.match(f)})}
    meta = {}
    for metafile in ('meta.json', 'story.json'):
        if metafile in files:
            try:
                meta = json.loads((entry / metafile).read_text())
            except (OSError, ValueError):
                meta = {}
            break
    info['kind'] = 'story' if 'story.json' in files else 'drawing'
    info['subject'] = str(meta.get('subject', ''))[:200]
    info['title'] = str(meta.get('title', ''))[:200]
    scenes = meta.get('scenes')
    info['narrations'] = [str(s.get('narration', ''))[:300]
                          for s in scenes if isinstance(s, dict)] \
        if isinstance(scenes, list) else []
    return info


@gallery_bp.route('/api/gallery', methods=['GET'])
def gallery():
    """Newest-first page of archived sessions."""
    try:
        offset = max(0, int(request.args.get('offset', 0)))
        limit = min(MAX_LIMIT, max(1, int(request.args.get('limit', 24))))
    except ValueError:
        return jsonify({'error': 'offset and limit must be integers'}), 400

    names = sorted(
        (e.name for e in core.archive_dir().iterdir()
         if e.is_dir() and SESSION_RE.match(e.name)),
        reverse=True)
    page = []
    for name in names[offset:offset + limit]:
        try:
            page.append(_session_summary(core.archive_dir() / name))
        except OSError:
            continue  # dir vanished or unreadable — skip, don't 500 the page
    return jsonify({'total': len(names), 'offset': offset, 'sessions': page})


@gallery_bp.route('/api/gallery/<session>/<filename>', methods=['GET'])
def gallery_file(session, filename):
    """Serve one archived image. Both path parts must match the allowlists
    and the resolved path must remain inside the archive dir."""
    if not SESSION_RE.match(session) or not FILE_RE.match(filename):
        return jsonify({'error': 'not found'}), 404
    base = core.archive_dir().resolve()
    path = (base / session / filename).resolve()
    if not path.is_relative_to(base) or not path.is_file():
        return jsonify({'error': 'not found'}), 404
    return send_file(path, mimetype=MIMETYPES[path.suffix],
                     max_age=86400)  # archives are immutable — let them cache
