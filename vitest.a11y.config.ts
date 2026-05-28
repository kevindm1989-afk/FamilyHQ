import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * A11y gate config (Phase 4 / Task 17). Picks up ONLY the dedicated a11y
 * tests under `src/__a11y__/`; the main vitest config excludes that path so
 * the suite runs exactly once per verifier invocation (under this config,
 * via `npm run a11y` and the verifier's Tier-4 a11y step).
 *
 * Shares the main config's jsdom environment + setup file (which registers
 * the `toHaveNoViolations` matcher and the jest-dom matchers).
 */
export default defineConfig({
  // VitePWA is included so it can resolve the `virtual:pwa-register/react`
  // module that `PwaUpdatePrompt.tsx` imports (test-time; the SW itself does
  // not run under jsdom). Without it, importing the prompt's a11y test fails
  // at module resolution.
  plugins: [react(), VitePWA({ registerType: 'prompt' })],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/__a11y__/**/*.{test,spec}.{ts,tsx}'],
    // Default exclude (node_modules) still applies; we intentionally do NOT
    // exclude the a11y dir here — that's the whole point of this config.
  },
});
