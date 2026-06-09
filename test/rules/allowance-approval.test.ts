/**
 * SECURITY-CRITICAL — Allowance APPROVAL transaction + the rule hardening it
 * leans on (Phase 3, Task 11; ADR-0004; threat-model M27/M28 allowance
 * integrity, F4 double-credit/race, M3/T1.3, M4/T1.4, M6/T1.6, M26/F3).
 *
 * This file pins the END-TO-END allowance lifecycle THROUGH the real rules, the
 * place the architect's idempotency + integrity guarantees actually live. The
 * approval is a SINGLE runTransaction (ADR-0004 option B) that, atomically:
 *   (1) re-reads the chore; ABORTS unless status=='complete' AND same family,
 *   (2) sets status='approved',
 *   (3) increment(users/{assignedTo}.allowanceBalance, dollarValue),
 *   (4) creates transactions/{id} = {uid, choreId, choreTitle, amount, type:
 *       'earning', familyId, createdAt}.
 * Idempotency is the STATUS GUARD: a second approve re-reads status!='complete'
 * and aborts, so the balance is credited EXACTLY once and exactly one ledger
 * doc is ever written (F4).
 *
 * We drive the transaction here with the rules-unit-testing authenticated
 * context's own runTransaction so the WHOLE multi-doc write goes through the
 * tightened rules (balance writer must be a same-family parent, the increment
 * non-negative, the chore complete->approved transition legal, the txn shape-
 * locked). The production helper choresParentService.approveChore must perform
 * the SAME transaction shape (its SDK-level contract is unit-pinned in
 * src/features/chores/choresParentService.test.ts).
 *
 * NOTE on "concurrent" approve (M27 race): the emulator serializes
 * transactions, so a truly-parallel pair is not deterministically reproducible
 * here. The SEQUENTIAL double-approve below exercises the SAME status-guard
 * idempotency the race mitigation relies on (the second tx re-reads
 * status!='complete' and aborts) — it is the deterministic, diagnosable proxy
 * for F4. A non-deterministic parallel test would violate the determinism bar.
 *
 * These FAIL today: the allowance-write rule currently DENIES every balance
 * write (M28 deferred the bare write to "the Phase-3 approval runTransaction")
 * and the transactions create rule is not yet shape-locked, so the approval
 * transaction is rejected until the Task-11 rules land. A failure here names a
 * real gap, never a test to relax.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;

// IMPORTANT: the baseline seed's chore-${FAMILY_A} ALREADY has a matching ledger
// doc txn-${FAMILY_A} (same choreId), so approving it would make the
// "exactly one ledger doc" count ambiguous. We therefore approve a DEDICATED,
// locally-seeded family-A chore (assigned to memberA, dollarValue 3) that has NO
// pre-existing ledger doc, so the credit/ledger counts are unambiguous.
const CHORE_A = 'chore-approval-a';
const CHORE_B = `chore-${FAMILY_B}`;
// MONEY IS INTEGER CENTS (second-opinion #4 / Finding 7). A $3.00 chore reward is
// 300 cents: the balance increments by 300 and the ledger `amount` equals 300.
const CHORE_DOLLAR_VALUE = 300; // $3.00 in integer cents

/** Seed the dedicated approval chore (family A, assignedTo memberA, pending,
 * dollarValue 300 cents = $3.00) with rules disabled. No ledger doc references
 * its choreId, so countTxnsForChore(CHORE_A) starts at 0. */
async function seedApprovalChore(): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'chores', CHORE_A), {
      title: 'Take out the trash',
      assignedTo: UID.memberA,
      dueDate: '2026-05-30',
      pointValue: 10, // integer POINTS
      dollarValue: CHORE_DOLLAR_VALUE, // integer CENTS
      status: 'pending',
      familyId: FAMILY_A,
      createdBy: UID.parentA,
      createdAt: Date.now(),
      isRecurring: false,
      recurrenceFrequency: 'none',
    });
  });
}

