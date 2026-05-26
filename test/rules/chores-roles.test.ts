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
