/**
 * notifyTodoCreated — creator → assignee (PR D6).
 *
 * Single-recipient shape (mirrors `notifyChoreApproved`). Recipient =
 * `todo.assignedTo`. Self-assignment (`assignedTo == createdBy`) returns
 * the silent `no_tokens` skip — a kid who created their own todo
 * doesn't need a push from themselves.
 *
 * State guard: the todo doc must exist, must be in the caller's family,
 * and must carry a non-empty `assignedTo`. The complete/incomplete bit
 * is irrelevant — the test pins that the creation-side notification
 * runs regardless of `isCompleted`.
 *
 * Category: `familyTodos`. Body: frozen
 * `NOTIFICATION_BODIES.todoCreated`.
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

const KIND = 'todoCreated';
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

export const notifyTodoCreated = onCall(
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

    const data = (request.data ?? {}) as { todoId?: unknown };
    const todoId = data.todoId;
    if (typeof todoId !== 'string' || todoId.length === 0) {
      throw new HttpsError('invalid-argument', 'Invalid request.');
    }

    const todoSnap = await db.doc(`todos/${todoId}`).get();
    if (!todoSnap.exists) {
      throw new HttpsError('not-found', 'Not found.');
    }
    const todo = (readSnap(todoSnap) ?? {}) as {
      familyId?: unknown;
      assignedTo?: unknown;
      createdBy?: unknown;
    };
    if (todo.familyId !== callerFamilyId) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    if (typeof todo.assignedTo !== 'string' || todo.assignedTo.length === 0) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const recipientUid = todo.assignedTo;

    // Self-assignment guard — assigner notifying themselves is a noop.
    if (typeof todo.createdBy === 'string' && todo.createdBy === recipientUid) {
      logger.info('notifyTodoCreated: skip', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: 0,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return { sent: 0 as const, reason: 'no_tokens' as const };
    }

    const recipientPrivateSnap = await db.doc(`userPrivate/${recipientUid}`).get();
    if (!recipientPrivateSnap.exists) {
      logger.info('notifyTodoCreated: skip', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: 0,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return { sent: 0 as const, reason: 'no_tokens' as const };
    }
    const recipientPrivate = (readSnap(recipientPrivateSnap) ?? {}) as {
      familyId?: unknown;
      notificationPreferences?: {
        pushEnabled?: unknown;
        categories?: { familyTodos?: unknown };
      };
    };
    if (recipientPrivate.familyId !== callerFamilyId) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const prefs = recipientPrivate.notificationPreferences ?? {};
    if (prefs.pushEnabled !== true || prefs.categories?.familyTodos !== true) {
      logger.info('notifyTodoCreated: skip', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: 0,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return { sent: 0 as const, reason: 'opted_out' as const };
    }

    const tokenSnaps = await db.collection(`userPrivate/${recipientUid}/fcmTokens`).get();
    if (tokenSnaps.empty) {
      logger.info('notifyTodoCreated: skip', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: 0,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return { sent: 0 as const, reason: 'no_tokens' as const };
    }

    const tokenEntries: Array<{ tokenHash: string; token: string }> = [];
    for (const docSnap of tokenSnaps.docs) {
      const tokenData = (readSnap(docSnap) ?? {}) as Partial<FcmTokenDoc>;
      if (typeof tokenData.token !== 'string' || tokenData.token.length === 0) {
        continue;
      }
      tokenEntries.push({
        tokenHash: (docSnap as { id?: string }).id ?? '',
        token: tokenData.token,
      });
    }
    if (tokenEntries.length === 0) {
      logger.info('notifyTodoCreated: skip', {
        kind: KIND,
        familyId: callerFamilyId,
        actorUid: callerUid,
        recipientCount: 0,
        successCount: 0,
        cleanedTokenCount: 0,
        durationMs: Date.now() - startedAt,
      });
      return { sent: 0 as const, reason: 'no_tokens' as const };
    }

    const tokens = tokenEntries.map((entry) => entry.token);
    const messaging = getMessaging();
    let result: MulticastResult;
    try {
      result = (await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: NOTIFICATION_BODIES.todoCreated.title,
          body: NOTIFICATION_BODIES.todoCreated.body,
        },
        data: { url: '/notifications' },
      })) as MulticastResult;
    } catch {
      logger.error('notifyTodoCreated: FCM send failed', {
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
            .doc(`userPrivate/${recipientUid}/fcmTokens/${entry.tokenHash}`)
            .delete()
            .then(() => undefined),
        );
      }
    }
    if (deletions.length > 0) {
      await Promise.all(deletions);
    }

    logger.info('notifyTodoCreated: send complete', {
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
