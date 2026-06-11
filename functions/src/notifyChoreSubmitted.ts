/**
 * notifyChoreSubmitted — kid → all parents (PR D1).
 *
 * Mirrors `notifyChoreApproved` (PR C) verbatim — same 13-step trust
 * derivation, same `readSnap` helper, same `runTransaction`-wrapped rate
 * limit, same stale-token cleanup, same M38 logger allow-list, same M39
 * response shape, same `enforceAppCheck: true` literal, same
 * `region: 'northamerica-northeast1'`.
 *
 * Differences from chore-approved:
 *   - Recipients = every active parent in the chore's family (server
 *     re-derives via a `users where familyId == X and role == 'parent'
 *     and isActive == true` query). The submitter is excluded when they
 *     themselves are a parent (parent-double-account guard).
 *   - State guard: `chore.status == 'complete'`.
 *   - Category key: `choreApprovalsNeeded`.
 *   - Notification copy: `NOTIFICATION_BODIES.choreSubmitted`.
 *   - Multi-recipient fan-out: ONE `sendEachForMulticast` over the
 *     aggregated token list, with a per-token recipient mapping kept
 *     so the stale-token cleanup deletes the right doc.
 *
 * Logging: structured `firebase-functions/logger` only, M38 allow-list
 * (kind, familyId, actorUid, recipientCount, successCount,
 * cleanedTokenCount, durationMs). No token bodies, no chore-doc PI, no
 * FCM error codes.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { initializeApp, getApps } from 'firebase-admin/app';
import { NOTIFICATION_BODIES } from './notificationBodies.js';

if (getApps().length === 0) {
  initializeApp();
}

const KIND = 'choreSubmitted';
const CATEGORY_KEY = 'choreApprovalsNeeded';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 10;
const FCM_STALE_TOKEN_CODES = new Set<string>([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

interface FcmTokenDoc {
  token: string;
}

/** Tolerate both the real Admin SDK (`.data()` is a method) and the unit-test mock (`data` is a property). */
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

interface SendResponse {
  success: boolean;
  error?: { code?: string } | undefined;
}

interface MulticastResult {
  successCount?: number;
  failureCount?: number;
  responses: SendResponse[];
}

