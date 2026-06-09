/**
 * Entry-point gate (second-opinion review #1).
 *
 * `firebase deploy --only functions:billingKillSwitch` reads the Functions
 * workspace's `main` (`lib/index.js` after `tsc`), so `functions/src/index.ts`
 * MUST exist and re-export `billingKillSwitch`. Without this, the deploy
 * either fails with "function not found in source" OR — worse, on some
 * firebase-tools versions — silently succeeds with zero functions and the
 * kill-switch is never deployed at all. The unit tests in
 * `functions/test/billingKillSwitch.test.ts` import the SOURCE file directly,
 * so they pass even when the entry point is missing — this gate catches
 * that gap by inspecting the source tree.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();
const INDEX_PATH = join(REPO_ROOT, 'functions/src/index.ts');
const PACKAGE_JSON_PATH = join(REPO_ROOT, 'functions/package.json');

describe('functions/src/index.ts — Cloud Functions deployment entry point', () => {
  it('exists at functions/src/index.ts', () => {
    expect(existsSync(INDEX_PATH)).toBe(true);
  });

  it('re-exports the `billingKillSwitch` symbol so firebase deploy can resolve it', () => {
    const source = readFileSync(INDEX_PATH, 'utf8');
    // Accept either a direct re-export or a destructured re-export. Pin
    // both spellings to keep the assertion robust against formatter
    // changes.
    const reExportMatch =
      /export\s*\{\s*billingKillSwitch[^}]*\}\s*from\s*['"]\.\/billingKillSwitch(?:\.js)?['"]/.test(
        source,
      ) ||
      /export\s*\{\s*billingKillSwitch[^}]*\}\s*from\s*['"]\.\/billingKillSwitch(?:\.js)?['"];/.test(
        source,
      );
    expect(reExportMatch).toBe(true);
  });

  it('functions/package.json main points at the compiled entry (lib/index.js)', () => {
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as { main?: string };
    expect(manifest.main).toBe('lib/index.js');
  });
});
