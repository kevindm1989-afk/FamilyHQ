/**
 * Playwright config — e2e smoke tests for the public-facing surface.
 *
 * Scope: tests run against the REAL production build (vite build → preview)
 * against the REAL browser (chromium). These catch what jsdom integration
 * tests can't:
 *   - CSS layout (focus rings, skip-link reveal, responsive widths)
 *   - <html lang> attribute syncing on language change
 *   - language-toggle round-trip in a real DOM
 *   - the actual production bundle byte loading + parsing
 *
 * Scope explicitly DOES NOT include the auth + Firestore happy-path — that
 * needs the Firebase emulator suite wired into CI as a separate piece of
 * infrastructure. These tests cover the unauthed entry points only
 * (LoginScreen and AccessibilityStatementScreen) so they require no backend.
 *
 * Browser bin: Playwright 1.56 pairs with browser revision 1194, which is
 * the version available in the team's prebuilt container at
 * /opt/pw-browsers. Local devs should run `npx playwright install chromium`
 * first; in CI the runner image is expected to either include the binary
 * or fetch it on first run.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173; // vite preview default

export default defineConfig({
  testDir: './e2e',
  // Run sequentially so the single preview server isn't oversaturated; this is
  // a smoke suite, not a load test.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    // The login flow's dynamic-imported authService tries to read
    // VITE_FIREBASE_* env at module-load. In the preview build those are
    // baked from the .env.local at build time (or missing — see webServer
    // below). We never reach the form submit in these smoke tests, so
    // missing config is fine — the login render path is firebase-free.
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // Build + preview the production bundle for each run — the same bundle
    // CI / users would see. `npm run build` includes `tsc --noEmit && vite
    // build`; preview serves from dist/.
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