export const notifyChoreSubmitted = onCall(
  {
    region: 'northamerica-northeast1',
    // M32 — App Check enforced inline (C-T1 source scan).
    enforceAppCheck: true,
  },
  async (request) => {
    const startedAt = Date.now();

    // 1. Auth.
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const callerUid = request.auth.uid;

    const db = getFirestore();

    // 2. Rate limit (M36) wrapped in a transaction so two concurrent
    //    invocations from the same caller can't both pass the cap.
    const rateLimitRef = db.doc(`rateLimits/${KIND}__${callerUid}`);
    const now = Date.now();
    const limitTripped = await db.runTransaction(async (tx) => {
      const rateLimitSnap = await tx.get(rateLimitRef);
      const prev = readSnap(rateLimitSnap) as
        | { count?: unknown; windowStartMs?: unknown }
        | undefined;
      const prevCount = typeof prev?.count === 'number' ? prev.count : 0;
      const prevWindowStart = typeof prev?.windowStartMs === 'number' ? prev.windowStartMs : 0;
      const withinWindow = now - prevWindowStart < RATE_LIMIT_WINDOW_MS;
      if (withinWindow && prevCount >= RATE_LIMIT_MAX_PER_WINDOW) {
        return true;
      }
      const nextCount = withinWindow ? prevCount + 1 : 1;
      const nextWindowStart = withinWindow ? prevWindowStart : now;
      // expiresAt = window-start + 7 days (Firestore TTL retention bound,
      // privacy review Fix 2).
      tx.set(rateLimitRef, {
        count: nextCount,
        windowStartMs: nextWindowStart,
        expiresAt: nextWindowStart + 7 * 24 * 60 * 60 * 1000,
      });
      return false;
    });
    if (limitTripped) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
    }

    // 3. Caller users doc + isActive.
    const callerSnap = await db.doc(`users/${callerUid}`).get();
    if (!callerSnap.exists) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const caller = (readSnap(callerSnap) ?? {}) as {
      isActive?: unknown;
      familyId?: unknown;
      role?: unknown;
    };
    if (caller.isActive !== true || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const callerFamilyId = caller.familyId;

    // 4. Input validation.
    const data = (request.data ?? {}) as { choreId?: unknown };
    const choreId = data.choreId;
    if (typeof choreId !== 'string' || choreId.length === 0) {
      throw new HttpsError('invalid-argument', 'Invalid request.');
    }

    // 5. Chore doc + family match + state guard.
    const choreSnap = await db.doc(`chores/${choreId}`).get();
    if (!choreSnap.exists) {
      throw new HttpsError('not-found', 'Not found.');
    }
    const chore = (readSnap(choreSnap) ?? {}) as {
      familyId?: unknown;
      status?: unknown;
    };
    if (chore.familyId !== callerFamilyId) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    if (chore.status !== 'complete') {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }

    // 6. Derive recipients = every active parent in the family, excluding
    //    the submitter (parent-double-account guard).
    const parentSnaps = await db
      .collection('users')
      .where('familyId', '==', callerFamilyId)
      .where('role', '==', 'parent')
      .where('isActive', '==', true)
      .get();
    const recipientUids: string[] = [];
    for (const userSnap of parentSnaps.docs) {
      const uid = (userSnap as { id?: string }).id;
      if (typeof uid === 'string' && uid.length > 0 && uid !== callerUid) {
        recipientUids.push(uid);
      }
    }

    // 7. Per-recipient cross-tenant + preference checks. Build the
    //    aggregated token list with per-token recipient mapping so the
    //    stale-token cleanup deletes the right doc (M37).
    const tokenEntries: Array<{ tokenHash: string; token: string; recipientUid: string }> = [];
    let anyHadTokens = false;
    let anyOptedOut = false;
    for (const recipientUid of recipientUids) {
      const recipientPrivateSnap = await db.doc(`userPrivate/${recipientUid}`).get();
      if (!recipientPrivateSnap.exists) {
        // Missing userPrivate is treated as no-tokens for THIS recipient;
        // do not error out the whole multicast (silent drop).
        continue;
      }
      const recipientPrivate = (readSnap(recipientPrivateSnap) ?? {}) as {
        familyId?: unknown;
        notificationPreferences?: {
          pushEnabled?: unknown;
          categories?: Record<string, unknown> | undefined;
        };
      };
      // Per-recipient cross-tenant guard (M35.7). Multi-recipient
      // callable: a single corrupt/stale userPrivate doc must NOT
      // DoS the entire multicast — skip the recipient + warn (server
      // log only, M38 allow-list). Pinned by SOR Concern 3 / Fix 6.
      if (recipientPrivate.familyId !== callerFamilyId) {
        logger.warn('notifyChoreSubmitted: recipient skipped — userPrivate familyId mismatch', {
          kind: KIND,
          familyId: callerFamilyId,
          actorUid: callerUid,
        });
        continue;
      }
      const prefs = recipientPrivate.notificationPreferences ?? {};
      const pushEnabled = prefs.pushEnabled === true;
      const categoryOn = prefs.categories?.[CATEGORY_KEY] === true;
      if (!pushEnabled || !categoryOn) {
        anyOptedOut = true;
        continue;
      }
      const tokenSnaps = await db.collection(`userPrivate/${recipientUid}/fcmTokens`).get();
      if (tokenSnaps.empty) {
        continue;
      }
      for (const tokenDoc of tokenSnaps.docs) {
        const tokenData = (readSnap(tokenDoc) ?? {}) as Partial<FcmTokenDoc>;
        if (typeof tokenData.token !== 'string' || tokenData.token.length === 0) {
          continue;
        }
        anyHadTokens = true;
        tokenEntries.push({
          tokenHash: (tokenDoc as { id?: string }).id ?? '',
          token: tokenData.token,
          recipientUid,
        });
      }
    }

    if (tokenEntries.length === 0) {
      // Skip reason classification stays SERVER-SIDE only (privacy
      // review Fix 1 — preference-enumeration oracle). Response shape
      // is uniform across all skip branches.
      const skipReason = anyOptedOut ? 'opted_out' : 'no_tokens';
      logger.info('notifyChoreSubmitted: skip', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: 0,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
        skipReason,
      });
      return { sent: 0 as const, cleaned: 0 as const };
    }
    // `anyHadTokens` already implied by tokenEntries.length > 0; pin to
    // suppress unused-var lints in strict builds.
    void anyHadTokens;

    // 8. Single multicast across the aggregated token list. M39: any
    //    throw is surfaced as the generic `send_failed` skip — never
    //    rethrown, never echoing the raw provider text.
    const tokens = tokenEntries.map((entry) => entry.token);
    const messaging = getMessaging();
    let result: MulticastResult;
    try {
      result = (await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: NOTIFICATION_BODIES.choreSubmitted.title,
          body: NOTIFICATION_BODIES.choreSubmitted.body,
        },
        data: { url: '/notifications' },
      })) as MulticastResult;
    } catch {
      logger.error('notifyChoreSubmitted: FCM send failed', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: tokenEntries.length,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
        skipReason: 'send_failed',
      });
      return { sent: 0 as const, cleaned: 0 as const };
    }

    // 9. Stale-token cleanup (M37) — per-token mapping points back to the
    //    specific recipient's fcmTokens doc. Transient codes are left
    //    alone (the device retries on next send).
    const responses = result.responses ?? [];
    let sent = 0;
    let cleaned = 0;
    const deletions: Promise<void>[] = [];
    for (let i = 0; i < tokenEntries.length; i += 1) {
      const entry = tokenEntries[i];
      const response = responses[i];
      if (!entry || !response) continue;
      if (response.success === true) {
        sent += 1;
        continue;
      }
      const code = response.error?.code;
      if (typeof code === 'string' && FCM_STALE_TOKEN_CODES.has(code)) {
        cleaned += 1;
        deletions.push(
          db
            .doc(`userPrivate/${entry.recipientUid}/fcmTokens/${entry.tokenHash}`)
            .delete()
            .then(() => undefined),
        );
      }
    }
    if (deletions.length > 0) {
      await Promise.all(deletions);
    }

    // 10. Structured log (M38 allow-list).
    logger.info('notifyChoreSubmitted: send complete', {
      kind: KIND,
      familyId: callerFamilyId,
      actorUid: callerUid,
      recipientCount: tokenEntries.length,
      successCount: sent,
      cleanedTokenCount: cleaned,
      durationMs: Date.now() - startedAt,
    });

    return { sent, cleaned };
  },
);
