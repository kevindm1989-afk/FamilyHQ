/**
 * Invite service — create/read/accept invitations.
 *
 * Parent creates an invite ({ email, role, familyId }) — Firestore generates a
 * high-entropy doc id which becomes the redeem code in the shareable link
 * (`/join/<inviteId>`). The recipient navigates to the link, fills in their
 * name + password, and `acceptInvite` does the rest:
 *
 *   1. createUserWithEmailAndPassword (Firebase Auth) — gives the invitee an
 *      authenticated session keyed by the invite email.
 *   2. writeBatch:
 *        - users/{uid} CREATE with familyId + role from the invite + the
 *          inviteId audit field. Rules (`isInviteBootstrap`) verify the invite
 *          exists, its email matches request.auth.token.email, and its
 *          familyId/role match what the user doc claims.
 *        - invites/{inviteId} UPDATE status pending → accepted. Rules
 *          (`isInviteAcceptance`) verify the email match again and that
 *          nothing else mutates.
 *
 * Both writes succeed atomically or both fail.
 *
 * Errors are user-safe (no raw Firebase codes, no PII): the caller gets one
 * of the InviteActionError-mapped messages. Specifically, the rules' email
 * mismatch (someone tries to redeem an invite with the wrong email) surfaces
 * as a generic "this invite couldn't be redeemed" message — not "wrong email"
 * — so a bad actor can't probe which emails have invites.
 */
import { createUserWithEmailAndPassword, type Auth, type UserCredential } from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { inviteConverter, userConverter } from '../../lib/converters';
import type { Invite, Role } from '../../lib/types';

const INVITES_COLLECTION = 'invites';
const USERS_COLLECTION = 'users';

export const INVITE_CREATE_SUCCESS = 'Invitation created.';
export const INVITE_REVOKE_SUCCESS = 'Invitation revoked.';
export const INVITE_ACCEPT_SUCCESS = 'Welcome to the family!';
export const INVITE_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const INVITE_INVALID_ERROR =
  "This invitation couldn't be redeemed. The link may have been used or revoked.";

export class InviteActionError extends Error {
  constructor(message: string = INVITE_GENERIC_ERROR) {
    super(message);
    this.name = 'InviteActionError';
  }
}

export interface InviteWithId extends Invite {
  id: string;
}

export interface CreateInviteInput {
  email: string;
  role: Role;
  familyId: string;
  invitedBy: string;
}

/**
 * Parent-only: create a pending invite. Returns the new doc id which is the
 * redeem code. The caller wraps the id in a shareable URL (`/join/<id>`).
 */
export async function createInvite(
  deps: { db: Firestore },
  input: CreateInviteInput,
): Promise<string> {
  const trimmedEmail = input.email.trim().toLowerCase();
  if (trimmedEmail.length === 0 || !trimmedEmail.includes('@')) {
    throw new InviteActionError('Please enter a valid email address.');
  }
  try {
    const ref = await addDoc(
      collection(deps.db, INVITES_COLLECTION).withConverter(inviteConverter),
      {
        email: trimmedEmail,
        role: input.role,
        familyId: input.familyId,
        invitedBy: input.invitedBy,
        createdAt: Date.now(),
        status: 'pending',
      } satisfies Invite,
    );
    return ref.id;
  } catch {
    throw new InviteActionError();
  }
}

/**
 * Public read of an invite by id. Used by the redeem page to show the invitee
 * who invited them BEFORE they finish signup. Rules allow this when
 * status == 'pending'. Returns null when the invite is missing/expired/
 * already accepted, so the UI can show a generic "this link is no longer
 * valid" without leaking which of those it is.
 */
export async function getInviteById(
  deps: { db: Firestore },
  inviteId: string,
): Promise<InviteWithId | null> {
  try {
    const snap = await getDoc(
      doc(deps.db, INVITES_COLLECTION, inviteId).withConverter(inviteConverter),
    );
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data.status !== 'pending') return null;
    return { id: snap.id, ...data };
  } catch {
    return null;
  }
}

export interface AcceptInviteInput {
  inviteId: string;
  /**
   * The email the invitee will sign up with. MUST match the invite's stored
   * email (rules enforce; client also pre-checks for a cleaner error). Lower-
   * case + trimmed before comparison.
   */
  email: string;
  password: string;
  name: string;
}

/**
 * Two-phase invite acceptance:
 *   1. createUserWithEmailAndPassword to get an authed session under the
 *      invitee email.
 *   2. writeBatch: users/{uid} create + invites/{inviteId} status update.
 *
 * If step 2 fails, the auth user from step 1 still exists; the invitee can
 * retry the redeem link and the same auth account will be reused
 * (createUserWithEmailAndPassword's auth/email-already-in-use is mapped to
 * "sign in instead" — a future polish; for v1 the user sees a generic error
 * and we suggest contacting the inviter).
 */
export async function acceptInvite(
  deps: { auth: Auth; db: Firestore },
  input: AcceptInviteInput,
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (name.length === 0) {
    throw new InviteActionError('Please enter your name.');
  }

  // Re-read the invite to validate freshness + email match before we touch
  // auth. Client-side check; rules enforce server-side too.
  const invite = await getInviteById(deps, input.inviteId);
  if (!invite) {
    throw new InviteActionError(INVITE_INVALID_ERROR);
  }
  if (invite.email !== email) {
    throw new InviteActionError(INVITE_INVALID_ERROR);
  }

  let credential: UserCredential;
  try {
    credential = await createUserWithEmailAndPassword(deps.auth, email, input.password);
  } catch {
    // Map all Firebase auth errors (weak password, email-already-in-use,
    // invalid-email, etc.) to one generic message. The user retries.
    throw new InviteActionError();
  }
  const uid = credential.user.uid;

  try {
    const batch = writeBatch(deps.db);
    batch.set(doc(deps.db, USERS_COLLECTION, uid).withConverter(userConverter), {
      name,
      role: invite.role,
      familyId: invite.familyId,
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
      inviteId: input.inviteId,
    });
    batch.update(doc(deps.db, INVITES_COLLECTION, input.inviteId), {
      status: 'accepted',
    });
    await batch.commit();
  } catch {
    throw new InviteActionError();
  }
}

/**
 * Parent-only: delete a pending invite. Rules enforce parent + same family.
 * Used by the FamilyManagementScreen's "Revoke" action when a parent typo'd
 * an email or simply changed their mind. After revoke, the invite is gone
 * from Firestore — the redeem link returns 404 to the invitee.
 */
export async function revokeInvite(deps: { db: Firestore }, inviteId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, INVITES_COLLECTION, inviteId));
  } catch {
    throw new InviteActionError();
  }
}

// serverTimestamp imported but not used here — keeps the import surface
// stable for follow-up that may switch createdAt from Date.now() to the
// server clock for stronger ordering guarantees.
void serverTimestamp;
