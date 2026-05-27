/**
 * SECURITY-CRITICAL — Tenant isolation (the #1 risk).
 *
 * Threat-model §3 leakage paths P1-P12; mitigations M1, M7, M22, M23, M24, M25.
 * constraints.md "Tenant isolation — the #1 security requirement".
 *
 * A user of family A must be DENIED get/list/write on every collection's docs
 * belonging to family B. List queries must be forced to carry the own-family
 * filter. Creates with a foreign familyId must be denied.
 *
 * These FAIL today (deny-all placeholder rules => every assertSucceeds throws)
 * and pass once the implementer writes the real family-scoped rules.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  FAMILY_A,
  FAMILY_B,
  UID,
  getEnv,
  seedBaseline,
  teardownEnv,
} from './helpers';

const TENANT_COLLECTIONS = ['events', 'posts', 'chores', 'transactions'] as const;

// Seed doc ids are `${singular}-${familyId}` (e.g. `event-family-B`,
// `txn-family-B`). See seedBaseline in helpers.ts.
const SEED_DOC_ID: Record<(typeof TENANT_COLLECTIONS)[number], (fid: string) => string> = {
  events: (fid) => `event-${fid}`,
  posts: (fid) => `post-${fid}`,
  chores: (fid) => `chore-${fid}`,
  transactions: (fid) => `txn-${fid}`,
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

describe('P1/M1: cross-tenant single-doc read (get) is denied', () => {
  for (const col of TENANT_COLLECTIONS) {
    it(`P1: family-A member CANNOT get a family-B ${col} doc by id`, async () => {
      const aDb = env.authenticatedContext(UID.memberA).firestore();
      const { doc, getDoc } = await import('firebase/firestore');
      await assertFails(getDoc(doc(aDb, col, SEED_DOC_ID[col](FAMILY_B))));
    });
  }

  it('P7: family-A member CANNOT get a family-B users/{uid} doc', async () => {
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(aDb, 'users', UID.parentB)));
  });

  it('P1: family-A member CAN get an own-family chore doc', async () => {
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(aDb, 'chores', `chore-${FAMILY_A}`)));
  });
});

describe('P2/P12/M7: list queries must carry the own-family filter', () => {
  for (const col of TENANT_COLLECTIONS) {
    it(`P2: unconstrained list of ${col} is denied`, async () => {
      const aDb = env.authenticatedContext(UID.memberA).firestore();
      const { collection, getDocs } = await import('firebase/firestore');
      await assertFails(getDocs(collection(aDb, col)));
    });

    it(`P2: cross-family where('familyId','==',B) list of ${col} is denied`, async () => {
      const aDb = env.authenticatedContext(UID.memberA).firestore();
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      await assertFails(
        getDocs(query(collection(aDb, col), where('familyId', '==', FAMILY_B))),
      );
    });

    it(`P2: own-family where('familyId','==',A) list of ${col} is allowed`, async () => {
      // chores reads are own-assignee-scoped for members (see
      // chores-member-view.test.ts); a member's family-only chore list is
      // denied — they must add where('assignedTo','==',uid). The allow/deny
      // cases for member chore lists live in that file, so we don't duplicate
      // them here; we only exclude chores from this member-own-family-list
      // assertion. (The unconstrained-denied and cross-family-denied chore
      // iterations above still apply and must keep running.)
      //
      // transactions are own-or-parent read-scoped per ADR-0004 (same pattern
      // as chores): a MEMBER's family-only transactions list WITHOUT a
      // where('uid','==',uid) filter would surface a peer's doc and is now
      // intentionally DENIED. The dedicated allow/deny cases for member
      // transaction lists live in allowance-approval.test.ts (the
      // "transactions read scoping" describe), so we don't duplicate them here;
      // we only exclude transactions from this member-own-family-list assertion.
      // (The unconstrained-denied and cross-family-denied transactions
      // iterations above still apply and must keep running.)
      if (col === 'chores' || col === 'transactions') return;
      const aDb = env.authenticatedContext(UID.memberA).firestore();
      const { collection, getDocs, query, where } = await import('firebase/firestore');
      await assertSucceeds(
        getDocs(query(collection(aDb, col), where('familyId', '==', FAMILY_A))),
      );
    });
  }

  it('P7: unconstrained list of users is denied', async () => {
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(aDb, 'users')));
  });

  it('P7: own-family users list (where familyId==A) is allowed', async () => {
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertSucceeds(
      getDocs(query(collection(aDb, 'users'), where('familyId', '==', FAMILY_A))),
    );
  });
});

describe('P3/P4/M22/M23: create with a foreign familyId is denied (no client-supplied family trust)', () => {
  for (const col of ['events', 'posts', 'chores'] as const) {
    it(`P3/P4: parent of A creating a ${col} with familyId:B is denied`, async () => {
      const aDb = env.authenticatedContext(UID.parentA).firestore();
      const { doc, setDoc } = await import('firebase/firestore');
      await assertFails(
        setDoc(doc(aDb, col, 'forged-doc'), {
          title: 'x',
          content: 'x',
          authorId: UID.parentA,
          authorName: 'Parent A',
          assignedTo: UID.memberA,
          date: '2026-05-26',
          dueDate: '2026-05-27',
          tag: 'family',
          pointValue: 1,
          dollarValue: 1,
          status: 'pending',
          familyId: FAMILY_B, // forged — not the caller's family
          createdBy: UID.parentA,
          createdAt: Date.now(),
          isRecurring: false,
          recurrenceFrequency: 'none',
        }),
      );
    });
  }

  it('P3: get() rule cannot be tricked by a client-supplied familyId (family derived server-side)', async () => {
    // Reading a family-B doc must be denied for a family-A caller regardless of
    // any client claim; the rule derives family from callerDoc(), not request.
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(aDb, 'posts', `post-${FAMILY_B}`)));
  });

  it('P4: parent of A CAN create an own-family (familyId:A) post', async () => {
    const aDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(aDb, 'posts', 'own-post'), {
        content: 'hello family',
        authorId: UID.parentA,
        authorName: 'Parent A',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });
});

describe('cross-tenant write/update/delete is denied', () => {
  it('P1: family-A parent CANNOT update a family-B post', async () => {
    const aDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(aDb, 'posts', `post-${FAMILY_B}`), { content: 'tampered' }),
    );
  });

  it('P1: family-A parent CANNOT delete a family-B chore', async () => {
    const aDb = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(aDb, 'chores', `chore-${FAMILY_B}`)));
  });
});

describe('P8/M24: families doc access', () => {
  it('P8: family-A member CANNOT read a family-B families doc', async () => {
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(aDb, 'families', FAMILY_B)));
  });

  it('P8: active member CAN read OWN family doc', async () => {
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(aDb, 'families', FAMILY_A)));
  });

  it('M24: a member CANNOT write own family doc (parents only)', async () => {
    const aDb = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(aDb, 'families', FAMILY_A), { familyName: 'Renamed' }));
  });

  it('M24: a parent CAN rename OWN family doc', async () => {
    const aDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(aDb, 'families', FAMILY_A), { familyName: 'The A Family' }),
    );
  });

  it('M24: a parent of A CANNOT rename family B', async () => {
    const aDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(aDb, 'families', FAMILY_B), { familyName: 'hijack' }));
  });
});
