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
import { trackUsage } from '../../lib/telemetry';

const INVITES_COLLECTION = 'invites';
const USERS_COLLECTION = 'users';
const USER_PRIVATE_COLLECTION = 'userPrivate';

/**
 * How long a pending invite remains redeemable. 14 days balances the parent's
 * need to share the link asynchronously (text, email, in-person) with the
 * privacy cost of an indefinitely-live credential. Tune here in one place if
 * we learn we need shorter (security) or longer (usability) in practice.
 */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const INVITE_CREATE_SUCCESS = 'Invitation created.';
export const INVITE_REVOKE_SUCCESS = 'Invitation revoked.';
export const INVITE_ACCEPT_SUCCESS = 'Welcome to the family!';
export const INVITE_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const INVITE_INVALID_ERROR =
  "This invitation couldn't be redeemed. The link may have been used or revoked.";
// Distinct from the generic error so the UI can offer a "Sign in instead"
// affordance instead of letting the visitor retry signup forever. Safe to
// be specific here — the invitee already knows the email is theirs (they
// got the link via it), so naming the condition doesn't leak account info.
export const INVITE_EMAIL_IN_USE_ERROR =
  'You already have an account with this email. Sign in instead.';

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
    const now = Date.now();
    const ref = await addDoc(
      collection(deps.db, INVITES_COLLECTION).withConverter(inviteConverter),
      {
        email: trimmedEmail,
        role: input.role,
        familyId: input.familyId,
        invitedBy: input.invitedBy,
        createdAt: now,
        // Explicit expiry so the read-side check can compare without
        // having to know INVITE_TTL_MS. Legacy invites without this field
        // still work — getInviteById falls back to createdAt + TTL.
        expiresAt: now + INVITE_TTL_MS,
        status: 'pending',
      } satisfies Invite,
    );
    return ref.id;
  } catch {
    throw new InviteActionError();
  }
}

/**
 * Returns the expiry timestamp for an invite. Legacy invites (pre-TTL
 * feature) have no `expiresAt` field — we fall back to a derived value
 * (createdAt + INVITE_TTL_MS). Public so the UI can render "expires in N
 * days" against the same value the service enforces against.
 */
export function inviteExpiresAt(invite: Pick<Invite, 'createdAt' | 'expiresAt'>): number {
  return invite.expiresAt ?? invite.createdAt + INVITE_TTL_MS;
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
    // Expired invites read as if they never existed — same null return as
    // accepted/revoked, so the redeem UI shows the generic "no longer
    // valid" copy and a bad actor can't tell expired from revoked from
    // never-existed. Server-side rules enforcement is a follow-up.
    if (inviteExpiresAt(data) <= Date.now()) return null;
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
  } catch (err) {
    // `auth/email-already-in-use` is the one Firebase code worth distin-
    // guishing here: the invitee can't sign UP with this email, but they
    // can sign IN — the UI surfaces a "Sign in instead" link off the
    // specific error message. Everything else (weak password, invalid
    // email, network, etc.) collapses to the generic retry message.
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 'auth/email-already-in-use') {
      throw new InviteActionError(INVITE_EMAIL_IN_USE_ERROR);
    }
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
    // Privacy finding 2 / parity with founding-parent signup
    // (authService.signUpFoundingParent): the invited member's email [PI]
    // lives on the per-subject userPrivate/{uid} doc, NOT on the
    // family-readable users doc. Written in this SAME atomic batch so an
    // invited member ends up in exactly the same shape as a founding
    // parent. Without this, invited members had NO userPrivate doc at all,
    // which (a) lost their email from the family-management surface and
    // (b) made every later userPrivate write (e.g. notification
    // preferences) a CREATE that the rules reject — the create-shape only
    // permits {email, familyId}, so a notificationPreferences write could
    // never land. The doc shape is EXACTLY {email, familyId} to satisfy
    // the userPrivate create rule's keys().hasOnly([email,familyId]); its
    // familyId is bound to the same-batch users doc's family via the
    // rule's getAfter() check.
    batch.set(doc(deps.db, USER_PRIVATE_COLLECTION, uid), {
      email,
      familyId: invite.familyId,
    });
    batch.update(doc(deps.db, INVITES_COLLECTION, input.inviteId), {
      status: 'accepted',
    });
    await batch.commit();
  } catch {
    throw new InviteActionError();
  }
  trackUsage('invite_accepted');
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
