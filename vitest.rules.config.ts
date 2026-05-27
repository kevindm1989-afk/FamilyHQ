import { defineConfig } from 'vitest/config';

// Firestore security-rules test suite. Runs against the local Firestore
// emulator (started via `firebase emulators:exec` — see Makefile `test-rules`
// and the CI `firestore-rules` job). The suite itself is authored by the
// test-writer in Phase 1 (Task 5); this config + a placeholder spec exist so
// the script + CI gate are wired now.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/rules/**/*.{test,spec}.ts'],
    // Rules tests can be slow (emulator round-trips).
    testTimeout: 20000,
    hookTimeout: 20000,
    // All suites share one Firestore emulator project and call
    // `clearFirestore()` in beforeEach/afterEach. Running suite files in
    // parallel lets one file's clear wipe another's seed mid-test (flaky
    // cross-tenant failures + getAfter service errors). Force single-file
    // execution so each suite has exclusive emulator state. This is harness
    // isolation, not a rule relaxation.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
