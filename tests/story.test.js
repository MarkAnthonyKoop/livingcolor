import { describe, it, expect } from 'vitest';
import { sanitizePrompt, buildPollinationsUrl } from '../js/story.js';

describe('sanitizePrompt', () => {
  it('normalizes smart quotes, dashes, and ellipsis', () => {
    expect(sanitizePrompt('a ‘cat’ — “fluffy”…')).toBe("a 'cat' - \"fluffy\"...");
  });

  it('strips control characters', () => {
    expect(sanitizePrompt('a\x00 b\x1Fc\x7Fd\ne')).toBe('a bcde');
    expect(sanitizePrompt('tab\tsep')).toBe('tabsep');
  });

  it('keeps accented and non-Latin characters', () => {
    expect(sanitizePrompt('niño pequeño')).toBe('niño pequeño');
    expect(sanitizePrompt('小さな猫')).toBe('小さな猫');
    expect(sanitizePrompt('café crème')).toBe('café crème');
  });

  it('handles null/undefined/empty input', () => {
    expect(sanitizePrompt(null)).toBe('');
    expect(sanitizePrompt(undefined)).toBe('');
    expect(sanitizePrompt('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizePrompt('  padded  ')).toBe('padded');
  });
});

describe('buildPollinationsUrl', () => {
  it('builds a Pollinations URL with seed and size params', () => {
    const url = buildPollinationsUrl('a red dragon', 1234);
    expect(url.startsWith('https://image.pollinations.ai/prompt/')).toBe(true);
    expect(url).toContain('seed=1234');
    expect(url).toContain('width=768&height=768');
    expect(url).toContain('nologo=true');
  });

  it('appends the quality suffix to the prompt', () => {
    const url = buildPollinationsUrl('a cat', 1);
    expect(decodeURIComponent(url)).toContain('a cat, highly detailed, vivid colors, masterpiece');
  });

  it('caps very long prompts at 400 chars before the suffix', () => {
    const long = 'x'.repeat(1000);
    const url = buildPollinationsUrl(long, 1);
    const path = url.slice('https://image.pollinations.ai/prompt/'.length, url.indexOf('?'));
    const decoded = decodeURIComponent(path);
    expect(decoded.length).toBeLessThanOrEqual(400 + ', highly detailed, vivid colors, masterpiece'.length);
  });

  it('percent-encodes non-ASCII prompts instead of dropping them', () => {
    const url = buildPollinationsUrl('niño pequeño', 7);
    expect(decodeURIComponent(url)).toContain('niño pequeño');
  });
});