/** Move CHORE_A to `complete` as its assigned member (the legal precondition
 * for approval). Uses the member's own authenticated context so it goes through
 * the member transition rule, exactly as production does. */
async function memberCompletesChoreA(): Promise<void> {
  const db = env.authenticatedContext(UID.memberA).firestore();
  const { doc, updateDoc } = await import('firebase/firestore');
  await updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' });
}

/** Read a member's current allowanceBalance with rules disabled (the rules deny
 * a member reading other docs; we just need ground-truth for the assertion). */
async function readBalance(uid: string): Promise<number> {
  let bal = Number.NaN;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(db, 'users', uid));
    bal = (snap.data() as { allowanceBalance: number }).allowanceBalance;
  });
  return bal;
}

/** Count ledger docs for a given choreId with rules disabled (ground truth for
 * the "exactly one transaction written" assertion). */
async function countTxnsForChore(choreId: string): Promise<number> {
  let n = -1;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    const snap = await getDocs(
      query(collection(db, 'transactions'), where('choreId', '==', choreId)),
    );
    n = snap.size;
  });
  return n;
}

/**
 * The approval transaction, executed through a given authenticated context so
 * it is gated by the rules. Mirrors choresParentService.approveChore's contract
 * (ADR-0004): re-read chore, abort unless complete + same family, flip to
 * approved, increment the assignee balance, append ONE ledger doc — all atomic.
 * `txnId` lets each test write a distinct ledger doc id deterministically.
 */
async function runApproval(
  actorUid: string,
  choreId: string,
  txnId: string,
): Promise<void> {
  const db = env.authenticatedContext(actorUid).firestore();
  const { doc, runTransaction, increment, collection } = await import('firebase/firestore');
  await runTransaction(db, async (tx) => {
    const choreRef = doc(db, 'chores', choreId);
    const choreSnap = await tx.get(choreRef);
    const chore = choreSnap.data() as
      | { status: string; assignedTo: string; dollarValue: number; familyId: string; title: string }
      | undefined;
    // Idempotency / integrity guard (ADR-0004 step 1): abort unless complete.
    if (!chore || chore.status !== 'complete') {
      throw new Error('chore-not-complete'); // aborts: no balance/ledger write
    }
    tx.update(choreRef, { status: 'approved' });
    tx.update(doc(db, 'users', chore.assignedTo), {
      allowanceBalance: increment(chore.dollarValue),
    });
    tx.set(doc(collection(db, 'transactions'), txnId), {
      uid: chore.assignedTo,
      choreId,
      choreTitle: chore.title,
      amount: chore.dollarValue,
      type: 'earning',
      familyId: chore.familyId,
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
  await seedApprovalChore();
});
afterEach(async () => {
  await env.clearFirestore();
});

describe('M27/ADR-0004 happy path: approving a complete chore credits EXACTLY the dollarValue + writes one ledger doc', () => {
  it('a parent approval of a complete chore SUCCEEDS through the rules', async () => {
    await memberCompletesChoreA();
    await assertSucceeds(runApproval(UID.parentA, CHORE_A, 'txn-approve-1'));
  });

  it('the assignee balance increases by EXACTLY dollarValue cents (300), from 0 to 300 ($3.00)', async () => {
    await memberCompletesChoreA();
    const before = await readBalance(UID.memberA);
    expect(before, 'seed balance is 0 cents').toBe(0);
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-1');
    const after = await readBalance(UID.memberA);
    expect(
      after,
      'balance must increase by exactly the chore dollarValue in CENTS (0 -> 300)',
    ).toBe(before + CHORE_DOLLAR_VALUE);
  });

  it('EXACTLY ONE transaction ledger doc is written for the approved chore', async () => {
    await memberCompletesChoreA();
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-1');
    expect(await countTxnsForChore(CHORE_A)).toBe(1);
  });

  it('the chore status becomes "approved" after the transaction', async () => {
    await memberCompletesChoreA();
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-1');
    let status = '';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, getDoc } = await import('firebase/firestore');
      const snap = await getDoc(doc(ctx.firestore(), 'chores', CHORE_A));
      status = (snap.data() as { status: string }).status;
    });
    expect(status).toBe('approved');
  });
});

