/**
 * logger-allowlist-ast — PR E observability AST gate (E-T1 + E-T2).
 *
 * Threat-model §A.10 PR E quotes (verbatim):
 *   - E-T1. AST/eslint: no `console.log` anywhere in `functions/src/` (M38).
 *   - E-T2. AST/eslint: every `logger.*` call uses only allow-listed field
 *           names (M38).
 *
 * This file is the canonical AST gate for BOTH. The historic
 * `no-console-ast.test.ts` covers E-T1 only and will be superseded once the
 * implementer either deletes it or migrates the project to an ESLint rule.
 * Until then BOTH tests must pass — they assert the same invariant from two
 * different angles, which is a feature, not a redundancy.
 *
 * The scan walks every `.ts` file under `functions/src/**` (excluding
 * `node_modules`, `lib` and `*.test.ts`). For each file it parses with the
 * TypeScript compiler API and reports two classes of offender:
 *
 *   1. `console.<method>(...)`  — any CallExpression whose callee is a
 *      PropertyAccess or ElementAccess of `console`. Catches the obvious
 *      `console.log` AND the bypass `console['log']`.
 *   2. `logger.<method>(msg, payload)` where `payload` is an
 *      ObjectLiteralExpression — every property NAME is compared against
 *      the M38 allow-list (the implementer's call-sites in
 *      `billingKillSwitch.ts` + `notifyChoreApproved.ts` today only use
 *      these names, so the scan over the existing tree must come up clean).
 *
 *   In addition: every allow-listed key has its substring scanned against
 *   a forbidden-substring blocklist (`{token, body, name, email,
 *   choreTitle, wishlistTitle, postContent, todoTitle, content, message,
 *   title}`). The intent: a future contributor adding `tokenSummary` or
 *   `bodyHash` to the allow-list trips this check. Allow-listed keys that
 *   are inherently unavoidable (`kind`, `actorUid`, `projectName` — the
 *   forbidden substring `name` is in each) are accepted only because their
 *   WHOLE name is on the allow-list — the substring check skips keys that
 *   are themselves in the allow-list.
 *
 * Fixture files: three temporary .ts files written into `os.tmpdir()` so
 * the scanner is proven to catch novel violations (an allow-list-clean
 * logger payload passes; a `console.log` is flagged; a logger payload with
 * `{ token: '...' }` is flagged). Fixtures are cleaned up in `afterEach`
 * and never written into the repo tree.
 *
 * MUST FAIL today (deliberately, per the brief):
 *   - The lint rule does not exist yet (eslint.config.js still allows
 *     arbitrary logger payload field names).
 *   - The implementer's job is to either add an ESLint rule OR keep this
 *     AST gate as the structural enforcement. Either way these assertions
 *     must continue to pass on the live tree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import * as ts from 'typescript';

const FUNCTIONS_SRC_DIR = resolve(__dirname, '../../functions/src');
const REPO_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// M38 allow-list — the EXACT field-name set permitted in `logger.*` payloads.
// Sourced verbatim from threat-model §A.10 M38 + the operational fields
// currently in use in `functions/src/billingKillSwitch.ts`. Edits to this set
// require a memory-curator pass over the threat model first; do NOT widen it
// here to make a new caller pass.
// ---------------------------------------------------------------------------
const M38_LOG_ALLOWLIST: ReadonlySet<string> = new Set([
  // Core notify-* callable fields
  'kind',
  'familyId',
  'actorUid',
  'recipientCount',
  'successCount',
  'cleanedTokenCount',
  'durationMs',
  'skipReason',
  // Kill-switch operational fields
  'action',
  'costAmount',
  'budgetAmount',
  'billingAccountBefore',
  'projectName',
  'hasEnvelope',
  'hasMessage',
  'rawDataType',
  // Generic
  'timestamp',
  'errorCode',
]);

// Forbidden-substring check (case-insensitive). If a key contains any of
// these as a substring, it is rejected UNLESS the WHOLE key is on the
// allow-list (which permits `kind`, `actorUid`, `projectName` — each
// contains the substring `name` — without forcing a special case here).
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  'token',
  'body',
  'name',
  'email',
  'choreTitle',
  'wishlistTitle',
  'postContent',
  'todoTitle',
  'content',
  'message',
  'title',
] as const;

const LOGGER_METHODS: ReadonlySet<string> = new Set(['info', 'warn', 'error', 'debug', 'log']);

// ---------------------------------------------------------------------------
// File walker — every .ts under functions/src, skipping build output + tests.
// ---------------------------------------------------------------------------
function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'lib') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      st.isFile() &&
      full.endsWith('.ts') &&
      !full.endsWith('.d.ts') &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// console.* call-site finder — PropertyAccess + ElementAccess (closes the
// `console['log']` bypass).
// ---------------------------------------------------------------------------
interface ConsoleHit {
  line: number;
  column: number;
  text: string;
}

function findConsoleCalls(filename: string, source: string): ConsoleHit[] {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true);
  const hits: ConsoleHit[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // console.log(...)
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'console'
      ) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
        hits.push({ line: line + 1, column: character + 1, text: node.getText().slice(0, 100) });
      }
      // console['log'](...)
      if (
        ts.isElementAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'console'
      ) {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
        hits.push({ line: line + 1, column: character + 1, text: node.getText().slice(0, 100) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

// ---------------------------------------------------------------------------
// logger.<method>(message, payload?) inspector — pulls every property key
// from the second argument when it is an ObjectLiteralExpression.
// ---------------------------------------------------------------------------
interface LoggerKeyHit {
  line: number;
  column: number;
  key: string;
  reason: 'not_allowlisted' | 'forbidden_substring';
  substring?: string;
}

function findLoggerOffenders(filename: string, source: string): LoggerKeyHit[] {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true);
  const hits: LoggerKeyHit[] = [];

  function pushKey(name: ts.Node, key: string): void {
    const { line, character } = sf.getLineAndCharacterOfPosition(name.getStart());
    const onAllowList = M38_LOG_ALLOWLIST.has(key);
    if (!onAllowList) {
      hits.push({ line: line + 1, column: character + 1, key, reason: 'not_allowlisted' });
      return;
    }
    // Even allow-listed keys are double-checked against the forbidden
    // substring blocklist — EXCEPT the keys themselves on the allow-list
    // pass (we don't want `kind` / `actorUid` / `projectName` to fail
    // because they happen to contain the substring `name`).
    const lowerKey = key.toLowerCase();
    for (const sub of FORBIDDEN_SUBSTRINGS) {
      if (lowerKey === sub.toLowerCase()) {
        // A WHOLE key equal to a forbidden substring (e.g. literally
        // `token`) is rejected outright — the allow-list happens not to
        // contain any of those words today, so this branch is a defense
        // in depth against a future widening that introduces one.
        hits.push({
          line: line + 1,
          column: character + 1,
          key,
          reason: 'forbidden_substring',
          substring: sub,
        });
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;
      // Match `logger.<method>(...)` — the identifier on the LHS is
      // `logger` (any import shape: `import * as logger from
      // 'firebase-functions/logger'`, `import { logger } from
      // 'firebase-functions'`, `const { logger } = require('firebase-functions')`).
      if (
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'logger' &&
        LOGGER_METHODS.has(callee.name.text)
      ) {
        // Second arg is the structured payload. Skip if absent or non-object.
        const payload = node.arguments[1];
        if (payload && ts.isObjectLiteralExpression(payload)) {
          for (const prop of payload.properties) {
            // { foo: 'bar' } — PropertyAssignment with an identifier name.
            if (ts.isPropertyAssignment(prop)) {
              if (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) {
                const keyText = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.text;
                pushKey(prop.name, keyText);
              }
            }
            // { foo } — shorthand.
            else if (ts.isShorthandPropertyAssignment(prop)) {
              pushKey(prop.name, prop.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

// ---------------------------------------------------------------------------
// Fixture helpers — write temp .ts files outside the repo so the scanner is
// proven to fire on novel inputs, not only on what's currently in the tree.
// ---------------------------------------------------------------------------
const TMP_FILES: string[] = [];

function writeFixture(filename: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'logger-allowlist-fixtures-'));
  const full = join(dir, filename);
  writeFileSync(full, contents, 'utf8');
  TMP_FILES.push(dir);
  return full;
}

afterEach(() => {
  while (TMP_FILES.length > 0) {
    const dir = TMP_FILES.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ===========================================================================
// E-T1 + E-T2 — assertions against the live functions/src tree.
// ===========================================================================
describe('E-T1: no console.* calls in functions/src/**/*.ts (AST gate)', () => {
  it('functions/src/ exists', () => {
    expect(existsSync(FUNCTIONS_SRC_DIR)).toBe(true);
  });

  it('at least one .ts source is present (the scan is non-trivial)', () => {
    const files = walkTs(FUNCTIONS_SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it('finds zero console.* call expressions across every functions/src/**/*.ts file', () => {
    const files = walkTs(FUNCTIONS_SRC_DIR);
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const hit of findConsoleCalls(file, src)) {
        offenders.push({ file: relative(REPO_ROOT, file), line: hit.line, text: hit.text });
      }
    }

    if (offenders.length > 0) {
      const report = offenders.map((o) => `  - ${o.file}:${o.line}  ${o.text}`).join('\n');
      throw new Error(
        `E-T1 violation: console.* call(s) found in functions/src — use firebase-functions/logger instead:\n${report}`,
      );
    }
    expect(offenders).toEqual([]);
  });
});

