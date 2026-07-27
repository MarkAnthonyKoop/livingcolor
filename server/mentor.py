"""Mentor/judge for "earn your film" — encouragement with a real rubric.

Claude reviews the storyboard and returns a structured verdict: a readiness
score, what improved since last time, what is still weak, and one concrete
next suggestion. The verdict is pinned to the revision it judged — editing
the storyboard afterwards means being judged again.

The render gate lives here too, enforced in code, not prompt: /api/film is
refused unless the project is BOTH time-qualified and judged ready on its
current revision. The refusal is explainable — reasons come back as
kid-readable sentences, because the gate must feel like mentorship, not a
paywall.
"""
from __future__ import annotations

import os

from server import core, projects

MENTOR_PROMPT = (
    'You are a warm, encouraging film mentor working with a young storyteller '
    'on a storyboard for a short animated film about: {subject}.\n\n'
    'Their storyboard right now (revision {revision}, {minutes} minutes of '
    'work so far):\n{panels}\n'
    '{previous}\n'
    'Judge honestly against this rubric — encouragement is real only if the '
    'score is real:\n'
    '- Story arc: is there a beginning, a change, and an ending — not just an '
    'object floating?\n'
    '- Shot variety: do the panels vary framing (close-up / wide / above)?\n'
    '- Character consistency: is the same recognizable character described in '
    'every panel?\n'
    '- Their own detail: has the storyteller added specific, personal touches '
    'beyond the obvious?\n\n'
    'Output ONLY a JSON object (no markdown, no commentary):\n'
    '{{"readiness": <0-10 integer — 7+ means genuinely ready to render>,\n'
    '  "improved": [<short strings: what got better since last review>],\n'
    '  "weak": [<short strings: what still needs work>],\n'
    '  "suggestion": "<ONE concrete, doable next step, kid-friendly>",\n'
    '  "encouragement": "<1-2 warm sentences about what they did well>"}}'
)


def gate_seconds():
    return int(os.environ.get('LIVINGCOLOR_GATE_SECONDS', 7200))


def gate_readiness():
    return int(os.environ.get('LIVINGCOLOR_GATE_READINESS', 7))


def _panels_text(revision):
    lines = []
    for i, p in enumerate(revision.get('panels', []), 1):
        lines.append(f'Panel {i}: {p.get("prompt", "")}')
        if p.get('narration'):
            lines.append(f'  Narration: {p["narration"]}')
        if p.get('note'):
            lines.append(f'  Storyteller\'s note: {p["note"]}')
    return '\n'.join(lines)


def _coerce_verdict(raw):
    """Validate Claude's JSON into the shape the gate trusts. Never let a
    malformed reply produce readiness — default is 0, not a pass."""
    try:
        readiness = max(0, min(10, int(raw.get('readiness'))))
    except (TypeError, ValueError):
        readiness = 0
    as_list = lambda v: [str(x)[:300] for x in v[:5]] if isinstance(v, list) else []
    return {
        'readiness': readiness,
        'improved': as_list(raw.get('improved')),
        'weak': as_list(raw.get('weak')),
        'suggestion': core.as_text(raw.get('suggestion'))[:500],
        'encouragement': core.as_text(raw.get('encouragement'))[:500],
    }


def review(project, revision):
    """Run the mentor over the given revision; persist and return the verdict."""
    prev = projects.latest_verdict(project['id'])
    previous = ''
    if prev:
        previous = (f'Your last review (revision {prev.get("revision")}) scored '
                    f'{prev.get("readiness")}/10 and flagged: '
                    f'{"; ".join(prev.get("weak", [])) or "nothing"}.\n')
    prompt = MENTOR_PROMPT.format(
        subject=project.get('subject') or project.get('name') or 'their idea',
        revision=revision['revision'],
        minutes=int(project.get('engaged_seconds', 0) // 60),
        panels=_panels_text(revision),
        previous=previous,
    )
    raw = core.parse_claude_json(core.claude(prompt, timeout=55))
    verdict = _coerce_verdict(raw)
    verdict['revision'] = revision['revision']
    verdict['engaged_seconds'] = project.get('engaged_seconds', 0)
    projects.append_verdict(project['id'], verdict)
    return verdict


CHAT_PROMPT = (
    'You are a warm, encouraging film mentor in a storyboard workshop with a '
    'young storyteller. Their film is about: {subject}.\n\n'
    'Their storyboard right now:\n{panels}\n\n'
    'They say: {message}\n\n'
    'Reply in 1-3 short, warm sentences. Be concrete and about THEIR story — '
    'if they ask for ideas, offer ONE specific suggestion tied to their '
    'panels, not generic praise. Simple words, 0-2 emojis.'
)


def chat(project, revision, message):
    """One conversational turn with the mentor, grounded in the storyboard."""
    panels = _panels_text(revision) if revision else '(no panels yet)'
    prompt = CHAT_PROMPT.format(
        subject=project.get('subject') or project.get('name') or 'their idea',
        panels=panels,
        message=message)
    return core.claude(prompt, timeout=55).strip()


def film_gate(project, verdict):
    """Decide whether this project has earned its film. Pure function of
    stored state — no prompt involved, so it cannot be sweet-talked."""
    need_s = gate_seconds()
    need_score = gate_readiness()
    engaged = project.get('engaged_seconds', 0)
    reasons = []

    time_ok = engaged >= need_s
    if not time_ok:
        left = int((need_s - engaged) // 60) + 1
        reasons.append(f'Keep creating! About {left} more minutes of working '
                       f'on your story together.')

    if verdict is None:
        judged_ok = False
        reasons.append('Ask your mentor to review your storyboard first.')
    elif verdict.get('revision') != project.get('revision_count'):
        judged_ok = False
        reasons.append('Your storyboard changed since the last review — '
                       'ask for a new one!')
    elif verdict.get('readiness', 0) < need_score:
        judged_ok = False
        reasons.append(f'Your mentor thinks the story can get even better '
                       f'({verdict.get("readiness", 0)}/{need_score} ready). '
                       f'Try: {verdict.get("suggestion") or "keep improving it!"}')
    else:
        judged_ok = True

    return {
        'allowed': time_ok and judged_ok,
        'time_ok': time_ok,
        'judged_ok': judged_ok,
        'engaged_seconds': engaged,
        'needed_seconds': need_s,
        'readiness': (verdict or {}).get('readiness'),
        'needed_readiness': need_score,
        'reasons': reasons,
    }
