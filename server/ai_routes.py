"""Vision, chat, prompt-writing, and TTS endpoints."""

import json
import urllib.error
import urllib.request

from flask import Blueprint, Response, jsonify, request

from server import core

ai_bp = Blueprint('ai', __name__)

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


@ai_bp.route('/api/recognize', methods=['POST'])
def recognize():
    data = request.json
    image_b64 = data.get('image', '')
    try:
        text = core.claude(RECOGNIZE_PROMPT, image_b64)
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


CHAT_SYSTEM = (
    'You are a playful, warm AI friend talking to a young child (or their parent) '
    'about a drawing. Be encouraging and brief (1-2 short sentences), use 1-2 emojis, '
    'keep words simple.'
)


@ai_bp.route('/api/chat', methods=['POST'])
def chat():
    """Kid-friendly chat via Claude (server-side; no browser API key)."""
    message = (request.json or {}).get('message', '').strip()
    if not message:
        return jsonify({'error': 'no message'}), 400
    try:
        reply = core.claude(f'{CHAT_SYSTEM}\n\nChild says: {message}')
        return jsonify({'reply': reply.strip()})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@ai_bp.route('/api/generate-prompt', methods=['POST'])
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
        return jsonify({'prompt': core.claude(prompt)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@ai_bp.route('/api/animate-prompt', methods=['POST'])
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
        return jsonify({'prompt': core.claude(prompt)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@ai_bp.route('/api/speak', methods=['POST'])
def speak():
    """Text → MP3 audio via ElevenLabs."""
    text = (request.json or {}).get('text', '').strip()
    if not text:
        return jsonify({'error': 'no text'}), 400
    if not core.ELEVENLABS_KEY:
        return jsonify({'error': 'voice disabled: ELEVENLABS_API_KEY not configured'}), 503
    # Strip emoji-heavy text to under 250 chars for cost control
    text = text[:250]
    try:
        payload = json.dumps({
            'text': text,
            'model_id': 'eleven_flash_v2_5',
            'voice_settings': {'stability': 0.5, 'similarity_boost': 0.75}
        }).encode()
        req = urllib.request.Request(
            f'https://api.elevenlabs.io/v1/text-to-speech/{core.ELEVENLABS_VOICE}',
            data=payload,
            headers={'xi-api-key': core.ELEVENLABS_KEY, 'Content-Type': 'application/json'}
        )
        audio = urllib.request.urlopen(req, timeout=15).read()
        return Response(audio, mimetype='audio/mpeg')
    except urllib.error.HTTPError as e:
        return jsonify({'error': f'ElevenLabs HTTP {e.code}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500