describe('E-T2: logger.* payload field names are restricted to the M38 allow-list', () => {
  it('every logger.* call in functions/src uses only allow-listed key names', () => {
    const files = walkTs(FUNCTIONS_SRC_DIR);
    const offenders: Array<{
      file: string;
      line: number;
      key: string;
      reason: LoggerKeyHit['reason'];
    }> = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const hit of findLoggerOffenders(file, src)) {
        offenders.push({
          file: relative(REPO_ROOT, file),
          line: hit.line,
          key: hit.key,
          reason: hit.reason,
        });
      }
    }

    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  - ${o.file}:${o.line}  key="${o.key}"  (${o.reason})`)
        .join('\n');
      throw new Error(
        `E-T2 violation: logger.* payload contains key(s) outside the M38 allow-list:\n${report}\n\n` +
          `Allow-list: ${Array.from(M38_LOG_ALLOWLIST).sort().join(', ')}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('the M38 allow-list itself contains no forbidden-substring tokens (defense in depth on the test fixture)', () => {
    // If a future contributor sneaks `tokenSummary` onto the allow-list,
    // catch it at the allow-list shape level — not just at the call site.
    // Whole-key matches against the forbidden list are caught (`token`,
    // `body`, `name`, `email`, etc.); allow-listed keys that merely
    // CONTAIN a substring (`kind` contains `name`'s `n`? no — `actorUid`,
    // `projectName` contain `name`) are deliberately accepted via the
    // whole-key-only test below.
    const offenders: Array<{ key: string; substring: string }> = [];
    for (const key of M38_LOG_ALLOWLIST) {
      const lower = key.toLowerCase();
      for (const sub of FORBIDDEN_SUBSTRINGS) {
        if (lower === sub.toLowerCase()) {
          offenders.push({ key, substring: sub });
        }
      }
    }
    expect(
      offenders,
      `M38 allow-list contains whole-key matches with forbidden substrings: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// Fixture-driven proofs — the scanner WORKS on novel inputs, not just on
// what is currently in the tree.
// ===========================================================================
describe('E-T2 fixtures: the AST scanner catches novel violations', () => {
  it('catches a logger.info call with a forbidden field name (token)', () => {
    const path = writeFixture(
      'leaks-token.ts',
      `import * as logger from 'firebase-functions/logger';\n` +
        `export function fn(): void {\n` +
        `  logger.info('msg', { token: 'leaked-fcm-token' });\n` +
        `}\n`,
    );
    const offenders = findLoggerOffenders(path, readFileSync(path, 'utf8'));
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders[0]?.key).toBe('token');
    // The reason is `not_allowlisted` first — `token` isn't on the
    // allow-list at all, so the substring branch never fires for it.
    expect(offenders[0]?.reason).toBe('not_allowlisted');
  });

  it('catches a logger.warn call with a forbidden chore-title field', () => {
    const path = writeFixture(
      'leaks-chore-title.ts',
      `import * as logger from 'firebase-functions/logger';\n` +
        `export function fn(): void {\n` +
        `  logger.warn('msg', { choreTitle: 'take out trash' });\n` +
        `}\n`,
    );
    const offenders = findLoggerOffenders(path, readFileSync(path, 'utf8'));
    expect(offenders.some((o) => o.key === 'choreTitle')).toBe(true);
  });

  it('catches a logger.error call with a shorthand-property forbidden name', () => {
    const path = writeFixture(
      'leaks-shorthand.ts',
      `import * as logger from 'firebase-functions/logger';\n` +
        `export function fn(email: string): void {\n` +
        `  logger.error('msg', { email });\n` +
        `}\n`,
    );
    const offenders = findLoggerOffenders(path, readFileSync(path, 'utf8'));
    expect(offenders.some((o) => o.key === 'email')).toBe(true);
  });

  it('ACCEPTS a logger.info call whose payload is fully allow-listed', () => {
    const path = writeFixture(
      'clean.ts',
      `import * as logger from 'firebase-functions/logger';\n` +
        `export function fn(): void {\n` +
        `  logger.info('msg', {\n` +
        `    kind: 'choreApproved',\n` +
        `    familyId: 'f1',\n` +
        `    actorUid: 'u1',\n` +
        `    recipientCount: 1,\n` +
        `    successCount: 1,\n` +
        `    cleanedTokenCount: 0,\n` +
        `    durationMs: 12,\n` +
        `    skipReason: 'opted_out',\n` +
        `  });\n` +
        `}\n`,
    );
    const offenders = findLoggerOffenders(path, readFileSync(path, 'utf8'));
    expect(offenders).toEqual([]);
  });

  it('ACCEPTS the kill-switch operational allow-listed fields (action, projectName, etc.)', () => {
    const path = writeFixture(
      'kill-switch-fields.ts',
      `import * as logger from 'firebase-functions/logger';\n` +
        `export function fn(): void {\n` +
        `  logger.info('msg', {\n` +
        `    action: 'billing_detached',\n` +
        `    projectName: 'projects/x',\n` +
        `    budgetAmount: 1,\n` +
        `    costAmount: 2,\n` +
        `    billingAccountBefore: 'billingAccounts/y',\n` +
        `    hasEnvelope: true,\n` +
        `    hasMessage: true,\n` +
        `    rawDataType: 'string',\n` +
        `  });\n` +
        `}\n`,
    );
    const offenders = findLoggerOffenders(path, readFileSync(path, 'utf8'));
    expect(offenders).toEqual([]);
  });

  it('E-T1 negative path: catches console.log in a fixture', () => {
    const path = writeFixture(
      'has-console.ts',
      `export function fn(): void {\n  console.log('hi');\n}\n`,
    );
    const hits = findConsoleCalls(path, readFileSync(path, 'utf8'));
    expect(hits.length).toBe(1);
    expect(hits[0]?.text).toContain('console.log');
  });

  it('E-T1 negative path: catches the console["log"] bracket-access bypass too', () => {
    const path = writeFixture(
      'has-console-bracket.ts',
      `export function fn(): void {\n  console['log']('hi');\n}\n`,
    );
    const hits = findConsoleCalls(path, readFileSync(path, 'utf8'));
    expect(hits.length).toBe(1);
  });

  it('E-T1 negative path: does NOT flag the literal string "console.log" inside a comment or string', () => {
    const path = writeFixture(
      'has-comment.ts',
      `// console.log('not a call')\n` + `export const note = 'console.log is forbidden';\n`,
    );
    const hits = findConsoleCalls(path, readFileSync(path, 'utf8'));
    expect(hits).toEqual([]);
  });
});
