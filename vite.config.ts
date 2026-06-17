// Pin a deterministic, non-UTC default timezone for the whole test run before
// any worker forks (workers inherit this process.env). Local-day behaviour
// (e.g. allowance day grouping, F4) is then exercised identically on every
// machine regardless of the host zone. Set here (not in a setup file) because
// V8 locks its default zone early — it must already be in the environment when
// the worker runtime initialises.
process.env.TZ ??= 'America/Los_Angeles';

// Use vitest/config's defineConfig because Vite 6 split test-config typing
// off the Vite UserConfig union. The triple-slash reference at the top of
// this file already pulls vitest's `test:` augmentation into scope.
import { defineConfig } from 'vitest/config';
import type { PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { loadEnv } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// FCM background-message service worker config substitution. The SW at
// `public/firebase-messaging-sw.js` is plain JS loaded directly by the
// browser (outside the Vite bundle), so it cannot read `import.meta.env`.
// At build time this plugin reads the same VITE_FIREBASE_* values Vite
// already loaded for the SPA bundle, then rewrites the literal config
// object between the marker comments. Without this step the SW boots
// against placeholder values, `getToken()` fails silently, and no push
// is ever delivered.
function firebaseMessagingSwConfigPlugin(): PluginOption {
  const SW_FILENAME = 'firebase-messaging-sw.js';
  const REQUIRED_VITE_KEYS = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
  ] as const;
  let resolvedMode = 'production';
  let resolvedRoot = process.cwd();
  return {
    name: 'familyhq-firebase-messaging-sw-config',
    apply: 'build',
    configResolved(config): void {
      resolvedMode = config.mode;
      resolvedRoot = config.root;
    },
    closeBundle: {
      sequential: true,
      handler(): void {
        const outPath = resolve(resolvedRoot, 'dist', SW_FILENAME);
        let source: string;
        try {
          source = readFileSync(outPath, 'utf8');
        } catch (err) {
          // PWA-disabled emulator e2e builds may not copy `public/` assets;
          // ENOENT in that case is benign. Anything else (EACCES, EISDIR,
          // partial read) is a real environment problem — fail loud so a
          // mis-permissioned CI mount cannot ship an un-templated SW
          // that would silently degrade FCM in production.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw err;
        }
        // 'VITE_' prefix matches the SPA bundle's contract — only VITE_-
        // prefixed vars cross into client-shipped artifacts. An empty
        // prefix would load every env var present at build time (deploy
        // tokens, service-account JSON), which is the wrong default for
        // any code that emits into dist/.
        const env = loadEnv(resolvedMode, resolvedRoot, 'VITE_');
        const missing = REQUIRED_VITE_KEYS.filter((k) => !env[k]);
        if (missing.length > 0) {
          throw new Error(
            `firebase-messaging-sw.js cannot be templated — missing env: ${missing.join(', ')}`,
          );
        }
        const firebaseConfig = {
          apiKey: env['VITE_FIREBASE_API_KEY'],
          authDomain: env['VITE_FIREBASE_AUTH_DOMAIN'],
          projectId: env['VITE_FIREBASE_PROJECT_ID'],
          storageBucket: env['VITE_FIREBASE_STORAGE_BUCKET'],
          messagingSenderId: env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
          appId: env['VITE_FIREBASE_APP_ID'],
        };
        const marker =
          /\/\* __FIREBASE_CONFIG_START__ \*\/[\s\S]*?\/\* __FIREBASE_CONFIG_END__ \*\//;
        if (!marker.test(source)) {
          throw new Error(
            `firebase-messaging-sw.js missing __FIREBASE_CONFIG_START__/__END__ markers`,
          );
        }
        const replaced = source.replace(
          marker,
          `/* __FIREBASE_CONFIG_START__ */ ${JSON.stringify(firebaseConfig)} /* __FIREBASE_CONFIG_END__ */`,
        );
        writeFileSync(outPath, replaced, 'utf8');
      },
    },
  };
}
// rollup-plugin-visualizer is imported DYNAMICALLY inside the config factory
// (only when ANALYZE=true). The package is ESM-only and uses `import.meta.dirname`
// in its template loader; knip's jiti-based config loader runs in a CJS-style VM
// context that can't evaluate `import.meta`, so a top-level static import would
// crash the knip gate even though vite itself handles it fine. Loading lazily
// means jiti never touches visualizer during static analysis (ANALYZE is unset).

