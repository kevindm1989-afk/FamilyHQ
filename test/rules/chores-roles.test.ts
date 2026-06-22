/**
 * SECURITY-CRITICAL — Chore role/transition rules (M4, T1.4).
 *
 * Threat-model T1.4 / §8: a member may create/update ONLY chores where
 * assignedTo == own uid AND only the pending -> complete transition. A parent
 * may write any in-family chore (incl. approve/reject). A member cannot
 * self-approve, cannot edit another's chore, cannot change pointValue/
 * dollarValue.
 *
 * The allowance-credit transaction itself is Phase 3 (Task 11); here we assert
 * the rule-level authority only.
 *
 * These FAIL today (deny-all denies the allowed cases too) and pass once chore
 * rules land.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;
const CHORE_A = `chore-${FAMILY_A}`; // assignedTo memberA, status pending

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

describe('M4: member chore writes are scoped to own assignment + legal transition', () => {
  it('member CAN move OWN chore pending -> complete', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });

  it('member CANNOT self-approve (pending -> approved) to credit themselves', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'approved' }));
  });

  it('member CANNOT move OWN chore complete -> approved (self-approve from complete)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // first legally complete it (allowed), then attempt to self-approve (denied)
    await assertSucceeds(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'approved' }));
  });

  it("member CANNOT update a chore assigned to a DIFFERENT member", async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // CHORE_A is assigned to memberA, not member2A.
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });

  it('member CANNOT change pointValue/dollarValue on own chore', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'chores', CHORE_A), { dollarValue: 999, pointValue: 999 }),
    );
  });

  it('member CANNOT create a chore (assigning work is parent-only)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'member-made-chore'), {
        title: 'self assigned',
        assignedTo: UID.memberA,
        dueDate: '2026-05-30',
        pointValue: 5,
        dollarValue: 5,
        status: 'pending',
        familyId: FAMILY_A,
        createdBy: UID.memberA,
        createdAt: Date.now(),
        isRecurring: false,
        recurrenceFrequency: 'none',
      }),
    );
  });
});

describe('parent chore authority within own family', () => {
  it('parent CAN create an in-family chore', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'chores', 'parent-made-chore'), {
        title: 'Dishes',
        assignedTo: UID.memberA,
        dueDate: '2026-05-30',
        pointValue: 5,
        dollarValue: 2,
        status: 'pending',
        familyId: FAMILY_A,
        createdBy: UID.parentA,
        createdAt: Date.now(),
        isRecurring: false,
        recurrenceFrequency: 'none',
      }),
    );
  });

  it('parent CAN approve a completed chore (complete -> approved)', async () => {
    // Move to complete first (as the assigned member), then parent approves.
    const memberDb = env.authenticatedContext(UID.memberA).firestore();
    const fs1 = await import('firebase/firestore');
    await fs1.updateDoc(fs1.doc(memberDb, 'chores', CHORE_A), { status: 'complete' });

    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    await assertSucceeds(
      fs1.updateDoc(fs1.doc(parentDb, 'chores', CHORE_A), { status: 'approved' }),
    );
  });

  it('parent CAN reject a completed chore with a reason (no balance change here)', async () => {
    const memberDb = env.authenticatedContext(UID.memberA).firestore();
    const fs1 = await import('firebase/firestore');
    await fs1.updateDoc(fs1.doc(memberDb, 'chores', CHORE_A), { status: 'complete' });

    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    await assertSucceeds(
      fs1.updateDoc(fs1.doc(parentDb, 'chores', CHORE_A), {
        status: 'rejected',
        rejectionReason: 'Not done properly',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// parentChoreEdit — the chore-management edit rule (Feature: edit + delete).
// Lets a parent correct a chore's content fields BEFORE it has been earned
// (status == 'pending' or 'rejected'). Once 'complete' or 'approved' the
// reward is owed and editing is denied. familyId/createdBy/createdAt/status
// are immutable via the affectedKeys lock; the change set must be non-empty.
// ---------------------------------------------------------------------------
describe('parentChoreEdit: parent may correct a pre-earned chore', () => {
  it('parent CAN edit title + dueDate + pointValue + dollarValue on a PENDING chore', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(parentDb, 'chores', CHORE_A), {
        title: 'Take out trash',
        dueDate: '2026-07-01',
        pointValue: 10,
        dollarValue: 7,
      }),
    );
  });

  it('parent CAN reassign a pending chore to another same-family member', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(parentDb, 'chores', CHORE_A), { assignedTo: UID.member2A }),
    );
  });

  it('parent CAN edit isRecurring / recurrenceFrequency on a pending chore', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(parentDb, 'chores', CHORE_A), {
        isRecurring: true,
        recurrenceFrequency: 'weekly',
      }),
    );
  });

  it('parent CAN edit a REJECTED chore (kid was sent back; parent clarifies)', async () => {
    // Drive the chore to 'rejected' first (complete -> rejected).
    const memberDb = env.authenticatedContext(UID.memberA).firestore();
    const fs = await import('firebase/firestore');
    await fs.updateDoc(fs.doc(memberDb, 'chores', CHORE_A), { status: 'complete' });
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    await fs.updateDoc(fs.doc(parentDb, 'chores', CHORE_A), {
      status: 'rejected',
      rejectionReason: 'try again',
    });
    // Now edit the chore content.
    await assertSucceeds(
      fs.updateDoc(fs.doc(parentDb, 'chores', CHORE_A), { title: 'Take out trash (clearer)' }),
    );
  });

  it('parent CANNOT edit a chore in COMPLETE status (kid earned it; lock the value)', async () => {
    const memberDb = env.authenticatedContext(UID.memberA).firestore();
    const fs = await import('firebase/firestore');
    await fs.updateDoc(fs.doc(memberDb, 'chores', CHORE_A), { status: 'complete' });
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    await assertFails(
      fs.updateDoc(fs.doc(parentDb, 'chores', CHORE_A), { dollarValue: 1 }),
    );
  });

  it('parent CANNOT edit a chore in APPROVED status (reward already credited)', async () => {
    const memberDb = env.authenticatedContext(UID.memberA).firestore();
    const fs = await import('firebase/firestore');
    await fs.updateDoc(fs.doc(memberDb, 'chores', CHORE_A), { status: 'complete' });
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    await fs.updateDoc(fs.doc(parentDb, 'chores', CHORE_A), { status: 'approved' });
    await assertFails(
      fs.updateDoc(fs.doc(parentDb, 'chores', CHORE_A), { title: 'retroactive change' }),
    );
  });

  it('parent CANNOT change familyId via edit (tenant reassignment denied)', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(parentDb, 'chores', CHORE_A), { familyId: 'family-B' }),
    );
  });

  it('parent CANNOT change status via edit (lifecycle path only)', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // From 'pending' the only legal status moves are via the member-complete
    // path; a parent setting status directly via the edit predicate is denied.
    await assertFails(updateDoc(doc(parentDb, 'chores', CHORE_A), { status: 'approved' }));
  });

  it('parent CANNOT reassign to a CROSS-FAMILY user', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(parentDb, 'chores', CHORE_A), { assignedTo: UID.memberB }),
    );
  });

  it('parent CANNOT submit a no-op edit (empty change set denied — defence against same-value re-assert)', async () => {
    // Setting dollarValue to its current value is a no-op write (affectedKeys
    // is empty), which the rule denies. Tests the size() > 0 clause.
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc, updateDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(parentDb, 'chores', CHORE_A));
    const current = snap.data() as { dollarValue: number };
    await assertFails(
      updateDoc(doc(parentDb, 'chores', CHORE_A), { dollarValue: current.dollarValue }),
    );
  });

  it('parent CANNOT set a fractional dollarValue (isValidMoneyInt: integer cents only)', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(parentDb, 'chores', CHORE_A), { dollarValue: 3.5 }),
    );
  });

  it('parent CANNOT set a negative pointValue', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(parentDb, 'chores', CHORE_A), { pointValue: -1 }),
    );
  });

  it('parent CANNOT set an unknown recurrenceFrequency value', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(parentDb, 'chores', CHORE_A), { recurrenceFrequency: 'monthly' }),
    );
  });

  it('CROSS-FAMILY parent CANNOT edit a chore in another family', async () => {
    const otherFamilyParentDb = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(otherFamilyParentDb, 'chores', CHORE_A), { title: 'cross-family' }),
    );
  });

  it('MEMBER CANNOT edit chore content even on own pending chore (parent-only path)', async () => {
    const memberDb = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(memberDb, 'chores', CHORE_A), { title: 'kid renamed it' }),
    );
  });
});

describe('parent chore delete (rule already allowed; documenting the contract)', () => {
  it('parent CAN delete a chore in their own family at ANY status', async () => {
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(parentDb, 'chores', CHORE_A)));
  });

  it('member CANNOT delete a chore (even their own assigned chore)', async () => {
    const memberDb = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(memberDb, 'chores', CHORE_A)));
  });

  it('CROSS-FAMILY parent CANNOT delete a chore in another family', async () => {
    const otherFamilyParentDb = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(otherFamilyParentDb, 'chores', CHORE_A)));
  });
});
