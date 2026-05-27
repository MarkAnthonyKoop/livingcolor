// Veo video generation and polling.

import {
  VEO_URL, VEO_POLL_URL, VEO_POLL_INTERVAL,
  getVeoAbort, setVeoAbort,
} from './state.js';
import { getCanvasBase64 } from './canvas.js';
import { getApiKey } from './setup.js';
import { stopMagicEffect } from './particles.js';
import {
  setVideoStatus, stopStoryboard,
  startVideoFallback, setLtxVideoCallback,
} from './storyboard.js';

export { setVideoStatus };

export function resetVideoUI() {
  stopMagicEffect();
  stopStoryboard();
  const videoStatus = document.getElementById('video-status');
  const videoBtn = document.getElementById('download-video-btn');
  const resultVideo = document.getElementById('result-video');
  videoStatus.style.display = 'none';
  videoStatus.className = 'video-status';
  videoBtn.style.display = 'none';
  resultVideo.style.display = 'none';
  resultVideo.src = '';
}

let onVideoReady = null;

function showGeneratedVideo(b64) {
  const resultImg = document.getElementById('result-image');
  const resultVideo = document.getElementById('result-video');
  const videoBtn = document.getElementById('download-video-btn');

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);

  resultVideo.src = url;
  resultVideo.style.display = '';
  resultImg.style.display = 'none';
  videoBtn.style.display = '';

  setVideoStatus('Video ready!', 'done');
  if (onVideoReady) { onVideoReady(url); onVideoReady = null; }
}

async function pollVeoOperation(opName, key, controller) {
  const pollUrl = VEO_POLL_URL + opName + '?key=' + key;
  let attempts = 0;
  const maxAttempts = 120;

  while (attempts < maxAttempts) {
    if (controller.signal.aborted) return;
    await new Promise(r => setTimeout(r, VEO_POLL_INTERVAL));
    attempts++;
    if (controller.signal.aborted) return;

    try {
      const res = await fetch(pollUrl, { signal: controller.signal });
      if (!res.ok) {
        if (res.status === 429) {
          setVideoStatus('Polling rate limited, waiting...');
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
        const body = await res.json().catch(() => ({}));
        setVideoStatus('Poll error: ' + (body?.error?.message || 'HTTP ' + res.status), 'error');
        return;
      }

      const data = await res.json();

      if (data.done) {
        if (data.error) {
          setVideoStatus('Video failed: ' + (data.error.message || 'Unknown error'), 'error');
          return;
        }
        const samples = data.response?.generateVideoResponse?.generatedSamples;
        if (!samples || samples.length === 0) {
          setVideoStatus('Video generation returned no results', 'error');
          return;
        }
        const videoB64 = samples[0].video?.bytesBase64Encoded;
        if (!videoB64) {
          setVideoStatus('Video response missing data', 'error');
          return;
        }
        showGeneratedVideo(videoB64);
        return;
      }

      const pct = data.metadata?.percentComplete;
      if (pct != null) {
        setVideoStatus('Generating video... ' + pct + '%');
      } else {
        setVideoStatus('Generating video... (attempt ' + attempts + ')');
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.error('Poll error:', e);
      setVideoStatus('Poll error: ' + e.message, 'error');
      return;
    }
  }

  setVideoStatus('Video generation timed out', 'error');
}

export async function startVeoGeneration(prompt, imgEl, chatCallback) {
  const key = getApiKey();
  if (!key) return;

  if (chatCallback) {
    onVideoReady = chatCallback;
    setLtxVideoCallback(chatCallback);
  }

  if (getVeoAbort()) { getVeoAbort().abort(); setVeoAbort(null); }

  const controller = new AbortController();
  setVeoAbort(controller);

  setVideoStatus('Submitting video generation...');

  try {
    const imgB64 = getCanvasBase64();
    const veoPrompt = 'Smooth cinematic animation of: ' + prompt + '. Gentle camera movement, natural motion, vivid lighting.';

    const res = await fetch(VEO_URL + '?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        instances: [{
          prompt: veoPrompt,
          image: { bytesBase64Encoded: imgB64, mimeType: 'image/jpeg' }
        }],
        parameters: {
          sampleCount: 1,
          durationSeconds: 6,
          aspectRatio: '16:9'
        }
      })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const errMsg = body?.error?.message || 'HTTP ' + res.status;
      if (res.status === 429) {
        setVideoStatus('Veo quota reached -- trying free LTX Video...');
        startVideoFallback(prompt);
        return;
      } else if (res.status === 401 || res.status === 403) {
        setVideoStatus('API key lacks Veo access', 'error');
      } else {
        setVideoStatus('Video error: ' + errMsg, 'error');
      }
      return;
    }

    const data = await res.json();
    const operationName = data.name;
    if (!operationName) {
      setVideoStatus('No operation returned from Veo', 'error');
      return;
    }

    setVideoStatus('Generating video... (polling)');
    await pollVeoOperation(operationName, key, controller);
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('Veo error:', e);
    setVideoStatus('Video generation failed: ' + e.message, 'error');
  }
}
