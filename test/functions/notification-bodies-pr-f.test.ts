/**
 * notificationBodies.ts — M52 / B10 anti-regression CI gate for the THREE
 * new PR F constants (`eventReminder`, `birthdayToday`, `anniversaryToday`).
 *
 * Complementary to test/functions/notification-bodies-no-pi.test.ts:
 *   - That file pins the structural M34 invariants over the whole file
 *     (no `${` template markers anywhere; forbidden-substring scan over
 *     EVERY string-literal value; runtime contract on `choreApproved`).
 *   - This file pins the THREE new PR F constants EXPLICITLY: each must
 *     exist, be Object.freeze-d, pass the M34 forbidden-substring scan,
 *     have a non-empty title + body < 80 chars, and contain no template
 *     markers.
 *
 * §A.10 F-T14 quotes (verbatim): "M34 scan passes over the three new
 * constants (eventReminder, birthdayToday, anniversaryToday); test list
 * explicitly enumerates them; a deliberately templated `birthdayToday`
 * fixture fails the scan."
 *
 * MUST FAIL today: the constants don't exist yet — implementer adds them
 * in functions/src/notificationBodies.ts as part of PR F task F5.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as ts from 'typescript';

const BODIES_PATH = resolve(__dirname, '../../functions/src/notificationBodies.ts');

// The three NEW constants PR F adds. Test names enumerate them explicitly
// so a reviewer can match the row to F-T14.
const NEW_CONSTANTS = ['eventReminder', 'birthdayToday', 'anniversaryToday'] as const;

// Forbidden substrings from the threat-model M34 list (extended for PR F).
// `birthday` is NOT on this list (the body legitimately reads "Birthday today"
// — the WORD birthday is a generic category word; the PERSON is never named).
// `anniversary` is also accepted (same rationale).
// `name`, `title`, `body`, `wishlist`, `amount`, `balance`, `dollar`, `kid`,
// `child`, `parent`, `email` remain forbidden in body/title VALUES.
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
const FORBIDDEN_IN_VALUES_ONLY = ['title', 'body'] as const;

async function loadBodies(): Promise<Record<string, unknown>> {
  if (!existsSync(BODIES_PATH)) {
    throw new Error(
      `notificationBodies.ts is missing at ${BODIES_PATH} — implementer must add the three PR F constants (F5)`,
    );
  }
  const url = `${BODIES_PATH.startsWith('/') ? 'file://' : 'file:///'}${BODIES_PATH}`;
  return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
}

function getEntry(
  mod: Record<string, unknown>,
  key: string,
): { title?: unknown; body?: unknown } | undefined {
  const direct = mod[key] as { title?: unknown; body?: unknown } | undefined;
  if (direct && typeof direct === 'object') return direct;
  const top =
    (mod.NOTIFICATION_BODIES as Record<string, { title?: unknown; body?: unknown }>) ??
    (mod.notificationBodies as Record<string, { title?: unknown; body?: unknown }>) ??
    (mod.NOTIF_BODIES as Record<string, { title?: unknown; body?: unknown }>);
  return top?.[key];
}

// Cleanup for fixture files written into tmpdir.
const TMP_DIRS: string[] = [];
function writeFixture(filename: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'notification-bodies-prf-fixtures-'));
  const full = join(dir, filename);
  writeFileSync(full, contents, 'utf8');
  TMP_DIRS.push(dir);
  return full;
}
function cleanupFixtures(): void {
  while (TMP_DIRS.length > 0) {
    const dir = TMP_DIRS.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

// ===========================================================================
// F-T14 — each of the three new constants exists, is well-formed, and
// passes the M34 forbidden-substring scan.
// ===========================================================================

describe('F-T14 (M52): the three PR F constants exist and pass the M34 scan', () => {
  it('notificationBodies.ts file exists', () => {
    expect(
      existsSync(BODIES_PATH),
      `notificationBodies.ts is missing at ${BODIES_PATH} — implementer must add PR F constants (F5)`,
    ).toBe(true);
  });

  for (const key of NEW_CONSTANTS) {
    it(`exports a non-empty ${key} entry with string title + body`, async () => {
      const mod = await loadBodies();
      const entry = getEntry(mod, key);
      expect(entry, `expected ${key} entry to be defined`).toBeDefined();
      expect(typeof entry?.title, `${key}.title must be a string`).toBe('string');
      expect(typeof entry?.body, `${key}.body must be a string`).toBe('string');
      expect((entry?.title as string).length).toBeGreaterThan(0);
      expect((entry?.body as string).length).toBeGreaterThan(0);
    });

    it(`${key} has EXACTLY two string fields {title, body} (no PI smuggled via extra keys)`, async () => {
      const mod = await loadBodies();
      const entry = getEntry(mod, key) as Record<string, unknown> | undefined;
      expect(entry).toBeDefined();
      const keys = Object.keys(entry ?? {}).sort();
      expect(keys, `${key} must have exactly {title, body}; got ${JSON.stringify(keys)}`).toEqual([
        'body',
        'title',
      ]);
    });

    it(`${key} title + body are each < 80 characters (lock-screen budget, M34)`, async () => {
      const mod = await loadBodies();
      const entry = getEntry(mod, key) as { title?: string; body?: string } | undefined;
      expect(entry).toBeDefined();
      expect((entry?.title ?? '').length).toBeLessThan(80);
      expect((entry?.body ?? '').length).toBeLessThan(80);
    });

    it(`${key} title + body contain NO template markers ($\\{ or {{)`, async () => {
      const mod = await loadBodies();
      const entry = getEntry(mod, key) as { title?: string; body?: string } | undefined;
      expect(entry).toBeDefined();
      expect(entry?.title ?? '').not.toContain('${');
      expect(entry?.body ?? '').not.toContain('${');
      expect(entry?.title ?? '').not.toContain('{{');
      expect(entry?.body ?? '').not.toContain('{{');
    });

    it(`${key} title + body do NOT contain any M34 forbidden substring`, async () => {
      const mod = await loadBodies();
      const entry = getEntry(mod, key) as { title?: string; body?: string } | undefined;
      expect(entry).toBeDefined();
      const fields: Array<[string, string]> = [
        ['title', (entry?.title ?? '').toLowerCase()],
        ['body', (entry?.body ?? '').toLowerCase()],
      ];
      const offenders: Array<{ field: string; sub: string; value: string }> = [];
      for (const [field, value] of fields) {
        for (const sub of FORBIDDEN_SUBSTRINGS) {
          if (value.includes(sub)) {
            offenders.push({ field, sub, value });
          }
        }
        for (const sub of FORBIDDEN_IN_VALUES_ONLY) {
          if (value.includes(sub)) {
            offenders.push({ field, sub, value });
          }
        }
      }
      if (offenders.length > 0) {
        const report = offenders
          .map((o) => `  - ${key}.${o.field}: "${o.value}" contains "${o.sub}"`)
          .join('\n');
        throw new Error(`F-T14 (M52) violation: forbidden substring in ${key}:\n${report}`);
      }
      expect(offenders).toEqual([]);
    });

    it(`${key} is reachable via Object.freeze-d constants (the export is immutable, M34)`, async () => {
      const mod = await loadBodies();
      const top =
        (mod.NOTIFICATION_BODIES as Record<string, unknown>) ??
        (mod.notificationBodies as Record<string, unknown>) ??
        (mod.NOTIF_BODIES as Record<string, unknown>);
      const direct = mod[key];
      const isFrozenSomewhere =
        Object.isFrozen(top) ||
        Object.isFrozen(direct) ||
        (top ? Object.isFrozen((top as Record<string, unknown>)[key]) : false);
      expect(
        isFrozenSomewhere,
        `${key} (or its parent constants object) must be Object.freeze-d so a runtime mutation cannot inject PI (M34)`,
      ).toBe(true);
    });
  }
});

// ===========================================================================
// F-T14 — defensive-fixture test: a TEMPLATED body MUST be caught by the scan.
// ===========================================================================

describe('F-T14 (M52) negative path: a templated birthdayToday fixture MUST FAIL the scan', () => {
  it('a fixture file containing `${familyName}` in birthdayToday is caught by the forbidden-substring scanner', () => {
    const path = writeFixture(
      'templated-birthday.ts',
      `export const NOTIFICATION_BODIES = Object.freeze({
  birthdayToday: Object.freeze({
    title: 'Birthday today',
    body: \`A birthday is today for \${familyName}. Open Family HQ.\`,
  }),
});\n`,
    );
    const src = readFileSync(path, 'utf8');

    // Replicate the scan: the bodies file MUST contain no \${ anywhere.
    expect(
      src.includes('${'),
      `fixture must contain a \${ template marker so the negative path can fire`,
    ).toBe(true);

    // Now run an equivalent string-literal scan and assert at least one
    // forbidden substring (`name`) is found in a VALUE position.
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true);
    const hits: Array<{ text: string; sub: string }> = [];

    function visit(node: ts.Node): void {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)
      ) {
        // For template expressions, scan the full text including
        // ${expression} placeholders — they typically contain field names.
        const text = node.getText().toLowerCase();
        for (const sub of FORBIDDEN_SUBSTRINGS) {
          if (text.includes(sub)) hits.push({ text, sub });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    // Cleanup before assertion so a failure still leaves no temp files.
    cleanupFixtures();

    expect(
      hits.length,
      `negative-path fixture should produce at least one forbidden-substring hit (e.g. "name" from \${familyName}); got ${hits.length}`,
    ).toBeGreaterThan(0);
  });
});

// ===========================================================================
// F-T14 — the top-level notificationBodies SOURCE FILE itself must contain
// no `${` (existing M34 scan); a deliberately-templated value in the THREE
// new constants must be caught.
// ===========================================================================

describe('F-T14 (M52): no `${` in the live notificationBodies.ts source covers the three new constants', () => {
  it('the live file contains zero `${`', () => {
    if (!existsSync(BODIES_PATH)) {
      throw new Error(
        `notificationBodies.ts is missing at ${BODIES_PATH} — implementer must add PR F constants (F5)`,
      );
    }
    const src = readFileSync(BODIES_PATH, 'utf8');
    expect(
      src.includes('${'),
      'notificationBodies.ts MUST NOT contain `${` anywhere (M34 — vague-by-default constants are NEVER templated)',
    ).toBe(false);
  });

  it('the live file contains zero `{{` (Handlebars-style would also be PI smuggling)', () => {
    if (!existsSync(BODIES_PATH)) {
      throw new Error(`notificationBodies.ts is missing at ${BODIES_PATH}`);
    }
    const src = readFileSync(BODIES_PATH, 'utf8');
    expect(src.includes('{{'), 'notificationBodies.ts MUST NOT contain `{{`').toBe(false);
  });
});
