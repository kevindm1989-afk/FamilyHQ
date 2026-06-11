/**
 * featureFlag — strict env-var contract for VITE_FCM_ENABLED (PR C bonus).
 *
 * Pins:
 *   - `isPushNotificationsEnabled()` returns `false` when the env var is
 *     undefined.
 *   - Returns `true` ONLY for the literal string `'true'` — strict equality,
 *     no truthiness games.
 *   - Returns `false` for `'1'`, `'yes'`, `''`, `'TRUE'`, `0`, etc.
 *
 * Why a separate tiny module: importing this predicate MUST NOT pull
 * `firebase/messaging` (or anything from `src/firebase/config.ts`) into
 * AppShell. The aborted PR B fix hit exactly that: a regression where
 * loading the predicate eagerly evaluated the FCM init, busting the lazy
 * chunk boundary. Test #4 below pins that contract: this module has NO
 * static imports from firebase/* — verified by source-scan.
 *
 * MUST FAIL today: `src/features/notifications/featureFlag.ts` does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FLAG_MODULE_PATH = resolve(__dirname, './featureFlag.ts');

/**
 * Re-import the module after stubbing import.meta.env so we get the value
 * the env-var was assigned at module-evaluation time. vi.stubEnv updates
 * import.meta.env entries for the duration of the test.
 *
 * Deferred via `pathToFileURL` so Vite's import-analysis doesn't try to
 * pre-resolve the path at file-parse time; we want each individual test
 * case to fail with its OWN diagnostic message when the file is absent,
 * not the whole suite to collapse with a single resolve error.
 */
async function loadFreshFlagModule(): Promise<{
  isPushNotificationsEnabled?: () => boolean;
}> {
  vi.resetModules();
  if (!existsSync(FLAG_MODULE_PATH)) {
    throw new Error(
      `featureFlag.ts is missing at ${FLAG_MODULE_PATH} — implementer must create it (brief Bonus)`,
    );
  }
  const url = `${FLAG_MODULE_PATH.startsWith('/') ? 'file://' : 'file:///'}${FLAG_MODULE_PATH}`;
  return (await import(/* @vite-ignore */ url)) as {
    isPushNotificationsEnabled?: () => boolean;
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('isPushNotificationsEnabled — strict literal-"true" contract', () => {
  it('returns false when VITE_FCM_ENABLED is undefined', async () => {
    // Explicitly stub to undefined-equivalent (empty string); vitest's
    // stubEnv treats this as the absent case for assertions.
    vi.stubEnv('VITE_FCM_ENABLED', '');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });

  it('returns true ONLY when VITE_FCM_ENABLED === "true" (lowercase, literal)', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', 'true');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(true);
  });

  it('returns false for "1" (truthy in JS but NOT the literal "true")', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', '1');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });

  it('returns false for "yes"', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', 'yes');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });

  it('returns false for the empty string', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', '');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });

  it('returns false for "TRUE" (case-sensitive — uppercase is NOT accepted)', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', 'TRUE');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });

  it('returns false for "True" (case-sensitive)', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', 'True');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });

  it('returns false for " true " (whitespace not stripped — strict equality)', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', ' true ');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });

  it('returns false for "false"', async () => {
    vi.stubEnv('VITE_FCM_ENABLED', 'false');
    const mod = await loadFreshFlagModule();
    expect(mod.isPushNotificationsEnabled!()).toBe(false);
  });
});

describe('featureFlag.ts — module hygiene (does NOT pull firebase/* into AppShell)', () => {
  it('the source file exists at src/features/notifications/featureFlag.ts', () => {
    expect(existsSync(FLAG_MODULE_PATH)).toBe(true);
  });

  it('the source has NO static import from firebase/* or any subpath (PR B aborted-fix lesson)', () => {
    // The whole point of this tiny module is that AppShell can import the
    // predicate without paying for the firebase/messaging chunk. A static
    // `import ... from 'firebase/...'` here would defeat that.
    const src = readFileSync(FLAG_MODULE_PATH, 'utf8');
    // Match either side of the import syntax: `from 'firebase/...'` or
    // `from "firebase/..."`. Banned outright.
    expect(src).not.toMatch(/from\s+['"]firebase\/[^'"]+['"]/);
    // Also forbid a relative re-import of src/firebase/config (same lazy-
    // chunk regression vector).
    expect(src).not.toMatch(/from\s+['"][./]+(src\/)?firebase\/config['"]/);
  });

  it('the source has NO require("firebase/...") either (CJS bypass guard)', () => {
    const src = readFileSync(FLAG_MODULE_PATH, 'utf8');
    expect(src).not.toMatch(/require\s*\(\s*['"]firebase\/[^'"]+['"]\s*\)/);
  });

  it('the source exports the predicate function `isPushNotificationsEnabled`', () => {
    const src = readFileSync(FLAG_MODULE_PATH, 'utf8');
    // Accept either `export function isPushNotificationsEnabled` or
    // `export const isPushNotificationsEnabled` followed by a fat-arrow.
    const hasExport =
      /export\s+function\s+isPushNotificationsEnabled\s*\(/.test(src) ||
      /export\s+const\s+isPushNotificationsEnabled\s*=/.test(src);
    expect(hasExport).toBe(true);
  });
});
