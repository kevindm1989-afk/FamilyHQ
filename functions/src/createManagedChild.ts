/**
 * createManagedChild — parent-only HTTPS-callable (ADR-0003 Option C;
 * docs/specs/managed-child-accounts.md §5).
 *
 * Creates an EMAIL-LESS child account: the Admin SDK mints the child's Auth
 * user with a parent-set password and a synthetic, non-routable address, then
 * atomically writes the child's `users/{uid}` (role 'member',
 * accountType 'managed') + `userPrivate/{uid}` docs. Because the Admin SDK
 * bypasses Firestore rules, no client bootstrap rule is needed and the parent's
 * own session is never disturbed (client-SDK user creation would sign the
 * parent out — ADR-0003 Option A, rejected).
 *
 * The child later signs in with `family.loginCode` + `loginHandle` + password,
 * which the client composes into `${handle}@${loginCode}.familyhq.invalid`.
 * `.invalid` is the IETF-reserved TLD (RFC 2606): it can never exist in DNS, so
 * "no email to/about a child" is a STRUCTURAL guarantee, not a policy promise —
 * and this path invokes no email subprocessor.
 *
 * Trust derivation order (cheapest checks first, mirrors notifyChoreApproved):
 *   1. `request.auth` present. App Check enforced at the platform layer via the
 *      LITERAL `enforceAppCheck: true` (CI source-scan asserts it).
 *   2. Rate limit (5 / hour) at `rateLimits/createChild__{callerUid}` — bumped
 *      FIRST after auth so a stolen session can't fan out before any reads cost
 *      us. Same `{count, windowStartMs}` transactional shape as the notify-*
 *      callables.
 *   3. Caller `users/{uid}` exists, `isActive == true`, `role == 'parent'`.
 *   4. Validate input: displayName (1..50), handle (^[a-z0-9]{2,20}$),
 *      password (length >= 8).
 *   5. One family-scoped read of `users` → enforce the per-family member cap
 *      (< 12 active) AND handle-uniqueness within the family.
 *   6. Ensure `families/{fam}.loginCode` — generate + reserve a globally-unique
 *      slug in a transaction (`familyLoginCodes/{code}`) on first child.
 *   7. `adminAuth.createUser` with the synthetic address + parent-set password.
 *   8. Atomic batch: `users/{childUid}` + `userPrivate/{childUid}`.
 *   9. Compensation: if the batch throws, delete the orphaned Auth user.
 *  10. PI-free structured log (kind/familyId/actorUid/durationMs ONLY — never
 *      the handle, display name, synthetic email, or password).
 *  11. Return `{ childUid, loginCode, handle }` (the parent tells the child the
 *      code + handle; they already set the password — it is never returned).
 *
 * Errors are canonical HttpsError codes with GENERIC messages (no PI, no raw
 * Firebase codes): unauthenticated / resource-exhausted / permission-denied /
 * invalid-argument / already-exists / failed-precondition / internal.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps } from 'firebase-admin/app';
import { randomInt } from 'node:crypto';

if (getApps().length === 0) {
  initializeApp();
}

const KIND = 'createChild';
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_PER_WINDOW = 5;

/** Per-family cap on active members (abuse containment, M-series). */
const MAX_ACTIVE_MEMBERS_PER_FAMILY = 12;
const MIN_PASSWORD_LENGTH = 8;
const HANDLE_RE = /^[a-z0-9]{2,20}$/;
const LOGIN_CODE_LENGTH = 6;
// DNS-label-safe alphabet (lowercase + digits). ~31 bits over 6 chars.
const LOGIN_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LOGIN_CODE_RESERVE_ATTEMPTS = 8;

/**
 * The child's synthetic address suffix. `.invalid` (RFC 2606) can never resolve
 * in DNS. MUST stay in lockstep with the client composer
 * (src/features/family/managedChildService.ts `composeChildLoginEmail`); both
 * sides are pinned by tests.
 */
const CHILD_EMAIL_DOMAIN_SUFFIX = 'familyhq.invalid';

/** Tolerant snapshot read — Admin `.data()` is a method; the test mock a prop. */
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

function generateLoginCode(): string {
  let code = '';
  for (let i = 0; i < LOGIN_CODE_LENGTH; i += 1) {
    code += LOGIN_CODE_ALPHABET[randomInt(0, LOGIN_CODE_ALPHABET.length)];
  }
  return code;
}

export function composeChildEmail(loginCode: string, handle: string): string {
  return `${handle}@${loginCode}.${CHILD_EMAIL_DOMAIN_SUFFIX}`;
}