describe('F4/M27 idempotency: double-approve credits EXACTLY once (the status guard aborts the second)', () => {
  it('a SECOND approval of an already-approved chore ABORTS (status != complete)', async () => {
    await memberCompletesChoreA();
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-1'); // first: credits once
    // Second approve: the chore is now `approved`, so the in-transaction status
    // guard THROWS an app-level Error('chore-not-complete') and the whole
    // transaction aborts. This is an APP-LEVEL abort (the integrity guarantee),
    // NOT a rules PERMISSION_DENIED — assertFails only accepts the latter, so we
    // assert the thrown abort directly and then confirm NO side effects landed.
    await expect(runApproval(UID.parentA, CHORE_A, 'txn-approve-2')).rejects.toThrow(
      'chore-not-complete',
    );
    expect(await readBalance(UID.memberA), 'a re-approve must not double-credit').toBe(
      CHORE_DOLLAR_VALUE,
    );
    expect(await countTxnsForChore(CHORE_A), 'the second approve writes no ledger doc').toBe(1);
  });

  it('after a double-approve the balance reflects EXACTLY one credit (300 cents, never 600)', async () => {
    await memberCompletesChoreA();
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-1');
    // Second attempt aborts; balance must NOT move again.
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-2').catch(() => undefined);
    expect(
      await readBalance(UID.memberA),
      'a re-approve must not double-credit — exactly one dollarValue',
    ).toBe(CHORE_DOLLAR_VALUE);
  });

  it('after a double-approve there is still EXACTLY ONE ledger doc (no second earning)', async () => {
    await memberCompletesChoreA();
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-1');
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-2').catch(() => undefined);
    expect(
      await countTxnsForChore(CHORE_A),
      'the second approve must append no ledger doc',
    ).toBe(1);
  });
});

describe('M27 abort: approving a chore that is NOT complete is a no-op (no credit, no ledger)', () => {
  it('approving a PENDING chore aborts (never completed)', async () => {
    // CHORE_A is seeded pending; skip the member-complete step. The status guard
    // throws an APP-LEVEL Error (not a rules PERMISSION_DENIED), so we assert the
    // abort directly and confirm no balance credit and no ledger doc landed.
    await expect(runApproval(UID.parentA, CHORE_A, 'txn-approve-pending')).rejects.toThrow(
      'chore-not-complete',
    );
    expect(await readBalance(UID.memberA), 'no credit for a pending chore').toBe(0);
    expect(await countTxnsForChore(CHORE_A), 'no ledger for a pending chore').toBe(0);
  });

  it('approving an already-APPROVED chore aborts (idempotent re-approve)', async () => {
    await memberCompletesChoreA();
    await runApproval(UID.parentA, CHORE_A, 'txn-approve-1');
    // The chore is now `approved`; the status guard throws an app-level abort.
    await expect(runApproval(UID.parentA, CHORE_A, 'txn-approve-again')).rejects.toThrow(
      'chore-not-complete',
    );
    expect(await readBalance(UID.memberA), 'no second credit on a re-approve').toBe(
      CHORE_DOLLAR_VALUE,
    );
    expect(await countTxnsForChore(CHORE_A), 'no second ledger doc on a re-approve').toBe(1);
  });

  it('approving a REJECTED chore aborts (no credit on a sent-back chore)', async () => {
    await memberCompletesChoreA();
    // Parent rejects it first (complete -> rejected, no balance change).
    const parentDb = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(parentDb, 'chores', CHORE_A), {
      status: 'rejected',
      rejectionReason: 'Try again',
    });
    // status is now `rejected` != `complete`; the guard throws an app-level abort.
    await expect(runApproval(UID.parentA, CHORE_A, 'txn-approve-rejected')).rejects.toThrow(
      'chore-not-complete',
    );
    expect(await readBalance(UID.memberA), 'a rejected chore is never credited').toBe(0);
    expect(await countTxnsForChore(CHORE_A), 'no ledger doc for a rejected chore').toBe(0);
  });
});

