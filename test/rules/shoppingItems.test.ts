/**
 * `shoppingItems` security-rules contract — Shopping List feature.
 *
 * Pins the rule: ANY active same-family member can CRUD a shopping item.
 * familyId / addedBy / createdAt are immutable; name shape is validated;
 * cross-tenant + deactivated callers are denied.
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
    addedBy: UID.memberA,
    name: 'Milk',
    isChecked: false,
    createdAt: Date.now(),
    ...over,
  };
}

async function seedItem(id: string, doc: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const { doc: docRef, setDoc } = await import('firebase/firestore');
    await setDoc(docRef(adminDb, 'shoppingItems', id), doc);
  });
}

describe('shoppingItems — CREATE', () => {
  it('a MEMBER can add an item', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(db, 'shoppingItems', 'i-1'), freshItem()));
  });

  it('a PARENT can add an item', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'shoppingItems', 'i-1'), freshItem({ addedBy: UID.parentA })),
    );
  });

  it('can add with optional quantity + category', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'shoppingItems', 'i-rich'),
        freshItem({ quantity: '2 gallons', category: 'dairy' }),
      ),
    );
  });

  it('CANNOT create with a forged addedBy', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'shoppingItems', 'i-bad'), freshItem({ addedBy: UID.member2A })),
    );
  });

  it('CANNOT create with isChecked=true (spec: starts unchecked)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'shoppingItems', 'i-bad'), freshItem({ isChecked: true })),
    );
  });

  it('CANNOT create with an empty name', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'shoppingItems', 'i-bad'), freshItem({ name: '' })));
  });

  it('CANNOT create with a smuggled field', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'shoppingItems', 'i-bad'), freshItem({ secret: 'pwned' })),
    );
  });

  it('cross-tenant: a member of B CANNOT add to family A', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'shoppingItems', 'i-cross'),
        freshItem({ familyId: FAMILY_A, addedBy: UID.memberB }),
      ),
    );
  });

  it('a DEACTIVATED member CANNOT add', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'shoppingItems', 'i-bad'), freshItem({ addedBy: UID.deactivatedA })),
    );
  });
});

describe('shoppingItems — READ', () => {
  beforeEach(async () => {
    await seedItem('i-A', freshItem());
    await seedItem('i-B', freshItem({ familyId: FAMILY_B, addedBy: UID.memberB }));
  });

  it('SAME-FAMILY caller CAN read (parent + member alike)', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      const db = env.authenticatedContext(uid).firestore();
      const { doc, getDoc } = await import('firebase/firestore');
      await assertSucceeds(getDoc(doc(db, 'shoppingItems', 'i-A')));
    }
  });

  it('cross-tenant: parent of B CANNOT read a family-A item', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'shoppingItems', 'i-A')));
  });
});

describe('shoppingItems — UPDATE', () => {
  beforeEach(async () => {
    await seedItem('i-A', freshItem());
  });

  it('ANY same-family member CAN check off an item', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'shoppingItems', 'i-A'), {
        isChecked: true,
        checkedAt: Date.now(),
        checkedBy: UID.member2A,
        name: 'Milk',
      }),
    );
  });

  it('CANNOT change familyId (tenant lock)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'shoppingItems', 'i-A'), { familyId: FAMILY_B, name: 'x' }),
    );
  });

  it('CANNOT rewrite addedBy', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'shoppingItems', 'i-A'), { addedBy: UID.parentA, name: 'x' }),
    );
  });

  it('CANNOT update to an empty name', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'shoppingItems', 'i-A'), { name: '' }));
  });

  it('cross-tenant CANNOT update', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'shoppingItems', 'i-A'), { name: 'pwned' }));
  });
});

describe('shoppingItems — DELETE', () => {
  beforeEach(async () => {
    await seedItem('i-A', freshItem());
  });

  it('ANY same-family member CAN delete', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      await seedItem(`i-${uid}`, freshItem());
      const db = env.authenticatedContext(uid).firestore();
      const { deleteDoc, doc } = await import('firebase/firestore');
      await assertSucceeds(deleteDoc(doc(db, 'shoppingItems', `i-${uid}`)));
    }
  });

  it('cross-tenant CANNOT delete', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'shoppingItems', 'i-A')));
  });
});
