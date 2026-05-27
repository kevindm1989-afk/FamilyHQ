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
 * CONTRACT STUB (M19, P6 — security finding 2 / privacy finding 1, CRITICAL).
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
 *  in that exact order.
 *
 * If `signOut` itself fails, cache clearing MUST STILL run (a failed sign-out
 * must not leave child PI on the device); the rejection is surfaced after the
 * cache is cleared.
 */
export async function signOutAndClearCache(deps: { auth: Auth; db: Firestore }): Promise<void> {
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

  if (signOutError !== undefined) {
    throw signOutError;
  }
}
