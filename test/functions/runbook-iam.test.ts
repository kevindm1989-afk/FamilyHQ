/**
 * Runbook IAM assertions — PR A, threat-model §A.10 A-T6, A-T7.
 *
 * The kill-switch service-account configuration is a MANUAL operator step
 * (design §12 A3 explicitly says "NOT a CI job"). The CI gate that DOES
 * exist is THIS: the runbook documenting those steps must contain the exact
 * `gcloud` verification commands so the operator cannot skip them by
 * accident — and so a future operator running the runbook for the first
 * time on a fresh environment does the negative-binding audit (M33b)
 * before they run A4.
 *
 * These tests assert the runbook FILE exists at the documented path
 * (`docs/runbooks/billing-killswitch.md`) and contains the required
 * negative + positive IAM-binding verification commands.
 *
 * MUST FAIL today: the runbook does not exist yet. The implementer writes it
 * during A3.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const RUNBOOK_PATH = resolve(__dirname, '../../docs/runbooks/billing-killswitch.md');

function readRunbookOrFail(): string {
  if (!existsSync(RUNBOOK_PATH)) {
    throw new Error(
      `Runbook missing at ${RUNBOOK_PATH}. PR A acceptance criterion A3 requires it.`,
    );
  }
  return readFileSync(RUNBOOK_PATH, 'utf8');
}

describe('A-T6: runbook documents the NEGATIVE IAM-binding verification commands', () => {
  it('the runbook file exists at docs/runbooks/billing-killswitch.md', () => {
    expect(existsSync(RUNBOOK_PATH)).toBe(true);
  });

  it('asserts the runtime SA does NOT have any roles/billing.* binding (M33)', () => {
    const md = readRunbookOrFail();
    // The runbook must show the operator the exact gcloud command that
    // enumerates the runtime SA's bindings, AND a grep/assertion that
    // proves no `roles/billing.*` is present.
    expect(md).toMatch(/gcloud\s+projects\s+get-iam-policy/i);
    // Reference to the runtime SA being scoped (no billing.*)
    expect(md).toMatch(/runtime[\s-]+service\s+account|runtime\s+SA/i);
    expect(md).toMatch(/roles\/billing\./);
    // The runbook must spell out that this is a NEGATIVE assertion (the
    // operator is looking for the ABSENCE of these roles).
    expect(md).toMatch(/(must NOT|MUST NOT|does not|should not have)/);
  });

  it('asserts the kill-switch SA does NOT have roles/owner / roles/editor (M33b)', () => {
    const md = readRunbookOrFail();
    expect(md).toMatch(/kill[\s-]+switch\s+(SA|service\s+account)/i);
    expect(md).toMatch(/roles\/owner/);
    expect(md).toMatch(/roles\/editor/);
  });

  it('asserts the kill-switch SA does NOT have any roles/datastore.* or roles/firestore.* binding (M33b)', () => {
    const md = readRunbookOrFail();
    expect(md).toMatch(/roles\/datastore\./);
    expect(md).toMatch(/roles\/firestore\./);
  });

  it('shows the operator how to verify each negative binding (gcloud command per audit)', () => {
    const md = readRunbookOrFail();
    // At least one `gcloud projects get-iam-policy` invocation and one
    // billing-accounts variant must appear; the runbook is verification-
    // ready, not handwave.
    const projectsPolicyCmds = (md.match(/gcloud\s+projects\s+get-iam-policy/gi) ?? []).length;
    expect(projectsPolicyCmds).toBeGreaterThanOrEqual(1);
  });
});

describe('A-T7: runbook documents the POSITIVE IAM-binding (kill-switch SA on billing account)', () => {
  it('asserts the kill-switch SA HAS roles/billing.projectManager on the BILLING ACCOUNT', () => {
    const md = readRunbookOrFail();
    expect(md).toMatch(/roles\/billing\.projectManager/);
    // The binding is on the BILLING ACCOUNT, not the project — the runbook
    // must spell out the distinction so the operator does not accidentally
    // grant it at the project level (which would make the SA over-scoped).
    expect(md).toMatch(/billing\s+account/i);
    expect(md).toMatch(/gcloud\s+beta\s+billing\s+accounts\s+get-iam-policy/i);
  });

  it('does NOT instruct the operator to grant roles/billing.admin (over-privileged) or roles/owner', () => {
    const md = readRunbookOrFail();
    // The runbook should NEVER ask the operator to grant the over-broad
    // billing.admin role to the kill-switch SA. Mentioning it in a
    // "negative binding" / "must NOT have" context is fine; an `add-iam-
    // policy-binding` line that grants it is not.
    const grantBillingAdmin = /add-iam-policy-binding[\s\S]{0,200}roles\/billing\.admin/i;
    expect(md).not.toMatch(grantBillingAdmin);
    const grantOwner = /add-iam-policy-binding[\s\S]{0,200}roles\/owner/i;
    expect(md).not.toMatch(grantOwner);
  });

  it('identifies the kill-switch SA as a DEDICATED service account (NOT the default runtime SA)', () => {
    const md = readRunbookOrFail();
    // M33b: the kill-switch SA MUST be a dedicated identity; the default
    // 2nd-gen Cloud Functions runtime SA must NOT carry billing rights.
    expect(md).toMatch(/dedicated/i);
  });
});
