import { defineConfig } from 'vitest/config';

// Functions-workspace Vitest config — intentionally separate from the root
// `vitest` so the SPA test runner never picks up `functions/test/**`. The root
// `npm test` excludes this directory by include-set scoping; we add an explicit
// guard here in case someone runs vitest from inside `functions/`.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'lib'],
    // Each test sets up its own mocks via vi.mock(); no shared fixtures, no
    // network, no real billing client. Deterministic by construction.
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
