// AI provider calls for the chat flow: drawing recognition + image-prompt generation.

import { GEMINI_URL, POLLINATIONS_IMAGE, setLastGeneratedPrompt } from './state.js';
import { getApiKey } from './setup.js';
import { getCanvasBase64 } from './canvas.js';
import { logStep } from './chat.js';
import { log } from './logger.js';
import { readStored } from './storage.js';

// Try AI vision providers in order, logging each attempt
export async function recognizeDrawing() {
  const b64 = getCanvasBase64();
  const prompt = 'You are a warm, playful AI friend talking to a young child (age 2-5) who just drew a picture. React with excitement in 1-2 short sentences. Use 1-2 emojis. Ask if you guessed right.\n\nThen on separate lines at the end, write:\nSUBJECT: <1-3 words naming what they drew>\nCOMPOSITION: <one short phrase: "full figure", "headshot", "wide scene", "close-up", "object on background", etc>\nDETAILS: <a sentence describing what they actually drew: body parts visible, action/pose, colors, positions>\nCHARACTER: <2-3 sentences capturing the drawing\'s distinctive quirks — proportions (e.g. "oblong head", "long thin arms", "tiny legs"), shapes (round/oval/square), expression/mood, posture, any unusual or charming details. These are the things that make THIS drawing unique, not just any drawing of a {subject}. Be specific and faithful to what you actually see.>';

  const useBackend = readStored('use_backend') === 'true';

  if (useBackend) {
    logStep('Trying Claude Code (local)…');
    try {
      const res = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64 }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          return {
            message: data.message,
            subject: data.subject || '',
            composition: data.composition || '',
            details: data.details || '',
            character: data.character || '',
          };
        }
      }
      logStep('Claude Code unavailable, falling back…');
    } catch (e) {
      logStep('Claude Code unavailable (' + e.message + ')');
    }
  }

  const geminiKey = getApiKey();
  if (geminiKey) {
    logStep('Trying Gemini Vision…');
    try {
      const res = await fetch(GEMINI_URL + '?key=' + geminiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: b64 } }
          ]}]
        })
      });
      if (res.ok) {
        const data = await res.json();
        return parseSubjectResponse(data.candidates[0].content.parts[0].text.trim());
      }
      logStep('Gemini rate limited (' + res.status + '), trying Claude…');
    } catch (e) {
      logStep('Gemini failed, trying Claude…');
    }
  }

  // Server-side Claude vision (no browser API key). Runs on the user's subscription.
  logStep('Trying Claude…');
  try {
    const res = await fetch('/api/recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: b64 })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && !data.error) {
        return {
          subject: data.subject || '',
          composition: data.composition || '',
          details: data.details || '',
          character: data.character || '',
          message: data.message || ''
        };
      }
    }
    logStep('Claude failed (' + res.status + ')');
  } catch (e) {
    logStep('Claude failed: ' + e.message);
  }

  throw new Error('All vision providers unavailable — try again in a moment');
}

function parseSubjectResponse(text) {
  const lines = text.split('\n');
  const findLine = (key) => {
    const l = lines.find(x => x.trim().toUpperCase().startsWith(key + ':'));
    return l ? l.split(':').slice(1).join(':').trim() : '';
  };
  const subject = findLine('SUBJECT');
  const composition = findLine('COMPOSITION');
  const details = findLine('DETAILS');
  const character = findLine('CHARACTER');
  const meta = ['SUBJECT', 'COMPOSITION', 'DETAILS', 'CHARACTER'];
  const message = lines
    .filter(l => !meta.some(k => l.trim().toUpperCase().startsWith(k + ':')))
    .join('\n').trim();
  return { message, subject, composition, details, character };
}

// Generate image prompt + Pollinations URL
export async function generateImage(subject, styleHint, composition, details, character) {
  const mode = document.getElementById('animation-mode')?.checked ? 'faithful' : 'reimagine';
  const useBackend = readStored('use_backend') === 'true';
  let prompt;

  if (useBackend) {
    try {
      const res = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, style: styleHint, mode, composition, details, character })
      });
      if (res.ok) prompt = (await res.json()).prompt;
    } catch (e) { /* fall through */ }
  }

  if (!prompt) {
    const compHint = composition ? ', ' + composition : '';
    const detailHint = details ? ' Scene: ' + details + '.' : '';
    const charHint = character ? ' Preserve these distinctive traits: ' + character : '';
    prompt = styleHint
      ? subject + compHint + ', ' + styleHint + ', highly detailed, vivid colors, masterpiece.' + detailHint + charHint
      : 'A beautiful, vibrant ' + subject + compHint + ', highly detailed, vivid colors, masterpiece, whimsical, magical.' + detailHint + charHint;
  }
  setLastGeneratedPrompt(prompt);
  log('flow', 'final image prompt', { prompt: prompt.slice(0, 300) });
  logStep('Generating with Pollinations.ai…');
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 999999);
  return {
    url: POLLINATIONS_IMAGE + encoded + '?width=768&height=768&seed=' + seed + '&nologo=true',
    prompt,
  };
}
