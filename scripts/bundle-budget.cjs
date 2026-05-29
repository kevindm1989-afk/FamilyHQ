#!/usr/bin/env node
/**
 * Bundle-size budget gate.
 *
 * Reads dist/assets/*.js after vite build, computes gzip size for each
 * file, matches against budgets in scripts/bundle-budget.json, and fails
 * if any budget is exceeded.
 *
 * Output:
 *   - One line per matched file with its actual vs budgeted gzip size.
 *   - One line per UNMATCHED file ("[no budget]" — Firebase third-party
 *     chunks intentionally escape; new files trip this so a reviewer sees
 *     them and decides whether to add a budget).
 *   - One PASS/FAIL line at the end.
 *
 * Why gzip and not raw bytes:
 *   gzip is what users actually pay over the wire on cold load. Raw
 *   bytes vary with esbuild minification settings; gzip is the stable
 *   comparison across builds.
 *
 * Hashed filenames:
 *   Vite emits content-hashed filenames (e.g. `index-Dm6qrRWR.js`). The
 *   budget patterns match the stable prefix; hashes are stripped out by
 *   the regex.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIST = path.resolve(__dirname, '..', 'dist', 'assets');
const BUDGETS_PATH = path.resolve(__dirname, 'bundle-budget.json');

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function gzipSize(filePath) {
  const buf = fs.readFileSync(filePath);
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error(`bundle-budget: dist/assets not found at ${DIST} — run \`vite build\` first.`);
    process.exit(2);
  }

  const config = JSON.parse(fs.readFileSync(BUDGETS_PATH, 'utf8'));
  // `b.pattern` is read from scripts/bundle-budget.json, a file we own
  // and review like any other source. It is NEVER user-supplied. Semgrep's
  // detect-non-literal-regexp rule flags any `new RegExp(...)` whose
  // argument isn't a string literal — it can't trace through the JSON
  // load + map to prove this is safe. The marker has to sit on the line
  // IMMEDIATELY ABOVE the matched call for semgrep to associate them.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const budgets = config.budgets.map((b) => ({ ...b, regex: new RegExp(b.pattern) }));

  const jsFiles = fs.readdirSync(DIST).filter((f) => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    console.error('bundle-budget: no .js files in dist/assets.');
    process.exit(2);
  }

  let failed = false;
  const matched = new Map(); // budget.name → array of {file, gzip}
  const unmatched = [];

  for (const file of jsFiles) {
    const size = gzipSize(path.join(DIST, file));
    const budget = budgets.find((b) => b.regex.test(file));
    if (budget) {
      if (!matched.has(budget.name)) matched.set(budget.name, []);
      matched.get(budget.name).push({ file, size });
    } else {
      unmatched.push({ file, size });
    }
  }

  // Report each budget.
  for (const budget of budgets) {
    const hits = matched.get(budget.name) ?? [];
    if (hits.length === 0) {
      console.log(`[no files matched "${budget.name}" — pattern: ${budget.pattern}]`);
      continue;
    }
    for (const { file, size } of hits) {
      const over = size > budget.maxGzipBytes;
      const status = over ? 'FAIL' : 'ok';
      const margin = size - budget.maxGzipBytes;
      console.log(
        `  [${status}] ${budget.name} — ${file}: ${fmt(size)} gzip ` +
          `(budget ${fmt(budget.maxGzipBytes)}, ` +
          `${margin >= 0 ? `+${fmt(margin)} OVER` : `${fmt(-margin)} under`})`,
      );
      if (over) {
        failed = true;
      }
    }
  }

  // Report unmatched files (informational; not a failure).
  if (unmatched.length > 0) {
    console.log('');
    console.log('  Unbudgeted chunks (intentional — Firebase / vendored / new):');
    for (const { file, size } of unmatched.sort((a, b) => b.size - a.size)) {
      console.log(`    [no budget] ${file}: ${fmt(size)} gzip`);
    }
  }

  console.log('');
  if (failed) {
    console.error('bundle-budget: FAIL — one or more chunks exceed their gzip budget.');
    console.error('  To accept the growth, bump the budget in scripts/bundle-budget.json.');
    process.exit(1);
  }
  console.log('bundle-budget: clean');
}

main();
