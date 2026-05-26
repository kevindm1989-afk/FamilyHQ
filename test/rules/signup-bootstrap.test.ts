/**
 * SECURITY-CRITICAL — Signup self-create is non-generalizable (M10, ADR-0006).
 *
 * Threat-model §4 proves the founding-parent bootstrap (the ONE place a client
 * may self-create a users doc with role=='parent') cannot be replayed by an
 * existing member to (a) elevate, (b) create/attach a second family, or (c)
 * flip themselves. Tests A-G below are §4's exact mitigation list.
 *
 * The four conjunctive properties the rule must enforce:
 *  (1) self-keyed: uid == request.auth.uid
 *  (2) no pre-existing users doc: !exists(users/{uid})  <-- the linchpin
 *  (3) family freshly created in the same batch with createdBy == uid
 *  (4) fixed shape: isActive==true, allowanceBalance==0, role=='parent'
 *
 * These FAIL today (deny-all => Test A's assertSucceeds throws) and pass once
 * the bounded self-create rule + the families-create rule land.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;

const NEW_FAMILY = 'family-fresh';

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
 * The rules-testing contexts return a compat Firestore instance from
 * `.firestore()`, not the modular SDK type. We accept it loosely and let the
 * modular `firebase/firestore` functions operate on it (they do at runtime).
 */
type ContextFirestore = ReturnType<
  ReturnType<
    Awaited<ReturnType<typeof getEnv>>['authenticatedContext']
  >['firestore']
>;

/** Atomic batch: create families/{fid} (createdBy) + users/{uid} (parent). */
async function bootstrapBatch(
  db: ContextFirestore,
  opts: {
    uid: string;
    familyId: string;
    createdBy?: string;
    role?: 'parent' | 'member';
    isActive?: boolean;
    allowanceBalance?: number;
    createFamily?: boolean;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  const { doc, writeBatch } = await import('firebase/firestore');
  // The context firestore is the compat instance; the modular fns accept it at
  // runtime. Cast to the modular type for the typed signatures.
  const mdb = db as unknown as import('firebase/firestore').Firestore;
  const batch = writeBatch(mdb);
  if (opts.createFamily !== false) {
    batch.set(doc(mdb, 'families', opts.familyId), {
      familyName: 'Fresh Family',
      createdBy: opts.createdBy ?? opts.uid,
      createdAt: Date.now(),
    });
  }
  batch.set(doc(mdb, 'users', opts.uid), {
    name: 'Founder',
    email: 'founder@example.test',
    role: opts.role ?? 'parent',
    familyId: opts.familyId,
    isActive: opts.isActive ?? true,
    allowanceBalance: opts.allowanceBalance ?? 0,
    theme: 'light',
    ...opts.extra,
  });
  await batch.commit();
}

describe('§4 / M10: founding-parent bootstrap (tests A-G)', () => {
  it('Test A: fresh uid creates families + parent users in one batch -> ALLOWED', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertSucceeds(
      bootstrapBatch(db, { uid: UID.fresh, familyId: NEW_FAMILY }),
    );
  });

  it('Test B: fresh uid self-creates users pointing at an EXISTING family (not created in this batch) -> DENIED (property 3)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, {
        uid: UID.fresh,
        familyId: FAMILY_A, // pre-existing family, NOT created here
        createFamily: false,
      }),
    );
  });

  it('Test C: an EXISTING member replays the bootstrap create -> DENIED (property 2, !exists)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    // memberA already has a users doc; the self-create can never fire.
    await assertFails(bootstrapBatch(db, { uid: UID.memberA, familyId: NEW_FAMILY }));
  });

  it('Test D: an existing member updates own role to parent -> DENIED (M3)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { role: 'parent' }));
  });

  it('Test E1: bootstrap with isActive:false -> DENIED (property 4)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, { uid: UID.fresh, familyId: NEW_FAMILY, isActive: false }),
    );
  });

  it('Test E2: bootstrap with allowanceBalance != 0 -> DENIED (property 4)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, {
        uid: UID.fresh,
        familyId: NEW_FAMILY,
        allowanceBalance: 500,
      }),
    );
  });

  it('Test E3: bootstrap smuggling an extra authority field -> DENIED (property 4)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, {
        uid: UID.fresh,
        familyId: NEW_FAMILY,
        extra: { isSuperAdmin: true },
      }),
    );
  });

  it('Test F: create a users doc for a DIFFERENT uid -> DENIED (property 1, self-keyed)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    // Caller is `fresh`, but the users doc key is someone else's uid.
    await assertFails(
      bootstrapBatch(db, { uid: 'uid-someone-else', familyId: NEW_FAMILY }),
    );
  });

  it('Test G: signup batch where families.createdBy != request.auth.uid -> DENIED (property 3)', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, {
        uid: UID.fresh,
        familyId: NEW_FAMILY,
        createdBy: 'uid-not-the-caller',
      }),
    );
  });

  it('non-generalizable: a fresh uid CANNOT self-create with role:member outside the invite flow', async () => {
    const db = env.authenticatedContext(UID.fresh).firestore();
    await assertFails(
      bootstrapBatch(db, { uid: UID.fresh, familyId: NEW_FAMILY, role: 'member' }),
    );
  });
});
