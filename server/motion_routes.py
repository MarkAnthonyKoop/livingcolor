"""Story-arc, region-segmentation, and motion-plan endpoints (Claude → JSON plans)."""

import json
import base64

from flask import Blueprint, jsonify, request

from server import core

motion_bp = Blueprint('motion', __name__)

REGION_PROMPT_TEMPLATE = (
    'Look at this AI-generated image of a {subject} and identify 2-5 animatable regions. '
    'Examples: a butterfly has left_wing, right_wing, body. A cat has head, body, tail. '
    'A tree has trunk, leaves. A person has head, torso, left_arm, right_arm.\n\n'
    'For each region, give:\n'
    '- name (snake_case)\n'
    '- bbox as [x, y, w, h] in fractions of image (0-1), x/y is top-left corner\n'
    '- anchor (where the region pivots from): "center", "top", "bottom", "left", "right", '
    '"top-left", "top-right", "bottom-left", "bottom-right"\n'
    '- motions: array of {{type, axis (for translate), amplitude, period_ms, easing}}\n'
    '  - type: "translate" | "rotate" | "scale"\n'
    '  - axis: "x" | "y" (only for translate)\n'
    '  - amplitude: translate in pixels, rotate in degrees, scale as fraction\n'
    '  - period_ms: oscillation period (full cycle)\n'
    '  - easing: "sine" | "linear" | "ease"\n\n'
    'Pick motions that match the subject — wings flap fast (period 300-500ms, amplitude 15-30deg), '
    'tail wags slowly (1000-1500ms), bodies breathe (2000ms, amplitude 5px), leaves rustle (800ms). '
    'All motions oscillate around 0. Don\'t exceed 30deg rotation or 20px translation.\n\n'
    'Output ONLY a JSON object like: {{"regions": [{{"name": "...", "bbox": [..], "anchor": "...", "motions": [...]}}]}}\n'
    'No markdown, no commentary.'
)

STORY_PROMPT = (
    'You are an inventive children\'s storyteller. A child drew a {subject}. '
    '{character_note}{detail_note}\n\n'
    'Write a SHORT, MAGICAL story arc (4 scenes only — exactly 4) that brings this drawing to life. '
    'It should feel ALIVE — with progression, surprise, character. Not just an object floating. '
    'Examples of arcs that work:\n'
    '  - close-up smiling face → revealed as tiny astronaut → climbs into rocket → blasts into stars → waves goodbye\n'
    '  - single butterfly → discovers a hidden flower → friends join → they dance in golden light → sun sets behind them\n'
    '  - cat at window → spots something magical outside → leaps through a portal → soars over a galaxy → curls up safely home\n'
    '  - dragon perched on rock → exhales a tiny puff of glitter that becomes a bird → bird leads it to treasure → dragon laughs\n\n'
    'Each scene should advance the story. Use camera moves (close-up → wide → above), '
    'introduce new elements, change settings. Keep the original character recognizable across scenes.\n\n'
    'For each scene write:\n'
    '- image_prompt: vivid 1-2 sentence image description (highly detailed, vivid colors, '
    'masterpiece quality). Always include the central character\'s look so it stays consistent.\n'
    '- narration: 1 short kid-friendly sentence to be read aloud (8-15 words, excited, warm)\n'
    '- hold_ms: how long this scene should display (3000-5000ms)\n\n'
    'Output ONLY a JSON object: {{"title": "Short title", "scenes": [{{"image_prompt": "...", "narration": "...", "hold_ms": 4000}}, ...]}}\n'
    'No markdown, no commentary.'
)


@motion_bp.route('/api/story', methods=['POST'])
def story():
    """Ask Claude to write a multi-scene narrative arc for the drawing."""
    data = request.get_json(silent=True) or {}
    subject = core.as_text(data.get('subject'), 'creature')
    character = core.as_text(data.get('character'))
    details = core.as_text(data.get('details'))
    style = core.as_text(data.get('style'))

    char_note = f'Distinctive features: {character}. ' if character else ''
    detail_note = f'Details from the drawing: {details}. ' if details else ''

    prompt = STORY_PROMPT.format(
        subject=subject,
        character_note=char_note,
        detail_note=detail_note,
    )
    if style:
        prompt += f'\nStyle hint: {style}'

    text = ''  # so the JSONDecodeError handler is safe if claude() itself raises it
    try:
        # 55s cap: the client gives up at 60s, so a longer run only burns
        # subscription time on a result nobody will receive.
        text = core.claude(prompt, timeout=55)
        plan = core.parse_claude_json(text)
        return jsonify(plan)
    except json.JSONDecodeError as e:
        return jsonify({'error': f'invalid JSON: {e}', 'raw': text[:500]}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@motion_bp.route('/api/region-motion', methods=['POST'])
def region_motion():
    """Ask Claude to segment the AI image into animatable regions + motion vectors."""
    data = request.get_json(silent=True) or {}
    image_url = core.as_text(data.get('image_url'))
    subject = core.as_text(data.get('subject'), 'object')

    if not image_url:
        return jsonify({'error': 'missing image_url'}), 400

    # Download the image (Pollinations rejects Referer header)
    try:
        img_b64 = base64.b64encode(core.fetch_image(image_url)).decode()
    except Exception as e:
        return jsonify({'error': f'image download failed: {e}'}), 500

    text = ''  # so the JSONDecodeError handler is safe if claude() itself raises it
    try:
        text = core.claude(REGION_PROMPT_TEMPLATE.format(subject=subject), img_b64)
        plan = core.parse_claude_json(text)
        return jsonify(plan)
    except json.JSONDecodeError as e:
        return jsonify({'error': f'invalid JSON from Claude: {e}', 'raw': text[:500]}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@motion_bp.route('/api/motion-plan', methods=['POST'])
def motion_plan():
    """Ask Claude Code to design a motion vector plan for the AI image."""
    data = request.get_json(silent=True) or {}
    subject = core.as_text(data.get('subject'), 'object')
    composition = core.as_text(data.get('composition'))
    details = core.as_text(data.get('details'))

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
        text = core.claude(instruction)
        plan = core.parse_claude_json(text)
        return jsonify(plan)
    except Exception as e:
        return jsonify({'error': str(e), 'fallback': True}), 500
