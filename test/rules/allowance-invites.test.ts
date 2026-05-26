/**
 * SECURITY-CRITICAL — Allowance balance write authority (M27/M28) and invites
 * access (M25/P9), plus the transactions append-only ledger (M6).
 *
 * Threat-model §5.3 (allowanceBalance writable only by a same-family parent;
 * direct member increment denied — the FULL credit transaction is Phase 3),
 * §2.2/P9 (invites parent-only + sameFamily), T1.6 (transactions append-only).
 *
 * These FAIL today (deny-all) and pass once the rules land.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

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

describe('M27: who can write allowanceBalance', () => {
  it('same-family parent CAN write a member allowanceBalance', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }),
    );
  });

  it('member CANNOT directly increment own allowanceBalance', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }));
  });

  it('cross-family parent CANNOT write another family member balance', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }));
  });
});

describe('M6/T1.6: transactions ledger is append-only', () => {
  it('parent CAN create an in-family transaction (earning)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'transactions', 'new-earning'), {
        uid: UID.memberA,
        choreId: `chore-${FAMILY_A}`,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('nobody can UPDATE an existing transaction (append-only)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'transactions', `txn-${FAMILY_A}`), { amount: 9999 }),
    );
  });

  it('nobody can DELETE an existing transaction (append-only)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'transactions', `txn-${FAMILY_A}`)));
  });

  it('member CANNOT create a transaction (credit themselves)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'self-credit'), {
        uid: UID.memberA,
        choreId: `chore-${FAMILY_A}`,
        choreTitle: 'Take out trash',
        amount: 100,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });
});

describe('M25/P9: invites are parent-only and family-scoped', () => {
  it('parent CAN create an invite in own family', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'invites', 'new-invite'), {
        email: 'newadult@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.parentA,
        createdAt: Date.now(),
        status: 'pending',
      }),
    );
  });

  it('parent CAN read own-family invite', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'invites', `invite-${FAMILY_A}`)));
  });

  it('parent CAN delete own-family invite', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'invites', `invite-${FAMILY_A}`)));
  });

  it('P9: member CANNOT read own-family invite (parent-only, adult email PI)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'invites', `invite-${FAMILY_A}`)));
  });

  it('P9: member CANNOT create an invite', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'invites', 'member-invite'), {
        email: 'x@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.memberA,
        createdAt: Date.now(),
        status: 'pending',
      }),
    );
  });

  it('P9: parent of A CANNOT read a family-B invite (cross-tenant adult email)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'invites', `invite-${FAMILY_B}`)));
  });

  it('P9: parent of A CANNOT create an invite into family B', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'invites', 'cross-family-invite'), {
        email: 'x@example.test',
        role: 'member',
        familyId: FAMILY_B,
        invitedBy: UID.parentA,
        createdAt: Date.now(),
        status: 'pending',
      }),
    );
  });
});
