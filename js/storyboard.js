// Storyboard: generate scene prompts via Gemini, load Pollinations frames, animate.

import { GEMINI_URL, POLLINATIONS_IMAGE } from './state.js';
import { getApiKey } from './setup.js';
import { startMagicEffect } from './particles.js';

let storyboardAnim = null;

export function setVideoStatus(msg, state) {
  const el = document.getElementById('video-status');
  const textEl = document.getElementById('video-status-text');
  el.style.display = 'flex';
  textEl.textContent = msg;
  el.className = 'video-status' + (state ? ' ' + state : '');
}

function stopStoryboard() {
  if (storyboardAnim) {
    clearInterval(storyboardAnim);
    storyboardAnim = null;
  }
  const resultImg = document.getElementById('result-image');
  resultImg.style.transition = '';
  resultImg.style.opacity = '1';
}

function playStoryboard(images) {
  stopStoryboard();
  const resultImg = document.getElementById('result-image');
  const overlay = document.getElementById('sketch-overlay');
  overlay.style.opacity = '0';

  let current = 0;
  const frameDuration = 3000;
  const fadeTime = 1000;

  resultImg.style.transition = 'opacity ' + fadeTime + 'ms ease-in-out';

  function nextFrame() {
    current = (current + 1) % images.length;
    resultImg.style.opacity = '0';
    setTimeout(() => {
      resultImg.src = images[current];
      resultImg.onload = () => {
        resultImg.style.opacity = '1';
      };
    }, fadeTime);
  }

  storyboardAnim = setInterval(nextFrame, frameDuration);
  setVideoStatus('Storyboard animation playing (' + images.length + ' scenes)', 'done');
}

export async function generateStoryboard(basePrompt) {
  const key = getApiKey();
  if (!key) return null;

  try {
    const res = await fetch(GEMINI_URL + '?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: 'I have this image description: "' + basePrompt + '". Write 4 short image prompts showing this scene animated across 4 moments (like a storyboard). Each should be 1 sentence, describing a different moment of gentle motion/change. Output ONLY 4 lines, one prompt per line, no numbering.'
          }]
        }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.candidates[0].content.parts[0].text.trim();
    const scenes = text.split('\n').filter(l => l.trim().length > 10).slice(0, 4);
    return scenes.length >= 3 ? scenes : null;
  } catch (e) {
    return null;
  }
}

export async function loadStoryboardImages(scenes, basePrompt) {
  if (!scenes && basePrompt) {
    setVideoStatus('Creating storyboard...');
    scenes = await generateStoryboard(basePrompt);
    if (!scenes) return;
  }
  if (!scenes) return;
  setVideoStatus('Generating storyboard (' + scenes.length + ' scenes)...');

  const urls = scenes.map((scene) => {
    const encoded = encodeURIComponent(scene + ', highly detailed, vivid, masterpiece');
    const seed = Math.floor(Math.random() * 999999);
    return POLLINATIONS_IMAGE + encoded + '?width=768&height=768&seed=' + seed + '&nologo=true';
  });

  const loaded = [];
  for (let i = 0; i < urls.length; i++) {
    setVideoStatus('Loading scene ' + (i + 1) + '/' + urls.length + '...');
    try {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = urls[i];
      });
      loaded.push(urls[i]);
    } catch (e) {
      // skip failed frames
    }
  }

  if (loaded.length >= 2) {
    playStoryboard(loaded);
  } else {
    setVideoStatus('Could not load enough frames', 'error');
    startMagicEffect();
  }
}

export async function startVideoFallback(prompt) {
  setVideoStatus('Creating storyboard animation...');
  const scenes = await generateStoryboard(prompt);
  if (scenes) {
    loadStoryboardImages(scenes);
    return;
  }

  try {
    const { Client } = await import('https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js');
    const client = await Client.connect("Lightricks/ltx-video-distilled");
    setVideoStatus('Generating video via LTX (free, ~30s)...');

    const result = await client.predict("/text_to_video", {
      prompt: prompt,
      negative_prompt: "blurry, distorted, worst quality",
      height_ui: 512,
      width_ui: 512,
      mode: "text-to-video",
      duration_ui: 2,
      seed_ui: 42,
      randomize_seed: true,
      ui_guidance_scale: 1,
      improve_texture_flag: false,
    });

    const videoData = result.data[0];
    const videoUrl = videoData?.video?.url || videoData?.url;
    if (!videoUrl) throw new Error('No video URL');

    const resp = await fetch(videoUrl);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);

    document.getElementById('result-video').src = blobUrl;
    document.getElementById('result-video').style.display = '';
    document.getElementById('result-image').style.display = 'none';
    document.getElementById('download-video-btn').style.display = '';
    setVideoStatus('Video ready! (via LTX)', 'done');
  } catch (e) {
    console.error('LTX fallback error:', e);
    setVideoStatus('Enjoy the magic effect!', 'error');
    startMagicEffect();
  }
}

export { stopStoryboard };
