/**
 * `todos` security-rules contract — Task Management feature (PR A).
 *
 * Pins the rule the spec asked for: ANY active same-family member can CRUD a
 * Todo. familyId / createdBy / createdAt are immutable; title shape is
 * validated; cross-tenant + deactivated callers are denied.
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

function freshTodo(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    familyId: FAMILY_A,
    createdBy: UID.memberA,
    title: 'Pick up groceries',
    isCompleted: false,
    createdAt: Date.now(),
    ...over,
  };
}

async function seedTodo(id: string, doc: Record<string, unknown>): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const { doc: docRef, setDoc } = await import('firebase/firestore');
    await setDoc(docRef(adminDb, 'todos', id), doc);
  });
}

describe('todos — CREATE', () => {
  it('a MEMBER can create a Todo in their own family', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(db, 'todos', 't-1'), freshTodo()));
  });

  it('a PARENT can create a Todo in their own family', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'todos', 't-1'), freshTodo({ createdBy: UID.parentA })),
    );
  });

  it('CANNOT create with a forged createdBy (rule binds to request.auth.uid)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'todos', 't-bad'), freshTodo({ createdBy: UID.member2A })),
    );
  });

  it('CANNOT create with isCompleted=true (spec: starts incomplete)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'todos', 't-bad'), freshTodo({ isCompleted: true })),
    );
  });

  it('CANNOT create with an empty title', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'todos', 't-bad'), freshTodo({ title: '' })));
  });

  it('CANNOT create with an unexpected smuggled field', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'todos', 't-bad'), freshTodo({ secret: 'pwned' })),
    );
  });

  it('cross-tenant: a member of B CANNOT create a Todo in family A', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'todos', 't-cross'),
        freshTodo({ familyId: FAMILY_A, createdBy: UID.memberB }),
      ),
    );
  });

  it('a DEACTIVATED member CANNOT create a Todo', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'todos', 't-bad'), freshTodo({ createdBy: UID.deactivatedA })),
    );
  });
});

describe('todos — READ', () => {
  beforeEach(async () => {
    await seedTodo('t-A', freshTodo());
    await seedTodo('t-B', freshTodo({ familyId: FAMILY_B, createdBy: UID.memberB }));
  });

  it('SAME-FAMILY caller CAN read a Todo (parent + member alike)', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      const db = env.authenticatedContext(uid).firestore();
      const { doc, getDoc } = await import('firebase/firestore');
      await assertSucceeds(getDoc(doc(db, 'todos', 't-A')));
    }
  });

  it('cross-tenant: parent of B CANNOT read a family-A Todo', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'todos', 't-A')));
  });
});

describe('todos — UPDATE', () => {
  beforeEach(async () => {
    await seedTodo('t-A', freshTodo());
  });

  it('ANY same-family member CAN toggle isCompleted (spec: full CRUD for the family)', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'todos', 't-A'), {
        isCompleted: true,
        completedAt: Date.now(),
        title: 'Pick up groceries',
      }),
    );
  });

  it('CANNOT change familyId (tenant lock)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'todos', 't-A'), { familyId: FAMILY_B, title: 'x' }),
    );
  });

  it('CANNOT rewrite createdBy', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'todos', 't-A'), { createdBy: UID.parentA, title: 'x' }),
    );
  });

  it('CANNOT update to an empty title', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'todos', 't-A'), { title: '' }));
  });

  it('cross-tenant CANNOT update', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'todos', 't-A'), { title: 'x' }));
  });
});

describe('todos — DELETE', () => {
  beforeEach(async () => {
    await seedTodo('t-A', freshTodo());
  });

  it('ANY same-family member CAN delete (spec: full CRUD for the family)', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      await seedTodo(`t-${uid}`, freshTodo());
      const db = env.authenticatedContext(uid).firestore();
      const { deleteDoc, doc } = await import('firebase/firestore');
      await assertSucceeds(deleteDoc(doc(db, 'todos', `t-${uid}`)));
    }
  });

  it('cross-tenant CANNOT delete', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'todos', 't-A')));
  });
});