describe('M27 reject path: rejecting sets status+reason, with NO balance change and NO ledger doc', () => {
  it('a parent CAN reject a complete chore with a reason (complete -> rejected)', async () => {
    await memberCompletesChoreA();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'chores', CHORE_A), {
        status: 'rejected',
        rejectionReason: 'Half the plates are still dirty',
      }),
    );
  });

  it('rejecting changes NO balance and writes NO ledger doc', async () => {
    await memberCompletesChoreA();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'chores', CHORE_A), {
      status: 'rejected',
      rejectionReason: 'Redo it',
    });
    expect(await readBalance(UID.memberA), 'reject must not credit').toBe(0);
    expect(await countTxnsForChore(CHORE_A), 'reject writes no ledger doc').toBe(0);
  });
});

describe('M27/M28 authority: a MEMBER cannot drive the approval credit path through the rules', () => {
  it('a member CANNOT run the approval transaction on their own complete chore (cannot set approved / write balance / create ledger)', async () => {
    await memberCompletesChoreA();
    // The member tries the exact approval transaction on their OWN chore.
    await assertFails(runApproval(UID.memberA, CHORE_A, 'txn-self-approve'));
    expect(await readBalance(UID.memberA), 'no self-credit').toBe(0);
    expect(await countTxnsForChore(CHORE_A)).toBe(0);
  });

  it('a member CANNOT directly increment their own allowanceBalance (no chore/ledger at all)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc, increment } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: increment(10) }),
    );
  });

  it('a member CANNOT create an earning transaction directly (self-credit the ledger)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'member-self-earning'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 100,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });
});

describe('M28 allowanceBalance write authority: same-family parent, NON-NEGATIVE delta only', () => {
  it('a same-family parent CAN increment a member balance as part of the approval transaction (covered above) but', async () => {
    // The legitimate increment is exercised by the happy-path transaction; here
    // we pin that a parent CANNOT push the balance NEGATIVE (delta < 0) even
    // inside an otherwise well-formed write — the non-negative-change rule (M28).
    await memberCompletesChoreA();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc, increment } = await import('firebase/firestore');
    // A bare decrement of the balance (new < old) must be denied; this also
    // re-confirms there is no direct bare balance-write path for a parent.
    await assertFails(
      updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: increment(-5) }),
    );
  });

  it('a same-family parent CANNOT set a member balance to a NEGATIVE absolute value', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', UID.memberA), { allowanceBalance: -1 }));
  });

  it('a CROSS-FAMILY parent CANNOT increment a member balance (tenant isolation, not exempt)', async () => {
    await memberCompletesChoreA();
    // parentB runs the approval against family A's chore — both the chore re-read
    // (cross-family) and the balance write must be denied.
    await assertFails(runApproval(UID.parentB, CHORE_A, 'txn-cross-family'));
    expect(await readBalance(UID.memberA)).toBe(0);
  });

  it('a DEACTIVATED parent-context actor CANNOT increment a balance', async () => {
    // deactivatedA is a member (isActive:false). Even pretending to drive the
    // credit, M26 denies a deactivated caller every op.
    await memberCompletesChoreA();
    await assertFails(runApproval(UID.deactivatedA, CHORE_A, 'txn-deactivated'));
    expect(await readBalance(UID.memberA)).toBe(0);
  });
});

