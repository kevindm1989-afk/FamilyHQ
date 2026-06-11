/**
 * notifyBoardPost — author → every other family member (PR D5).
 *
 * Mirrors `notifyChoreSubmitted` structurally — multi-recipient fan-out,
 * one aggregated multicast, per-token recipient mapping for stale-token
 * cleanup.
 *
 * Differences:
 *   - Source doc: `posts/{postId}` with `{authorId, familyId}`.
 *   - State guard: the caller must equal `post.authorId` (forged-author
 *     defense; the client cannot ghost-post as someone else).
 *   - Recipient set: every active user in the family EXCEPT the author
 *     (server re-derives; the `EXCEPT-author` filter is server-side so
 *     a malicious client can't smuggle themselves out of an exclusion
 *     list).
 *   - Category: `familyBoardPosts`.
 *   - Body: `NOTIFICATION_BODIES.familyBoardPost` (no author name, no
 *     post content — M34 + design D5).
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

const KIND = 'familyBoardPost';
const CATEGORY_KEY = 'familyBoardPosts';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 10;
const FCM_STALE_TOKEN_CODES = new Set<string>([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

interface FcmTokenDoc {
  token: string;
}

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

export const notifyBoardPost = onCall(
  {
    region: 'northamerica-northeast1',
    enforceAppCheck: true,
  },
  async (request) => {
    const startedAt = Date.now();

    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const callerUid = request.auth.uid;

    const db = getFirestore();

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
      tx.set(rateLimitRef, { count: nextCount, windowStartMs: nextWindowStart });
      return false;
    });
    if (limitTripped) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
    }

    const callerSnap = await db.doc(`users/${callerUid}`).get();
    if (!callerSnap.exists) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const caller = (readSnap(callerSnap) ?? {}) as { isActive?: unknown; familyId?: unknown };
    if (caller.isActive !== true || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const callerFamilyId = caller.familyId;

    const data = (request.data ?? {}) as { postId?: unknown };
    const postId = data.postId;
    if (typeof postId !== 'string' || postId.length === 0) {
      throw new HttpsError('invalid-argument', 'Invalid request.');
    }

    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) {
      throw new HttpsError('not-found', 'Not found.');
    }
    const post = (readSnap(postSnap) ?? {}) as {
      familyId?: unknown;
      authorId?: unknown;
    };
    if (post.familyId !== callerFamilyId) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    // Forged-author guard: the caller MUST be the author. Defense-in-
    // depth against a client invoking the callable on someone else's
    // behalf (M35).
    if (post.authorId !== callerUid) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }

    // Recipients = every active user in the family EXCEPT the author.
    const userSnaps = await db
      .collection('users')
      .where('familyId', '==', callerFamilyId)
      .where('isActive', '==', true)
      .get();
    const recipientUids: string[] = [];
    for (const userSnap of userSnaps.docs) {
      const uid = (userSnap as { id?: string }).id;
      if (typeof uid === 'string' && uid.length > 0 && uid !== callerUid) {
        recipientUids.push(uid);
      }
    }

    const tokenEntries: Array<{ tokenHash: string; token: string; recipientUid: string }> = [];
    let anyOptedOut = false;
    for (const recipientUid of recipientUids) {
      const recipientPrivateSnap = await db.doc(`userPrivate/${recipientUid}`).get();
      if (!recipientPrivateSnap.exists) {
        continue;
      }
      const recipientPrivate = (readSnap(recipientPrivateSnap) ?? {}) as {
        familyId?: unknown;
        notificationPreferences?: {
          pushEnabled?: unknown;
          categories?: Record<string, unknown> | undefined;
        };
      };
      if (recipientPrivate.familyId !== callerFamilyId) {
        throw new HttpsError('permission-denied', 'Not permitted.');
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
        tokenEntries.push({
          tokenHash: (tokenDoc as { id?: string }).id ?? '',
          token: tokenData.token,
          recipientUid,
        });
      }
    }

    if (tokenEntries.length === 0) {
      const reason = anyOptedOut ? 'opted_out' : 'no_tokens';
      logger.info('notifyBoardPost: skip', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: 0,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return { sent: 0 as const, reason: reason as 'opted_out' | 'no_tokens' };
    }

    const tokens = tokenEntries.map((entry) => entry.token);
    const messaging = getMessaging();
    let result: MulticastResult;
    try {
      result = (await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: NOTIFICATION_BODIES.familyBoardPost.title,
          body: NOTIFICATION_BODIES.familyBoardPost.body,
        },
        data: { url: '/notifications' },
      })) as MulticastResult;
    } catch {
      logger.error('notifyBoardPost: FCM send failed', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: tokenEntries.length,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return { sent: 0 as const, reason: 'send_failed' as const };
    }

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

    logger.info('notifyBoardPost: send complete', {
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
