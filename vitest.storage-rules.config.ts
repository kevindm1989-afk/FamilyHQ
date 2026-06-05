import { defineConfig } from 'vitest/config';

// Storage rules test suite. Runs against the local Firebase emulator
// (storage + firestore, since storage.rules uses cross-collection
// `firestore.get()` lookups for callerDoc + chore-assignee checks).
// Wrapped by `npm run test:storage-rules` which kicks the emulator via
// `firebase emulators:exec`.
//
// Same single-fork posture as vitest.rules.config.ts — every test file
// shares one emulator project; running them in parallel races on
// `clearStorage()` and `clearFirestore()`.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/storage-rules/**/*.{test,spec}.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
  },
});
