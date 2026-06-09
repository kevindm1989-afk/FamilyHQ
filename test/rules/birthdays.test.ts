/**
 * `birthdays` security-rules contract — Birthdays feature.
 *
 * Pins the rule the spec asked for: ANY active same-family member can CRUD a
 * Birthday. familyId / createdBy / createdAt are immutable; name / monthDay /
 * type are validated; cross-tenant + deactivated callers are denied.
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

function freshBirthday(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    familyId: FAMILY_A,
    createdBy: UID.memberA,
    name: 'Maya',
    monthDay: '06-15',
    type: 'birthday',
    createdAt: Date.now(),
    ...over,
  };
}

async function seedBirthday(id: string, doc: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const { doc: docRef, setDoc } = await import('firebase/firestore');
    await setDoc(docRef(adminDb, 'birthdays', id), doc);
  });
}

describe('birthdays — CREATE', () => {
  it('a MEMBER can create a birthday in their own family', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(db, 'birthdays', 'b-1'), freshBirthday()));
  });

  it('a PARENT can create a birthday in their own family', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'birthdays', 'b-1'), freshBirthday({ createdBy: UID.parentA })),
    );
  });

  it('can create an anniversary type', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'birthdays', 'b-anniv'),
        freshBirthday({ type: 'anniversary', name: 'Mom + Dad' }),
      ),
    );
  });

  it('can create with optional birthYear + note', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'birthdays', 'b-rich'),
        freshBirthday({ birthYear: 2014, note: 'Loves Pokémon' }),
      ),
    );
  });

  it('CANNOT create with a forged createdBy (rule binds to request.auth.uid)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'birthdays', 'b-bad'), freshBirthday({ createdBy: UID.member2A })),
    );
  });

  it('CANNOT create with an empty name', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'birthdays', 'b-bad'), freshBirthday({ name: '' })));
  });

  it('CANNOT create with a malformed monthDay (wrong format)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'birthdays', 'b-bad'), freshBirthday({ monthDay: '2026-06-15' })),
    );
  });

  it('CANNOT create with an impossible monthDay (13-01)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'birthdays', 'b-bad'), freshBirthday({ monthDay: '13-01' })),
    );
  });

  it('CANNOT create with an unknown type', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'birthdays', 'b-bad'), freshBirthday({ type: 'birthdayish' })),
    );
  });

  it('CANNOT create with a smuggled field', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'birthdays', 'b-bad'), freshBirthday({ secret: 'pwned' })),
    );
  });

  it('cross-tenant: a member of B CANNOT create a birthday in family A', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'birthdays', 'b-cross'),
        freshBirthday({ familyId: FAMILY_A, createdBy: UID.memberB }),
      ),
    );
  });

  it('a DEACTIVATED member CANNOT create a birthday', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'birthdays', 'b-bad'), freshBirthday({ createdBy: UID.deactivatedA })),
    );
  });
});

describe('birthdays — READ', () => {
  beforeEach(async () => {
    await seedBirthday('b-A', freshBirthday());
    await seedBirthday('b-B', freshBirthday({ familyId: FAMILY_B, createdBy: UID.memberB }));
  });

  it('SAME-FAMILY caller CAN read a birthday (parent + member alike)', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      const db = env.authenticatedContext(uid).firestore();
      const { doc, getDoc } = await import('firebase/firestore');
      await assertSucceeds(getDoc(doc(db, 'birthdays', 'b-A')));
    }
  });

  it('cross-tenant: parent of B CANNOT read a family-A birthday', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'birthdays', 'b-A')));
  });
});

describe('birthdays — UPDATE', () => {
  beforeEach(async () => {
    await seedBirthday('b-A', freshBirthday());
  });

  it('ANY same-family member CAN update name (spec: full CRUD for the family)', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'birthdays', 'b-A'), {
        name: 'Maya Rivera',
        monthDay: '06-15',
        type: 'birthday',
      }),
    );
  });

  it('CANNOT change familyId (tenant lock)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'birthdays', 'b-A'), {
        familyId: FAMILY_B,
        name: 'x',
        monthDay: '06-15',
        type: 'birthday',
      }),
    );
  });

  it('CANNOT rewrite createdBy', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'birthdays', 'b-A'), {
        createdBy: UID.parentA,
        name: 'x',
        monthDay: '06-15',
        type: 'birthday',
      }),
    );
  });

  it('CANNOT update to a malformed monthDay', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'birthdays', 'b-A'), {
        name: 'Maya',
        monthDay: 'June 15',
        type: 'birthday',
      }),
    );
  });

  it('cross-tenant CANNOT update', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'birthdays', 'b-A'), {
        name: 'pwned',
        monthDay: '06-15',
        type: 'birthday',
      }),
    );
  });
});

describe('birthdays — DELETE', () => {
  beforeEach(async () => {
    await seedBirthday('b-A', freshBirthday());
  });

  it('ANY same-family member CAN delete (spec: full CRUD for the family)', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      await seedBirthday(`b-${uid}`, freshBirthday());
      const db = env.authenticatedContext(uid).firestore();
      const { deleteDoc, doc } = await import('firebase/firestore');
      await assertSucceeds(deleteDoc(doc(db, 'birthdays', `b-${uid}`)));
    }
  });

  it('cross-tenant CANNOT delete', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'birthdays', 'b-A')));
  });
});
