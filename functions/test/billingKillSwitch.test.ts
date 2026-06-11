/**
 * billingKillSwitch — unit contract (PR A, threat-model §A.10 A-T1..A-T5).
 *
 * These tests MUST FAIL today: `functions/src/billingKillSwitch.ts` does not
 * exist yet. The implementer makes them pass next.
 *
 * Boundaries mocked at the SDK layer:
 *   - `firebase-functions/v2/pubsub`.onMessagePublished — capture wrapper args
 *     so we can (a) assert the trigger shape (A-T1) and (b) invoke the inner
 *     handler with synthetic CloudEvent payloads to exercise A-T2..A-T5.
 *   - `firebase-functions/v2` setGlobalOptions + region — assert region.
 *   - `firebase-functions/logger` — capture structured log calls (warn for
 *     malformed payloads, info for actions).
 *   - `googleapis`.google.cloudbilling — fake the `projects.getBillingInfo` +
 *     `projects.updateBillingInfo` Admin SDK clients.
 *
 * Determinism: no real time, no real network, no real Pub/Sub. Each test
 * resets mocks in beforeEach; no shared mutable state.
 *
 * The expected runtime shape (the implementer codes against this contract):
 *   export const billingKillSwitch = onMessagePublished(
 *     {
 *       topic: 'billing-budget-alerts',
 *       region: 'northamerica-northeast1',
 *       retry: false,
 *     },
 *     async (event) => { ...threshold check + idempotent updateBillingInfo... },
 *   );
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock surfaces
// ---------------------------------------------------------------------------

type CapturedTrigger = {
  options: Record<string, unknown> | undefined;
  handler: ((event: unknown) => unknown | Promise<unknown>) | undefined;
};
const captured: CapturedTrigger = { options: undefined, handler: undefined };

const onMessagePublishedMock = vi.fn((options: unknown, handler: unknown) => {
  captured.options = options as Record<string, unknown>;
  captured.handler = handler as (event: unknown) => unknown | Promise<unknown>;
  // Return a sentinel "function declaration" object the way firebase-functions
  // does; the test only ever inspects `captured.*`.
  return {
    __trigger: 'pubsub.onMessagePublished',
    options,
  };
});

vi.mock('firebase-functions/v2/pubsub', () => ({
  onMessagePublished: (options: unknown, handler: unknown) =>
    onMessagePublishedMock(options, handler),
}));

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock('firebase-functions/logger', () => ({
  info: (...args: unknown[]) => loggerInfoMock(...args),
  warn: (...args: unknown[]) => loggerWarnMock(...args),
  error: (...args: unknown[]) => loggerErrorMock(...args),
}));

// firebase-functions root re-exports `logger` AND `setGlobalOptions`. Some
// implementations import `functions.logger.info(...)` directly; tolerate both
// import shapes by stubbing the root module too.
vi.mock('firebase-functions', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfoMock(...args),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    error: (...args: unknown[]) => loggerErrorMock(...args),
  },
  setGlobalOptions: vi.fn(),
}));

// googleapis cloudbilling client. Each test installs the desired
// getBillingInfo response via `billingState.billingEnabled`; updateBillingInfo
// captures its argument for assertion.
const getBillingInfoMock = vi.fn();
const updateBillingInfoMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: class {
        async getClient() {
          return { __fakeClient: true };
        }
      },
    },
    cloudbilling: vi.fn(() => ({
      projects: {
        getBillingInfo: (...args: unknown[]) => getBillingInfoMock(...args),
        updateBillingInfo: (...args: unknown[]) => updateBillingInfoMock(...args),
      },
    })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOPIC = 'billing-budget-alerts';
const REGION = 'northamerica-northeast1';
const PROJECT_ID = 'familyhq-68638';

function encodePubSubData(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/** Shape that mirrors GCP Cloud Billing budget-alert messages. */
function budgetEvent(payload: unknown): {
  data: { message: { data: string } };
} {
  return {
    data: {
      message: {
        data: encodePubSubData(payload),
      },
    },
  };
}

/** Import-and-invoke. Forces a fresh load each test so the captured trigger
 *  reflects the current call. The implementer file does NOT exist yet — this
 *  import is exactly what fails first.  */
async function loadModule() {
  // Reset captured AFTER mocks were registered (above) but BEFORE the module
  // body runs (which calls onMessagePublished at import time).
  captured.options = undefined;
  captured.handler = undefined;
  // Bust ESM module cache so each test sees a fresh registration.
  vi.resetModules();
  return await import('../src/billingKillSwitch.js');
}

async function invokeHandlerWith(event: unknown): Promise<void> {
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error(
      'billingKillSwitch did not register an onMessagePublished handler at import time',
    );
  }
  await captured.handler(event);
}

