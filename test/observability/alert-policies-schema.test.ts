/**
 * alert-policies-schema — observability runbook §5 follow-up shape gate.
 *
 * The three recommended alerts from `docs/runbooks/observability.md` §5 ship
 * as declarative Cloud Monitoring AlertPolicy JSON in
 * `infra/monitoring/alert-policies/` so that:
 *   (a) each policy can be re-applied from a clean GCP state via
 *       `gcloud alpha monitoring policies create --policy-from-file=<file>`,
 *   (b) every change goes through code review (same pattern as
 *       `infra/monitoring/dashboard.json` / dashboard-schema.test.ts), and
 *   (c) the structural invariants the alertPolicies API requires are pinned
 *       here instead of being rediscovered one failed `gcloud` deploy at a
 *       time (the dashboard provisioning cost 4 attempts that way).
 *
 * IMPORTANT — the alertPolicies API schema is NOT the dashboards schema:
 *   - alert policies DO use `displayName` (dashboards use `title` at the
 *     widget level),
 *   - `combiner` is REQUIRED at the top level even with a single condition,
 *   - ratio conditions need either MQL (`conditionMonitoringQueryLanguage`)
 *     or a `conditionThreshold` with `denominatorFilter`,
 *   - `notificationChannels` ships EMPTY — channel ids are environment-
 *     specific and are wired by the operator post-create (runbook §5).
 *
 * Assertions stay structural on purpose: we pin the fields we control and
 * the filters the runbook promises, not GCP enum values we haven't verified
 * against a live deploy.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ALERT_POLICIES_DIR = resolve(__dirname, '../../infra/monitoring/alert-policies');

const POLICY_FILES = [
  'kill-switch-invoked.json',
  'notify-success-ratio-low.json',
  'token-cleanup-spike.json',
] as const;

type PolicyFile = (typeof POLICY_FILES)[number];

// ---------------------------------------------------------------------------
// Loader. Returns the parsed JSON or throws a clear error if missing /
// invalid — never returns a partial / null shape silently.
// ---------------------------------------------------------------------------
interface AlertPolicyJson {
  displayName?: unknown;
  documentation?: { content?: unknown; mimeType?: unknown };
  combiner?: unknown;
  conditions?: unknown;
  notificationChannels?: unknown;
  [key: string]: unknown;
}

function policyPath(file: PolicyFile): string {
  return resolve(ALERT_POLICIES_DIR, file);
}

function loadPolicy(file: PolicyFile): AlertPolicyJson {
  const path = policyPath(file);
  if (!existsSync(path)) {
    throw new Error(
      `${file} is missing at ${path} — the alert-policy configs must ship in infra/monitoring/alert-policies/ (observability runbook §5).`,
    );
  }
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw) as AlertPolicyJson;
  } catch (err) {
    throw new Error(`${file} at ${path} is not valid JSON: ${(err as Error).message}`);
  }
}

function conditionsOf(policy: AlertPolicyJson): Record<string, unknown>[] {
  if (!Array.isArray(policy.conditions)) return [];
  return policy.conditions.filter(
    (c): c is Record<string, unknown> => c !== null && typeof c === 'object',
  );
}

/**
 * Stringify a policy for substring checks — same tolerant approach as the
 * dashboard-schema test: every nested filter string is inspectable from one
 * place without traversing the AlertPolicy condition union by hand.
 */
