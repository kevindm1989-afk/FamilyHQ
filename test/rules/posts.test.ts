/**
 * SECURITY-CRITICAL — `posts` create / read / DELETE authorization (Task 9).
 *
 * Threat-model §3 (tenant isolation P1/P2/P4), §5.2 (deactivated user, F3/M26),
 * §8 priority-1 cross-tenant rows; ADR-0002 role model; constraints.md
 * "Tenant isolation — the #1 security requirement".
 *
 * The bulletin board adds a DELETE authorization requirement the current rules
 * do NOT yet encode correctly:
 *   - a same-family PARENT may delete ANY post in their family;
 *   - a MEMBER may delete ONLY their OWN post (authorId == uid);
 *   - a member must NOT delete another member's (or a parent's) post;
 *   - cross-family delete is denied for everyone;
 *   - a DEACTIVATED user may delete nothing.
 *
 * The shipped rule today is `allow delete: if isActive() && sameFamily(resource)`
 * — which lets ANY active same-family member delete ANY post. These tests PIN
 * the tightened rule (a per-author / parent split). The member-deletes-another's
 * cases below FAIL against the current over-permissive rule and pass once the
 * implementer tightens it. The create/read scoping cases assert the EXISTING
 * guarantees still hold (no weakening).
 *
 * Determinism: emulator-backed; each test seeds with rules disabled then asserts
 * through the rules. No real clock/network/RNG beyond the emulator; per-test
 * clearFirestore + reseed (no shared mutable state, order-independent).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;

// Post ids seeded per-test. `post-family-A` (from seedBaseline) is authored by
// parentA. We add member-authored posts so the member-own-vs-others split is
// exercisable.
const POST_BY_PARENT_A = `post-${FAMILY_A}`;
const POST_BY_MEMBER_A = 'post-by-member-a';
const POST_BY_MEMBER_2A = 'post-by-member-2-a';
const POST_BY_PARENT_B = `post-${FAMILY_B}`;

async function seedExtraPosts(): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'posts', POST_BY_MEMBER_A), {
      content: 'Member A post',
      authorId: UID.memberA,
      authorName: 'Member A',
      familyId: FAMILY_A,
      createdAt: Date.now(),
    });
    await setDoc(doc(db, 'posts', POST_BY_MEMBER_2A), {
      content: 'Member Two A post',
      authorId: UID.member2A,
      authorName: 'Member Two A',
      familyId: FAMILY_A,
      createdAt: Date.now(),
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
  await seedExtraPosts();
});
afterEach(async () => {
  await env.clearFirestore();
});

describe('posts create — signed-in + active + incomingSameFamily + authored-by-self (existing guarantee)', () => {
  it('an active member CAN create an own-family post authored by themselves', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'posts', 'new-by-member-a'), {
        content: 'hello family',
        authorId: UID.memberA,
        authorName: 'Member A',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a create with a FOREIGN familyId is denied (no cross-tenant write, P4)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'posts', 'forged-family'), {
        content: 'leak',
        authorId: UID.parentA,
        authorName: 'Parent A',
        familyId: FAMILY_B, // forged — not the caller's family
        createdAt: Date.now(),
      }),
    );
  });

  it('a DEACTIVATED user CANNOT create a post (F3/M26)', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'posts', 'by-deactivated'), {
        content: 'should be denied',
        authorId: UID.deactivatedA,
        authorName: 'Deactivated A',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('an UNAUTHENTICATED client CANNOT create a post', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'posts', 'by-anon'), {
        content: 'anon',
        authorId: 'nobody',
        authorName: 'Nobody',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });
});

describe('posts read — own-family only (existing guarantee, P1/P2/P7)', () => {
  it('an active member CAN get an own-family post', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'posts', POST_BY_PARENT_A)));
  });

  it('a family-A member CANNOT get a family-B post', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'posts', POST_BY_PARENT_B)));
  });

  it('own-family where(familyId==A) list of posts is allowed', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertSucceeds(
      getDocs(query(collection(db, 'posts'), where('familyId', '==', FAMILY_A))),
    );
  });

  it('an UNCONSTRAINED list of posts is denied (P2/M7)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'posts')));
  });

  it('a cross-family where(familyId==B) list of posts is denied (P2/M7)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(query(collection(db, 'posts'), where('familyId', '==', FAMILY_B))),
    );
  });
});

describe('posts DELETE — parent deletes any; member deletes only own (Task 9 NEW rule)', () => {
  it('a same-family PARENT CAN delete another member’s post', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'posts', POST_BY_MEMBER_A)));
  });

  it('a same-family PARENT CAN delete their own post', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'posts', POST_BY_PARENT_A)));
  });

  it('a MEMBER CAN delete their OWN post', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'posts', POST_BY_MEMBER_A)));
  });

  it('a MEMBER CANNOT delete ANOTHER member’s post (tightening — fails the over-permissive rule)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'posts', POST_BY_MEMBER_2A)));
  });

  it('a MEMBER CANNOT delete a PARENT’s post (tightening)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'posts', POST_BY_PARENT_A)));
  });

  it('a cross-family PARENT CANNOT delete a post in another family (P1)', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'posts', POST_BY_MEMBER_A)));
  });

  it('a cross-family MEMBER CANNOT delete a post in another family (P1)', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'posts', POST_BY_MEMBER_A)));
  });

  it('a DEACTIVATED user CANNOT delete even their own post (F3/M26)', async () => {
    // Seed a post authored by the deactivated user, then assert deletion denied.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const inner = ctx.firestore();
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(inner, 'posts', 'post-by-deactivated-a'), {
        content: 'authored while active',
        authorId: UID.deactivatedA,
        authorName: 'Deactivated A',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      });
    });
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'posts', 'post-by-deactivated-a')));
  });

  it('an UNAUTHENTICATED client CANNOT delete a post', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'posts', POST_BY_MEMBER_A)));
  });
});
