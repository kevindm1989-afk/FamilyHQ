/**
 * billingKillSwitch — Pub/Sub-triggered budget kill-switch (PR A / ADR-0013).
 *
 * Subscribes to the Cloud Billing budget-alert topic and detaches the project
 * from its billing account when the cost crosses the configured cap. This is
 * the hard backstop for runaway cost on Blaze-tier features (Cloud Functions,
 * FCM Admin SDK). When billing is detached, every chargeable Google Cloud
 * service returns errors on this project; core Firestore + Auth (free tier)
 * keep working. See `docs/runbooks/billing-killswitch.md` for the operator
 * runbook and IAM negative-binding audits.
 *
 * Trigger: Pub/Sub topic `billing-budget-alerts` in `northamerica-northeast1`
 * (Montreal — Canadian residency, ADR-0013).
 *
 * Threat-model coverage:
 *   - M42 — strict `costAmount > budgetAmount` threshold + idempotency unit
 *     tests (`functions/test/billingKillSwitch.test.ts`). Cloud Billing's
 *     100% threshold fan-out fires at `costAmount === budgetAmount`; treating
 *     equality as breach would self-DoS on the very first 100% alert. Strict
 *     `>` matches threat-model M42 + ADR-0013 §12 A2 + A-T3.
 *   - M33b — function pins `serviceAccount` so the kill-switch SA is the
 *     deployed runtime identity. Without this, `firebase deploy` would bind
 *     the function to the default 2nd-gen runtime SA which the runbook
 *     explicitly forbids from carrying any `roles/billing.*`.
 *   - M38 — `firebase-functions/logger` only; no `console.*` (AST gate in
 *     `test/functions/no-console-ast.test.ts`); below-threshold info log so
 *     50/90% fan-out alerts confirm the function is alive between breaches.
 *   - T-KS.3 — structured log payload carries no PII (billing metadata only).
 *   - On any error from the billing API we log a generic message + structured
 *     payload; we NEVER pass the raw error object through to the logger because
 *     nested `errorInfo` from `googleapis` can carry credentials / OAuth tokens
 *     in metadata fields (threat-model §A.4.3).
 *   - Handler NEVER throws on malformed Pub/Sub payloads. A thrown handler
 *     would be retried by Cloud Functions 2nd gen (even with `retry: false`
 *     each redelivery burns invocations + invocation-cost). We warn + return.
 */
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import * as logger from 'firebase-functions/logger';
import { google, cloudbilling_v1 } from 'googleapis';

// Pinned literals — also the values the unit-test contract pins against.
// Project id is the canonical id from `.firebaserc`; it is a public identifier
// (not a secret) so embedding it is safe. We pass `name: 'projects/<id>'`
// verbatim to the billing API so the test can assert on the exact request
// body shape (`A-T2`).
const PROJECT_NAME = 'projects/familyhq-68638';
const TOPIC = 'billing-budget-alerts';
const REGION = 'northamerica-northeast1';
// M33b: pin the runtime SA in the function declaration so `firebase deploy`
// always binds the function to the dedicated kill-switch SA (not the default
// 2nd-gen runtime SA, which the runbook forbids from holding any
// `roles/billing.*`). Operator can override at deploy time via the
// KILL_SWITCH_SA env var if the SA email differs from the documented one.
const KILL_SWITCH_SA =
  process.env.KILL_SWITCH_SA ?? 'kill-switch@familyhq-68638.iam.gserviceaccount.com';

/**
 * Shape of a Cloud Billing budget-alert message after base64 + JSON decode.
 * Only the two fields we act on are required; the rest are descriptive.
 *   - `budgetAmount` — the configured cap (CAD).
 *   - `costAmount`   — accumulated spend in the current period (CAD).
 * Cloud Billing also includes `budgetDisplayName`, `currencyCode`,
 * `alertThresholdExceeded` (0.5, 0.9, 1.0 for the 50/90/100% fan-out), but
 * we only need cost vs budget to decide.
 */
interface BudgetAlertPayload {
  budgetAmount: number;
  costAmount: number;
}

/** Type guard: payload is a parseable budget alert with numeric amounts. */
function isBudgetAlertPayload(value: unknown): value is BudgetAlertPayload {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.budgetAmount === 'number' && typeof v.costAmount === 'number';
}

/**
 * Decode an inbound Pub/Sub message data field (base64-encoded JSON) into a
 * validated BudgetAlertPayload. Returns `null` on any malformed step — never
 * throws. The caller is expected to log + early-return on `null`.
 */
function decodeBudgetAlert(rawBase64: unknown): BudgetAlertPayload | null {
  if (typeof rawBase64 !== 'string' || rawBase64.length === 0) return null;

  let jsonText: string;
  try {
    // Buffer.from with 'base64' tolerates a fair amount of junk (it silently
    // drops invalid chars); the parsed JSON step catches the rest.
    jsonText = Buffer.from(rawBase64, 'base64').toString('utf8');
  } catch {
    return null;
  }
  if (jsonText.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!isBudgetAlertPayload(parsed)) return null;
  return parsed;
}