// Bundle visualizer — set ANALYZE=true at build time to emit
// dist/bundle-stats.html, a treemap of every chunk + its module
// contents. Pairs with scripts/bundle-budget.json: when the budget
// gate fails and you need to figure out what got pulled in, run
// `npm run analyze` and open dist/bundle-stats.html. Default OFF
// because the visualizer is ~700 KB of HTML/JS embedded in dist/
// and we don't want it in a production deploy.
const ANALYZE = process.env.ANALYZE === 'true';

// PWA (ADR-0005): Firestore handles data offline; Workbox precaches the app
// shell + serves an SPA fallback for navigations while offline. SW updates
// are USER-CONTROLLED via `registerType: 'prompt'` — `src/app/PwaUpdatePrompt.tsx`
// surfaces the prompt; mid-task users never get a surprise reload.
export default defineConfig(async () => ({
  plugins: [
    react(),
    firebaseMessagingSwConfigPlugin(),
    VitePWA({
      // Skip SW generation when the build is for the authed e2e suite
      // (`vite build --mode emulator`, see package.json's e2e:authed
      // script + .env.emulator). The `disable` option still emits the
      // `virtual:pwa-register/react` shim so PwaUpdatePrompt's import
      // resolves, but the SW itself is never registered — which is what
      // we need: a SW from one Playwright test was caching the app shell
      // and serving stale state to the next test in the same emulator
      // run, breaking the auth-listener flip between sign-in and sign-out
      // (the negative-path tests in PR #32's commit body have the long
      // form). PWA's offline contract is for end users, not the emulator
      // suite — turning it off there is safe.
      disable: process.env.VITE_DISABLE_PWA === 'true',
      // The new SW installs in the background but waits for an explicit
      // updateServiceWorker(true) call — the prompt component owns that
      // decision so a mid-task user is never reloaded silently.
      registerType: 'prompt',
      // Static assets that need to be in the precache but aren't otherwise
      // emitted by Vite's bundler (those come in via globPatterns below).
      // favicon.svg is the SVG browser-tab icon; the apple-touch-icon is
      // what iOS reads from <link rel="apple-touch-icon"> in index.html
      // (it does NOT read the web-app manifest's icon list for the home-
      // screen tile, so the file must be precached separately to work
      // offline). The 192/512 manifest icons are picked up by the
      // globPatterns *.png rule below.
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      workbox: {
        // The app shell — every static artifact Vite emits. The SW precaches
        // these at install time so a cold offline launch boots the SPA and
        // Firestore's IndexedDB cache (config.ts) serves the data.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
        // SPA navigations that miss the precache (any deep route) fall back
        // to the precached index.html. Without this the browser shows its
        // offline error page on a fresh deep-link while offline.
        navigateFallback: '/index.html',
        // ...EXCEPT requests we MUST NOT serve from the shell — Firebase /
        // Google API hosts handle their own offline path via the Firestore
        // SDK's IndexedDB cache + write queue. Letting the SW intercept those
        // would corrupt the SDK's transport. The denylist is conservative:
        // anything looking like a Firebase / Google API host, and the auth
        // popup handler routes.
        navigateFallbackDenylist: [
          /^\/__\//, // Firebase Hosting reserved
          /\/firestore\.googleapis\.com\//,
          /\/identitytoolkit\.googleapis\.com\//,
          /\/securetoken\.googleapis\.com\//,
        ],
        // Prune precache entries for files that no longer exist in a new
        // build, so storage doesn't grow unbounded across deployments.
        cleanupOutdatedCaches: true,
        // No skipWaiting — the prompt flow controls activation so a mid-task
        // user is never replaced under their feet.
        skipWaiting: false,
        clientsClaim: false,
      },
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
    // Cast to PluginOption: rollup-plugin-visualizer types its plugin
    // against rollup's Plugin shape, which differs from vite 6's stricter
    // PluginOption under exactOptionalPropertyTypes (resolveId.options
    // gains `ssr`, filter.id loses its `| undefined`). The plugin runs
    // identically — only the type surfaces diverge — so a narrow cast
    // here is preferable to loosening tsconfig.
    ANALYZE
      ? ((await import('rollup-plugin-visualizer')).visualizer({
          filename: 'dist/bundle-stats.html',
          gzipSize: true,
          brotliSize: true,
          template: 'treemap',
          // Open the report automatically in a browser when the build finishes
          // (handy during local debugging; never fires in CI which doesn't
          // set ANALYZE).
          open: true,
        }) as PluginOption)
      : false,
  ],
  build: {
    // Emit source maps as SEPARATE .map files but DO NOT reference them
    // from the JS bundles via a `//# sourceMappingURL=` comment. The
    // result:
    //   - The maps exist in dist/ for an error-tracking SDK (Sentry,
    //     Bugsnag, etc.) to upload during the release step. When that
    //     wires in, the SDK reads dist/assets/*.js.map and pairs them
    //     with the captured stack traces server-side.
    //   - Casual users inspecting the bundles in devtools do NOT see a
    //     link to the maps, so a curious visitor can't trivially
    //     reconstruct the source.
    //   - firebase.json's hosting.ignore strips `**/*.map` from the
    //     deploy upload entirely, so the maps never leave the build
    //     machine in production. (The hidden setting is the BELT;
    //     ignore is the SUSPENDERS.)
    // ErrorBoundary's reportError seam (src/app/ErrorBoundary.tsx) is
    // where the SDK's captureException will attach.
    sourcemap: 'hidden' as const,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    // Rules tests run under their own config + the emulator (npm run test:rules).
    // A11y tests under src/__a11y__/ run as their own tier via `npm run a11y`
    // (verify.sh Tier 4); excluded here so they execute exactly once per
    // verifier invocation, not twice.
    // `functions/**` is a separate workspace with its own Vitest config + its
    // own runtime semantics (Node 22, no jsdom, mocks the firebase-functions
    // SDK at the boundary). The root `npm test` must NOT pick those tests up
    // — they run via `cd functions && npm test`. Root-side AST/IAM/CI-shape
    // tests that scan the functions tree live under `test/functions/**` and
    // ARE picked up here (they assert on files, not Functions runtime).
    exclude: [
      'test/rules/**',
      'test/storage-rules/**',
      'node_modules/**',
      'src/__a11y__/**',
      'functions/**',
    ],
    // Coverage runs via `npm run coverage` AND inside the verifier's
    // npm-test gate (scripts/verify.sh): vitest fails the run if any of
    // the thresholds below is breached, so a PR that drops coverage
    // cannot merge silently.
    //
    // v8 provider is the upstream-recommended default for vitest 3; it
    // pipes V8's native coverage so we don't pay a Babel-instrumentation
    // cost on every test run. Reporters: `text` for the terminal summary,
    // `html` for the drill-down view at coverage/index.html (gitignored),
    // `lcov` so a future Codecov/Coveralls integration has a file to
    // consume.
    coverage: {
      provider: 'v8' as const,
      reporter: ['text', 'html', 'lcov'],
      // Mirror the test include set so the report covers the runtime code
      // we actually exercise. Tests, type-only files, generated artifacts,
      // and config files don't belong in the denominator.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.d.ts',
        'src/__a11y__/**',
        'src/main.tsx', // bootstrap shim, exercised by e2e not unit tests
        'src/vite-env.d.ts',
      ],
      // Thresholds — pinned with ~5% headroom below the baseline measured
      // after the coverage backfill (PR #71 — useFamily Provider + Board
      // Route + ChoresRoute tests). The post-Vitest-4 provider measures
      // lines vs. statements separately and counts JSX/TSX paths
      // accurately; previous baseline under v4 was lines 82.5 / branches
      // 75.0 / funcs 79.6 / stmts 80.2 (thresholds 78/70/75/76). With
      // the new tests the measured baseline is lines 89.6 / branches
      // 80.2 / funcs 84.5 / stmts 86.7 — thresholds tightened ~5% under
      // those to lock in the gain. The point isn't to ratchet up
      // mechanically; it's to catch a meaningful regression — a PR that
      // disables a test file, deletes assertions, or adds a sizable
      // un-exercised feature gets flagged before merge.
      //
      // Raise these when the suite naturally settles higher. Lower them
      // ONLY with an explicit reason in the PR description (e.g. a
      // dependency added a generated wrapper we can't reasonably cover).
      thresholds: {
        lines: 84,
        branches: 75,
        functions: 79,
        statements: 81,
      },
    },
  },
}));
