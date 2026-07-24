import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // jsdom refuses localStorage on opaque origins (the default about:blank)
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
    setupFiles: ['tests/_setup.js'],
    globals: true,
  },
});
