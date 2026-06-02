/**
 * savingsGoals rules — Feature 1 (Savings Goals & Jars).
 *
 * Pins the same-family + role + status-machine guarantees of the
 * `savingsGoals` collection. Each `describe` covers one rule branch
 * (read, create, owner-meta update, contribute, status flip, delete).
 *
 * Seed strategy mirrors the sibling rules tests: baseline fixtures from
 * `helpers.seedBaseline`; per-test bespoke seeds via
 * `env.withSecurityRulesDisabled` so a test can stage an active /
 * completed / archived goal without exercising the create rule.
 */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});
afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});

// 14-day-ish "valid" money: 1000 cents = $10. All shape-ok constants here.
const VALID_TARGET = 50000; // $500
const VALID_BUMP = 250; // $2.50
const NOW = () => Date.now();

function activeGoalDoc(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    familyId: FAMILY_A,
    ownerUid: UID.memberA,
    title: 'New bike',
    targetAmount: VALID_TARGET,
    currentAmount: 0,
    createdAt: NOW(),
    updatedAt: NOW(),
    status: 'active',
    ...over,
  };
}

async function seedGoal(id: string, doc: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const { doc: docRef, setDoc } = await import('firebase/firestore');
    await setDoc(docRef(adminDb, 'savingsGoals', id), doc);
  });
}

describe('savingsGoals — CREATE', () => {
  it('a MEMBER can create their OWN active goal in their family', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(db, 'savingsGoals', 'g-new'), activeGoalDoc()));
  });

  it('a PARENT can create a goal on behalf of a same-family member', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'savingsGoals', 'g-parent-on-member'), activeGoalDoc()),
    );
  });

  it('a MEMBER cannot create a goal owned by ANOTHER member', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'savingsGoals', 'g-foreign-owner'),
        activeGoalDoc({ ownerUid: UID.member2A }),
      ),
    );
  });

  it('cross-tenant: parent of A cannot create a goal in family B', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'savingsGoals', 'g-cross'),
        activeGoalDoc({ familyId: FAMILY_B, ownerUid: UID.memberB }),
      ),
    );
  });

  it('create REJECTED when currentAmount is not 0 (no smuggled balance)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'savingsGoals', 'g-smuggle'), activeGoalDoc({ currentAmount: 1000 })),
    );
  });

  it('create REJECTED when status is not active', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'savingsGoals', 'g-pre'), activeGoalDoc({ status: 'completed' })),
    );
  });

  it('create REJECTED when targetAmount is 0', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'savingsGoals', 'g-zero'), activeGoalDoc({ targetAmount: 0 })),
    );
  });

  it('create REJECTED when title is empty', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'savingsGoals', 'g-empty'), activeGoalDoc({ title: '' })),
    );
  });

  it('create REJECTED when an unexpected field is smuggled in', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'savingsGoals', 'g-extra'),
        activeGoalDoc({ secretField: 'pwned' }),
      ),
    );
  });

  it('a DEACTIVATED caller cannot create a goal', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'savingsGoals', 'g-deactive'),
        activeGoalDoc({ ownerUid: UID.deactivatedA }),
      ),
    );
  });
});

describe('savingsGoals — READ', () => {
  beforeEach(async () => {
    await seedGoal('g-A-mem', activeGoalDoc({ ownerUid: UID.memberA }));
    await seedGoal(
      'g-A-other',
      activeGoalDoc({ ownerUid: UID.member2A, title: 'Other kid' }),
    );
    await seedGoal(
      'g-B',
      activeGoalDoc({ familyId: FAMILY_B, ownerUid: UID.memberB, title: 'Cross' }),
    );
  });

  it('parent CAN read any family goal', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'savingsGoals', 'g-A-mem')));
    await assertSucceeds(getDoc(doc(db, 'savingsGoals', 'g-A-other')));
  });

  it('member CAN read their own goal', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'savingsGoals', 'g-A-mem')));
  });

  it("member CANNOT read another family member's goal (privacy)", async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'savingsGoals', 'g-A-other')));
  });

  it('cross-tenant: parent A CANNOT read a family B goal', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'savingsGoals', 'g-B')));
  });
});

