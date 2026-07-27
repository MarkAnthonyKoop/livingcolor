import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// CSP contract: index.html ships ZERO inline style attributes, so the
// style-src directive can drop 'unsafe-inline'. Hidden state uses the native
// [hidden] attribute backed by `[hidden]{display:none !important}` in
// style.css; reveals go through js/vis.js (which clears the attribute).
describe('no inline styles ship', () => {
  it('index.html has no style= attributes', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/ style="/);
  });

  it('style.css carries the [hidden] backstop', () => {
    expect(readFileSync('style.css', 'utf8')).toMatch(/\[hidden\]\s*{\s*display:\s*none\s*!important/);
  });
});
