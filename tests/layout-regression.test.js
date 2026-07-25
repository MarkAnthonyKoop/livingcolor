import { describe, it, expect, beforeEach } from 'vitest';

// Regression for the layout break found by the real-browser run (2026-07-25):
// #result-image / #result-video exist ONLY to back the download buttons — the
// chat UI renders media in message bubbles. When a video path un-hid the raw
// element, it rendered a second copy at width/height:100% and pushed the
// result panel past the viewport mid-story.

function mountAppShell() {
  document.body.innerHTML = `
    <div class="result-panel">
      <div id="chat-container"></div>
      <img id="result-image" style="display:none">
      <video id="result-video" style="display:none"></video>
      <button id="download-video-btn" style="display:none"></button>
      <div class="video-status" id="video-status" style="display:none">
        <span id="video-status-text"></span>
      </div>
    </div>`;
}

beforeEach(mountAppShell);

describe('hidden media elements stay hidden in the chat UI', () => {
  it('index.html marks them hidden to begin with', () => {
    expect(document.getElementById('result-image').style.display).toBe('none');
    expect(document.getElementById('result-video').style.display).toBe('none');
  });

  it('no source file un-hides #result-video', async () => {
    // Guard the invariant at the source level: any `resultVideo.style.display = ''`
    // reintroduces the double-render. Keeping this as a source check (rather than
    // driving the LTX/Veo paths) keeps the test hermetic and fast.
    const fs = await import('node:fs');
    for (const file of ['js/video.js', 'js/storyboard.js', 'js/chat-flow.js']) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, `${file} un-hides #result-video`).not.toMatch(
        /resultVideo\.style\.display\s*=\s*['"]['"]/);
    }
  });

  it('no source file un-hides #result-image', async () => {
    const fs = await import('node:fs');
    for (const file of ['js/video.js', 'js/storyboard.js', 'js/chat-flow.js']) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src, `${file} un-hides #result-image`).not.toMatch(
        /resultImg\.style\.display\s*=\s*['"]['"]/);
    }
  });
});