export const createManagedChild = onCall(
  {
    region: 'northamerica-northeast1',
    // App Check is mandatory. The LITERAL `enforceAppCheck: true` is the
    // structural enforcement; the CI source-scan greps for it as a property
    // assignment. Without it a stolen user session alone could mint accounts.
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

    // 2. Rate limit FIRST (M36). Same transactional {count, windowStartMs}
    //    shape as the notify-* callables — two concurrent bursts from one
    //    caller can't both read N and write N+1.
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

    // 3. Caller must be an ACTIVE PARENT. Missing-doc and non-parent both
    //    surface as permission-denied (no membership/role enumeration oracle).
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

    // 4. Validate input. Generic messages — the invalid value is never echoed.
    const data = (request.data ?? {}) as {
      displayName?: unknown;
      handle?: unknown;
      password?: unknown;
    };
    const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
    const handle = typeof data.handle === 'string' ? data.handle : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (displayName.length < 1 || displayName.length > 50) {
      throw new HttpsError('invalid-argument', 'Please enter a name (1–50 characters).');
    }
    if (!HANDLE_RE.test(handle)) {
      throw new HttpsError('invalid-argument', 'Usernames use 2–20 lowercase letters or numbers.');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpsError('invalid-argument', 'Passwords need at least 8 characters.');
    }

    // 5. ONE family-scoped read: enforce the member cap AND handle-uniqueness.
    //    Family-scale (< cap) so reading the member docs is cheap.
    const familyUsersSnap = await db.collection('users').where('familyId', '==', familyId).get();
    let activeCount = 0;
    let handleTaken = false;
    for (const docSnap of familyUsersSnap.docs) {
      const u = (readSnap(docSnap) ?? {}) as { isActive?: unknown; loginHandle?: unknown };
      if (u.isActive === true) activeCount += 1;
      if (u.loginHandle === handle) handleTaken = true;
    }
    if (activeCount >= MAX_ACTIVE_MEMBERS_PER_FAMILY) {
      throw new HttpsError('failed-precondition', 'This family has reached its member limit.');
    }
    if (handleTaken) {
      throw new HttpsError('already-exists', 'That username is already taken in your family.');
    }

    // 6. Ensure the family has a loginCode. Generated + globally reserved in a
    //    transaction on first child; both `familyLoginCodes/{code}` and
    //    `families/{fam}.loginCode` are written atomically.
    const familySnap = await db.doc(`families/${familyId}`).get();
    const existingCode = (readSnap(familySnap) ?? {}).loginCode;
    let loginCode: string;
    if (typeof existingCode === 'string' && existingCode.length > 0) {
      loginCode = existingCode;
    } else {
      loginCode = await reserveUniqueLoginCode(db, familyId);
    }

    // 7. Create the Auth user server-side. The synthetic address never receives
    //    mail (`.invalid`); emailVerified stays false.
    const syntheticEmail = composeChildEmail(loginCode, handle);
    let childUid: string;
    try {
      const created = await getAuth().createUser({
        email: syntheticEmail,
        password,
        emailVerified: false,
        displayName,
      });
      childUid = created.uid;
    } catch {
      // Never echo the raw Firebase code (it could reveal collisions). A
      // duplicate synthetic email means the (loginCode,handle) pair already
      // exists — but the step-5 handle check already covers the in-family
      // case, so this is an unexpected state → generic internal error.
      throw new HttpsError('internal', 'We could not create the account. Please try again.');
    }

    // 8. Atomic Firestore write. Shape mirrors the invite flow exactly (an
    //    invited member and a managed child differ only by accountType +
    //    loginHandle). userPrivate is {email, familyId} only — notification
    //    preferences default at read time (safe-by-default, master-off), same
    //    as every pre-push user.
    try {
      const batch = db.batch();
      batch.set(db.doc(`users/${childUid}`), {
        name: displayName,
        role: 'member',
        familyId,
        isActive: true,
        allowanceBalance: 0,
        theme: 'light',
        accountType: 'managed',
        loginHandle: handle,
      });
      batch.set(db.doc(`userPrivate/${childUid}`), {
        email: syntheticEmail,
        familyId,
      });
      await batch.commit();
    } catch {
      // 9. Compensation — remove the orphaned Auth user so a failed doc write
      //    never leaves a sign-in-able account with no family membership.
      try {
        await getAuth().deleteUser(childUid);
      } catch {
        // Best-effort cleanup; swallow so the caller still gets a clean error.
      }
      throw new HttpsError(
        'internal',
        'We could not finish creating the account. Please try again.',
      );
    }

    // 10. PI-free structured log (allow-list only).
    logger.info('createManagedChild: created', {
      kind: KIND,
      familyId,
      actorUid: callerUid,
      durationMs: Date.now() - startedAt,
    });

    // 11. Return the sign-in coordinates (never the password).
    return { childUid, loginCode, handle };
  },
);

/**
 * Reserve a globally-unique family loginCode. Generates a candidate and, in a
 * transaction, claims `familyLoginCodes/{code}` iff it does not already exist,
 * and writes `families/{fam}.loginCode` in the same transaction. Retries on
 * collision. Throws `resource-exhausted` if it cannot find a free code — with a
 * 36^6 space and family-scale volume this is effectively unreachable.
 */
async function reserveUniqueLoginCode(
  db: FirebaseFirestore.Firestore,
  familyId: string,
): Promise<string> {
  for (let attempt = 0; attempt < LOGIN_CODE_RESERVE_ATTEMPTS; attempt += 1) {
    const candidate = generateLoginCode();
    const codeRef = db.doc(`familyLoginCodes/${candidate}`);
    const familyRef = db.doc(`families/${familyId}`);

    const claimed = await db.runTransaction(async (tx) => {
      const existing = await tx.get(codeRef);
      if (existing.exists) return false;
      tx.set(codeRef, { familyId });
      tx.set(familyRef, { loginCode: candidate }, { merge: true });
      return true;
    });
    if (claimed) return candidate;
  }
  throw new HttpsError('resource-exhausted', 'Could not allocate a family code. Please try again.');
}
