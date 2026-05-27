/**
 * SECURITY-CRITICAL — Chore CREATE hardening + the rejected->complete redo
 * transition (Phase 3, Task 11; threat-model M4/T1.4, M22/M23 incomingSameFamily,
 * P4 create-into-another-family; ADR-0004 lifecycle decision).
 *
 * The member-view feature (Task 10) deferred the chore-create hardening: the
 * create rule was the loose `isParent() && incomingSameFamily()` with NO shape
 * lock or value validation. Task 11 (Add Chore lands now) tightens it so a
 * parent create must be the EXACT well-formed shape with valid values and
 * status=='pending'. This file pins that tightening + the new member redo
 * transition (rejected -> complete), which the lifecycle decision added so a
 * member can re-attempt a sent-back chore.
 *
 * The exact key set is the Chore type (types.ts): title, assignedTo, dueDate,
 * pointValue, dollarValue, status, familyId, createdBy, createdAt, isRecurring,
 * recurrenceFrequency, with rejectionReason OPTIONAL (absent on a fresh create).
 *
 * These FAIL today: the create rule does not yet shape-lock/value-validate, so
 * the malformed-create DENY cases below currently (wrongly) succeed; and the
 * member rejected->complete transition is not yet allowed, so that ALLOW case
 * currently fails. Each failure names a real Task-11 gap.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;
const CHORE_A = `chore-${FAMILY_A}`; // assignedTo memberA, status pending

// MONEY IS INTEGER CENTS (second-opinion #4 / adversarial Finding 7): dollarValue
// is whole cents, >= 0 and <= MONEY_MAX (= 100000000 cents = $1,000,000). A
// fractional value (e.g. 350.5) or an over-max value is DENIED at the rules layer.
const MONEY_MAX = 100000000;

/** A well-formed, valid parent-create chore body (the EXACT shape). Override
 * individual fields to build each malformed/invalid variant. `dollarValue` is in
 * INTEGER CENTS — `200` means $2.00. */
function validChore(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Dishes',
    assignedTo: UID.memberA,
    dueDate: '2026-05-30',
    pointValue: 5, // integer POINTS, not money
    dollarValue: 200, // integer CENTS — $2.00
    status: 'pending',
    familyId: FAMILY_A,
    createdBy: UID.parentA,
    createdAt: Date.now(),
    isRecurring: false,
    recurrenceFrequency: 'none',
    ...over,
  };
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

describe('chore create — a valid parent create is ALLOWED', () => {
  it('parent CAN create a well-formed pending chore assigned to a same-family member', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(db, 'chores', 'valid-create'), validChore()));
  });

  it('parent CAN create a recurring weekly chore (isRecurring true + weekly)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'chores', 'valid-recurring'),
        validChore({ isRecurring: true, recurrenceFrequency: 'weekly' }),
      ),
    );
  });

  it('parent CAN create a chore with zero pointValue/dollarValue (>=0 boundary)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'chores', 'valid-zero'), validChore({ pointValue: 0, dollarValue: 0 })),
    );
  });
});

describe('chore create — role + tenant authority (M4/M22/P4)', () => {
  it('a MEMBER cannot create a chore (assigning work is parent-only)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'member-create'), validChore({ createdBy: UID.memberA })),
    );
  });

  it('a parent cannot create a chore into ANOTHER family (incomingSameFamily / P4)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'cross-family-create'), validChore({ familyId: FAMILY_B })),
    );
  });

  it('a parent cannot create a chore with createdBy != their own uid (identity binding)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'forged-creator'), validChore({ createdBy: UID.parentB })),
    );
  });

  it('a DEACTIVATED parent-context caller cannot create a chore (M26)', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'deactivated-create'), validChore({ createdBy: UID.deactivatedA })),
    );
  });
});

describe('chore create — status must be pending', () => {
  it('a create with status != "pending" (e.g. approved) is denied (no pre-approved self-credit)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'pre-approved'), validChore({ status: 'approved' })),
    );
  });

  it('a create with status "complete" is denied (cannot create a chore already awaiting approval)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'pre-complete'), validChore({ status: 'complete' })),
    );
  });
});

describe('chore create — assignedTo must be a same-family user that exists', () => {
  it('a create assigning to a NON-EXISTENT uid is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'ghost-assignee'), validChore({ assignedTo: 'uid-does-not-exist' })),
    );
  });

  it('a create assigning to a member of ANOTHER family is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'foreign-assignee'), validChore({ assignedTo: UID.memberB })),
    );
  });
});

describe('chore create — numeric value validation (pointValue/dollarValue numbers >= 0)', () => {
  it('a NEGATIVE dollarValue is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'chores', 'neg-dollar'), validChore({ dollarValue: -1 })));
  });

  it('a NEGATIVE pointValue is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'chores', 'neg-point'), validChore({ pointValue: -5 })));
  });

  it('a NON-NUMERIC dollarValue (string) is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'string-dollar'), validChore({ dollarValue: '2' })),
    );
  });

  it('a NON-NUMERIC pointValue (string) is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'chores', 'string-point'), validChore({ pointValue: '5' })));
  });
});

