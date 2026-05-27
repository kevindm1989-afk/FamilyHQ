/**
 * SECURITY-CRITICAL — Chores MEMBER-VIEW rules (Phase 3, Task 10; threat-model
 * M1/P1/P7/P10 cross-tenant + own-assignee READ scoping, M4/T1.4 member write
 * authority, M3/T1.3 no allowanceBalance write, M26/F3 deactivated gating).
 *
 * The member view (handoff #05a ChoresTeenScreen) READS the member's OWN chores
 * and MARKS them complete — and nothing else. This file pins the READ-path +
 * balance + cross-tenant guarantees specific to that view. The member WRITE
 * transitions (pending->complete only, no self-approve, no value edits, no
 * create) are pinned in chores-roles.test.ts; a couple are re-asserted here so
 * this view's contract reads as a whole.
 *
 * These should LARGELY PASS against the CURRENT rules — this feature should NOT
 * need a rules change (the member chore + users-immutability rules already
 * exist from Phases 1-2). Any case that unexpectedly FAILS is a REAL gap to
 * flag, not a test to relax.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;

// chore-${FAMILY_A} is seeded assignedTo memberA, status pending, family A.
const CHORE_A = `chore-${FAMILY_A}`;
const CHORE_B = `chore-${FAMILY_B}`; // assignedTo memberB, family B.
// A SECOND family-A chore assigned to the PEER (member2A), seeded locally below
// (owned by this file, mirroring posts.test.ts's seedExtraPosts). The baseline
// seed only carries ONE family-A chore (assignedTo memberA); to prove that a
// member's family-only list is DENIED when it would surface a peer's chore, and
// that a peer's get is denied, family A must genuinely contain a chore NOT
// assigned to memberA. Without this, a family-only list by memberA would return
// only memberA's own chore and the tightened rule would (wrongly) allow it.
const CHORE_PEER_A = 'chore-peer-a'; // family A, assignedTo member2A, pending.

async function seedPeerChore(): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'chores', CHORE_PEER_A), {
      title: 'Walk the dog',
      assignedTo: UID.member2A,
      dueDate: '2026-05-27',
      pointValue: 5,
      dollarValue: 1,
      status: 'pending',
      familyId: FAMILY_A,
      createdBy: UID.parentA,
      createdAt: Date.now(),
      isRecurring: false,
      recurrenceFrequency: 'none',
    });
  });
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
  await seedPeerChore();
});
afterEach(async () => {
  await env.clearFirestore();
});

describe('M1/own-assignee: a member can READ ONLY their own chores, scoped to own family', () => {
  it('member CAN get their OWN chore (assignedTo == self, same family)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'chores', CHORE_A)));
  });

  it('member CAN list chores constrained to own family AND own assignment (the only query the view issues)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'chores'),
          where('familyId', '==', FAMILY_A),
          where('assignedTo', '==', UID.memberA),
        ),
      ),
    );
  });

  it('member CAN list own-family + own-assignment chores ordered by createdAt DESC (EXACT production query — exercises the composite index)', async () => {
    // This is the LITERAL query useMyChores issues:
    //   where(familyId==A) + where(assignedTo==self) + orderBy(createdAt,desc).
    // Running it through the emulator exercises the composite-index requirement
    // in firestore.indexes.json — if that index were missing or its field order
    // were wrong (e.g. createdAt ASC, or assignedTo/familyId swapped), the
    // emulator would reject this query with a failed-precondition, so this MUST
    // succeed. A bare equality-only list (asserted elsewhere) would NOT catch a
    // mis-ordered index, because no orderBy means no composite-index need.
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, orderBy, query, where } = await import('firebase/firestore');
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'chores'),
          where('familyId', '==', FAMILY_A),
          where('assignedTo', '==', UID.memberA),
          orderBy('createdAt', 'desc'),
        ),
      ),
    );
  });

  it('member CANNOT list chores with an UNCONSTRAINED query (would leak others) — denied', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    // The seed has a FAMILY_B chore, so an unconstrained list would surface a
    // foreign-family doc — the per-resource family rule denies it.
    await assertFails(getDocs(collection(db, 'chores')));
  });

  it('member CANNOT list chores filtered to OWN family but WITHOUT the own-assignment filter — denied', async () => {
    // family-A has chores for memberA (CHORE_A) AND member2A (CHORE_PEER_A,
    // seeded locally). A list scoped to the family but not to assignee would
    // surface CHORE_PEER_A, whose assignedTo (member2A) != memberA, so the
    // per-resource own-assignee predicate denies it for a member (M7-style
    // per-doc scoping). This denial is REAL only because CHORE_PEER_A exists.
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(query(collection(db, 'chores'), where('familyId', '==', FAMILY_A))),
    );
  });
});

describe('M1/P10: cross-assignee and cross-family chore reads are DENIED for a member', () => {
  it('member CANNOT get a chore assigned to a DIFFERENT member in the same family', async () => {
    // CHORE_A is assigned to memberA; member2A is a different member of family A.
    // Tightened rule: a member may read ONLY chores where assignedTo == own uid,
    // so a same-family PEER's chore is DENIED at the get rule (spec: "Members
    // see only their own chores"). This is no longer a mere QUERY contract.
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'chores', CHORE_A)));
  });

  it('member CANNOT get a chore assigned to a peer, viewed from the peer-owned chore (symmetric direction)', async () => {
    // The reverse direction: memberA gets CHORE_PEER_A (assignedTo member2A).
    // assignedTo (member2A) != memberA, so the tightened get rule denies it.
    // Pinning both directions guarantees the rule keys on assignedTo == own uid,
    // not on a single fixture's particular assignee.
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'chores', CHORE_PEER_A)));
  });

  it('member CANNOT list a PEER\'s chores by filtering assignedTo to the peer (same family) — denied', async () => {
    // member2A queries family-A chores filtered to memberA's assignment. Each
    // returned doc has assignedTo == memberA != member2A, so the per-resource
    // own-assignee predicate denies the list for member2A.
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(
        query(
          collection(db, 'chores'),
          where('familyId', '==', FAMILY_A),
          where('assignedTo', '==', UID.memberA),
        ),
      ),
    );
  });

  it('member of family A CANNOT get a family-B chore (cross-tenant)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'chores', CHORE_B)));
  });

  it('member of family A CANNOT list family-B chores even with a cross-family where filter', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(query(collection(db, 'chores'), where('familyId', '==', FAMILY_B))),
    );
  });
});

describe('Task 11 approval queue: a PARENT can READ ANY chore in their OWN family', () => {
  it('parent CAN get a chore assigned to a member of their family (approval queue)', async () => {
    // CHORE_A is assigned to memberA, NOT to parentA. The tightened rule keeps
    // parents able to read ANY in-family chore (isParent() branch), which the
    // parent approval queue (Task 11) depends on.
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'chores', CHORE_A)));
  });

  it('parent CAN list ALL chores in their own family (no own-assignment filter needed)', async () => {
    // The approval queue lists every family chore regardless of assignee; a
    // family-only filter must succeed for a parent (the isParent() branch
    // bypasses the per-resource own-assignee predicate).
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertSucceeds(
      getDocs(query(collection(db, 'chores'), where('familyId', '==', FAMILY_A))),
    );
  });

  it('parent of family A CANNOT get a family-B chore (cross-tenant, parent is not exempt)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'chores', CHORE_B)));
  });

  it('parent of family A CANNOT list family-B chores even with a cross-family filter', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(query(collection(db, 'chores'), where('familyId', '==', FAMILY_B))),
    );
  });
});

describe('M4/T1.4: the ONLY member chore mutation is pending -> complete on OWN chore', () => {
  it('member CAN move OWN chore pending -> complete', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });

  it('member CANNOT self-approve (pending -> approved) to credit themselves', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'approved' }));
  });

  it('member CANNOT mark complete a chore NOT assigned to them', async () => {
    // CHORE_A is assigned to memberA; member2A attempts to complete it.
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });

  it('member CANNOT change pointValue/dollarValue while completing own chore', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'chores', CHORE_A), {
        status: 'complete',
        pointValue: 999,
        dollarValue: 999,
      }),
    );
  });

  it('member CANNOT reassign a chore to themselves while completing it', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // member2A cannot grab CHORE_A by setting assignedTo to self + complete.
    await assertFails(
      updateDoc(doc(db, 'chores', CHORE_A), {
        status: 'complete',
        assignedTo: UID.member2A,
      }),
    );
  });
});

describe('M3/T1.3: a member CANNOT write their own allowanceBalance (no self-credit)', () => {
  it('member CANNOT set their own allowanceBalance on the users doc', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 999 }));
  });

  it('member CANNOT elevate their own role to parent', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { role: 'parent' }));
  });
});

describe('M26/F3: a DEACTIVATED member cannot read or complete chores', () => {
  it('deactivated member CANNOT get a chore', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'chores', CHORE_A)));
  });

  it('deactivated member CANNOT list chores even with the own-family filter', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(query(collection(db, 'chores'), where('familyId', '==', FAMILY_A))),
    );
  });
});