/**
 * Build a Cloud Billing client using Application Default Credentials. At
 * runtime in the deployed Function, ADC resolves to the kill-switch SA's
 * identity (`roles/billing.projectManager` on the billing account only —
 * see runbook for IAM provisioning). No key files in source.
 *
 * The googleapis client is constructed inside the handler so the unit-test
 * mock (`vi.mock('googleapis', ...)`) can stub `google.cloudbilling` at
 * call time rather than module-load time.
 */
function makeCloudBillingClient(): cloudbilling_v1.Cloudbilling {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-billing'],
  });
  return google.cloudbilling({ version: 'v1', auth });
}

export const billingKillSwitch = onMessagePublished(
  {
    topic: TOPIC,
    region: REGION,
    // M33b: dedicated kill-switch SA — see KILL_SWITCH_SA constant above.
    // The literal in source is the structural enforcement; the runbook
    // verification step is a redundant operator check, not the primary
    // control.
    serviceAccount: KILL_SWITCH_SA,
    // Pub/Sub-triggered functions auto-retry on throw; we never throw, so
    // retry: false is a defensive belt — even if a future bug throws, we
    // don't want to amplify a runaway-cost scenario with re-invocations.
    retry: false,
  },
  async (event: unknown) => {
    // The CloudEvent envelope shape from firebase-functions v2/pubsub is
    // `{ data: { message: { data: '<base64>' , ... }, subscription: ... } }`.
    // We pull only what we need and defensively narrow at every step.
    const envelope = event as { data?: { message?: { data?: unknown } } } | undefined;
    const rawData = envelope?.data?.message?.data;

    const payload = decodeBudgetAlert(rawData);
    if (payload === null) {
      logger.warn('billingKillSwitch: malformed Pub/Sub payload — early return', {
        action: 'malformed_payload_dropped',
        hasEnvelope: envelope !== undefined,
        hasMessage: envelope?.data?.message !== undefined,
        rawDataType: typeof rawData,
      });
      return;
    }

    const { budgetAmount, costAmount } = payload;

    // At or below the cap — no action. The 50% / 90% / 100% Cloud Billing
    // fan-out alerts are expected to hit this branch every billing period.
    // The 100% alert fires at `costAmount === budgetAmount`, so STRICT
    // greater-than is the only safe comparison (M42); equality is not a
    // breach. We log info here so operators get a live-heartbeat for the
    // function on every fan-out alert — without it the function appears
    // dead between real breaches (second-opinion review #3).
    if (costAmount <= budgetAmount) {
      logger.info('billingKillSwitch: budget alert below threshold — no action', {
        action: 'below_threshold',
        projectName: PROJECT_NAME,
        budgetAmount,
        costAmount,
      });
      return;
    }

    // Above the cap — detach billing. Strict `>` only (M42 / A-T3); see
    // the below-threshold branch above for the rationale.
    let cloudbilling: cloudbilling_v1.Cloudbilling;
    try {
      cloudbilling = makeCloudBillingClient();
    } catch {
      // Defensive — should not happen with ADC. Log generic + return.
      logger.error('billingKillSwitch: failed to construct cloud-billing client', {
        action: 'client_init_failed',
        projectName: PROJECT_NAME,
      });
      return;
    }

    // Idempotency: read current billing state first. If already detached
    // (billingEnabled === false), do nothing. This handles Pub/Sub
    // at-least-once redelivery and re-firing alerts inside the same period.
    let currentlyEnabled: boolean;
    try {
      const info = await cloudbilling.projects.getBillingInfo({
        name: PROJECT_NAME,
      });
      currentlyEnabled = info?.data?.billingEnabled === true;
    } catch {
      // Generic message + structured payload — NEVER pass the raw error
      // object: googleapis errors can carry credentials/tokens in nested
      // `errorInfo`/`config` fields (see threat-model §A.4.3).
      logger.error('billingKillSwitch: getBillingInfo call failed', {
        action: 'get_billing_info_failed',
        projectName: PROJECT_NAME,
        budgetAmount,
        costAmount,
      });
      return;
    }

    if (!currentlyEnabled) {
      logger.info('billingKillSwitch: project already detached — no-op (idempotent)', {
        action: 'already_detached',
        projectName: PROJECT_NAME,
        budgetAmount,
        costAmount,
      });
      return;
    }

    try {
      await cloudbilling.projects.updateBillingInfo({
        name: PROJECT_NAME,
        requestBody: { billingAccountName: '' },
      });
    } catch {
      logger.error('billingKillSwitch: updateBillingInfo call failed', {
        action: 'update_billing_info_failed',
        projectName: PROJECT_NAME,
        budgetAmount,
        costAmount,
      });
      return;
    }

    // Success — structured payload mirrors threat-model M38's allow-list
    // (action, projectName, budgetAmount, costAmount — billing metadata
    // only, no PII).
    logger.info('billingKillSwitch: billing detached', {
      action: 'billing_detached',
      projectName: PROJECT_NAME,
      budgetAmount,
      costAmount,
    });
  },
);