describe('transactions: shape-lock, type/amount validation, append-only, scoped read (M6/M27)', () => {
  it('a parent CAN create a well-formed earning transaction (the 7-field shape)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'transactions', 'well-formed'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a transaction with an EXTRA field is denied (shape-locked to the 7 fields)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'extra-field'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
        note: 'smuggled', // extra key — must be rejected
      }),
    );
  });

  it('a transaction MISSING a required field is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'missing-field'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 3,
        // type missing
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a transaction with type outside the union ["earning", "spending"] is denied', async () => {
    // The rule now accepts `type in ['earning','spending']` (Allowance debit
    // + wishlist redemption feature widened the union). Any other value is
    // still rejected at the authorization boundary.
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'bad-type'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'transfer', // not in the allowed union
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a transaction with a NEGATIVE amount is denied (amount >= 0)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'negative-amount'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: -3,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  // MONEY → INTEGER CENTS (Finding 7): the ledger `amount` is whole cents, so a
  // fractional amount and an over-max amount are denied; a valid integer-cents
  // amount equal to the approved chore's dollarValue (300) is allowed.
  it('a transaction with a FRACTIONAL amount (2.5 — not whole cents) is denied (is int)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'frac-amount'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 2.5,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a transaction with an amount OVER the max ($1,000,000 + 1 cent) is denied (<= cap)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'over-max-amount'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 100000001,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a transaction with a valid integer-cents amount (300 = $3.00) is ALLOWED', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'transactions', 'cents-amount'), {
        uid: UID.memberA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 300,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a transaction whose uid is NOT a same-family member is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'bad-uid'), {
        uid: UID.memberB, // a family-B member — not in parent A's family
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      }),
    );
  });

  it('a parent CANNOT create a transaction in ANOTHER family (cross-tenant)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'transactions', 'cross-family-txn'), {
        uid: UID.memberB,
        choreId: CHORE_B,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: FAMILY_B,
        createdAt: Date.now(),
      }),
    );
  });

  it('nobody can UPDATE an existing transaction (append-only ledger)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'transactions', `txn-${FAMILY_A}`), { amount: 9999 }));
  });

  it('nobody can DELETE an existing transaction (append-only ledger)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'transactions', `txn-${FAMILY_A}`)));
  });
});

describe('transactions read scoping: subject member reads OWN, parent reads any in-family, cross-tenant denied (M1/P10)', () => {
  it('the SUBJECT member CAN read their own transaction', async () => {
    // txn-${FAMILY_A} is seeded with uid == memberA.
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'transactions', `txn-${FAMILY_A}`)));
  });

  it('a same-family PARENT CAN read any in-family transaction', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'transactions', `txn-${FAMILY_A}`)));
  });

  it('a NON-SUBJECT same-family member CANNOT read a peer member’s transaction', async () => {
    // txn-${FAMILY_A} belongs to memberA; member2A is a peer (not the subject,
    // not a parent) and must be denied — mirrors the chores own-or-parent model.
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'transactions', `txn-${FAMILY_A}`)));
  });

  it('a member CAN list OWN-family + OWN-uid transactions (the only query the history view issues)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'transactions'),
          where('familyId', '==', FAMILY_A),
          where('uid', '==', UID.memberA),
        ),
      ),
    );
  });

  it('a member CANNOT list a PEER’s transactions even with a same-family filter (per-doc subject scoping)', async () => {
    // member2A filters family-A transactions to memberA's uid; each returned doc
    // has uid==memberA != member2A, so the per-resource subject predicate denies.
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(
        query(
          collection(db, 'transactions'),
          where('familyId', '==', FAMILY_A),
          where('uid', '==', UID.memberA),
        ),
      ),
    );
  });

  it('a member CANNOT list transactions UNCONSTRAINED (would surface a peer / foreign-family doc)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'transactions')));
  });

  it('a member of family A CANNOT read a family-B transaction (cross-tenant)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'transactions', `txn-${FAMILY_B}`)));
  });

  it('a parent of family A CANNOT read a family-B transaction (cross-tenant, parent not exempt)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'transactions', `txn-${FAMILY_B}`)));
  });

  it('a DEACTIVATED member CANNOT read their own transaction (M26)', async () => {
    // Seed a transaction owned by the deactivated member, then assert the read
    // is denied because isActive() gates the transactions get rule.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'transactions', 'txn-deactivated-a'), {
        uid: UID.deactivatedA,
        choreId: CHORE_A,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: FAMILY_A,
        createdAt: Date.now(),
      });
    });
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'transactions', 'txn-deactivated-a')));
  });
});
