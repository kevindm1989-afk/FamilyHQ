/**
 * `wishlistItems` security-rules contract — Allowance debit + wishlist
 * redemption feature.
 *
 * Pins the state machine:
 *   wishing ↔ requested (owner only)
 *   requested → redeemed | denied (parent only)
 * Plus the create shape lock (`status` must start 'wishing', positive
 * costCents) and the parent-or-owner delete authority.
 */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});
afterAll(async () => {
  await env.cleanup();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});

function freshItem(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    familyId: FAMILY_A,
    ownerUid: UID.memberA,
    title: 'Nintendo Switch',
    costCents: 30000,
    status: 'wishing',
    createdAt: Date.now(),
    ...over,
  };
}

async function seedItem(id: string, doc: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const { doc: docRef, setDoc } = await import('firebase/firestore');
    await setDoc(docRef(adminDb, 'wishlistItems', id), doc);
  });
}

describe('wishlistItems — CREATE', () => {
  it('a MEMBER can create an item with ownerUid=self', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(db, 'wishlistItems', 'w-1'), freshItem()));
  });

  it('CANNOT create with a forged ownerUid (rule binds to request.auth.uid)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'wishlistItems', 'w-bad'), freshItem({ ownerUid: UID.member2A })),
    );
  });

  it('CANNOT create with status != "wishing"', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'wishlistItems', 'w-bad'), freshItem({ status: 'requested' })),
    );
  });

  it('CANNOT create with costCents <= 0', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'wishlistItems', 'w-bad'), freshItem({ costCents: 0 })));
  });

  it('CANNOT create with an empty title', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'wishlistItems', 'w-bad'), freshItem({ title: '' })));
  });

  it('cross-tenant: a member of B CANNOT create in family A', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'wishlistItems', 'w-cross'),
        freshItem({ familyId: FAMILY_A, ownerUid: UID.memberB }),
      ),
    );
  });

  it('a DEACTIVATED member CANNOT create', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'wishlistItems', 'w-bad'), freshItem({ ownerUid: UID.deactivatedA })),
    );
  });
});

describe('wishlistItems — UPDATE status transitions (owner)', () => {
  beforeEach(async () => {
    await seedItem('w-A', freshItem());
  });

  it('OWNER CAN flip wishing → requested', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'wishlistItems', 'w-A'), {
        status: 'requested',
        requestedAt: Date.now(),
      }),
    );
  });

  it('OWNER CAN flip requested → wishing (cancel)', async () => {
    await seedItem('w-req', freshItem({ status: 'requested', requestedAt: Date.now() }));
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'wishlistItems', 'w-req'), { status: 'wishing' }));
  });

  it('OWNER CANNOT flip directly to redeemed (parent-only)', async () => {
    await seedItem('w-req', freshItem({ status: 'requested', requestedAt: Date.now() }));
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'wishlistItems', 'w-req'), {
        status: 'redeemed',
        resolvedAt: Date.now(),
      }),
    );
  });

  it('a peer MEMBER (not owner) CANNOT change another member\'s wishlist item', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'wishlistItems', 'w-A'), { status: 'requested' }),
    );
  });
});

describe('wishlistItems — UPDATE status transitions (parent resolve)', () => {
  beforeEach(async () => {
    await seedItem('w-req', freshItem({ status: 'requested', requestedAt: Date.now() }));
  });

  it('PARENT CAN flip requested → redeemed', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'wishlistItems', 'w-req'), {
        status: 'redeemed',
        resolvedAt: Date.now(),
      }),
    );
  });

  it('PARENT CAN flip requested → denied with reason', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'wishlistItems', 'w-req'), {
        status: 'denied',
        deniedReason: 'Save for the bigger goal',
        resolvedAt: Date.now(),
      }),
    );
  });

  it('PARENT CANNOT resolve a non-requested item (no replay)', async () => {
    await seedItem('w-wish', freshItem({ status: 'wishing' }));
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'wishlistItems', 'w-wish'), { status: 'redeemed' }),
    );
  });

  it('PARENT CANNOT change familyId or ownerUid (tenant + identity locked)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'wishlistItems', 'w-req'), { familyId: FAMILY_B, status: 'redeemed' }),
    );
    await assertFails(
      updateDoc(doc(db, 'wishlistItems', 'w-req'), { ownerUid: UID.parentA, status: 'redeemed' }),
    );
  });

  it('cross-tenant parent CANNOT resolve an item', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'wishlistItems', 'w-req'), { status: 'redeemed' }),
    );
  });
});

describe('wishlistItems — DELETE', () => {
  beforeEach(async () => {
    await seedItem('w-A', freshItem());
  });

  it('OWNER CAN delete their own item', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'wishlistItems', 'w-A')));
  });

  it('PARENT CAN delete any same-family item (cleanup)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'wishlistItems', 'w-A')));
  });

  it("a peer MEMBER (not owner) CANNOT delete another member's item", async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'wishlistItems', 'w-A')));
  });

  it('cross-tenant CANNOT delete', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'wishlistItems', 'w-A')));
  });
});

describe('users.allowanceBalance — parentAllowanceDebit predicate', () => {
  it('a PARENT CAN decrease a same-family child\'s allowanceBalance', async () => {
    // Seed a baseline balance so we can debit it.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(adminDb, 'users', UID.memberA), { allowanceBalance: 50000 });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 20000 }));
  });

  it('a PARENT CANNOT debit below 0 (rule floor)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: -1 }));
  });

  it('a MEMBER CANNOT debit anyone\'s balance', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(adminDb, 'users', UID.memberA), { allowanceBalance: 50000 });
    });
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 20000 }));
  });

  it('cross-tenant parent CANNOT debit a foreign-family balance', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 0 }));
  });
});

describe('transactions — type "spending" accepted (Allowance debit feature)', () => {
  it('PARENT CAN create a spending ledger row with the 7-field shape', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'transactions', 'txn-spend-1'), {
        uid: UID.memberA,
        sourceId: 'wish-1',
        sourceLabel: 'Nintendo Switch',
        amount: 30000,
        type: 'spending',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('CANNOT create a spending row with an unknown type', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'txn-bad'), {
        uid: UID.memberA,
        sourceId: 'wish-1',
        sourceLabel: 'X',
        amount: 100,
        type: 'transfer',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });
});
