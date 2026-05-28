"""LivingColor backend — powered by Claude Code (user's subscription)."""

import os
import json
import subprocess
import tempfile
import base64
import urllib.request
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')

CLAUDE_CMD = os.environ.get('CLAUDE_CMD', 'claude')
ELEVENLABS_KEY = os.environ.get('ELEVENLABS_API_KEY', 'sk_adb35ecedf556cdc84feed2b7ecedcaf70d6c108e9d7cccb')
ELEVENLABS_VOICE = os.environ.get('ELEVENLABS_VOICE_ID', 'FGY2WhTYpPnrIDTdsKH5')  # Laura

# --- Drawing archive: configurable storage location ---
CONFIG_DIR = Path.home() / '.livingcolor'
CONFIG_FILE = CONFIG_DIR / 'config.json'


def get_config():
    """Load config from ~/.livingcolor/config.json, creating defaults if needed."""
    CONFIG_DIR.mkdir(exist_ok=True)
    if not CONFIG_FILE.exists():
        default = {'archive_dir': '/mnt/d/livingcolor'}
        CONFIG_FILE.write_text(json.dumps(default, indent=2))
        return default
    return json.loads(CONFIG_FILE.read_text())


def archive_dir():
    """Return the archive directory, creating it if needed."""
    d = Path(get_config().get('archive_dir', str(Path.home() / 'livingcolor')))
    d.mkdir(parents=True, exist_ok=True)
    return d


def claude(prompt, image_b64=None):
    """Run Claude Code in non-interactive mode. Returns response text."""
    with tempfile.TemporaryDirectory() as tmpdir:
        img_path = None
        if image_b64:
            img_path = os.path.join(tmpdir, 'drawing.png')
            with open(img_path, 'wb') as f:
                f.write(base64.b64decode(image_b64))

        full_prompt = prompt
        if img_path:
            full_prompt = f'Read the image file {img_path} and respond.\n\n{prompt}'

        env = os.environ.copy()
        env.pop('ANTHROPIC_API_KEY', None)
        env.pop('CLAUDE_API_KEY', None)

        result = subprocess.run(
            [CLAUDE_CMD, '-p', '--output-format', 'json',
             '--no-session-persistence', '--dangerously-skip-permissions',
             '--add-dir', tmpdir],
            input=full_prompt, capture_output=True, text=True,
            timeout=120, cwd=tmpdir, env=env
        )

        if result.returncode != 0:
            raise RuntimeError(f'Claude Code error: {result.stderr[:200]}')

        data = json.loads(result.stdout)
        if data.get('is_error'):
            raise RuntimeError(data.get('result', 'Unknown error'))
        return data.get('result', '')


@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')


RECOGNIZE_PROMPT = (
    'You are a warm, playful AI friend talking to a young child (age 2-5) '
    'who just drew a picture. Look at their drawing and react with genuine '
    'excitement. Guess what they drew in 1-2 short, simple sentences. '
    'Use 1-2 emojis. Ask if you guessed right. Keep it very simple — '
    'short words, big feelings.\n\n'
    'Then on separate lines at the end, write:\n'
    'SUBJECT: <1-3 words naming what they drew>\n'
    'COMPOSITION: <one short phrase: "full figure", "headshot", "wide scene", '
    '"close-up", "object on background", etc>\n'
    'DETAILS: <a sentence describing what they actually drew: body parts '
    'visible, action/pose, colors, positions>\n'
    'CHARACTER: <2-3 sentences capturing the drawing\'s distinctive quirks — '
    'proportions (e.g. "oblong head", "long thin arms", "tiny legs"), shapes '
    '(round/oval/square), expression/mood, posture, any unusual or charming '
    'details. These are the things that make THIS drawing unique, not just '
    'any drawing of the subject. Be specific and faithful to what you see.>'
)


