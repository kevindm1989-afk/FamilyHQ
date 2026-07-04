/**
 * resetManagedChildPassword — parent-only HTTPS-callable (ADR-0003 Option C;
 * docs/specs/managed-child-accounts.md §5).
 *
 * A managed child has no email, so the Firebase self-serve password-reset flow
 * cannot reach them. A same-family active parent resets the child's password
 * here via the Admin SDK. Without this, a child who forgets their password is
 * permanently locked out — a high support burden — so it ships in v1.
 *
 * Trust derivation order (mirrors createManagedChild / notifyChoreApproved):
 *   1. `request.auth` present; App Check enforced by the LITERAL
 *      `enforceAppCheck: true` (CI source-scan asserts it).
 *   2. Rate limit (10 / hour) at `rateLimits/resetChildPw__{callerUid}`.
 *   3. Caller `users/{uid}` exists, `isActive == true`, `role == 'parent'`.
 *   4. Validate input: childUid (non-empty string), newPassword (length >= 8).
 *   5. Target `users/{childUid}` exists, same family as the caller, and
 *      `accountType == 'managed'` (a parent can only reset a MANAGED child —
 *      never a co-parent's or standard member's credential).
 *   6. `adminAuth.updateUser(childUid, { password })`.
 *   7. PI-free structured log; return `{ ok: true }`.
 *
 * All failure branches surface generic HttpsError codes with no PI and no raw
 * Firebase codes.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase-admin/app';

if (getApps().length === 0) {
  initializeApp();
}

const KIND = 'resetChildPw';
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_PER_WINDOW = 10;
const MIN_PASSWORD_LENGTH = 8;

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

export const resetManagedChildPassword = onCall(
  {
    region: 'northamerica-northeast1',
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

    // 2. Rate limit FIRST.
    const rateLimitRef = db.doc(`rateLimits/${KIND}__${callerUid}`);
    const now = Date.now();
    const limitTripped = await db.runTransaction(async (tx) => {
      const prev = readSnap(await tx.get(rateLimitRef)) as
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

    // 3. Caller must be an ACTIVE PARENT.
    const callerSnap = await db.doc(`users/${callerUid}`).get();
    if (!callerSnap.exists) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const caller = (readSnap(callerSnap) ?? {}) as {
      isActive?: unknown;
      familyId?: unknown;
      role?: unknown;
    };
    if (
      caller.isActive !== true ||
      caller.role !== 'parent' ||
      typeof caller.familyId !== 'string'
    ) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const familyId = caller.familyId;

    // 4. Validate input.
    const data = (request.data ?? {}) as { childUid?: unknown; newPassword?: unknown };
    const childUid = typeof data.childUid === 'string' ? data.childUid : '';
    const newPassword = typeof data.newPassword === 'string' ? data.newPassword : '';
    if (childUid.length === 0) {
      throw new HttpsError('invalid-argument', 'Invalid request.');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpsError('invalid-argument', 'Passwords need at least 8 characters.');
    }

    // 5. Target must be a MANAGED child in the caller's family. A cross-family
    //    target, a non-managed member, or a parent is permission-denied — the
    //    generic code prevents probing which condition failed.
    const childSnap = await db.doc(`users/${childUid}`).get();
    if (!childSnap.exists) {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }
    const child = (readSnap(childSnap) ?? {}) as { familyId?: unknown; accountType?: unknown };
    if (child.familyId !== familyId || child.accountType !== 'managed') {
      throw new HttpsError('permission-denied', 'Not permitted.');
    }

    // 6. Reset the password via the Admin SDK.
    try {
      await getAuth().updateUser(childUid, { password: newPassword });
    } catch {
      throw new HttpsError('internal', 'We could not reset the password. Please try again.');
    }

    // 7. PI-free log + response.
    logger.info('resetManagedChildPassword: reset', {
      kind: KIND,
      familyId,
      actorUid: callerUid,
      durationMs: Date.now() - startedAt,
    });

    return { ok: true as const };
  },
);
