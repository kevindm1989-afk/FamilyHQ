/**
 * SECURITY-CRITICAL — Deactivated-user gating (M26, P11, F3) and
 * unauthenticated denial (M2, T1.2, P-no-anon).
 *
 * Threat-model §5.2: isActive() is part of EVERY authenticated predicate, not
 * just UI gating. A user with isActive:false is denied all reads/writes across
 * collections. And no unauthenticated client may touch any collection.
 *
 * These FAIL today (deny-all denies even the allowed cases, so the
 * assertSucceeds active-user controls throw) and pass once isActive() is woven
 * into the rules.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

const ALL_COLLECTIONS = [
  'families',
  'users',
  'events',
  'posts',
  'chores',
  'transactions',
  'invites',
] as const;

const TENANT_COLLECTIONS = ['events', 'posts', 'chores', 'transactions', 'invites'] as const;
const SEED_DOC_ID: Record<string, string> = {
  events: `event-${FAMILY_A}`,
  posts: `post-${FAMILY_A}`,
  chores: `chore-${FAMILY_A}`,
  transactions: `txn-${FAMILY_A}`,
  invites: `invite-${FAMILY_A}`,
};

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

describe('M2/T1.2: unauthenticated access is denied on every collection', () => {
  for (const col of ALL_COLLECTIONS) {
    it(`anon CANNOT list ${col}`, async () => {
      const db = env.unauthenticatedContext().firestore();
      const { collection, getDocs } = await import('firebase/firestore');
      await assertFails(getDocs(collection(db, col)));
    });

    it(`anon CANNOT write ${col}`, async () => {
      const db = env.unauthenticatedContext().firestore();
      const { doc, setDoc } = await import('firebase/firestore');
      await assertFails(setDoc(doc(db, col, 'anon-doc'), { familyId: FAMILY_A }));
    });
  }

  it('anon CANNOT read own-looking families doc', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'families', FAMILY_A)));
  });
});

describe('M26/P11/F3: a deactivated (isActive:false) user is denied all ops', () => {
  it('deactivated user CANNOT read own users doc', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'users', UID.deactivatedA)));
  });

  it('deactivated user CANNOT read own family doc', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'families', FAMILY_A)));
  });

  for (const col of TENANT_COLLECTIONS) {
    it(`deactivated user CANNOT list own-family ${col}`, async () => {
      const db = env.authenticatedContext(UID.deactivatedA).firestore();
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      await assertFails(
        getDocs(query(collection(db, col), where('familyId', '==', FAMILY_A))),
      );
    });

    it(`deactivated user CANNOT read own-family ${col} doc by id`, async () => {
      const db = env.authenticatedContext(UID.deactivatedA).firestore();
      const { doc, getDoc } = await import('firebase/firestore');
      await assertFails(getDoc(doc(db, col, SEED_DOC_ID[col]!)));
    });
  }

  it('deactivated user CANNOT create a post in own family', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'posts', 'deactivated-post'), {
        content: 'should not be allowed',
        authorId: UID.deactivatedA,
        authorName: 'Deactivated',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('control: an ACTIVE member CAN read own users doc (proves the deny is isActive, not blanket)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'users', UID.memberA)));
  });
});