beforeEach(() => {
  onMessagePublishedMock.mockClear();
  loggerInfoMock.mockReset();
  loggerWarnMock.mockReset();
  loggerErrorMock.mockReset();
  getBillingInfoMock.mockReset();
  updateBillingInfoMock.mockReset();
  // Default: project is currently billed (so a threshold breach triggers
  // detach). Individual tests override before invoking.
  getBillingInfoMock.mockResolvedValue({
    data: {
      name: `projects/${PROJECT_ID}/billingInfo`,
      projectId: PROJECT_ID,
      billingAccountName: 'billingAccounts/FAKE-BILLING-ACCT',
      billingEnabled: true,
    },
  });
  updateBillingInfoMock.mockResolvedValue({
    data: {
      name: `projects/${PROJECT_ID}/billingInfo`,
      projectId: PROJECT_ID,
      billingAccountName: '',
      billingEnabled: false,
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// A-T1 — trigger shape
// ---------------------------------------------------------------------------

describe('A-T1: billingKillSwitch is bound to topic billing-budget-alerts in northamerica-northeast1', () => {
  it('registers via onMessagePublished at import time', async () => {
    await loadModule();
    expect(onMessagePublishedMock).toHaveBeenCalledTimes(1);
  });

  it('passes topic="billing-budget-alerts" in the trigger options', async () => {
    await loadModule();
    expect(captured.options).toBeDefined();
    expect(captured.options).toMatchObject({ topic: TOPIC });
  });

  it('pins region="northamerica-northeast1" (Montreal — Canadian residency, ADR-0013)', async () => {
    await loadModule();
    expect(captured.options).toMatchObject({ region: REGION });
  });

  it('exports a function declaration named billingKillSwitch', async () => {
    const mod = (await loadModule()) as Record<string, unknown>;
    expect(mod.billingKillSwitch).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// A-T2 — threshold breach triggers detach with the exact body shape
// ---------------------------------------------------------------------------

describe('A-T2: costAmount > budgetAmount calls updateBillingInfo with billingAccountName: ""', () => {
  it('calls updateBillingInfo exactly once when costAmount > budgetAmount', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetDisplayName: 'familyhq-monthly',
        budgetAmount: 5.0,
        costAmount: 7.42,
        currencyCode: 'CAD',
        alertThresholdExceeded: 1.0,
      }),
    );
    expect(updateBillingInfoMock).toHaveBeenCalledTimes(1);
  });

  it('calls updateBillingInfo with the exact request body shape (name + empty billingAccountName)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetDisplayName: 'familyhq-monthly',
        budgetAmount: 5.0,
        costAmount: 5.01,
        currencyCode: 'CAD',
      }),
    );

    expect(updateBillingInfoMock).toHaveBeenCalledTimes(1);
    const [firstCallArgs] = updateBillingInfoMock.mock.calls;
    expect(firstCallArgs).toBeDefined();
    const arg = firstCallArgs?.[0] as {
      name?: string;
      requestBody?: { billingAccountName?: string };
    };
    expect(arg).toMatchObject({
      name: `projects/${PROJECT_ID}`,
      requestBody: { billingAccountName: '' },
    });
    // Nothing else may smuggle authority — billingAccountName must be the
    // empty string literal, not undefined, not null, not a placeholder.
    expect(arg.requestBody?.billingAccountName).toBe('');
  });

  it('does NOT fire when costAmount equals budgetAmount (strict > per M42 / A-T3)', async () => {
    // Per security-reviewer Finding 1 + second-opinion concern #4: the
    // strict `>` semantics are pinned by threat-model M42 and ADR-0013 §12
    // A2. Cloud Billing's 100% threshold fan-out fires at
    // `costAmount === budgetAmount`; treating equality as a breach would
    // self-DoS on every billing period's first 100% alert.
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 5.0,
        currencyCode: 'CAD',
      }),
    );
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('logs a structured info entry for the detach action (no console.*)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 6.0,
        currencyCode: 'CAD',
      }),
    );
    expect(loggerInfoMock).toHaveBeenCalled();
    // The payload object is the second arg by convention; assert it carries
    // the action + the cost/budget pair (threat-model §A.5 M38 allow-list).
    // We don't pin the exact field set here — that's PR E's job — but a
    // logger.info call MUST exist so the operator can find the action.
  });
});

// ---------------------------------------------------------------------------
// A-T2b — structural enforcement of the kill-switch service-account binding
// (security-reviewer Finding 2 / second-opinion concern #2 / M33b)
// ---------------------------------------------------------------------------

describe('A-T2b: trigger options pin the dedicated kill-switch service account (M33b)', () => {
  it('declares serviceAccount on the onMessagePublished trigger options', async () => {
    await loadModule();
    expect(captured.options).toBeDefined();
    const sa = (captured.options as { serviceAccount?: unknown } | undefined)?.serviceAccount;
    // The literal value is the documented kill-switch SA (env-var-overridable
    // for ops flexibility), but the test cares about PRESENCE + a non-empty
    // string — if this is missing, `firebase deploy` would bind the function
    // to the default runtime SA, which the runbook explicitly forbids from
    // holding any `roles/billing.*` permission.
    expect(typeof sa).toBe('string');
    expect(sa).toMatch(/^kill-switch@.+\.iam\.gserviceaccount\.com$/);
  });
});

// ---------------------------------------------------------------------------
// A-T3b — below-threshold info log so the operator can confirm liveness
// (second-opinion concern #3)
// ---------------------------------------------------------------------------

