import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
import { APP_DEFINE } from './vite.config';

/**
 * The unit tests: the rules in `src/domain` and the parts of `src/api` and
 * `src/store` that are plain functions. Kept apart from `vite.config.ts` so
 * the app's plugins (the service worker, the OAuth client document) never run
 * under test. End-to-end journeys live in `e2e/` and run with Playwright.
 */
export default defineConfig({
  define: APP_DEFINE,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
