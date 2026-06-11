/**
 * notifyChoreApproved — first chargeable HTTPS-callable (PR C1, threat-model
 * §A.10 C-T1..C-T20, design §12 PR C).
 *
 * Sends a vague, PI-free push when a parent has just approved a kid's chore.
 * Idempotent against replay (rate-limited by M36). Cross-tenant safe (M35).
 * All FCM error codes are mapped to a generic surface (M39) — the response
 * shape sent to the client is `{ sent, failed }` and nothing else. No
 * recipient UIDs, no FCM error code prefixes, no chore PI.
 *
 * Trust derivation order (intentional — short-circuit cheapest checks first):
 *   1. `request.auth` exists. App Check is enforced at the platform layer
 *      via `enforceAppCheck: true` (M32 — the literal MUST appear in the
 *      onCall options object; CI source-scan in C-T1 greps for it).
 *   2. Rate limit (M36) — `rateLimits/choreApproved__{callerUid}` doc with
 *      `{count, windowStartMs}`. Window = 60_000 ms. Limit = 10/window.
 *      Bumped FIRST after auth so a stolen session cannot fan out before
 *      the chore-doc reads cost us anything.
 *   3. Caller `users/{uid}` exists AND `isActive == true`.
 *   4. Input `choreId` is a non-empty string.
 *   5. Chore doc exists.
 *   6. Chore `familyId == caller familyId` (cross-tenant guard).
 *   7. Chore `status == 'approved'` (state-machine guard).
 *   8. Recipient `userPrivate/{assignedTo}.familyId == caller familyId`
 *      (defense-in-depth cross-tenant — M35.7).
 *   9. Recipient `pushEnabled && categories.myChoreResolved`.
 *  10. Recipient has at least one `fcmTokens/{tokenHash}` doc.
 *  11. `sendEachForMulticast` with the FROZEN constants from
 *      `notificationBodies.ts` — no template substitution, no chore-doc
 *      field interpolation (M34 + threat-model B10).
 *  12. Stale-token cleanup ONLY on the two pinned codes
 *      (`registration-token-not-registered`, `invalid-registration-token`
 *      — M37). Transient codes (`server-unavailable`, `internal-error`,
 *      `quota-exceeded`) leave the doc intact.
 *  13. Return `{ sent, failed }`.
 *
 * Logging: `firebase-functions/logger` only (M38 — extends PR A's no-`console.*`
 * AST gate to this file via C-T20). Payloads carry only the allow-listed
 * fields enumerated in the brief — never `choreTitle`, `name`, raw FCM
 * tokens, or FCM error codes.
 *
 * Error mapping: any throw from `sendEachForMulticast` is caught and
 * rethrown as `HttpsError('internal', '<generic>')`. The raw provider text
 * (incl. `messaging/*` prefixes) NEVER appears in the client-visible
 * message — M39, second-opinion CB3 (FCM as Google subprocessor).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { initializeApp, getApps } from 'firebase-admin/app';
import { NOTIFICATION_BODIES } from './notificationBodies.js';

// Module-load-time Admin SDK init. Idempotent under module reloads (vitest's
// vi.resetModules() between tests would otherwise re-init and trip the
// "already initialized" error). Cloud Functions cold-start runs this once
// per instance.
if (getApps().length === 0) {
  initializeApp();
}

const KIND = 'choreApproved';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 10;
const FCM_STALE_TOKEN_CODES = new Set<string>([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Per-token doc shape — narrow read view. */
interface FcmTokenDoc {
  token: string;
}

/**
 * Read a Firestore document snapshot's data tolerantly. The real Admin SDK
 * exposes `.data()` as a method that returns `Record<string, unknown> |
 * undefined`. The Vitest mock in `functions/test/notifyChoreApproved.test.ts`
 * exposes it as a plain `data` property. Supporting both keeps the
 * implementation honest against both runtimes without conditional branches
 * sprinkled through the handler.
 */
function readSnap(snap: unknown): Record<string, unknown> | undefined {
  if (!snap || typeof snap !== 'object') return undefined;
  const candidate = snap as { data?: unknown };
  if (typeof candidate.data === 'function') {
    const value = (candidate.data as () => unknown)();
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  }
  if (candidate.data && typeof candidate.data === 'object') {
    return candidate.data as Record<string, unknown>;
  }
  return undefined;
}

/** Per-token response shape from `sendEachForMulticast`. */
interface SendResponse {
  success: boolean;
  error?: { code?: string } | undefined;
}

interface MulticastResult {
  successCount?: number;
  failureCount?: number;
  responses: SendResponse[];
}

