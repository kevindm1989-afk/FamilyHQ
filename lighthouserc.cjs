/**
 * Lighthouse CI config (lhci 0.15+).
 *
 * Static-site collection: `npm run build` produces dist/; LHCI spins up its
 * own static server against that, hits the URL list, and asserts category
 * scores + a few hot-path metric budgets.
 *
 * Why CommonJS:
 *   The lhci CLI loads its config via `require()` and the project is ESM
 *   ("type": "module" in package.json), so the config file MUST be .cjs for
 *   the loader to not blow up. .json was an option too but we want runtime
 *   comments + the CHROME_PATH env fallback, which JSON can't express.
 *
 * Chrome path:
 *   Picks up CHROME_PATH from the environment when set (the verifier exports
 *   it before invoking lhci so this points at the Playwright-managed
 *   Chromium under /opt/pw-browsers). When unset, falls through to LHCI's
 *   default lookup (system Chrome / chrome-launcher discovery), which is
 *   what a fresh developer install hits.
 */
module.exports = {
  ci: {
    collect: {
      // Static-site mode — LHCI serves dist/ itself, so we don't have to
      // wrangle a vite preview process from inside the config.
      staticDistDir: './dist',
      // Just the entrypoint for now. Authed routes need a signed-in session
      // and would need an LHCI Puppeteer recipe to seed auth — out of scope
      // for this PR; the public surface is the highest-leverage Lighthouse
      // signal anyway (it's the page every visitor hits first).
      url: ['http://localhost/'],
      // Two runs gives a noise floor without exploding wall-clock; LHCI
      // takes the median by default.
      numberOfRuns: 2,
      settings: {
        chromePath: process.env.CHROME_PATH || undefined,
        // CI and sandboxed dev environments (incl. this project's remote
        // execution containers) run as root and need --no-sandbox or Chrome
        // refuses to start. --headless=new uses the new headless mode
        // Lighthouse expects on modern Chrome.
        chromeFlags: '--no-sandbox --headless=new --disable-dev-shm-usage',
        preset: 'desktop',
        throttlingMethod: 'simulate',
        // Audits that are noise on a localhost static server (no HTTPS,
        // no HTTP/2) or unfair to the SW-prompt flow we deliberately use
        // (registerType: 'prompt' means the SW doesn't install at first
        // load — installable-manifest fails by design).
        skipAudits: ['is-on-https', 'uses-http2', 'installable-manifest', 'service-worker'],
      },
    },
    assert: {
      // ALL Lighthouse assertions are WARN-only.
      //
      // Lighthouse is here as an observability signal — the numbers are
      // tracked, regressions are visible, but the gate never blocks a
      // merge. Three reasons:
      //
      //   1. GitHub-hosted runners have noisy CPU contention (shared
      //      tenants on the same VM) that drops perf scores 0.10-0.15
      //      vs a clean local run. PR #51's CI tripped on this twice.
      //   2. Lighthouse's accessibility audit subset checks rendering-
      //      sensitive rules (contrast ratios in particular) that can
      //      vary by 1-2 points run-to-run depending on font hinting
      //      and Chromium version drift.
      //   3. The REAL accessibility bar is the axe-core unit suite
      //      (`npm run a11y`, 47 tests, runs as its own Tier-4 gate).
      //      That's a deterministic JSDOM check, not a screenshot
      //      diff — it doesn't suffer from runner-noise issues. We
      //      don't need a second a11y gate that's noisier than the
      //      first.
      //
      // To turn any of these back into hard-error gates, switch 'warn'
      // → 'error' and run CI on a dedicated runner (self-hosted or
      // larger) that doesn't have the noise floor.
      assertions: {
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['warn', { minScore: 0.95 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 200 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 2000 }],
      },
    },
    upload: {
      // Filesystem target — emits JSON + HTML reports under .lighthouseci/
      // for local inspection. Switch target to 'temporary-public-storage'
      // to share a one-off link, or 'lhci' once a real LHCI server lands.
      target: 'filesystem',
      outputDir: './.lighthouseci',
    },
  },
};
