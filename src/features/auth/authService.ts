/**
 * Auth + tenant bootstrap service (Task 4, ADR-0006).
 *
 * `signUpFoundingParent` is the ONLY client path that self-assigns
 * role:'parent'. It creates the Auth user, then atomically writes exactly one
 * `families` doc + one parent `users` doc in a single writeBatch. The
 * server-side rules (test/rules/signup-bootstrap.test.ts, tests A-G) prove the
 * self-create is non-generalizable; this service is the well-behaved client.
 *
 * Errors are mapped to user-safe, PII-free messages here (constraints "No PII
 * in error messages") — raw Firebase codes and the email never surface.
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  type Auth,
  type UserCredential,
} from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  doc,
  terminate,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

export interface SignUpInput {
  familyName: string;
  name: string;
  email: string;
  password: string;
}

export interface SignUpResult {
  uid: string;
  familyId: string;
}

/** A generic, user-safe error — never leaks a raw Firebase code or PII. */
export class AuthActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthActionError';
  }
}

const GENERIC_SIGNUP_ERROR =
  'We could not create your account. Please check your details and try again.';
const ALREADY_SIGNED_IN_ERROR = 'You are already signed in. Sign out before creating a new family.';

/**
 * Generate an opaque family id. Uses the Web Crypto UUID when available and a
 * non-crypto fallback otherwise (the id is a public document key, not a
 * secret — security lives in firestore.rules, not in id unguessability).
 */
