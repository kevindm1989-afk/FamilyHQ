/// <reference types="vitest/config" />

// Pin a deterministic, non-UTC default timezone for the whole test run before
// any worker forks (workers inherit this process.env). Local-day behaviour
// (e.g. allowance day grouping, F4) is then exercised identically on every
// machine regardless of the host zone. Set here (not in a setup file) because
// V8 locks its default zone early — it must already be in the environment when
// the worker runtime initialises.
process.env.TZ ??= 'America/Los_Angeles';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// PWA baseline only (ADR-0005). Manifest + autoUpdate registration.
// TODO(Phase 4 / Task 16): Workbox app-shell precache, offline-fallback
// navigation route, controlled SW update prompt, runtime asset caching.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Icons are placeholders; real icon set is a Phase 4 / design deliverable.
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Family HQ',
        short_name: 'FamilyHQ',
        description: 'A shared family home base for schedules, chores, and allowance.',
        // theme_color / background_color come straight from design-tokens.json
        // (color.light.brand.indigo / color.light.surface.bg). Kept in sync by
        // hand here because the web-app manifest cannot import the TS theme.
        theme_color: '#3730A3',
        background_color: '#F9FAFB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    // Rules tests run under their own config + the emulator (npm run test:rules).
    // A11y tests under src/__a11y__/ run as their own tier via `npm run a11y`
    // (verify.sh Tier 4); excluded here so they execute exactly once per
    // verifier invocation, not twice.
    exclude: ['test/rules/**', 'node_modules/**', 'src/__a11y__/**'],
    // Coverage reporting (provider + reporters) is configured by the test-writer
    // when real tests land, so we don't pin an unused coverage engine in the
    // empty shell. Run with `vitest run --coverage` once `@vitest/coverage-v8`
    // is added.
  },
});
