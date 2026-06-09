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

  it('M28/ADR-0004: same-family parent CAN credit a member allowanceBalance to a HIGHER value in CENTS (only allowanceBalance changes)', async () => {
    // Seed balance is 0 cents; crediting to 2500 cents ($25.00) is a non-negative
    // change of ONLY allowanceBalance, which parentAllowanceCredit permits. Money
    // is integer cents everywhere (Finding 7). The no-bare-credit-without-an-
    // approved-chore integrity property is enforced by the approveChore
    // transaction + its tests, NOT by these rules (ADR-0004).
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 2500 }),
    );
  });

  // MONEY → INTEGER CENTS (Finding 7): allowanceBalance is whole cents, so a
  // FRACTIONAL credit (2550.5) and an OVER-MAX credit (> $1,000,000) are denied,
  // even though they are non-negative increases.
  it('M28/Finding 7: same-family parent CANNOT credit a FRACTIONAL allowanceBalance (2550.5 — not whole cents)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 2550.5 }),
    );
  });

  it('M28/Finding 7: same-family parent CANNOT credit an allowanceBalance OVER the max ($1,000,000 + 1 cent)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 100000001 }),
    );
  });

  it('M28/Allowance-debit: same-family parent CAN decrease a member allowanceBalance (wishlist redemption path)', async () => {
    // ADR-0004 originally allowed only increments (`parentAllowanceCredit`).
    // The Allowance-debit + wishlist redemption feature added a parallel
    // `parentAllowanceDebit` predicate that permits a same-family parent
    // to lower a member's balance, with the floor pinned by
    // `isValidMoneyInt` (>= 0). Raising the balance to 25 first then
    // debiting to 10 is the redemption-approval path: allowed.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'users', UID.memberA), { allowanceBalance: 25 });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: 10 }));
  });

  it('M28/Allowance-debit: parent CANNOT decrease to a NEGATIVE balance (rule floor)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'users', UID.memberA), { allowanceBalance: 25 });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: -1 }));
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
        // 14-day TTL — matches INVITE_TTL_MS. Rule (post-#67 follow-up)
        // requires expiresAt to be `is number` AND in the future at create
        // time. Tests that expect FAILURE on a different axis (member can't
        // invite; cross-family create) still set this so they fail for the
        // right reason — not because the field is missing.
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
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
        // 14-day TTL — matches INVITE_TTL_MS. Rule (post-#67 follow-up)
        // requires expiresAt to be `is number` AND in the future at create
        // time. Tests that expect FAILURE on a different axis (member can't
        // invite; cross-family create) still set this so they fail for the
        // right reason — not because the field is missing.
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
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
        // 14-day TTL — matches INVITE_TTL_MS. Rule (post-#67 follow-up)
        // requires expiresAt to be `is number` AND in the future at create
        // time. Tests that expect FAILURE on a different axis (member can't
        // invite; cross-family create) still set this so they fail for the
        // right reason — not because the field is missing.
        expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
        status: 'pending',
      }),
    );
  });
});

// TTL enforcement — PR #67 added a 14-day expiresAt to invites and a
// client-side check. This describe block pins the RULE-level mirror so
// the cutoff isn't just UX: an expired invite is unreadable to the public
// redeem path and unacceptable to the bootstrap rule.
describe('TTL enforcement: expired invites are rule-blocked', () => {
  it('public redeem: an UNAUTH visitor can GET a fresh pending invite', async () => {
    // The default seed sets expiresAt = now + 14d (see helpers.ts). An
    // anonymous visitor (the redeem page) must be able to read it.
    const db = env.unauthenticatedContext().firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'invites', `invite-${FAMILY_A}`)));
  });

  it('public redeem: an UNAUTH visitor CANNOT GET an EXPIRED pending invite (read denied)', async () => {
    // Seed a fresh fixture with an explicitly-past expiresAt — the rule's
    // `isInviteFreshLocal()` short-circuits the public-read branch so the
    // unauthenticated read fails. Same failure surface as missing /
    // accepted / revoked — no leak about which dead-state occurred.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(adminDb, 'invites', 'expired-invite'), {
        email: 'invitee@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.parentA,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
        expiresAt: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago — expired
        status: 'pending',
      });
    });
    const db = env.unauthenticatedContext().firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'invites', 'expired-invite')));
  });

  it('parent: an EXPIRED invite is still visible to the inviting parent (so the UI can show the Expired badge + revoke)', async () => {
    // Parents need to see expired invites to clean them up. Only the
    // PUBLIC branch is restricted by freshness; the parent + same-family
    // branch isn't.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(adminDb, 'invites', 'expired-for-parent'), {
        email: 'invitee@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.parentA,
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() - 24 * 60 * 60 * 1000,
        status: 'pending',
      });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'invites', 'expired-for-parent')));
  });

  it('create: rule REJECTS an invite created without an `expiresAt` field', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'invites', 'no-expires'), {
        email: 'x@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.parentA,
        createdAt: Date.now(),
        // expiresAt deliberately omitted — rule's `is number` check fails.
        status: 'pending',
      }),
    );
  });

  it('create: rule REJECTS an invite whose `expiresAt` is already in the past (back-dated)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'invites', 'back-dated'), {
        email: 'x@example.test',
        role: 'member',
        familyId: FAMILY_A,
        invitedBy: UID.parentA,
        createdAt: Date.now(),
        expiresAt: Date.now() - 1000, // already expired
        status: 'pending',
      }),
    );
  });
});
