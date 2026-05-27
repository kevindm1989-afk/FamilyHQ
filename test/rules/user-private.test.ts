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

const NEW_FAMILY = 'family-private-fresh';

/**
 * The rules-testing contexts return a compat Firestore instance from
 * `.firestore()`. We accept it loosely; the modular `firebase/firestore`
 * functions operate on it at runtime.
 */
type ContextFirestore = ReturnType<
  ReturnType<Awaited<ReturnType<typeof getEnv>>['authenticatedContext']>['firestore']
>;

/**
 * Founding-parent bootstrap batch MIRRORING the real signup
 * (signup-bootstrap.test.ts / authService.signUpFoundingParent): a fresh uid
 * atomically writes families/{fid} (createdBy == uid) + a parent users/{uid}
 * doc + the userPrivate/{uid} doc carrying the SAME familyId. This is the ONLY
 * legitimate path that creates a userPrivate doc, and the userPrivate create
 * rule must bind its familyId to the family the caller belongs to (same-batch
 * users doc + getAfter on families), NOT accept an arbitrary client value.
 */
async function bootstrapBatch(
  db: ContextFirestore,
  opts: {
    uid: string;
    usersFamilyId: string;
    privateFamilyId?: string;
    createdBy?: string;
    createFamily?: boolean;
    privateExtra?: Record<string, unknown>;
    omitPrivateFamilyId?: boolean;
  },
): Promise<void> {
  const { doc, writeBatch } = await import('firebase/firestore');
  const mdb = db as unknown as import('firebase/firestore').Firestore;
  const batch = writeBatch(mdb);
  const privateFamily = opts.privateFamilyId ?? opts.usersFamilyId;
  if (opts.createFamily !== false) {
    batch.set(doc(mdb, 'families', opts.usersFamilyId), {
      familyName: 'Fresh Family',
      createdBy: opts.createdBy ?? opts.uid,
      createdAt: Date.now(),
    });
  }
  batch.set(doc(mdb, 'users', opts.uid), {
    name: 'Founder',
    role: 'parent',
    familyId: opts.usersFamilyId,
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  });
  const privateDoc: Record<string, unknown> = { email: 'founder@example.test' };
  if (!opts.omitPrivateFamilyId) privateDoc.familyId = privateFamily;
  batch.set(doc(mdb, 'userPrivate', opts.uid), { ...privateDoc, ...opts.privateExtra });
  await batch.commit();
}

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
  // FLIPPED (Finding 1, HIGH): the old test asserted a fresh subject could
  // self-create their userPrivate with an ARBITRARY familyId (FAMILY_A) to
  // which they have no relationship — that asserted the unbounded-create hole.
  // The legitimate bootstrap creates the family + users + userPrivate in ONE
  // batch and the userPrivate.familyId must equal the family the caller is
  // joining (their same-batch users doc / the family they create).
  it('a founding parent CAN self-create userPrivate in the SAME bootstrap batch (familyId matches own new family)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertSucceeds(
      bootstrapBatch(db, { uid: UID.fresh, usersFamilyId: NEW_FAMILY }),
    );
  });

  it('Finding 1: a fresh subject CANNOT self-create userPrivate with an arbitrary foreign familyId (no same-batch users doc claiming it)', async () => {
    // No users doc, no family created — just a bare userPrivate claiming a
    // pre-existing foreign tenant. This is the exact hole the old test asserted.
    const db = env.authenticatedContext(UID.fresh).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'userPrivate', UID.fresh), {
        email: 'founder@example.test',
        familyId: FAMILY_A,
      }),
    );
  });

  it('Finding 1: founding-parent batch whose userPrivate.familyId differs from the batch users/family -> DENIED (cross-tenant userPrivate)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, {
        uid: UID.fresh,
        usersFamilyId: NEW_FAMILY,
        privateFamilyId: FAMILY_A, // points at a foreign tenant, not own new family
      }),
    );
  });

  it('Finding 1: an ESTABLISHED member (users doc says FAMILY_A, no userPrivate yet) CANNOT create a userPrivate carrying a foreign familyId', async () => {
    // establishedNoPrivateA has users/{uid} with familyId == FAMILY_A but NO
    // userPrivate yet, so this is a genuine CREATE. Claiming FAMILY_B must be
    // denied — the create familyId is bound to the caller's own family.
    const db = env.authenticatedContext(UID.establishedNoPrivateA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'userPrivate', UID.establishedNoPrivateA), {
        email: 'foreign@example.test',
        familyId: FAMILY_B,
      }),
    );
  });

  it('an ESTABLISHED member CAN create their own userPrivate with their OWN familyId (positive control for the bound create)', async () => {
    // Same actor, claiming the family their users doc already says (FAMILY_A):
    // a legitimate self-create that the bound rule must still permit.
    const db = env.authenticatedContext(UID.establishedNoPrivateA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'userPrivate', UID.establishedNoPrivateA), {
        email: 'mine@example.test',
        familyId: FAMILY_A,
      }),
    );
  });

  it('Finding 1: userPrivate create carrying an EXTRA field is DENIED (keys().hasOnly([email,familyId]))', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, {
        uid: UID.fresh,
        usersFamilyId: NEW_FAMILY,
        privateExtra: { isSuperAdmin: true },
      }),
    );
  });

  it('Finding 1: userPrivate create MISSING familyId is DENIED (keys().hasOnly([email,familyId]) requires both)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, {
        uid: UID.fresh,
        usersFamilyId: NEW_FAMILY,
        omitPrivateFamilyId: true,
      }),
    );
  });

  it('Finding 1: an existing userPrivate cannot be clobbered by a fresh create (familyId already pinned)', async () => {
    // memberA's userPrivate already exists (seeded with FAMILY_A). A second
    // create attempting to repoint familyId to FAMILY_B is an update under the
    // hood and must be denied (familyId immutable; not a fresh create).
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'userPrivate', UID.memberA), {
        email: 'clobber@example.test',
        familyId: FAMILY_B,
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

  it('Finding C (M26): a DEACTIVATED established member CANNOT create their own userPrivate', async () => {
    // deactivatedNoPrivateA has users/{uid} with familyId == FAMILY_A and
    // isActive:false, and NO userPrivate yet -> a genuine CREATE. The userPrivate
    // create rule must require isActive() (consistent with the get rule), so a
    // deactivated user creating their own private doc is DENIED even though the
    // familyId matches their own family.
    const db = env.authenticatedContext(UID.deactivatedNoPrivateA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'userPrivate', UID.deactivatedNoPrivateA), {
        email: 'deactivated@example.test',
        familyId: FAMILY_A,
      }),
    );
  });

  it('Finding C (M26): a DEACTIVATED established member CANNOT update their own userPrivate email', async () => {
    // deactivatedA has a seeded userPrivate (FAMILY_A). Updating its email must
    // be DENIED because the update rule must require isActive() (M26): a
    // deactivated user can no longer mutate their own private data.
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'userPrivate', UID.deactivatedA), { email: 'reactivated@example.test' }),
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
