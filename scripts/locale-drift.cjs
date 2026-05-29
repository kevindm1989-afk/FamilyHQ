#!/usr/bin/env node
/**
 * Locale drift check — verify that every locale file has the SAME nested key
 * structure as the en source. Run by verify.sh as a Tier 1 gate.
 *
 * Why this matters:
 *   - en.json is the source. fr.json (and any future locale) MUST mirror its
 *     keys; missing keys in fr fall back to en at runtime, which is
 *     silently English to a French user — a subtle a11y / launch-gate fail.
 *   - With ~200 keys split across feature trees (login.*, dashboard.*,
 *     calendar.*, family.*, chores.*, etc.) the only realistic way to keep
 *     them in sync is to fail CI on drift.
 *
 * What it checks:
 *   1. The set of dotted key paths in each locale matches en exactly.
 *      Missing keys: fail. Extra keys (in fr but not en): fail — they're
 *      dead weight at best, a typo bug at worst.
 *   2. Every leaf value is a string (i18next plural / Trans-component
 *      strings count). An accidental object/array nesting that breaks
 *      runtime t() resolution is caught at build time, not user runtime.
 *
 * What it does NOT check (intentionally):
 *   - Translation quality. That's the native-speaker review track flagged
 *     in PR #22 onward.
 *   - Whether {{interpolation}} variables match between en and fr. Adding
 *     that would be valuable; it's the natural next iteration if drift
 *     starts coming from there.
 *   - The `_meta` key — meta is locale-specific by design (each locale's
 *     `_meta` carries its own status / register notes). Skipped at the
 *     top level only.
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '..', 'src', 'locales');
const SOURCE = 'en';

// BCP 47 short tag — two lowercase letters, optionally a -REGION suffix
// (en, fr, fr-CA, zh-Hant). Strict shape gate so a stray file in src/locales
// (or a future feature reading from a different source) can never widen the
// path.join sink below. Semgrep flags any path.join whose input it can't
// statically prove safe — the regex below is that proof.
const LOCALE_NAME_RE = /^[a-z]{2}(-[A-Z][a-zA-Z]{1,3})?$/;

function loadLocale(name) {
  if (!LOCALE_NAME_RE.test(name)) {
    throw new Error(`locale-drift: rejected locale name "${name}" — must match ${LOCALE_NAME_RE}`);
  }
  // `name` is gated by LOCALE_NAME_RE above (two-letter primary subtag,
  // optional region) and the resolved path is verified to sit inside
  // LOCALES_DIR below. Semgrep can't trace the regex through to this call
  // so it flags any non-literal argument by default. The nosemgrep marker
  // must be on the line IMMEDIATELY ABOVE the matched call for semgrep to
  // associate them — splitting the justification off above this is
  // deliberate.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const p = path.resolve(LOCALES_DIR, `${name}.json`);
  // Defence-in-depth: even with the regex above, verify the resolved path
  // is still under LOCALES_DIR. Catches a future change where the regex is
  // loosened or LOCALES_DIR moves.
  if (!p.startsWith(LOCALES_DIR + path.sep)) {
    throw new Error(`locale-drift: resolved path escapes locales dir: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Walk a nested object and yield ["dotted.path", value] pairs for every
 *  leaf. The leaf is anything that is NOT a plain object — strings, numbers,
 *  arrays. Objects are recursed into. */
function* leaves(node, prefix = '') {
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      yield* leaves(v, prefix ? `${prefix}.${k}` : k);
    }
  } else {
    yield [prefix, node];
  }
}

function collectKeys(node) {
  const out = new Map();
  // Skip the top-level _meta — each locale's meta is intentionally distinct.
  const cleaned = { ...node };
  delete cleaned._meta;
  for (const [p, v] of leaves(cleaned)) out.set(p, v);
  return out;
}

function diff(sourceKeys, targetKeys) {
  const missing = [];
  const extra = [];
  for (const k of sourceKeys.keys()) if (!targetKeys.has(k)) missing.push(k);
  for (const k of targetKeys.keys()) if (!sourceKeys.has(k)) extra.push(k);
  return { missing, extra };
}

function checkLeafShapes(targetKeys) {
  const badShape = [];
  for (const [k, v] of targetKeys) {
    if (typeof v !== 'string') {
      badShape.push({ key: k, kind: typeof v, sample: String(v).slice(0, 60) });
    }
  }
  return badShape;
}

function main() {
  const enKeys = collectKeys(loadLocale(SOURCE));

  // Discover every other locale file in the directory (resilient to a third
  // language showing up later).
  const others = fs
    .readdirSync(LOCALES_DIR)
    .filter((f) => f.endsWith('.json') && f !== `${SOURCE}.json`)
    .map((f) => path.basename(f, '.json'));

  let failed = false;
  for (const loc of others) {
    const locKeys = collectKeys(loadLocale(loc));
    const { missing, extra } = diff(enKeys, locKeys);
    const badShape = checkLeafShapes(locKeys);

    if (missing.length || extra.length || badShape.length) {
      failed = true;
      console.error(`locale-drift: ${loc}.json drift vs ${SOURCE}.json`);
      if (missing.length) {
        console.error(`  missing (${missing.length}):`);
        for (const k of missing) console.error(`    - ${k}`);
      }
      if (extra.length) {
        console.error(`  extra (${extra.length}):`);
        for (const k of extra) console.error(`    + ${k}`);
      }
      if (badShape.length) {
        console.error(`  non-string leaves (${badShape.length}):`);
        for (const b of badShape) {
          console.error(`    ! ${b.key} → ${b.kind} (${b.sample})`);
        }
      }
    }
  }

  if (failed) {
    console.error('locale-drift: FAIL — edit src/locales/*.json to match.');
    process.exit(1);
  }
  console.log('locale-drift: clean');
}

main();