describe('savingsGoals — UPDATE (owner metadata)', () => {
  beforeEach(async () => {
    await seedGoal('g-edit', activeGoalDoc({ ownerUid: UID.memberA }));
  });

  it('OWNER can edit title + targetAmount on their active goal', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'savingsGoals', 'g-edit'), {
        title: 'Renamed',
        targetAmount: VALID_TARGET + 1000,
        updatedAt: NOW(),
      }),
    );
  });

  it('owner CANNOT smuggle a status change through the metadata patch path', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'savingsGoals', 'g-edit'), {
        title: 'Renamed',
        status: 'completed',
        updatedAt: NOW(),
      }),
    );
  });

  it('owner CANNOT mutate currentAmount through the metadata patch path (only the contribute branch can)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'savingsGoals', 'g-edit'), {
        title: 'Renamed',
        currentAmount: 9999,
        updatedAt: NOW(),
      }),
    );
  });

  it('a non-owner MEMBER cannot edit the goal', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'savingsGoals', 'g-edit'), { title: 'Hack', updatedAt: NOW() }),
    );
  });
});

describe('savingsGoals — UPDATE (contribute)', () => {
  beforeEach(async () => {
    await seedGoal(
      'g-jar',
      activeGoalDoc({ ownerUid: UID.memberA, currentAmount: 0 }),
    );
  });

  it('OWNER can increment currentAmount toward the target', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'savingsGoals', 'g-jar'), {
        currentAmount: VALID_BUMP,
        updatedAt: NOW(),
      }),
    );
  });

  it('PARENT can contribute to any same-family goal', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'savingsGoals', 'g-jar'), {
        currentAmount: VALID_BUMP,
        updatedAt: NOW(),
      }),
    );
  });

  it('contribute REJECTED when the new currentAmount EXCEEDS targetAmount (over-saved guard)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'savingsGoals', 'g-jar'), {
        currentAmount: VALID_TARGET + 1,
        updatedAt: NOW(),
      }),
    );
  });

  it('contribute REJECTED when currentAmount DECREASES (no debit-via-contribute path)', async () => {
    // Seed a goal that already has $5 saved so a decrement to $2.50 is
    // a real decrease (not a no-op). The contribute branch requires
    // strict increase; the metadata branch forbids touching currentAmount.
    await seedGoal(
      'g-decrement',
      activeGoalDoc({ ownerUid: UID.memberA, currentAmount: 500 }),
    );
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'savingsGoals', 'g-decrement'), {
        currentAmount: 250,
        updatedAt: NOW(),
      }),
    );
  });
});

describe('savingsGoals — UPDATE (status flip, parent terminal)', () => {
  beforeEach(async () => {
    await seedGoal('g-term', activeGoalDoc({ ownerUid: UID.memberA }));
  });

  it('PARENT can complete an active goal', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'savingsGoals', 'g-term'), {
        status: 'completed',
        updatedAt: NOW(),
      }),
    );
  });

  it('PARENT can archive an active goal', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'savingsGoals', 'g-term'), {
        status: 'archived',
        updatedAt: NOW(),
      }),
    );
  });

  it('MEMBER cannot flip status (terminal transitions are parent-only)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'savingsGoals', 'g-term'), {
        status: 'completed',
        updatedAt: NOW(),
      }),
    );
  });
});

describe('savingsGoals — DELETE', () => {
  beforeEach(async () => {
    await seedGoal('g-del', activeGoalDoc({ ownerUid: UID.memberA }));
  });

  it('PARENT can delete a same-family goal', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'savingsGoals', 'g-del')));
  });

  it('MEMBER cannot delete (archive only)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'savingsGoals', 'g-del')));
  });
});
