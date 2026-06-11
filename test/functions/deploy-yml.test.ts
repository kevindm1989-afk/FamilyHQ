/**
 * Deploy-workflow assertions — PR A (A-T8, A-T9) + PR C (C-T19).
 *
 * PR #84 lesson (lessons.md 2026-06-08 #1): mixing tier-gated services
 * (Functions) with always-on services (Firestore rules) in one --only flag
 * creates a billing-plan trap. The Functions deploy MUST be its own
 * flag-gated step.
 *
 *   - A-T8 (UPDATED for PR D): the deploy-functions step's `--only` list
 *     enumerates the kill-switch + all seven notify-callables shipped to
 *     date — billingKillSwitch (PR A), notifyChoreApproved (PR C), and
 *     the six PR D callables (notifyChoreSubmitted, notifyWishlistRequested,
 *     notifyWishlistResolved, notifyBoardPost, notifyTodoCreated,
 *     notifyTodoCompleted). The kill-switch MUST precede every chargeable
 *     callable in the comma list (documentation-of-precedence; the actual
 *     operational guarantee is that the kill-switch was deployed in PR A
 *     and has been live since well before any subsequent push-callable
 *     was merged — firebase-tools deploys this --only list in parallel,
 *     not serially).
 *   - A-T9: the existing `--only firestore:rules,firestore:indexes` deploy
 *     line is UNCHANGED.
 *   - C-T19 (new): the kill-switch literal MUST appear at the START of the
 *     functions `--only` list (kill-switch deploys first).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEPLOY_YML_PATH = resolve(__dirname, '../../.github/workflows/deploy.yml');

function readDeployYml(): string {
  if (!existsSync(DEPLOY_YML_PATH)) {
    throw new Error(`deploy.yml missing at ${DEPLOY_YML_PATH}`);
  }
  return readFileSync(DEPLOY_YML_PATH, 'utf8');
}

describe('A-T8 (PR D update): deploy-functions step exists, is flag-gated, and --only enumerates kill-switch + 7 notify-callables shipped to date', () => {
  it('contains a job/step named deploy-functions (the new, flag-gated functions deploy)', () => {
    const yml = readDeployYml();
    // The job name is `deploy-functions` per PR A acceptance criterion A4;
    // accept either the job key or a step name match for flexibility on
    // the exact YAML shape the implementer picks.
    expect(yml).toMatch(/(^|\s)deploy-functions(:|\s)/m);
  });

  it('is gated by inputs.deploy_functions == true (default false)', () => {
    const yml = readDeployYml();
    // Accept `inputs.deploy_functions == true` or the GitHub Actions
    // shorthand inside an `if:` expression.
    const flagGated =
      /if:\s*\$\{\{\s*[^}]*inputs\.deploy_functions[^}]*==\s*true[^}]*\}\}/.test(yml) ||
      /if:\s*\$\{\{\s*[^}]*inputs\.deploy_functions[^}]*\}\}/.test(yml);
    expect(flagGated).toBe(true);
  });

  it('defines the deploy_functions workflow_dispatch input with default: false', () => {
    const yml = readDeployYml();
    // Defensive — the input MUST exist AND default to false so a routine
    // hosting+rules deploy never accidentally ships a Functions revision.
    expect(yml).toMatch(/deploy_functions:/);
    // Match `default: false` (with or without quotes) within ~200 chars of
    // the deploy_functions input declaration.
    const inputBlock = yml.match(/deploy_functions:[\s\S]{0,400}/);
    expect(inputBlock).not.toBeNull();
    expect(inputBlock![0]).toMatch(/default:\s*false/);
  });

  it('its firebase deploy --only list enumerates kill-switch + all 7 notify-callables (PR A + PR C + PR D), exactly once each, in the canonical order', () => {
    const yml = readDeployYml();
    // Find every `firebase deploy --only <list>` line and inspect any list
    // that mentions `functions:`. There must be exactly one such line,
    // and its value must enumerate the kill-switch first (documentation-
    // of-precedence — see header comment for the operational reality) plus
    // every notify-callable shipped to date. New callables shipped in
    // future PRs append to the END of the list; never prepend (the kill-
    // switch entry stays first).
    const onlyLines = [...yml.matchAll(/firebase\s+deploy[\s\S]*?--only\s+([^\s\\\n]+)/g)].map(
      (m) => m[1]!,
    );
    const functionsLines = onlyLines.filter((l) => l.includes('functions:'));
    expect(functionsLines).toHaveLength(1);
    expect(functionsLines[0]).toBe(
      'functions:billingKillSwitch,functions:notifyChoreApproved,functions:notifyChoreSubmitted,functions:notifyWishlistRequested,functions:notifyWishlistResolved,functions:notifyBoardPost,functions:notifyTodoCreated,functions:notifyTodoCompleted',
    );
  });

  it('C-T19: in the --only list, `billingKillSwitch` precedes `notifyChoreApproved` (kill-switch first)', () => {
    const yml = readDeployYml();
    const onlyLines = [...yml.matchAll(/firebase\s+deploy[\s\S]*?--only\s+([^\s\\\n]+)/g)].map(
      (m) => m[1]!,
    );
    const fnLine = onlyLines.find((l) => l.includes('functions:'));
    expect(fnLine, 'a functions deploy --only line must exist').toBeDefined();
    const killSwitchPos = fnLine!.indexOf('billingKillSwitch');
    const notifyPos = fnLine!.indexOf('notifyChoreApproved');
    expect(
      killSwitchPos,
      'billingKillSwitch must appear in the --only list',
    ).toBeGreaterThanOrEqual(0);
    expect(notifyPos, 'notifyChoreApproved must appear in the --only list').toBeGreaterThanOrEqual(
      0,
    );
    expect(
      killSwitchPos,
      'kill-switch MUST be listed before notifyChoreApproved so the cap gates the chargeable callable from second 0',
    ).toBeLessThan(notifyPos);
  });

  it('C-T19: the --only list STARTS with `functions:billingKillSwitch,` (no leading entry)', () => {
    const yml = readDeployYml();
    const onlyLines = [...yml.matchAll(/firebase\s+deploy[\s\S]*?--only\s+([^\s\\\n]+)/g)].map(
      (m) => m[1]!,
    );
    const fnLine = onlyLines.find((l) => l.includes('functions:'));
    expect(fnLine).toBeDefined();
    expect(fnLine!.startsWith('functions:billingKillSwitch,')).toBe(true);
  });

  it('does NOT bundle functions: with firestore: in the same --only list (PR #84 lesson)', () => {
    const yml = readDeployYml();
    // No --only argument may carry both prefixes. This is the trap the
    // lesson exists to prevent.
    const onlyValues = [...yml.matchAll(/firebase\s+deploy[\s\S]*?--only\s+([^\s\\\n]+)/g)].map(
      (m) => m[1]!,
    );
    for (const value of onlyValues) {
      const hasFunctions = value.includes('functions:');
      const hasFirestore = value.includes('firestore:');
      const hasStorage = value.includes('storage:');
      const hasHosting = value.includes('hosting');
      const bundled =
        (hasFunctions && hasFirestore) ||
        (hasFunctions && hasStorage) ||
        (hasFunctions && hasHosting);
      expect(bundled).toBe(false);
    }
  });
});

describe('A-T9: existing --only firestore:rules,firestore:indexes deploy is UNCHANGED by PR A', () => {
  it('the firestore rules+indexes deploy line still appears exactly as before (staging job)', () => {
    const yml = readDeployYml();
    // Existing pre-PR-A line per /home/user/FamilyHQ/.github/workflows/deploy.yml.
    // The implementer MUST NOT touch this — Functions get their own step.
    expect(yml).toMatch(/--only\s+firestore:rules,firestore:indexes/);
  });

  it('the firestore rules+indexes deploy line appears at least twice (staging + production jobs)', () => {
    const yml = readDeployYml();
    // The existing file has the rules+indexes deploy in BOTH jobs. Pin
    // both occurrences so we catch an accidental deletion or merge of one.
    const matches = yml.match(/--only\s+firestore:rules,firestore:indexes/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT silently fold storage:rules or functions:* into the firestore --only list', () => {
    const yml = readDeployYml();
    // Catch a regression where someone re-bundles Storage or Functions
    // back into the Firestore step (the PR #84 trap).
    expect(yml).not.toMatch(/--only\s+firestore:rules,firestore:indexes,storage:rules/);
    expect(yml).not.toMatch(/--only\s+firestore:rules,firestore:indexes,functions:/);
    expect(yml).not.toMatch(/--only\s+firestore:[^,\s]+,functions:/);
  });
});