export const notifyChoreApproved = onCall(
  {
    region: 'northamerica-northeast1',
    // M32 — App Check is mandatory on every notify-callable. The LITERAL
    // `enforceAppCheck: true` here is the structural enforcement; the
    // C-T1 CI source-scan greps for it as a property assignment (not a
    // comment). Without this, a stolen user session token alone is
    // enough to mint pushes — see threat-model T5.7 / T-C.3.
    enforceAppCheck: true,
  },
  async (request) => {
    // 1. Auth — must reject UNAUTHENTICATED before any read.
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const callerUid = request.auth.uid;

    const db = getFirestore();

    // 2. Rate limit (M36). Runs FIRST after auth so a stolen session burst
    //    cannot fan out before the chore-doc reads cost us anything. The
    //    counter doc is a tiny tenant-private resource at
    //    `rateLimits/{kind}__{callerUid}`. We read-then-write (not
    //    increment-sentinel) because the C-T17 increment test asserts that
    //    the persisted `count` is a plain number after the call.
    const rateLimitRef = db.doc(`rateLimits/${KIND}__${callerUid}`);
    const now = Date.now();
    const rateLimitSnap = await rateLimitRef.get();
    // The Admin SDK exposes `.data()` as a method; the unit-test mock
    // exposes it as a property. Tolerate both so the implementation
    // works against the real SDK at runtime and the test fixtures.
    const prev = readSnap(rateLimitSnap) as
      | { count?: unknown; windowStartMs?: unknown }
      | undefined;
    const prevCount = typeof prev?.count === 'number' ? prev.count : 0;
    const prevWindowStart = typeof prev?.windowStartMs === 'number' ? prev.windowStartMs : 0;
    const withinWindow = now - prevWindowStart < RATE_LIMIT_WINDOW_MS;
    if (withinWindow && prevCount >= RATE_LIMIT_MAX_PER_WINDOW) {
      // Generic message — no enumeration oracle. The actor is told they
      // were limited but not the exact remaining window (M39).
      throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
    }
    const nextCount = withinWindow ? prevCount + 1 : 1;
    const nextWindowStart = withinWindow ? prevWindowStart : now;
    await rateLimitRef.set({ count: nextCount, windowStartMs: nextWindowStart });

    // 3. Caller users doc + isActive. Both missing-doc AND deactivated-doc
    //    surface as `permission-denied` so the response shape does NOT
    //    distinguish "you don't exist" from "you were deactivated" — that
    //    distinction would be a tenant-membership enumeration oracle (M39).
    const callerSnap = await db.doc(`users/${callerUid}`).get();
    if (!callerSnap.exists) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const caller = (readSnap(callerSnap) ?? {}) as { isActive?: unknown; familyId?: unknown };
    if (caller.isActive !== true || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const callerFamilyId = caller.familyId;

    // 4. Input validation. Reject with the canonical invalid-argument code
    //    for missing / non-string / empty `choreId`. We accept `data` being
    //    undefined and treat it as a missing-arg case.
    const data = (request.data ?? {}) as { choreId?: unknown };
    const choreId = data.choreId;
    if (typeof choreId !== 'string' || choreId.length === 0) {
      throw new HttpsError('invalid-argument', 'Invalid request.');
    }

    // 5. Chore doc + family match + state guard. Note: a chore in a
    //    different family is treated as permission-denied (not not-found)
    //    so the response cannot be used to probe foreign chore ids.
    const choreSnap = await db.doc(`chores/${choreId}`).get();
    if (!choreSnap.exists) {
      throw new HttpsError('not-found', 'Not found.');
    }
    const chore = (readSnap(choreSnap) ?? {}) as {
      familyId?: unknown;
      status?: unknown;
      assignedTo?: unknown;
    };
    if (chore.familyId !== callerFamilyId) {
      // Generic message — the foreign familyId never appears in the surfaced
      // error (M39 / C-T7 second assertion).
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    if (chore.status !== 'approved') {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    if (typeof chore.assignedTo !== 'string' || chore.assignedTo.length === 0) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const recipientUid = chore.assignedTo;

    // 6. Recipient cross-tenant guard (M35.7 / C-T8b). The recipient's
    //    `userPrivate/{uid}` doc's familyId must also match the caller —
    //    a chore could in principle reference an assignee outside the
    //    family in a corrupted state; we belt-and-suspenders the check.
    const recipientPrivateSnap = await db.doc(`userPrivate/${recipientUid}`).get();
    if (!recipientPrivateSnap.exists) {
      // Treat missing-recipient as a silent no-op (no PI to send to).
      logger.info('notifyChoreApproved: no recipient userPrivate', {
        kind: KIND,
        recipientCount: 0,
      });
      return { sent: 0, failed: 0 };
    }
    const recipientPrivate = (readSnap(recipientPrivateSnap) ?? {}) as {
      familyId?: unknown;
      notificationPreferences?: {
        pushEnabled?: unknown;
        categories?: { myChoreResolved?: unknown };
      };
    };
    if (recipientPrivate.familyId !== callerFamilyId) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }

    // 7. Recipient preferences. The category mute is part of the master
    //    contract — a kid who muted "my chores resolved" expects no push,
    //    full stop. Master `pushEnabled === false` short-circuits the
    //    category check.
    const prefs = recipientPrivate.notificationPreferences ?? {};
    if (prefs.pushEnabled !== true) {
      return { sent: 0, failed: 0 };
    }
    if (prefs.categories?.myChoreResolved !== true) {
      return { sent: 0, failed: 0 };
    }

    // 8. Fetch the recipient's FCM tokens. The subcollection list returns
    //    one entry per device. An empty list is a silent no-op.
    const tokenSnaps = await db.collection(`userPrivate/${recipientUid}/fcmTokens`).get();
    if (tokenSnaps.empty) {
      return { sent: 0, failed: 0 };
    }

    // Build the (tokenHash, token) pair list with deterministic order so
    // the per-response array maps 1:1 back to the source docs. The C-T13/14
    // delete-the-bad-token assertions depend on this mapping.
    const tokenEntries: Array<{ tokenHash: string; token: string }> = [];
    for (const docSnap of tokenSnaps.docs) {
      const tokenData = (readSnap(docSnap) ?? {}) as Partial<FcmTokenDoc>;
      if (typeof tokenData.token !== 'string' || tokenData.token.length === 0) {
        continue;
      }
      tokenEntries.push({ tokenHash: docSnap.id, token: tokenData.token });
    }
    if (tokenEntries.length === 0) {
      return { sent: 0, failed: 0 };
    }

    // 9. Send. The notification payload is the FROZEN constants from
    //    notificationBodies.ts — no template, no chore-doc fields, no PI.
    //    `data.url` is an opaque app route (no query string, no doc id
    //    that names PI). The C-T19 assertion stringifies the whole
    //    message and asserts no forbidden chore-PI substring appears.
    const tokens = tokenEntries.map((entry) => entry.token);
    const messaging = getMessaging();
    let result: MulticastResult;
    try {
      result = (await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: NOTIFICATION_BODIES.choreApproved.title,
          body: NOTIFICATION_BODIES.choreApproved.body,
        },
        data: { url: '/notifications' },
      })) as MulticastResult;
    } catch {
      // M39: never echo the raw FCM provider text (`messaging/server-
      // unavailable`, etc.) — a `messaging/*` code prefix is itself a
      // token-validity / config oracle. The generic 'internal' code +
      // generic message is all the client sees. The original error is
      // dropped on purpose (not even logged with the error object) so
      // nested `errorInfo` cannot leak credentials. We log a structured
      // generic message so the operator can correlate via the rest of
      // the allow-listed payload.
      logger.error('notifyChoreApproved: FCM send failed', {
        kind: KIND,
        recipientCount: tokenEntries.length,
      });
      throw new HttpsError('internal', 'Notification send failed.');
    }

    // 10. Stale-token cleanup (M37). Only the two pinned codes trigger
    //     deletion; transient codes leave the doc alone (the device will
    //     try again next send). The per-token response index aligns
    //     with `tokenEntries` because we built the tokens array from
    //     `tokenEntries` directly above.
    const responses = result.responses ?? [];
    let sent = 0;
    let failed = 0;
    const deletions: Promise<void>[] = [];
    for (let i = 0; i < tokenEntries.length; i += 1) {
      const entry = tokenEntries[i];
      const response = responses[i];
      if (!entry || !response) continue;
      if (response.success === true) {
        sent += 1;
      } else {
        failed += 1;
        const code = response.error?.code;
        if (typeof code === 'string' && FCM_STALE_TOKEN_CODES.has(code)) {
          deletions.push(
            db
              .doc(`userPrivate/${recipientUid}/fcmTokens/${entry.tokenHash}`)
              .delete()
              .then(() => undefined),
          );
        }
      }
    }
    if (deletions.length > 0) {
      await Promise.all(deletions);
    }

    // 11. Structured log (M38 allow-list — kind + counts only; no token
    //     bodies, no chore title, no recipient UID in raw form).
    logger.info('notifyChoreApproved: send complete', {
      kind: KIND,
      recipientCount: tokenEntries.length,
      tokensFailed: failed,
    });

    return { sent, failed };
  },
);
