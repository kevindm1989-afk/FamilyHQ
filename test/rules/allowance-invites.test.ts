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

/**
 * SECURITY FINDING 1/3 — a same-family parent doing a BARE updateDoc on a
 * member's users doc may update ONLY `name` and `isActive`. allowanceBalance is
 * a tracked-money field whose only legitimate write path is the Phase-3
 * approval runTransaction (M28); a direct bare balance write at the rules layer
 * is DENIED (previously this passed — tightened to denied here). role, email,
 * and familyId are never parent-writable on a member doc either.
 *
 * NOTE: balance changes are deferred to the Phase-3 approval runTransaction
 * (M27/M28). No direct balanceWrite is permitted at the rules layer — the
 * transaction enforces the chore-status guard + matching ledger doc; a bare
 * update cannot.
 */
describe('M28: parent bare-update of a member doc is limited to name + isActive', () => {
  it('same-family parent CAN set a member name', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { name: 'Renamed' }));
  });

  it('same-family parent CAN deactivate a member (isActive:false)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { isActive: false }));
  });

  it('same-family parent CAN re-activate a member (isActive:true)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // deactivatedA is seeded isActive:false; a parent may flip it back to true.
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.deactivatedA), { isActive: true }),
    );
  });

  it('same-family parent CAN set name AND isActive together', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.memberA), { name: 'Renamed', isActive: false }),
    );
  });

  it('M28: same-family parent CANNOT bare-write a member allowanceBalance (deferred to Phase-3 txn)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }),
    );
  });

  it('M28: same-family parent CANNOT bare-write allowanceBalance to 0 either (no direct balance writes)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 0 }),
    );
  });

  it('same-family parent CANNOT change a member role (no parent-granted elevation)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { role: 'parent' }));
  });

  it('same-family parent CANNOT change a member familyId (no tenant reassignment)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { familyId: FAMILY_B }));
  });

  it('same-family parent CANNOT write a member email onto the family-readable users doc (email left this doc)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { email: 'leak@example.test' }),
    );
  });

  it('same-family parent CANNOT set name AND allowanceBalance together (mixed write still denied)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { name: 'Renamed', allowanceBalance: 99 }),
    );
  });

  it('member CANNOT directly increment own allowanceBalance', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }));
  });

  it('cross-family parent CANNOT update another family member (name)', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { name: 'hijack' }));
  });

  it('cross-family parent CANNOT deactivate another family member', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { isActive: false }));
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
