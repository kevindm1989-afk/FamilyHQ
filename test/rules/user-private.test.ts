/**
 * SECURITY/PRIVACY-CRITICAL — userPrivate/{uid} access (privacy finding 2, P7).
 *
 * Adult email [PI] was moved OFF the family-readable users doc onto a
 * per-subject userPrivate/{uid} doc so that other members of the family
 * (notably children) can never read an adult's email. The core privacy fix is
 * the last test in the "read authority" block: a member CANNOT read another
 * user's userPrivate.
 *
 * Rules contract (the implementer adds a `match /userPrivate/{userId}` block):
 *  - read: ONLY the subject (userId == auth.uid) OR a same-family active PARENT.
 *      Another MEMBER of the same family is DENIED (children must not see an
 *      adult's email). Cross-family read is DENIED.
 *  - create: bootstrap path — self-keyed (userId == auth.uid). Cross-uid create
 *      DENIED.
 *  - update: the subject may update own email; `familyId` is IMMUTABLE.
 *  - cross-family read/write: DENIED.
 *
 * These FAIL today: there is no userPrivate match block, so the default-deny
 * catch-all denies EVERY op — including the ALLOWED ones (self-read,
 * parent-read, self-create), whose assertSucceeds will throw. They pass once
 * the userPrivate rule lands.
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

describe('userPrivate read authority (privacy finding 2)', () => {
  it('the subject CAN read their OWN userPrivate doc', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'userPrivate', UID.memberA)));
  });

  it('a same-family PARENT CAN read a member userPrivate doc', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'userPrivate', UID.memberA)));
  });

  it('CORE FIX: a same-family MEMBER (child) CANNOT read another member userPrivate (adult email not exposed)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    // memberA tries to read parentA's private (email) doc — denied.
    await assertFails(getDoc(doc(db, 'userPrivate', UID.parentA)));
  });

  it('a same-family MEMBER CANNOT read another member userPrivate (peer member email)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'userPrivate', UID.member2A)));
  });

  it('a deactivated member CANNOT read even their own userPrivate', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'userPrivate', UID.deactivatedA)));
  });

  it('a cross-family PARENT CANNOT read a userPrivate in another family', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'userPrivate', UID.memberA)));
  });

  it('a cross-family MEMBER CANNOT read a userPrivate in another family', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'userPrivate', UID.parentA)));
  });

  it('an unauthenticated client CANNOT read any userPrivate doc', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'userPrivate', UID.memberA)));
  });
});

describe('userPrivate list is denied (no enumeration of adult emails)', () => {
  it('a parent CANNOT list the userPrivate collection', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'userPrivate')));
  });
});

describe('userPrivate write authority', () => {
  it('a fresh subject CAN self-create their own userPrivate (bootstrap path)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'userPrivate', UID.fresh), {
        email: 'founder@example.test',
        familyId: FAMILY_A,
      }),
    );
  });

  it('a caller CANNOT create a userPrivate doc keyed by ANOTHER uid', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'userPrivate', 'uid-someone-else'), {
        email: 'forged@example.test',
        familyId: FAMILY_A,
      }),
    );
  });

  it('the subject CAN update their own email (accuracy / PIPEDA principle 6)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'userPrivate', UID.memberA), { email: 'updated@example.test' }),
    );
  });

  it('the subject CANNOT change familyId on their own userPrivate (immutable, no tenant reassignment)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'userPrivate', UID.memberA), { familyId: FAMILY_B }),
    );
  });

  it('a member CANNOT write ANOTHER member userPrivate', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'userPrivate', UID.parentA), { email: 'hijack@example.test' }),
    );
  });

  it('a cross-family parent CANNOT write a userPrivate in another family', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'userPrivate', UID.memberA), { email: 'hijack@example.test' }),
    );
  });
});
