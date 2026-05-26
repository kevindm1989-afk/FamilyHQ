/**
 * SECURITY-CRITICAL — Role / familyId immutability on self-update (M3, F2).
 *
 * Threat-model T1.3, §5.1; constraints "No role self-elevation. No tenant
 * reassignment." A member updating their OWN users doc may change only `name`
 * and `theme`. They may NOT change `role`, `familyId`, `email`, `isActive`, or
 * `allowanceBalance`.
 *
 * These FAIL today (deny-all) and pass once the real `users` update rule with
 * immutable(field) predicates lands.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

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

describe('M3: subject self-update of authority fields is denied', () => {
  it('M3: member CANNOT set own role to parent (no self-elevation)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { role: 'parent' }));
  });

  it('M3: member CANNOT change own familyId (no tenant reassignment)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { familyId: FAMILY_B }));
  });

  it('M3: member CANNOT change own email', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { email: 'new@example.test' }),
    );
  });

  it('M3: member CANNOT flip own isActive to re-activate themselves', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { isActive: false }));
  });

  it('M3/M27: member CANNOT increment own allowanceBalance', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 999 }),
    );
  });

  it('M3: member CANNOT change role AND name together (mixed write still denied)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { name: 'Renamed', role: 'parent' }),
    );
  });
});

describe('M3: subject may change only name and theme', () => {
  it('M3: member CAN change own name', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { name: 'New Name' }));
  });

  it('M3: member CAN change own theme to dark', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { theme: 'dark' }));
  });
});

describe('M3: a member cannot tamper with ANOTHER user doc', () => {
  it('M3: member CANNOT edit a different same-family member doc', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.member2A), { name: 'Hacked' }));
  });
});