// === MONEY → INTEGER CENTS (second-opinion #4 / adversarial Finding 7) ========
// dollarValue is now whole cents. The rule must require dollarValue `is int`,
// `>= 0`, and `<= MONEY_MAX`. A fractional value (a float-dollar like 350.5
// smuggled where cents are expected), a value over the cap, and (still) a
// negative are DENIED; valid integer-cent boundaries ALLOWED.
describe('chore create — dollarValue is INTEGER CENTS (Finding 7: int, >=0, <=$1,000,000)', () => {
  it('a valid integer-cents dollarValue (300 = $3.00) is ALLOWED', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'chores', 'cents-3-dollars'), validChore({ dollarValue: 300 })),
    );
  });

  it('the MAX integer-cents dollarValue ($1,000,000 = 100000000) is ALLOWED (upper boundary)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'chores', 'cents-max'), validChore({ dollarValue: MONEY_MAX })),
    );
  });

  it('a FRACTIONAL dollarValue (350.5 — not whole cents) is DENIED (is int)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'frac-dollar'), validChore({ dollarValue: 350.5 })),
    );
  });

  it('a dollarValue OVER the max (MONEY_MAX + 1) is DENIED (<= cap)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'over-max-dollar'), validChore({ dollarValue: MONEY_MAX + 1 })),
    );
  });

  it('a FRACTIONAL pointValue (2.5 — points are whole) is DENIED (is int)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'frac-point'), validChore({ pointValue: 2.5 })),
    );
  });
});

describe('chore create — recurrence validation', () => {
  it('a recurrenceFrequency outside the enum is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'bad-freq'), validChore({ recurrenceFrequency: 'daily' })),
    );
  });

  it('a non-boolean isRecurring is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'bad-recurring'), validChore({ isRecurring: 'yes' })),
    );
  });
});

describe('chore create — shape lock (exact key set; rejectionReason optional on create)', () => {
  it('an EXTRA/unknown field is denied (shape-locked)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'extra-key'), validChore({ emoji: '🧹' })),
    );
  });

  it('a MISSING required field (no recurrenceFrequency) is denied', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    const body = validChore();
    delete (body as Record<string, unknown>).recurrenceFrequency;
    await assertFails(setDoc(doc(db, 'chores', 'missing-key'), body));
  });

  it('a create that INCLUDES rejectionReason is denied (a fresh chore is never pre-rejected)', async () => {
    // rejectionReason is set only by the parent reject transition, never at
    // create. Including it at create is rejected by the shape lock.
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'chores', 'pre-rejected'), validChore({ rejectionReason: 'nope' })),
    );
  });
});

describe('chore update — member redo loop (rejected -> complete) added by the lifecycle decision', () => {
  it('a member CAN move their OWN chore rejected -> complete (re-attempt a sent-back chore)', async () => {
    // Seed CHORE_A into the rejected state (parent rejected it earlier).
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'chores', CHORE_A), {
        title: 'Take out trash',
        assignedTo: UID.memberA,
        dueDate: '2026-05-27',
        pointValue: 10,
        dollarValue: 3,
        status: 'rejected',
        rejectionReason: 'Try again',
        familyId: FAMILY_A,
        createdBy: UID.parentA,
        createdAt: Date.now(),
        isRecurring: false,
        recurrenceFrequency: 'none',
      });
    });
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });

  it('a member STILL CAN move pending -> complete (the original transition is preserved)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });

  it('a member CANNOT move approved -> complete (re-claiming an already-approved chore)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), { status: 'approved' });
    });
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });

  it('a member CANNOT self-approve a rejected chore (rejected -> approved)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), {
        status: 'rejected',
        rejectionReason: 'Try again',
      });
    });
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'approved' }));
  });

  it('a member redoing a rejected chore CANNOT also change its dollarValue/pointValue', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), {
        status: 'rejected',
        rejectionReason: 'Try again',
      });
    });
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete', dollarValue: 999 }),
    );
  });

  it('a member CANNOT redo a PEER’s rejected chore (own-assignment only)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), {
        status: 'rejected',
        rejectionReason: 'Try again',
      });
    });
    // CHORE_A is assigned to memberA; member2A attempts the redo.
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });
});

describe('chore update — parent approve/reject transitions (paired with the credit transaction elsewhere)', () => {
  it('a parent CAN move complete -> approved', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), { status: 'complete' });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'chores', CHORE_A), { status: 'approved' }));
  });

  it('a parent CAN move complete -> rejected with a reason', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), { status: 'complete' });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'chores', CHORE_A), { status: 'rejected', rejectionReason: 'Redo it' }),
    );
  });

  it('a parent CANNOT change a chore familyId (tenant immutability, M5)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { familyId: FAMILY_B }));
  });

  it('a CROSS-FAMILY parent CANNOT approve a chore in another family', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), { status: 'complete' });
    });
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'approved' }));
  });

  // Finding 2 (adversarial): the parent reject transition is from-status guarded —
  // ONLY a `complete -> rejected` move is legal. A parent must NOT be able to move
  // an already-TERMINAL `approved` chore back to `rejected` (which would let a
  // reject path act on a credited chore). parentChoreUpdate requires
  // resource.data.status == 'complete', so approved -> rejected is denied.
  it('a parent CANNOT move an APPROVED chore to rejected (approved -> rejected denied; only complete -> rejected)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), { status: 'approved' });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'chores', CHORE_A), { status: 'rejected', rejectionReason: 'no take-backs' }),
    );
  });

  it('a parent CANNOT move an APPROVED chore back to complete (re-open a credited chore)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, updateDoc } = await import('firebase/firestore');
      await updateDoc(doc(ctx.firestore(), 'chores', CHORE_A), { status: 'approved' });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'chores', CHORE_A), { status: 'complete' }));
  });
});
