/**
 * SECURITY-CRITICAL — Allowance balance write authority (M27/M28) and invites
 * access (M25/P9), plus the transactions append-only ledger (M6).
 *
 * Threat-model §5.3 (allowanceBalance writable only by a same-family parent;
 * direct member increment denied — the FULL credit transaction is Phase 3),
 * §2.2/P9 (invites parent-only + sameFamily), T1.6 (transactions append-only).
 *
 * These FAIL today (deny-all) and pass once the rules land.
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

/**
 * SECURITY FINDING 1/3 (revised per ADR-0004) — a same-family ACTIVE parent
 * doing an updateDoc on a member's users doc may change `name`, `isActive`, OR
 * `allowanceBalance`. Per ADR-0004 (client-transaction allowance model), the
 * `parentAllowanceCredit` rule MUST permit a same-family parent to write
 * `allowanceBalance` because Firestore rules cannot distinguish the approval
 * `runTransaction`'s balance write from a bare write. The rule constrains that
 * write to a NON-NEGATIVE change of ONLY `allowanceBalance`.
 *
 * INTEGRITY NOTE (ADR-0004 limitation): the property "balance only grows via an
 * approved chore + a matching ledger doc" is NOT a rules guarantee. It is
 * enforced by the `approveChore` transaction's status guard plus the approval
 * tests (allowance-approval.test.ts), not by these rules. So a bare credit
 * here is ALLOWED by the rules; the no-bare-credit-without-an-approved-chore
 * property lives at the transaction layer.
 *
 * role, email, and familyId are never parent-writable on a member doc, a
 * DECREASE is denied, and a balance change bundled with any other field is
 * denied (allowanceBalance must be the only affected key).
 */
describe('M28: parent update of a member doc — name, isActive, or a non-negative allowanceBalance credit', () => {
  it('same-family parent CAN set a member name', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { name: 'Renamed' }));
  });

  it('same-family parent CAN deactivate a member (isActive:false)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { isActive: false }));
  });

  it('same-family parent CAN re-activate a member (isActive:true)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // deactivatedA is seeded isActive:false; a parent may flip it back to true.
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.deactivatedA), { isActive: true }),
    );
  });

  it('same-family parent CAN set name AND isActive together', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.memberA), { name: 'Renamed', isActive: false }),
    );
  });

  it('M28/ADR-0004: same-family parent CAN credit a member allowanceBalance to a HIGHER value (only allowanceBalance changes)', async () => {
    // Seed balance is 0; crediting to 25 is a non-negative change of ONLY
    // allowanceBalance, which parentAllowanceCredit permits. The
    // no-bare-credit-without-an-approved-chore integrity property is enforced by
    // the approveChore transaction + its tests, NOT by these rules (ADR-0004).
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }),
    );
  });

  it('M28/ADR-0004: same-family parent CANNOT DECREASE a member allowanceBalance (new < old denied)', async () => {
    // Raise the balance to 25 first (with rules disabled), then a parent write
    // to 10 is a decrease — parentAllowanceCredit requires new >= old, so deny.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'users', UID.memberA), { allowanceBalance: 25 });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 10 }),
    );
  });

  it('M28/ADR-0004: a member CANNOT write their OWN allowanceBalance (self-credit denied)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }),
    );
  });

  it('M28/ADR-0004: a CROSS-FAMILY parent CANNOT credit a member allowanceBalance (tenant isolation)', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }),
    );
  });

  it('M28/ADR-0004: a DEACTIVATED parent-context actor CANNOT credit a member allowanceBalance (M26)', async () => {
    // deactivatedA is a same-family member with isActive:false; isParent() (and
    // isActive()) both fail, so the credit branch is denied for them.
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 25 }),
    );
  });

  it('same-family parent CANNOT change a member role (no parent-granted elevation)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { role: 'parent' }));
  });

  it('same-family parent CANNOT change a member familyId (no tenant reassignment)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { familyId: FAMILY_B }));
  });

  it('same-family parent CANNOT write a member email onto the family-readable users doc (email left this doc)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { email: 'leak@example.test' }),
    );
  });

  it('same-family parent CANNOT change allowanceBalance bundled with another field (only allowanceBalance may change)', async () => {
    // parentAllowanceCredit requires affectedKeys().hasOnly(['allowanceBalance']);
    // a write that also changes `name` affects {name, allowanceBalance}, which is
    // neither the credit set nor the {name,isActive} bare-update set — denied.
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { name: 'Renamed', allowanceBalance: 99 }),
    );
  });

  it('cross-family parent CANNOT update another family member (name)', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { name: 'hijack' }));
  });

  it('cross-family parent CANNOT deactivate another family member', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { isActive: false }));
  });
});

describe('M6/T1.6: transactions ledger is append-only', () => {
  it('parent CAN create an in-family transaction (earning)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'transactions', 'new-earning'), {
        uid: UID.memberA,
        choreId: `chore-${FAMILY_A}`,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('nobody can UPDATE an existing transaction (append-only)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'transactions', `txn-${FAMILY_A}`), { amount: 9999 }),
    );
  });

  it('nobody can DELETE an existing transaction (append-only)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'transactions', `txn-${FAMILY_A}`)));
  });

  it('member CANNOT create a transaction (credit themselves)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'self-credit'), {
        uid: UID.memberA,
        choreId: `chore-${FAMILY_A}`,
        choreTitle: 'Take out trash',
        amount: 100,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });
});

describe('M25/P9: invites are parent-only and family-scoped', () => {
  it('parent CAN create an invite in own family', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'invites', 'new-invite'), {
        email: 'newadult@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.parentA,
        createdAt: Date.now(),
        status: 'pending',
      }),
    );
  });

  it('parent CAN read own-family invite', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'invites', `invite-${FAMILY_A}`)));
  });

  it('parent CAN delete own-family invite', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'invites', `invite-${FAMILY_A}`)));
  });

  it('P9: member CANNOT read own-family invite (parent-only, adult email PI)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'invites', `invite-${FAMILY_A}`)));
  });

  it('P9: member CANNOT create an invite', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'invites', 'member-invite'), {
        email: 'x@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.memberA,
        createdAt: Date.now(),
        status: 'pending',
      }),
    );
  });

  it('P9: parent of A CANNOT read a family-B invite (cross-tenant adult email)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'invites', `invite-${FAMILY_B}`)));
  });

  it('P9: parent of A CANNOT create an invite into family B', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'invites', 'cross-family-invite'), {
        email: 'x@example.test',
        role: 'member',
        familyId: FAMILY_B,
        invitedBy: UID.parentA,
        createdAt: Date.now(),
        status: 'pending',
      }),
    );
  });
});
