/**
 * CONTRACT — auth + tenant bootstrap service (Task 4, ADR-0006).
 *
 * Signatures only; the implementer writes the bodies. The tests import these to
 * pin the contract:
 *  - `signUpFoundingParent` is the ONLY path that self-assigns role:'parent'.
 *    It must atomically create exactly one `families` doc and one parent
 *    `users` doc (a single writeBatch). A failed batch leaves NO orphan.
 *    An already-authenticated existing user must NOT be able to bootstrap a
 *    second family.
 *  - `signIn` / `sendPasswordReset` call the matching Firebase Auth APIs.
 *
 * Errors must be mapped to user-safe, PII-free messages at the call site
 * (constraints "No PII in error messages"); raw Firebase codes never surface.
 */
import type { Auth, UserCredential } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

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

/**
 * Create the founding parent's family + parent user atomically.
 * Throws if a user is already signed in / already has a users doc (no second
 * family bootstrap), and rolls back (no orphan) on any partial failure.
 */
export declare function signUpFoundingParent(
  deps: { auth: Auth; db: Firestore },
  input: SignUpInput,
): Promise<SignUpResult>;

export declare function signIn(
  deps: { auth: Auth },
  email: string,
  password: string,
): Promise<UserCredential>;

export declare function sendPasswordReset(
  deps: { auth: Auth },
  email: string,
): Promise<void>;
