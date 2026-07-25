"""Drawing/story archive endpoints — save sessions to the configurable archive dir."""

import json
import base64
from datetime import datetime

from flask import Blueprint, jsonify, request

from server import core

archive_bp = Blueprint('archive', __name__)


@archive_bp.route('/api/archive', methods=['POST'])
def archive():
    """Save a drawing + AI output to the archive directory."""
    data = request.get_json(silent=True) or {}
    ts = datetime.now().strftime('%Y%m%d-%H%M%S-%f')[:-3]
    subject = (data.get('subject', 'untitled') or 'untitled').replace('/', '_').replace(' ', '_')
    session_dir = core.archive_dir() / f'{ts}-{subject}'
    session_dir.mkdir(parents=True, exist_ok=True)

    saved = []

    # User's drawing (base64 image)
    if data.get('drawing'):
        path = session_dir / 'drawing.png'
        path.write_bytes(base64.b64decode(data['drawing']))
        saved.append('drawing.png')

    # AI-generated image (URL to download — Pollinations rejects Referer header)
    if data.get('ai_image_url'):
        path = session_dir / 'ai_image.jpg'
        try:
            core.fetch_image(data['ai_image_url'], path)
            saved.append('ai_image.jpg')
        except Exception as e:
            saved.append(f'ai_image_failed: {e}')

    # Conversation metadata
    meta = {
        'timestamp': ts,
        'subject': subject,
        'composition': data.get('composition', ''),
        'details': data.get('details', ''),
        'character': data.get('character', ''),
        'prompt': data.get('prompt', ''),
        'ai_message': data.get('ai_message', ''),
        'mode': data.get('mode', 'reimagine'),
        'style': data.get('style', ''),
    }
    (session_dir / 'meta.json').write_text(json.dumps(meta, indent=2))
    saved.append('meta.json')

    return jsonify({'saved': saved, 'path': str(session_dir)})


@archive_bp.route('/api/archive-story', methods=['POST'])
def archive_story():
    """Save a generated story arc to the current session's archive folder."""
    data = request.get_json(silent=True) or {}
    subject = (data.get('subject', 'untitled') or 'untitled').replace('/', '_').replace(' ', '_')
    title = data.get('title', 'Story')
    scenes = data.get('scenes', [])
    if not scenes:
        return jsonify({'error': 'no scenes'}), 400

    # Find or create the latest session dir for this subject (or make a new one)
    base = core.archive_dir()
    ts = datetime.now().strftime('%Y%m%d-%H%M%S-%f')[:-3]
    story_dir = base / f'{ts}-story-{subject}'
    story_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for i, scene in enumerate(scenes):
        url = scene.get('image_url')
        if not url:
            continue
        path = story_dir / f'scene_{i+1:02d}.jpg'
        try:
            core.fetch_image(url, path)
            saved.append(path.name)
        except Exception as e:
            saved.append(f'scene_{i+1:02d}_failed: {e}')

    (story_dir / 'story.json').write_text(json.dumps({
        'title': title,
        'subject': subject,
        'scenes': [{
            'narration': s.get('narration', ''),
            'image_prompt': s.get('image_prompt', ''),
            'hold_ms': s.get('hold_ms', 4000),
        } for s in scenes],
    }, indent=2))
    saved.append('story.json')

    return jsonify({'saved': saved, 'path': str(story_dir), 'title': title})


@archive_bp.route('/api/archive/config', methods=['GET', 'POST'])
def archive_config():
    """Get or update archive config (e.g. change the archive directory)."""
    if request.method == 'POST':
        # An open archive_dir setter is an arbitrary-path write primitive on a
        # public deployment; writes need LIVINGCOLOR_ALLOW_CONFIG_WRITE=1.
        if not core.ALLOW_CONFIG_WRITE:
            return jsonify({'error': 'archive config is read-only on this deployment'}), 403
        data = request.get_json(silent=True) or {}
        cfg = core.get_config()
        if 'archive_dir' in data:
            cfg['archive_dir'] = data['archive_dir']
        core.CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
        return jsonify(cfg)
    return jsonify(core.get_config())
