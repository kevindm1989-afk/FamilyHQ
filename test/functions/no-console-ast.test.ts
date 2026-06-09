/**
 * AST scan — PR A, threat-model §A.10 A-T10 (and PR E §E1).
 *
 * Every TypeScript file under functions/src MUST NOT contain any console
 * call. Cloud Functions structured logging must go through
 * functions.logger.{info,warn,error} (or `logger.info` after import) so:
 *
 *   - The log gets the right severity in Cloud Logging (`console.log` ends
 *     up as a single severity bucket; `logger.warn` is searchable + alertable
 *     as WARNING).
 *   - The log scrubbing rules (threat-model M38, PR E §E1) can be enforced
 *     consistently against ONE logging surface.
 *   - A future allow-list assertion (PR E §E1.2) can statically pin every
 *     `logger.info(...)` payload's key set.
 *
 * This test uses the TypeScript compiler API for a real AST walk, not a
 * regex — a string match would false-positive on `// console.log` comments,
 * `'console.log'` string literals in docstrings, and similar.
 *
 * MUST FAIL today: `functions/src/billingKillSwitch.ts` does not exist, so
 * the test cannot find any source files and FAILS with a clear message
 * ("no source files matched"). The implementer adds the file (and writes
 * `functions.logger.*` instead of `console.*`) to make this pass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import * as ts from 'typescript';

const FUNCTIONS_SRC_DIR = resolve(__dirname, '../../functions/src');
const REPO_ROOT = resolve(__dirname, '../..');

function walkTs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (st.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Returns every `console.<method>(...)` call site in the given source. */
function findConsoleCalls(
  filename: string,
  source: string,
): Array<{
  line: number;
  column: number;
  text: string;
}> {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2022, true);
  const hits: Array<{ line: number; column: number; text: string }> = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const obj = node.expression.expression;
      if (ts.isIdentifier(obj) && obj.text === 'console') {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
        hits.push({
          line: line + 1,
          column: character + 1,
          text: node.getText().slice(0, 80),
        });
      }
    }
    // Also catch `console['log']('x')` to prevent a trivial bypass.
    if (
      ts.isCallExpression(node) &&
      ts.isElementAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console'
    ) {
      const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
      hits.push({
        line: line + 1,
        column: character + 1,
        text: node.getText().slice(0, 80),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

describe('A-T10: no console.* calls in functions/src/**/*.ts (AST scan)', () => {
  it('functions/src/ exists (implementer creates it during A1)', () => {
    expect(existsSync(FUNCTIONS_SRC_DIR)).toBe(true);
  });

  it('at least one TypeScript source file is present (the kill-switch must be implemented)', () => {
    const files = walkTs(FUNCTIONS_SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it('billingKillSwitch.ts exists at functions/src/billingKillSwitch.ts (or under an aggregator)', () => {
    // The brief pins the file path explicitly. The implementer is free to
    // re-export from index.ts, but the named file MUST exist.
    const expected = join(FUNCTIONS_SRC_DIR, 'billingKillSwitch.ts');
    expect(existsSync(expected)).toBe(true);
  });

  it('contains zero console.* call expressions across every .ts file in functions/src', () => {
    const files = walkTs(FUNCTIONS_SRC_DIR);
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const hits = findConsoleCalls(file, source);
      for (const h of hits) {
        offenders.push({
          file: relative(REPO_ROOT, file),
          line: h.line,
          text: h.text,
        });
      }
    }

    if (offenders.length > 0) {
      const report = offenders.map((o) => `  - ${o.file}:${o.line}  ${o.text}`).join('\n');
      throw new Error(
        `console.* call(s) found in functions/src — use functions.logger.{info,warn,error} instead:\n${report}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('uses functions.logger or the logger module (proves logging surface exists, not just an empty file)', () => {
    const files = walkTs(FUNCTIONS_SRC_DIR);
    const sources = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    // Either `functions.logger.<method>` OR `import * from 'firebase-functions/logger'`
    // is acceptable; both produce structured logs at the right severity.
    const usesLogger =
      /functions\.logger\.(info|warn|error)\s*\(/.test(sources) ||
      /from\s+['"]firebase-functions\/logger['"]/.test(sources) ||
      /from\s+['"]firebase-functions['"]/.test(sources);
    expect(usesLogger).toBe(true);
  });
});
