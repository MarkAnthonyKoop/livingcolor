"""Shot-based video generation — the real animation tier.

Today every "animation" in LivingColor is a CSS breathing effect, because Veo's
key is revoked and the free LTX Space is quota-exhausted. This module is the
renderer that replaces it: a story's scene list becomes a list of SHOTS, each
rendered by a real video model, then stitched into a film.

Provider-agnostic on purpose — the funding decision (Veo vs Runway) shouldn't
require rewriting the pipeline. Adapters are thin; the job model is shared.

No provider key present → `available()` is False and the app keeps its current
fallbacks. Nothing here changes behaviour until a key exists.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid

# --- shot model -------------------------------------------------------------


class Shot:
    """One continuous camera take. Video models cap out around 5-10s, so a film
    is many shots; `reference_image` is what keeps the character consistent
    across them."""

    def __init__(self, prompt, duration_s=8, reference_image=None, narration=''):
        self.prompt = prompt
        self.duration_s = duration_s
        self.reference_image = reference_image
        self.narration = narration

    def to_dict(self):
        return {
            'prompt': self.prompt,
            'duration_s': self.duration_s,
            'has_reference': bool(self.reference_image),
            'narration': self.narration,
        }


def shots_from_story(story, reference_image=None, duration_s=8):
    """Turn the existing /api/story scene list into a shot list. The story
    endpoint already produces a shot breakdown — it was just being rendered as
    stills."""
    scenes = story.get('scenes') if isinstance(story, dict) else None
    if not isinstance(scenes, list):
        return []
    shots = []
    for s in scenes:
        if not isinstance(s, dict):
            continue
        prompt = s.get('image_prompt')
        if not isinstance(prompt, str) or not prompt.strip():
            continue
        narration = s.get('narration') if isinstance(s.get('narration'), str) else ''
        shots.append(Shot(prompt.strip(), duration_s, reference_image, narration))
    return shots


# --- providers --------------------------------------------------------------


class ProviderUnavailable(RuntimeError):
    pass


class BaseProvider:
    name = 'base'

    def available(self):
        return False

    def render(self, shot):
        """Return bytes of an mp4 for one shot. Blocking; callers use the job
        queue rather than holding a request open."""
        raise ProviderUnavailable(f'{self.name}: no API key configured')


class VeoProvider(BaseProvider):
    """Google Veo via the Gemini API long-running predict endpoint.

    Tiers (2026-07): lite ~$0.03/s (720p, no audio), fast ~$0.15/s,
    standard ~$0.40/s — audio included on fast/standard.
    """
    name = 'veo'
    BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

    def __init__(self, api_key=None, model=None, timeout=600):
        self.api_key = api_key or os.environ.get('VEO_API_KEY') or os.environ.get('GOOGLE_API_KEY', '')
        self.model = model or os.environ.get('VEO_MODEL', 'veo-3.1-fast-generate-preview')
        self.timeout = timeout

    def available(self):
        return bool(self.api_key)

    def _post(self, url, payload):
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json', 'x-goog-api-key': self.api_key})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())

    def render(self, shot):
        if not self.available():
            raise ProviderUnavailable('veo: set VEO_API_KEY (a billing-enabled Google AI key)')
        payload = {'instances': [{'prompt': shot.prompt}],
                   'parameters': {'durationSeconds': shot.duration_s}}
        if shot.reference_image:
            payload['instances'][0]['image'] = {
                'bytesBase64Encoded': shot.reference_image, 'mimeType': 'image/jpeg'}

        op = self._post(f'{self.BASE}/{self.model}:predictLongRunning', payload)
        name = op.get('name')
        if not name:
            raise RuntimeError(f'veo: no operation name in response: {str(op)[:200]}')

        deadline = time.time() + self.timeout
        while time.time() < deadline:
            time.sleep(10)
            req = urllib.request.Request(
                f'https://generativelanguage.googleapis.com/v1beta/{name}',
                headers={'x-goog-api-key': self.api_key})
            with urllib.request.urlopen(req, timeout=60) as r:
                status = json.loads(r.read())
            if status.get('done'):
                return self._extract(status)
        raise TimeoutError(f'veo: shot did not finish within {self.timeout}s')

    def _extract(self, status):
        resp = status.get('response') or {}
        vids = (resp.get('generatedVideos') or resp.get('generateVideoResponse', {})
                .get('generatedSamples') or [])
        if not vids:
            raise RuntimeError(f'veo: no video in completed operation: {str(status)[:200]}')
        uri = (vids[0].get('video') or {}).get('uri')
        if not uri:
            raise RuntimeError('veo: completed operation carried no video uri')
        req = urllib.request.Request(uri, headers={'x-goog-api-key': self.api_key})
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.read()


class RunwayProvider(BaseProvider):
    """Runway Gen-4 via the existing ~/claude/runway_client package, which
    already speaks text_to_image → image_to_video."""
    name = 'runway'

    def __init__(self, api_key=None):
        self.api_key = api_key or os.environ.get('RUNWAY_API_KEY', '')

    def available(self):
        return bool(self.api_key)

    def render(self, shot):
        if not self.available():
            raise ProviderUnavailable('runway: set RUNWAY_API_KEY')
        raise NotImplementedError(
            'runway adapter: wire to ~/claude/runway_client once a key exists')


def get_provider(name=None):
    name = (name or os.environ.get('LIVINGCOLOR_VIDEO_PROVIDER', 'veo')).lower()
    provider = {'veo': VeoProvider, 'runway': RunwayProvider}.get(name, BaseProvider)()
    return provider


# --- job queue --------------------------------------------------------------
# Shots take minutes, so a synchronous request cannot hold. Jobs run on a
# worker thread and the client polls. (Measured on the live box: image stills
# alone take ~13.6s; real video shots are far longer.)

_jobs = {}
_lock = threading.Lock()
MAX_FINISHED_JOBS = 50  # finished jobs kept for polling; older ones evicted


def _evict_finished():
    """Drop the oldest finished jobs beyond the cap — _jobs must not grow
    forever on a long-lived worker. Callers hold _lock."""
    done = [j for j in _jobs.values() if j['state'] in ('done', 'failed')]
    for job in done[:max(0, len(done) - MAX_FINISHED_JOBS)]:
        del _jobs[job['id']]


def _set(job_id, **fields):
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job.update(fields)


def start_film(shots, provider=None):
    """Kick off rendering; returns a job id to poll."""
    provider = provider or get_provider()
    job_id = uuid.uuid4().hex[:12]
    with _lock:
        _evict_finished()
        _jobs[job_id] = {'id': job_id, 'state': 'queued', 'provider': provider.name,
                         'total': len(shots), 'done': 0, 'clips': [], 'error': None}

    def run():
        _set(job_id, state='rendering')
        clips = []
        for i, shot in enumerate(shots):
            try:
                clips.append(provider.render(shot))
                _set(job_id, done=i + 1, clips=clips)
            except Exception as e:  # one bad shot shouldn't kill the film
                _set(job_id, error=f'shot {i + 1}: {e}')
        _set(job_id, state='done' if clips else 'failed')

    threading.Thread(target=run, daemon=True).start()
    return job_id


def job_status(job_id):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        return {k: v for k, v in job.items() if k != 'clips'} | {'clips': len(job['clips'])}
