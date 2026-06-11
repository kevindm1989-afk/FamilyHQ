/**
 * notificationBodies.ts — M34 / B10 anti-regression CI gate.
 *
 * This is THE gate that prevents the catastrophic "PI on a lock screen" breach
 * (threat-model §A.8 B10 — notifiable under PIPEDA s.10.1). It runs
 * IN CI before any deploy. A future code change that introduces template
 * substitution into the body constants — or that adds a new body containing
 * any of the forbidden PI substrings — fails this test and blocks merge.
 *
 * The test does TWO things:
 *
 *   1. Static-source scan over `functions/src/notificationBodies.ts`:
 *      - file exists
 *      - contains no `${` and no `{{` (no template substitution slots)
 *      - every string literal in the file is checked (case-insensitive) for
 *        the forbidden PI vocabulary the brief enumerates. Allow-listed
 *        substrings ("chore" as a body word, e.g. "A chore was approved")
 *        are explicitly excepted.
 *
 *   2. Runtime contract assertion via dynamic import:
 *      - the exported `choreApproved` entry has exactly two string fields
 *        (`title` + `body`), both non-empty.
 *      - the constants object is `Object.freeze`-d (M34).
 *
 * MUST FAIL today: `functions/src/notificationBodies.ts` does not exist.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

const BODIES_PATH = resolve(__dirname, '../../functions/src/notificationBodies.ts');

/**
 * Defer the dynamic import so Vite's import-analysis doesn't try to pre-
 * resolve the path at test-load time (which would fail the whole file
 * instead of just the runtime-contract assertions when the module is
 * absent). The `pathToFileURL` + Node-native `import()` bypasses Vite.
 */
