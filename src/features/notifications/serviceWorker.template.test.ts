/**
 * SW build-template contract (PR G).
 *
 * The Vite plugin in `vite.config.ts` rewrites `dist/firebase-messaging-sw.js`
 * by matching the literal config object between two marker comments. Without
 * the markers the plugin throws — and with no plugin output the SW boots
 * against placeholder values, `getToken()` fails silently, and no push
 * is ever delivered. Pin both markers so a future "tidy up" edit that
 * removes them surfaces here BEFORE shipping.
 *
 * The build-time substitution is asserted by `scripts/verify.sh` (runs
 * `npm run build` and inspects dist/). This file is the static-source
 * half of the contract.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SW_PATH = resolve(__dirname, '../../../public/firebase-messaging-sw.js');

function readSw(): string {
  if (!existsSync(SW_PATH)) {
    throw new Error(`firebase-messaging-sw.js missing at ${SW_PATH}`);
  }
  return readFileSync(SW_PATH, 'utf8');
}

describe('firebase-messaging-sw.js — build-template markers', () => {
  it('contains the __FIREBASE_CONFIG_START__ marker', () => {
    expect(readSw()).toContain('/* __FIREBASE_CONFIG_START__ */');
  });

  it('contains the __FIREBASE_CONFIG_END__ marker', () => {
    expect(readSw()).toContain('/* __FIREBASE_CONFIG_END__ */');
  });

  it('the markers wrap a JS object literal (the config the build substitutes)', () => {
    const src = readSw();
    const marker =
      /\/\* __FIREBASE_CONFIG_START__ \*\/\s*\{[\s\S]*?\}\s*\/\* __FIREBASE_CONFIG_END__ \*\//;
    expect(src).toMatch(marker);
  });
});
