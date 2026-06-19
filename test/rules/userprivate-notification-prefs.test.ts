/**
 * SECURITY-ADJACENT regression — NotificationsRoute preferences write vs the
 * userPrivate rule.
 *
 * Root cause this guards (PR push-debugging): invited members created before
 * the inviteService bootstrap fix had NO userPrivate/{uid} doc. The
 * notification-preferences write is a setDoc-merge; on a MISSING doc that
 * merge is a CREATE, and the userPrivate create rule permits ONLY the exact
 * shape {email, familyId} — so a `notificationPreferences` write can never
 * land on a missing doc. Symptom: the master toggle flipped ON then snapped
 * back to OFF with a "could not save" toast.
 *
 * The fix has two halves, both asserted here:
 *   - The write succeeds when the doc EXISTS (cases A, B) — the founding-
 *     parent / fixed-invite state.
 *   - The one-shot merge on a MISSING doc is DENIED (case C) — documents
 *     exactly why the doc must pre-exist.
 *   - The route's self-heal (create {email, familyId} first, then merge the
 *     preferences) is rules-valid (case D) — this is the exact two-step the
 *     client now performs for legacy invited members.
 *
 * memberA: seeded, ACTIVE, WITH a userPrivate doc ({email, familyId}).
 * establishedNoPrivateA: seeded, ACTIVE, NO userPrivate doc (the legacy
 *   invited-member state).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;

beforeAll(async () => {
  env = await getEnv();
});
afterAll(async () => {
  await teardownEnv();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});
afterEach(async () => {
  await env.clearFirestore();
});

const PREFS = {
  pushEnabled: true,
  showDetails: false,
  updatedAt: 1234567890,
  categories: {
    choreApprovalsNeeded: false,
    wishlistApprovalsNeeded: false,
    myChoreResolved: false,
    myWishlistResolved: false,
    familyBoardPosts: false,
    familyTodos: false,
    eventReminders: false,
    birthdays: false,
  },
};

describe('userPrivate notification-preferences write authority', () => {
  it('A) active member WITH userPrivate can merge {notificationPreferences} only', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'userPrivate', UID.memberA),
        { notificationPreferences: PREFS },
        { merge: true },
      ),
    );
  });

  it('B) active member WITH userPrivate can merge {familyId, notificationPreferences}', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'userPrivate', UID.memberA),
        { familyId: FAMILY_A, notificationPreferences: PREFS },
        { merge: true },
      ),
    );
  });

  it('C) active member WITHOUT userPrivate: a one-shot prefs merge (a CREATE) is DENIED', async () => {
    // This is the exact bug. The merge becomes a CREATE; the create rule
    // requires keys().hasOnly([email, familyId]); {familyId,
    // notificationPreferences} has an extra key and is missing email.
    const db = env.authenticatedContext(UID.establishedNoPrivateA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'userPrivate', UID.establishedNoPrivateA),
        { familyId: FAMILY_A, notificationPreferences: PREFS },
        { merge: true },
      ),
    );
  });

  it('D) self-heal: create {email, familyId} first, THEN merge prefs — both steps allowed', async () => {
    // Mirrors the route's self-heal for legacy invited members.
    const db = env.authenticatedContext(UID.establishedNoPrivateA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    // Step 1: bootstrap the doc with EXACTLY {email, familyId} (create rule).
    await assertSucceeds(
      setDoc(doc(db, 'userPrivate', UID.establishedNoPrivateA), {
        email: 'invited@example.test',
        familyId: FAMILY_A,
      }),
    );
    // Step 2: now the prefs merge is an UPDATE and lands.
    await assertSucceeds(
      setDoc(
        doc(db, 'userPrivate', UID.establishedNoPrivateA),
        { notificationPreferences: PREFS },
        { merge: true },
      ),
    );
  });
});