function asText(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Shared structural invariants — every policy file.
// ---------------------------------------------------------------------------
describe.each(POLICY_FILES)('alert policy %s — sanity & required shape', (file) => {
  it('exists in infra/monitoring/alert-policies/', () => {
    expect(existsSync(policyPath(file))).toBe(true);
  });

  it('parses as JSON', () => {
    expect(() => loadPolicy(file)).not.toThrow();
  });

  it('carries a non-empty string displayName (alert policies DO use displayName)', () => {
    const policy = loadPolicy(file);
    expect(typeof policy.displayName).toBe('string');
    expect((policy.displayName as string).trim().length).toBeGreaterThan(0);
  });

  it('declares a top-level combiner (required by the alertPolicies API even for a single condition)', () => {
    const policy = loadPolicy(file);
    expect(typeof policy.combiner).toBe('string');
    expect((policy.combiner as string).trim().length).toBeGreaterThan(0);
  });

  it('has at least one condition', () => {
    const policy = loadPolicy(file);
    expect(conditionsOf(policy).length).toBeGreaterThanOrEqual(1);
  });

  it('every condition carries its own displayName', () => {
    const policy = loadPolicy(file);
    for (const condition of conditionsOf(policy)) {
      expect(typeof condition.displayName).toBe('string');
      expect((condition.displayName as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('ships notificationChannels as an EMPTY array (channel ids are env-specific; the operator wires them post-create per runbook §5)', () => {
    const policy = loadPolicy(file);
    expect(Array.isArray(policy.notificationChannels)).toBe(true);
    expect(policy.notificationChannels).toEqual([]);
  });

  it('carries operator documentation content (non-empty string)', () => {
    const policy = loadPolicy(file);
    const content = policy.documentation?.content;
    expect(typeof content).toBe('string');
    expect((content as string).trim().length).toBeGreaterThan(0);
  });

  it('displayName and documentation are pure ASCII (operator-facing, not localized)', () => {
    const policy = loadPolicy(file);
    const texts = [policy.displayName, policy.documentation?.content].filter(
      (s): s is string => typeof s === 'string',
    );
    const nonAscii = texts.filter((s) => /[^\x20-\x7F\t\n\r]/.test(s));
    expect(
      nonAscii,
      `alert-policy operator text contains non-ASCII characters: ${JSON.stringify(nonAscii)}`,
    ).toEqual([]);
  });

  it('contains no forbidden PI substrings in operator-visible text (same family as the dashboard hygiene gate)', () => {
    const policy = loadPolicy(file);
    const FORBIDDEN = ['choreTitle', 'wishlistTitle', 'postContent', 'todoTitle', 'email'];
    const text = `${policy.displayName ?? ''} ${policy.documentation?.content ?? ''}`.toLowerCase();
    const offenders = FORBIDDEN.filter((sub) => text.includes(sub.toLowerCase()));
    expect(
      offenders,
      `alert-policy text contains forbidden PI substring(s): ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-policy condition shape — the part each alert actually promises.
// ---------------------------------------------------------------------------
describe('kill-switch-invoked.json — pins the billingkillswitch service', () => {
  it('some condition filter references the billingkillswitch identifier (gen-2 Cloud Run service name)', () => {
    const policy = loadPolicy('kill-switch-invoked.json');
    const matches = conditionsOf(policy).some((c) => /billingkillswitch/i.test(asText(c)));
    expect(
      matches,
      'the kill-switch policy must filter on the billingkillswitch / billingKillSwitch identifier',
    ).toBe(true);
  });

  it('queries the gen-2 request_count metric on cloud_run_revision (the kill-switch is Cloud Functions v2 / Cloud Run-backed)', () => {
    const policy = loadPolicy('kill-switch-invoked.json');
    const text = asText(policy.conditions);
    expect(text).toContain('run.googleapis.com/request_count');
    expect(text).toContain('cloud_run_revision');
  });
});

describe('notify-success-ratio-low.json — expresses a ratio condition', () => {
  it('uses either a denominatorFilter (conditionThreshold ratio) or MQL (conditionMonitoringQueryLanguage)', () => {
    const policy = loadPolicy('notify-success-ratio-low.json');
    const hasRatioShape = conditionsOf(policy).some((c) => {
      const text = asText(c);
      const hasDenominator = /denominatorFilter/.test(text);
      const hasMql = /conditionMonitoringQueryLanguage/.test(text);
      return hasDenominator || hasMql;
    });
    expect(
      hasRatioShape,
      'a ratio alert needs denominatorFilter on conditionThreshold OR an MQL condition — neither found',
    ).toBe(true);
  });

  it('scopes the ratio to the notify-* callables', () => {
    const policy = loadPolicy('notify-success-ratio-low.json');
    const text = asText(policy.conditions);
    expect(text).toContain('run.googleapis.com/request_count');
    expect(/\^notify/.test(text)).toBe(true);
  });
});

describe('token-cleanup-spike.json — queries the cleanup log-based metric', () => {
  it('some condition references the notify_callable_cleaned_token_count log-based metric', () => {
    const policy = loadPolicy('token-cleanup-spike.json');
    const matches = conditionsOf(policy).some((c) =>
      /notify_callable_cleaned_token_count/.test(asText(c)),
    );
    expect(
      matches,
      'the spike policy must query logging.googleapis.com/user/notify_callable_cleaned_token_count (runbook §4 creates it)',
    ).toBe(true);
  });
});