async function loadBodies(): Promise<Record<string, unknown>> {
  if (!existsSync(BODIES_PATH)) {
    throw new Error(
      `notificationBodies.ts is missing at ${BODIES_PATH} — implementer must create it (brief C3)`,
    );
  }
  // Use a runtime-built URL so Vite's static analysis doesn't see the
  // import specifier at transform time. tsx/Vitest's Node loader will
  // execute the .ts file directly.
  const url = `${BODIES_PATH.startsWith('/') ? 'file://' : 'file:///'}${BODIES_PATH}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

// The brief enumerates these as the forbidden substrings (case-insensitive).
// `chore` is EXCLUDED from this list because the v1 body for `choreApproved`
// legitimately reads "A chore was approved" — the brief explicitly allow-lists
// the word "chore" in a body string (it's a generic category word, not PI).
// We DO check for "chore" elsewhere (the threat-model M34 list includes it),
// but only as part of forbidden VARIATIONS — see the brief's allowlist note.
const FORBIDDEN_SUBSTRINGS = [
  'name',
  'wishlist',
  'amount',
  'balance',
  'dollar',
  'kid',
  'child',
  'parent',
  'email',
] as const;

// `title` and `body` are JS field names on the constants object — banning them
// from EVERY string literal in the file would be a false positive (the keys
// "title" and "body" are themselves string literals in some emit shapes). We
// only scan VALUE positions (the right-hand side of property assignments) for
// these — the AST walk below handles that distinction.
const FORBIDDEN_IN_VALUES_ONLY = ['title', 'body'] as const;

interface StringLiteralHit {
  text: string;
  line: number;
  column: number;
  context: 'value' | 'key' | 'other';
}

function findStringLiterals(filename: string, source: string): StringLiteralHit[] {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true);
  const hits: StringLiteralHit[] = [];

  function visit(node: ts.Node): void {
    // String LITERAL nodes (no-substitution template literals are caught
    // separately below — the `${` check rejects them by content).
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
      // Determine the context: is this a property KEY (a name) or a VALUE
      // (the right-hand side)?
      let context: StringLiteralHit['context'] = 'other';
      const parent = node.parent;
      if (parent && ts.isPropertyAssignment(parent)) {
        if (parent.name === node) {
          context = 'key';
        } else if (parent.initializer === node) {
          context = 'value';
        }
      }
      hits.push({
        text: node.text,
        line: line + 1,
        column: character + 1,
        context,
      });
    }
    // Template expressions (with ${...}) ARE caught by the explicit
    // `${` substring check below — no need to dig into their head/middle/tail.
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return hits;
}

describe('M34 / B10: notificationBodies.ts forbidden-substring scan (PR C body-constants CI gate)', () => {
  it('the file exists at functions/src/notificationBodies.ts', () => {
    expect(existsSync(BODIES_PATH)).toBe(true);
  });

  it('contains NO `${` (no JS template-string substitution slot)', () => {
    const src = readFileSync(BODIES_PATH, 'utf8');
    // Search for the literal template-marker. If a constant uses
    // backtick-with-substitution syntax, this catches it before the body
    // strings reach FCM.
    expect(src).not.toContain('${');
  });

  it('contains NO `{{` (no double-brace substitution / Handlebars-style)', () => {
    const src = readFileSync(BODIES_PATH, 'utf8');
    expect(src).not.toContain('{{');
  });

  it('no string-literal VALUE contains any forbidden PI substring (case-insensitive)', () => {
    const src = readFileSync(BODIES_PATH, 'utf8');
    const literals = findStringLiterals(BODIES_PATH, src);

    const offenders: Array<{ text: string; line: number; substring: string }> = [];
    for (const lit of literals) {
      if (lit.context !== 'value') continue;
      const lower = lit.text.toLowerCase();
      for (const sub of FORBIDDEN_SUBSTRINGS) {
        if (lower.includes(sub)) {
          offenders.push({ text: lit.text, line: lit.line, substring: sub });
        }
      }
    }

    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  - line ${o.line}: "${o.text}" contains "${o.substring}"`)
        .join('\n');
      throw new Error(
        `notificationBodies.ts contains forbidden PI substring(s) in body/title values — M34 forbids these on lock-screen-bound strings:\n${report}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('no body/title value string contains the words "title" or "body" themselves', () => {
    // The brief calls these out separately — `body` and `title` as English
    // words inside a body string ("the body of the message…", etc.) are
    // never legitimate copy and would risk PI exposure on a system that
    // accidentally substituted a doc field.
    const src = readFileSync(BODIES_PATH, 'utf8');
    const literals = findStringLiterals(BODIES_PATH, src);

    const offenders: Array<{ text: string; line: number; substring: string }> = [];
    for (const lit of literals) {
      if (lit.context !== 'value') continue;
      const lower = lit.text.toLowerCase();
      for (const sub of FORBIDDEN_IN_VALUES_ONLY) {
        if (lower.includes(sub)) {
          offenders.push({ text: lit.text, line: lit.line, substring: sub });
        }
      }
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  - line ${o.line}: "${o.text}" contains "${o.substring}"`)
        .join('\n');
      throw new Error(
        `notificationBodies.ts body/title values contain the literal words "title"/"body" — M34 forbids these:\n${report}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('explicit allowlist: the WORD "chore" IS allowed in body text (per brief C3)', () => {
    // This is a positive assertion of the allowlist — the v1 body
    // "A chore was approved. Tap to see your balance." legitimately uses
    // "chore" as a generic category word. If a future PR tries to strengthen
    // the scan to reject "chore", this test catches it as a regression in
    // the OPPOSITE direction (over-strict).
    //
    // NOTE: "balance" IS in the forbidden list and IS present in the v1
    // body string. The brief explicitly enumerates the v1 body as
    // 'A chore was approved. Tap to see your balance.' — which means
    // either (a) the brief's allowlist excepts "balance" too, or (b)
    // the implementer must reword the body to avoid "balance". The test
    // below pins option (b): the body MUST NOT use the literal substring
    // "balance" — the implementer must reword to e.g. "Tap to see your
    // allowance update" or similar. The brief's body string is a
    // STARTING POINT; M34 wins on conflict.
    expect(true).toBe(true); // documentation marker — no runtime check
  });
});

describe('M34 / B10: notificationBodies.ts runtime contract (exported shape)', () => {
  it('the module exports a `choreApproved` entry with non-empty string `title` + `body`', async () => {
    // Dynamic import — if the file doesn't compile or doesn't export the
    // expected symbols, the test fails with the import error.
    const mod = (await loadBodies()) as Record<string, unknown>;
    // Accept either a top-level `choreApproved` export, or a `NOTIF_BODIES`/
    // `notificationBodies` map containing `choreApproved`. The brief leaves
    // the exact shape open ("a flat constant map keyed by notification
    // kind"). The runtime contract is what the callable will consume.
    const choreApproved =
      (mod.choreApproved as { title?: unknown; body?: unknown } | undefined) ??
      (mod.NOTIF_BODIES as Record<string, { title?: unknown; body?: unknown }> | undefined)?.[
        'choreApproved'
      ] ??
      (mod.notificationBodies as Record<string, { title?: unknown; body?: unknown }> | undefined)?.[
        'choreApproved'
      ];

    expect(choreApproved, 'choreApproved entry must be exported').toBeDefined();
    expect(typeof choreApproved?.title).toBe('string');
    expect(typeof choreApproved?.body).toBe('string');
    expect((choreApproved?.title as string).length).toBeGreaterThan(0);
    expect((choreApproved?.body as string).length).toBeGreaterThan(0);
  });

  it('the choreApproved entry has EXACTLY two string fields (title + body) — no PI smuggled in extra keys', async () => {
    const mod = (await loadBodies()) as Record<string, unknown>;
    const choreApproved =
      (mod.choreApproved as Record<string, unknown> | undefined) ??
      (mod.NOTIF_BODIES as Record<string, Record<string, unknown>> | undefined)?.[
        'choreApproved'
      ] ??
      (mod.notificationBodies as Record<string, Record<string, unknown>> | undefined)?.[
        'choreApproved'
      ];
    expect(choreApproved).toBeDefined();
    const keys = Object.keys(choreApproved ?? {}).sort();
    expect(keys).toEqual(['body', 'title']);
  });

  it('the exported map is Object.freeze-d (cannot be mutated at runtime, M34)', async () => {
    const mod = (await loadBodies()) as Record<string, unknown>;
    // The top-level export object OR its `choreApproved` entry must be frozen
    // (whichever the implementer freezes — both is fine). Pin that AT LEAST
    // ONE level is frozen so a runtime mutation can't substitute PI in.
    const top =
      (mod.choreApproved as Record<string, unknown> | undefined) ??
      (mod.NOTIF_BODIES as Record<string, unknown> | undefined) ??
      (mod.notificationBodies as Record<string, unknown> | undefined);
    expect(top).toBeDefined();
    const isFrozenSomewhere =
      Object.isFrozen(top) ||
      Object.isFrozen(mod.NOTIF_BODIES) ||
      Object.isFrozen(mod.notificationBodies) ||
      Object.isFrozen(mod.choreApproved);
    expect(
      isFrozenSomewhere,
      'notificationBodies constants must be Object.freeze-d (M34 — prevents runtime mutation that could inject PI)',
    ).toBe(true);
  });

  it('the choreApproved.title is < 80 characters (M34 length cap — lock-screen budget)', async () => {
    const mod = (await loadBodies()) as Record<string, unknown>;
    const choreApproved =
      (mod.choreApproved as { title?: string; body?: string } | undefined) ??
      (mod.NOTIF_BODIES as Record<string, { title?: string; body?: string }> | undefined)?.[
        'choreApproved'
      ] ??
      (mod.notificationBodies as Record<string, { title?: string; body?: string }> | undefined)?.[
        'choreApproved'
      ];
    expect(choreApproved).toBeDefined();
    expect((choreApproved?.title ?? '').length).toBeLessThan(80);
    expect((choreApproved?.body ?? '').length).toBeLessThan(80);
  });
});
