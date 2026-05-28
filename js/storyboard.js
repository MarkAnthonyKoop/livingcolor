// Animation: Gemini writes animation prompts, LTX generates video from image.
// Two modes: "reimagine" (default) = AI interprets + animates,
//            "faithful" = animate the drawing as-is.

import { GEMINI_URL } from './state.js';
import { getApiKey } from './setup.js';
import { getCanvasBase64 } from './canvas.js';
import { startMagicEffect } from './particles.js';
import { log } from './logger.js';

let storyboardAnim = null;
let ltxVideoCallback = null;

export function setLtxVideoCallback(fn) { ltxVideoCallback = fn; }

export function setVideoStatus(msg, state) {
  const el = document.getElementById('video-status');
  const textEl = document.getElementById('video-status-text');
  el.style.display = 'flex';
  textEl.textContent = msg;
  el.className = 'video-status' + (state ? ' ' + state : '');
}

export function stopStoryboard() {
  if (storyboardAnim) {
    clearInterval(storyboardAnim);
    storyboardAnim = null;
  }
  const resultImg = document.getElementById('result-image');
  resultImg.style.transition = '';
  resultImg.style.opacity = '1';
}

async function getAnimationPrompt(basePrompt, mode) {
  const key = getApiKey();
  if (!key) return null;

  const instruction = mode === 'faithful'
    ? 'Write a short animation prompt (1-2 sentences) for subtle, gentle motion of this scene. Keep it simple — small movements, breathing, swaying. Scene: "' + basePrompt + '". Output ONLY the animation prompt.'
    : 'Write a vivid, cinematic animation prompt (2-3 sentences) for this scene coming fully to life. Describe dramatic, creative motion: characters moving, interacting, the environment reacting. Be imaginative — add story, surprise, emotion. Scene: "' + basePrompt + '". Output ONLY the animation prompt.';

  try {
    const res = await fetch(GEMINI_URL + '?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: instruction }] }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.candidates[0].content.parts[0].text.trim();
  } catch (e) {
    return null;
  }
}

function showVideo(blobUrl) {
  const resultVideo = document.getElementById('result-video');
  const resultImg = document.getElementById('result-image');
  resultVideo.src = blobUrl;
  resultVideo.style.display = '';
  resultImg.style.display = 'none';
  document.getElementById('download-video-btn').style.display = '';
  if (ltxVideoCallback) { ltxVideoCallback(blobUrl); ltxVideoCallback = null; }
}

async function generateLtxVideo(prompt, imageBase64, mode) {
  const { Client } = await import(
    'https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js'
  );
  const client = await Client.connect("Lightricks/ltx-video-distilled");

  const useImage = mode === 'faithful' && imageBase64;
  const apiName = useImage ? '/image_to_video' : '/text_to_video';
  const imageInput = useImage
    ? { url: 'data:image/jpeg;base64,' + imageBase64 }
    : null;

  const result = await client.predict(apiName, {
    prompt: prompt,
    negative_prompt: 'blurry, distorted, worst quality, static, frozen',
    input_image_filepath: imageInput,
    input_video_filepath: null,
    height_ui: 512,
    width_ui: 512,
    mode: useImage ? 'image-to-video' : 'text-to-video',
    duration_ui: 4,
    ui_frames_to_use: 9,
    seed_ui: 42,
    randomize_seed: true,
    ui_guidance_scale: useImage ? 3 : 1,
    improve_texture_flag: false,
  });

  const videoData = result.data[0];
  const videoUrl = videoData?.video?.url || videoData?.url;
  if (!videoUrl) throw new Error('No video URL in response');

  const resp = await fetch(videoUrl);
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

export function getAnimationMode() {
  const toggle = document.getElementById('animation-mode');
  return toggle && toggle.checked ? 'faithful' : 'reimagine';
}

export async function startVideoFallback(basePrompt) {
  log('video', 'startVideoFallback (LTX)');
  const mode = getAnimationMode();

  setVideoStatus(mode === 'faithful'
    ? 'Animating your drawing with LTX…'
    : 'Creating cinematic animation with LTX…');

  const animPrompt = await getAnimationPrompt(basePrompt, mode);
  const prompt = animPrompt || basePrompt + ', smooth cinematic animation';

  setVideoStatus('Generating video via LTX (~30-60s)…');
  log('video', 'submitting to LTX', { mode, promptLen: prompt.length });

  try {
    const canvasB64 = mode === 'faithful' ? getCanvasBase64() : null;
    const blobUrl = await generateLtxVideo(prompt, canvasB64, mode);
    log('video', 'LTX returned blob');
    showVideo(blobUrl);
    setVideoStatus('Video ready!', 'done');
  } catch (e) {
    log('video', 'LTX failed', { error: e.message.slice(0, 200) });
    if (e.message?.includes('quota') || e.message?.includes('exceeded')) {
      setVideoStatus('Free GPU quota reached — using magic effect instead', 'error');
    } else {
      setVideoStatus('Video unavailable — using magic effect instead', 'error');
    }
    startMagicEffect();
  }
}