@app.route('/api/recognize', methods=['POST'])
def recognize():
    data = request.json
    image_b64 = data.get('image', '')
    try:
        text = claude(RECOGNIZE_PROMPT, image_b64)
        fields = {'SUBJECT': '', 'COMPOSITION': '', 'DETAILS': '', 'CHARACTER': ''}
        keep_lines = []
        for line in text.split('\n'):
            matched = False
            for key in fields:
                if line.strip().upper().startswith(key + ':'):
                    fields[key] = line.split(':', 1)[1].strip()
                    matched = True
                    break
            if not matched:
                keep_lines.append(line)
        message = '\n'.join(keep_lines).strip()
        return jsonify({
            'message': message,
            'subject': fields['SUBJECT'],
            'composition': fields['COMPOSITION'],
            'details': fields['DETAILS'],
            'character': fields['CHARACTER'],
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/generate-prompt', methods=['POST'])
def generate_prompt():
    data = request.json
    subject = data.get('subject', '')
    style = data.get('style', '')
    mode = data.get('mode', 'reimagine')
    composition = data.get('composition', '')
    details = data.get('details', '')
    character = data.get('character', '')

    framing = f'Composition: {composition}. ' if composition else ''
    detail_note = f'The child drew: {details} ' if details else ''
    character_note = f'Distinctive traits to preserve: {character} ' if character else ''

    if mode == 'faithful':
        prompt = (f'Write a 1-sentence image generation prompt that faithfully '
                  f'recreates a child\'s drawing of: {subject}. {detail_note}'
                  f'{character_note}{framing}IMPORTANT: preserve the original '
                  f'framing AND the distinctive proportions/quirks. '
                  f'Keep it simple and childlike. Output ONLY the prompt, nothing else.')
    else:
        prompt = (f'Write a vivid 2-3 sentence image generation prompt that brings '
                  f'"{subject}" to life as magical, beautiful artwork a child would love. '
                  f'{detail_note}{character_note}{framing}'
                  f'IMPORTANT: preserve the framing AND the distinctive character of '
                  f'the original drawing — the proportions, shapes, expression, and '
                  f'quirky details that make THIS drawing unique. Reimagine the style, '
                  f'not the character. '
                  f'{("Style: " + style + ". ") if style else ""}'
                  f'Output ONLY the prompt, nothing else.')
    try:
        return jsonify({'prompt': claude(prompt)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/animate-prompt', methods=['POST'])
def animate_prompt():
    data = request.json
    subject = data.get('subject', '')
    mode = data.get('mode', 'reimagine')

    if mode == 'faithful':
        prompt = (f'Write a 1-2 sentence animation prompt for gentle, subtle motion '
                  f'of {subject}. Small movements, breathing, swaying. '
                  f'Output ONLY the prompt, nothing else.')
    else:
        prompt = (f'Write a vivid, cinematic 2-3 sentence animation prompt for '
                  f'{subject} coming fully to life with creative, dramatic motion. '
                  f'Characters moving, interacting, surprises — a child would be '
                  f'delighted. Output ONLY the prompt, nothing else.')
    try:
        return jsonify({'prompt': claude(prompt)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/speak', methods=['POST'])
def speak():
    """Text → MP3 audio via ElevenLabs."""
    text = (request.json or {}).get('text', '').strip()
    if not text:
        return jsonify({'error': 'no text'}), 400
    # Strip emoji-heavy text to under 250 chars for cost control
    text = text[:250]
    try:
        payload = json.dumps({
            'text': text,
            'model_id': 'eleven_flash_v2_5',
            'voice_settings': {'stability': 0.5, 'similarity_boost': 0.75}
        }).encode()
        req = urllib.request.Request(
            f'https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE}',
            data=payload,
            headers={'xi-api-key': ELEVENLABS_KEY, 'Content-Type': 'application/json'}
        )
        audio = urllib.request.urlopen(req, timeout=15).read()
        from flask import Response
        return Response(audio, mimetype='audio/mpeg')
    except urllib.error.HTTPError as e:
        return jsonify({'error': f'ElevenLabs HTTP {e.code}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/motion-plan', methods=['POST'])
def motion_plan():
    """Ask Claude Code to design a motion vector plan for the AI image."""
    data = request.json
    subject = data.get('subject', 'object')
    composition = data.get('composition', '')
    details = data.get('details', '')

    instruction = (
        f'Design a 4-second animation plan for a "{subject}". '
        f'{("Composition: " + composition + ". ") if composition else ""}'
        f'{("Details: " + details + ". ") if details else ""}\n\n'
        f'Output ONLY a JSON object with this exact shape (no markdown, no commentary):\n'
        f'{{\n'
        f'  "duration_ms": 4000,\n'
        f'  "loop": true,\n'
        f'  "layers": [\n'
        f'    {{\n'
        f'      "name": "whole_image",\n'
        f'      "transforms": [\n'
        f'        {{"type": "translate", "axis": "y", "amplitude": 12, "period_ms": 2000, "easing": "sine"}},\n'
        f'        {{"type": "rotate", "amplitude": 3, "period_ms": 3000, "easing": "sine"}},\n'
        f'        {{"type": "scale", "amplitude": 0.03, "period_ms": 2500, "easing": "sine"}}\n'
        f'      ]\n'
        f'    }}\n'
        f'  ]\n'
        f'}}\n\n'
        f'Transform types: translate (axis x/y, amplitude in pixels), rotate (amplitude in degrees), scale (amplitude as fraction). '
        f'All oscillate around 0 over the given period_ms. Easing: "sine" (smooth), "linear", or "ease". '
        f'Choose amplitudes and periods that make sense for the subject. A bird flaps faster (period 400ms) than a fish swims (period 1500ms). '
        f'Keep amplitudes subtle (translate <20px, rotate <10deg, scale <0.1) so it looks like gentle life, not chaos.'
    )

    try:
        text = claude(instruction)
        # Strip markdown code fences if Claude added them
        text = text.strip()
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text
            if text.endswith('```'):
                text = text.rsplit('\n', 1)[0]
            text = text.strip()
        plan = json.loads(text)
        return jsonify(plan)
    except Exception as e:
        return jsonify({'error': str(e), 'fallback': True}), 500


@app.route('/api/archive', methods=['POST'])
def archive():
    """Save a drawing + AI output to the archive directory."""
    data = request.json
    ts = datetime.now().strftime('%Y%m%d-%H%M%S-%f')[:-3]
    subject = (data.get('subject', 'untitled') or 'untitled').replace('/', '_').replace(' ', '_')
    session_dir = archive_dir() / f'{ts}-{subject}'
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
            req = urllib.request.Request(
                data['ai_image_url'],
                headers={'User-Agent': 'curl/8'}  # No Referer; minimal UA
            )
            with urllib.request.urlopen(req, timeout=60) as r:
                path.write_bytes(r.read())
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


@app.route('/api/archive/config', methods=['GET', 'POST'])
def archive_config():
    """Get or update archive config (e.g. change the archive directory)."""
    if request.method == 'POST':
        data = request.json
        cfg = get_config()
        if 'archive_dir' in data:
            cfg['archive_dir'] = data['archive_dir']
        CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
        return jsonify(cfg)
    return jsonify(get_config())


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8091))
    app.run(host='0.0.0.0', port=port, debug=True)
