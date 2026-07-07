/**
 * Drift gate — src/index.theme.css MUST match gen-theme-css.cjs output for the
 * committed design-tokens.json. Mirrors the locale-drift discipline: a color
 * token change without re-running the generator fails here (the token-audit
 * gate can't catch it because it deliberately ignores *.theme.* files).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('theme css is generated from tokens', () => {
  it('src/index.theme.css is in sync with scripts/gen-theme-css.cjs', () => {
    const root = resolve(__dirname, '..');
    expect(() =>
      execFileSync('node', ['scripts/gen-theme-css.cjs', '--check'], { cwd: root }),
    ).not.toThrow();
  });
});