describe('A-T3b: below-threshold fan-out alerts emit a structured info log (liveness signal)', () => {
  it('logs `below_threshold` info when costAmount < budgetAmount (e.g. 50% / 90% alert)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 2.5,
        currencyCode: 'CAD',
        alertThresholdExceeded: 0.5,
      }),
    );
    expect(loggerInfoMock).toHaveBeenCalled();
    // Match the structured action label exactly; the second-opinion review
    // pinned this string so an operator can find liveness signals by grep.
    const lastCall = loggerInfoMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toMatchObject({
      action: 'below_threshold',
    });
  });

  it('logs `below_threshold` info even when costAmount EQUALS budgetAmount (the 100% alert that is NOT a breach under strict >)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 5.0,
        currencyCode: 'CAD',
        alertThresholdExceeded: 1.0,
      }),
    );
    expect(loggerInfoMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A-T3 — early-trigger safety: below threshold is a no-op
// ---------------------------------------------------------------------------

describe('A-T3: costAmount < budgetAmount does NOT call updateBillingInfo', () => {
  it('does not call updateBillingInfo when costAmount is below budgetAmount', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 2.5,
        currencyCode: 'CAD',
        alertThresholdExceeded: 0.5, // 50% early-warning fan-out, NOT a breach
      }),
    );
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('does not call updateBillingInfo when costAmount is zero (a freshly-billed month)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 0,
        currencyCode: 'CAD',
      }),
    );
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A-T4 — idempotent at the API level (no getBillingInfo pre-check)
// ---------------------------------------------------------------------------
//
// Operator-debug, 2026-06-11: the original implementation called
// `getBillingInfo` first as an idempotency check. That requires
// `billing.resourceAssociations.get` on the project, which
// `roles/billing.projectManager` does NOT include — the call 403'd on
// first deploy and the function silently never detached. The Cloud
// Billing `updateBillingInfo` API is naturally idempotent (calling it
// on an already-detached project is a no-op success), so the pre-check
// was redundant. Dropping it keeps the kill-switch SA's IAM minimal
// (M33b) and removes a hidden permission dependency. Tests now pin the
// new contract: getBillingInfo is NEVER called; updateBillingInfo fires
// on every over-threshold breach, including re-fires of the same alert.

describe('A-T4: idempotent at the API level — no getBillingInfo pre-check', () => {
  it('calls updateBillingInfo on every over-threshold breach (trusts API idempotency)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 9.99,
        currencyCode: 'CAD',
      }),
    );

    expect(updateBillingInfoMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT call getBillingInfo at all (M33b: pre-check would require .get permission)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        costAmount: 9.99,
        currencyCode: 'CAD',
      }),
    );

    expect(getBillingInfoMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// A-T5 — malformed payload: warn + early return, never an API call
// ---------------------------------------------------------------------------

describe('A-T5: malformed Pub/Sub payload warns + early-returns + no API call', () => {
  it('handles a missing event.data.message entirely (warn, no API call)', async () => {
    await invokeHandlerWith({ data: {} });

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
    expect(getBillingInfoMock).not.toHaveBeenCalled();
  });

  it('handles a missing data attribute on the Pub/Sub message (warn, no API call)', async () => {
    await invokeHandlerWith({ data: { message: {} } });

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('handles a non-base64 data field without throwing (warn, no API call)', async () => {
    // The implementer's parser must tolerate junk — Pub/Sub at-least-once
    // delivery can re-fire stale or partially-routed messages.
    await invokeHandlerWith({
      data: { message: { data: '!!!-not-valid-base64-!!!' } },
    });

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('handles a base64 payload that is not JSON (warn, no API call)', async () => {
    const bogus = Buffer.from('this is not json at all', 'utf8').toString('base64');
    await invokeHandlerWith({ data: { message: { data: bogus } } });

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('handles a JSON payload missing budgetAmount (warn, no API call)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        // budgetAmount intentionally absent
        costAmount: 9.99,
        currencyCode: 'CAD',
      }),
    );

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('handles a JSON payload missing costAmount (warn, no API call)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 5.0,
        // costAmount intentionally absent
        currencyCode: 'CAD',
      }),
    );

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('handles a payload where budgetAmount/costAmount are non-numeric (warn, no API call)', async () => {
    await invokeHandlerWith(
      budgetEvent({
        budgetAmount: 'five-dollars',
        costAmount: { not: 'a-number' },
        currencyCode: 'CAD',
      }),
    );

    expect(loggerWarnMock).toHaveBeenCalled();
    expect(updateBillingInfoMock).not.toHaveBeenCalled();
  });

  it('does not throw on malformed input (Pub/Sub would otherwise redeliver and burn invocations)', async () => {
    // A thrown handler is auto-retried by Cloud Functions 2nd gen unless
    // `retry: false` is set. Even with retry off, exceptions cost
    // invocations and noise. The contract is: warn + early-return, never
    // re-throw on malformed payloads.
    await expect(invokeHandlerWith({ data: {} })).resolves.toBeUndefined();
  });
});
