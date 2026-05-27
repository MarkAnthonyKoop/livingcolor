"""LivingColor backend — proxies AI APIs with fallback chain + retry."""

import os
import json
import time
import urllib.request
import urllib.error
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='..', static_url_path='')

GEMINI_KEY = os.environ.get('GEMINI_API_KEY', 'AIzaSyDpNKSrREpnTZcGNyqN4rZJI4nJG5Oa8T4')
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
PERPLEXITY_KEY = os.environ.get('PERPLEXITY_API_KEY', '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')
PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions'


def perplexity_vision(system_prompt, image_b64):
    """Call Perplexity Sonar with vision. Returns text."""
    payload = json.dumps({
        'model': 'sonar',
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': system_prompt},
            {'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{image_b64}'}}
        ]}],
        'max_tokens': 300
    }).encode()
    req = urllib.request.Request(PERPLEXITY_URL, data=payload, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {PERPLEXITY_KEY}'
    })
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    return resp['choices'][0]['message']['content'].strip()


def perplexity_text(prompt):
    """Call Perplexity Sonar for text generation."""
    payload = json.dumps({
        'model': 'sonar',
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': 300
    }).encode()
    req = urllib.request.Request(PERPLEXITY_URL, data=payload, headers={
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {PERPLEXITY_KEY}'
    })
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    return resp['choices'][0]['message']['content'].strip()


def gemini_call(contents, retries=3, delay=5):
    """Call Gemini with retry. Returns text or None on failure."""
    url = f'{GEMINI_URL}?key={GEMINI_KEY}'
    payload = json.dumps({'contents': contents}).encode()
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=payload,
                headers={'Content-Type': 'application/json'})
            resp = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
            return resp['candidates'][0]['content']['parts'][0]['text'].strip()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < retries - 1:
                time.sleep(delay * (attempt + 1))
                continue
            return None
    return None


def ai_vision(prompt, image_b64):
    """Vision with fallback: Gemini -> Perplexity."""
    result = gemini_call([{'parts': [
        {'text': prompt},
        {'inline_data': {'mime_type': 'image/jpeg', 'data': image_b64}}
    ]}])
    if result:
        return result
    return perplexity_vision(prompt, image_b64)


def ai_text(prompt):
    """Text generation with fallback: Gemini -> Perplexity."""
    result = gemini_call([{'parts': [{'text': prompt}]}])
    if result:
        return result
    return perplexity_text(prompt)


RECOGNIZE_PROMPT = (
    'You are a warm, playful AI friend talking to a young child (age 2-5) '
    'who just drew a picture. React with genuine excitement. Guess what they '
    'drew in 1-2 short, simple sentences. Use 1-2 emojis. Ask if you guessed '
    'right. Keep it very simple — short words, big feelings.\n\n'
    'IMPORTANT: On the very last line, write SUBJECT: followed by 1-3 words '
    'naming what you think it is (e.g. SUBJECT: butterfly).'
)


@app.route('/')
def index():
    return send_from_directory('..', 'index.html')


@app.route('/api/recognize', methods=['POST'])
def recognize():
    data = request.json
    image_b64 = data.get('image', '')
    try:
        text = ai_vision(RECOGNIZE_PROMPT, image_b64)
        subject, message = '', text
        for line in text.split('\n'):
            if line.strip().upper().startswith('SUBJECT:'):
                subject = line.split(':', 1)[1].strip()
                message = text[:text.rfind(line)].strip()
                break
        return jsonify({'message': message, 'subject': subject})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/generate-prompt', methods=['POST'])
def generate_prompt():
    data = request.json
    subject = data.get('subject', '')
    style = data.get('style', '')
    mode = data.get('mode', 'reimagine')

    if mode == 'faithful':
        instruction = (f'Write a 1-sentence image prompt that faithfully '
                      f'recreates a child\'s drawing of: {subject}. '
                      f'Keep it simple and childlike. Output ONLY the prompt.')
    else:
        instruction = (f'Write a vivid 2-3 sentence image prompt that brings '
                      f'"{subject}" to life as magical, beautiful artwork. '
                      f'Whimsical, a child would love it. '
                      f'{("Style: " + style + ". ") if style else ""}'
                      f'Output ONLY the prompt.')
    try:
        return jsonify({'prompt': ai_text(instruction)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/animate-prompt', methods=['POST'])
def animate_prompt():
    data = request.json
    subject = data.get('subject', '')
    mode = data.get('mode', 'reimagine')

    if mode == 'faithful':
        instruction = (f'Write a 1-2 sentence animation prompt for gentle motion '
                      f'of {subject}. Small movements, breathing, swaying. '
                      f'Output ONLY the prompt.')
    else:
        instruction = (f'Write a vivid 2-3 sentence animation prompt for '
                      f'{subject} coming to life. Creative motion, characters '
                      f'interacting, surprises. A child would be delighted. '
                      f'Output ONLY the prompt.')
    try:
        return jsonify({'prompt': ai_text(instruction)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8091, debug=True)