function newFamilyId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `fam_${cryptoObj.randomUUID()}`;
  }
  return `fam_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function signUpFoundingParent(
  deps: { auth: Auth; db: Firestore },
  input: SignUpInput,
): Promise<SignUpResult> {
  const { auth, db } = deps;

  // No second-family bootstrap: an already-authenticated user must not be able
  // to mint a new family for themselves (ADR-0006 property 2 is enforced
  // server-side; this is the matching client guard).
  if (auth.currentUser) {
    throw new AuthActionError(ALREADY_SIGNED_IN_ERROR);
  }

  let uid: string;
  try {
    const credential = await createUserWithEmailAndPassword(auth, input.email, input.password);
    uid = credential.user.uid;
  } catch {
    // Swallow the raw Firebase error (it carries the auth/* code and the
    // email) and surface a generic message.
    throw new AuthActionError(GENERIC_SIGNUP_ERROR);
  }

  const familyId = newFamilyId();
  const createdAt = Date.now();

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'families', familyId), {
      familyName: input.familyName,
      createdBy: uid,
      createdAt,
    });
    // Privacy finding 2: the family-readable users doc carries NO email. Adult
    // email [PI] lives on the per-subject userPrivate/{uid} doc, written in this
    // SAME atomic batch so there is never an orphaned/missing email.
    batch.set(doc(db, 'users', uid), {
      name: input.name,
      role: 'parent',
      familyId,
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
    });
    batch.set(doc(db, 'userPrivate', uid), {
      email: input.email,
      familyId,
    });
    await batch.commit();
  } catch {
    // The batch is atomic — a failed commit writes neither doc, so there is no
    // orphan family/user to clean up. Surface a generic error.
    throw new AuthActionError(GENERIC_SIGNUP_ERROR);
  }

  return { uid, familyId };
}

export async function signIn(
  deps: { auth: Auth },
  email: string,
  password: string,
): Promise<UserCredential> {
  return signInWithEmailAndPassword(deps.auth, email, password);
}

export async function sendPasswordReset(deps: { auth: Auth }, email: string): Promise<void> {
  await sendPasswordResetEmail(deps.auth, email);
}

/**
 * CONTRACT STUB (M19, P6 — security finding 2 / privacy finding 1, CRITICAL;
 * adversarial review Findings 2 & 3).
 *
 * On sign-out (and on account switch) the on-device IndexedDB Firestore cache —
 * which may hold another family's children's PI — MUST be cleared so the next
 * user on a shared device cannot read stale family data.
 *
 * Required behavior (pinned by signOut.test.ts):
 *  1. call Firebase `signOut(auth)` FIRST (revoke the live session),
 *  2. then `terminate(db)` (stop the Firestore client so the cache can be
 *     released — clearIndexedDbPersistence rejects on a running client),
 *  3. then `clearIndexedDbPersistence(db)` (wipe the on-device cache),
 *  4. then `deps.reload()` — force a full page reload AFTER the cache is
 *     cleared, so a FRESH Firestore client is constructed (the terminated
 *     singleton is otherwise unusable and could be reused; Finding 2). The
 *     reload is injected (not a direct `window.location` touch) so it is
 *     unit-testable.
 *  in that exact order.
 *
 * If `signOut` itself fails, cache clearing MUST STILL run (a failed sign-out
 * must not leave child PI on the device); the rejection is surfaced after the
 * cache is cleared. The reload still fires on the clean-clear path.
 */
export interface SignOutDeps {
  auth: Auth;
  db: Firestore;
  /** Force a full page reload (fresh Firestore client) AFTER the cache clear. */
  reload: () => void;
}

export async function signOutAndClearCache(deps: SignOutDeps): Promise<void> {
  const { auth, db } = deps;

  // Capture (do not yet throw) a sign-out failure: the cache MUST still be
  // cleared so a failed sign-out never leaves another family's children's PI on
  // a shared device. The rejection is surfaced after the cache is cleared.
  let signOutError: unknown;
  try {
    await signOut(auth);
  } catch (e) {
    signOutError = e;
  }

  // terminate() stops the Firestore client; clearIndexedDbPersistence rejects
  // on a running client, so the order is fixed: terminate THEN clear.
  await terminate(db);
  await clearIndexedDbPersistence(db);

  // Finding 2: force a full page reload AFTER the cache is cleared so a FRESH
  // Firestore client is constructed — the terminated singleton is unusable and
  // must never be reused. The reload fires even on the clean-clear path; the
  // captured signOut rejection is surfaced afterward.
  deps.reload();

  if (signOutError !== undefined) {
    throw signOutError;
  }
}

/**
 * Startup uid-guard (M19, P6 — adversarial review Finding 3 + Finding A).
 *
 * Closes the non-graceful-session-end stale-cache leak: if the previous session
 * ended WITHOUT routing through signOutAndClearCache (tab killed, crash, token
 * expiry), the IndexedDB cache may still hold the prior user's family PI. On app
 * startup, before Firestore is used for a session, compare the authenticated uid
 * to a persisted "last cached uid" marker:
 *  - if a prior uid is recorded AND it differs from `currentUid` →
 *    `clearIndexedDbPersistence(db)` BEFORE returning (wipe the foreign cache),
 *  - then record `currentUid` via `setLastUid` (confirmed session marker),
 *  - if the uid is the SAME as the marker → do NOT clear (warm cache reuse is
 *    safe; same user),
 *  - if there is NO prior uid → do NOT clear, but still record the marker.
 *
 * The marker is persisted in localStorage by the wiring (the implementer);
 * get/set are injected here so the unit test needs no real storage or IndexedDB.
 * Pinned by clearCacheIfUserChanged.test.ts.
 *
 * Finding A (HIGH) — FAIL-CLOSED contract. The Firestore client is already
 * started at module load (config.ts enables persistentLocalCache), so
 * clearIndexedDbPersistence REJECTS on a running client. The mismatch path MUST
 * therefore `terminate(db)` BEFORE `clearIndexedDbPersistence(db)`. Two
 * obligations follow:
 *  - The function RETURNS `{ reloadRequired }` — `true` on a uid mismatch — so
 *    the caller can guarantee a full page reload (a fresh Firestore client)
 *    before any feature reads Firestore. On same-uid / cold-start it is `false`.
 *  - If `terminate` or `clearIndexedDbPersistence` REJECTS, the rejection MUST
 *    propagate (the function fails closed); the caller must still force the
 *    reload and must NOT release the session to a readable state. A swallowed
 *    rejection that lets the session proceed is the bug being fixed.
 */
export interface ClearCacheIfUserChangedDeps {
  db: Firestore;
  currentUid: string;
  getLastUid: () => string | null;
  setLastUid: (uid: string) => void;
}

export interface ClearCacheResult {
  /** True when the authenticated uid differed from the persisted marker. */
  reloadRequired: boolean;
}

export async function clearCacheIfUserChanged(
  deps: ClearCacheIfUserChangedDeps,
): Promise<ClearCacheResult> {
  const { db, currentUid, getLastUid, setLastUid } = deps;
  const lastUid = getLastUid();

  // uid MISMATCH: a different user's family PI may sit in the IndexedDB cache.
  // The Firestore client is already STARTED at module load (config.ts enables
  // persistentLocalCache), so clearIndexedDbPersistence rejects on a running
  // client — terminate(db) MUST run first. Fail closed: if either terminate or
  // the clear rejects, the rejection propagates and the marker is NOT advanced,
  // so the next start still treats the (uncleared) cache as foreign. The
  // returned reloadRequired:true tells the caller to swap in a fresh client.
  if (lastUid !== null && lastUid !== currentUid) {
    await terminate(db);
    await clearIndexedDbPersistence(db);
    setLastUid(currentUid);
    return { reloadRequired: true };
  }

  // same-uid (warm cache is the same user's data) or cold-start (no marker,
  // nothing foreign cached): no terminate, no clear; just record the marker.
  setLastUid(currentUid);
  return { reloadRequired: false };
}
