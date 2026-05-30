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
      // Tier the assertions: hard-fail (error) on the launch-critical
      // category scores; warn-only for SEO + best-practices, which are
      // most distorted by the static-server context. Lower a threshold
      // ONLY with an explicit reason in the PR description.
      assertions: {
        'categories:performance': ['error', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:seo': ['warn', { minScore: 0.9 }],
        // Hot-path metric budgets — direct numbers, not just category
        // scores. Desktop preset targets:
        //   LCP < 2.5s, CLS < 0.1, TBT < 200ms, FCP < 2s (warn).
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
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
