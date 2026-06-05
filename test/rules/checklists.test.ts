/**
 * `checklistTemplates` + `checklistInstances` security-rules contract — Task
 * Management feature (PR A).
 *
 * Pins the rules the spec asked for:
 *  - templates: ANY active same-family member can create; reads gated by
 *    `isSharedWithFamily` (shared → anyone in family; draft → creator only);
 *    update + delete restricted to the creator OR a same-family parent (per
 *    Q-A — deliberately stricter than "anyone-edits-anything" to stop
 *    sibling-pranks / accidental destruction).
 *  - instances: ANY active same-family member can create with `userId=self`
 *    (parents don't impersonate); any same-family member reads (parents see
 *    kid progress); update is owner-only; delete is owner OR same-family
 *    parent. familyId / templateId / userId / date / createdAt are immutable.
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

function freshTemplate(
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    familyId: FAMILY_A,
    createdBy: UID.memberA,
    title: 'Morning Routine',
    isSharedWithFamily: true,
    items: [
      { id: 'i-1', text: 'Brush teeth' },
      { id: 'i-2', text: 'Make bed' },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...over,
  };
}

function freshInstance(
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    familyId: FAMILY_A,
    templateId: 'tpl-A',
    userId: UID.memberA,
    date: '2026-06-05',
    isCompleted: false,
    itemsProgress: {},
    createdAt: Date.now(),
    ...over,
  };
}

async function seedDoc(
  collection: string,
  id: string,
  doc: Record<string, unknown>,
): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const { doc: docRef, setDoc } = await import('firebase/firestore');
    await setDoc(docRef(adminDb, collection, id), doc);
  });
}

// ===========================================================================
// checklistTemplates
// ===========================================================================

describe('checklistTemplates — CREATE', () => {
  it('a MEMBER can create a template in their own family', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'checklistTemplates', 'tpl-1'), freshTemplate()),
    );
  });

  it('a PARENT can create a template in their own family', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-1'),
        freshTemplate({ createdBy: UID.parentA }),
      ),
    );
  });

  it('CANNOT create with a forged createdBy', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-bad'),
        freshTemplate({ createdBy: UID.member2A }),
      ),
    );
  });

  it('CANNOT create with an empty title', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-bad'),
        freshTemplate({ title: '' }),
      ),
    );
  });

  it('CANNOT create with isSharedWithFamily not a bool', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-bad'),
        freshTemplate({ isSharedWithFamily: 'yes' }),
      ),
    );
  });

  it('CANNOT create with items not a list', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-bad'),
        freshTemplate({ items: { 'i-1': 'Brush teeth' } }),
      ),
    );
  });

  it('CANNOT create with a smuggled field', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-bad'),
        freshTemplate({ secret: 'pwned' }),
      ),
    );
  });

  it('cross-tenant: a member of B CANNOT create a template in family A', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-cross'),
        freshTemplate({ familyId: FAMILY_A, createdBy: UID.memberB }),
      ),
    );
  });

  it('a DEACTIVATED member CANNOT create a template', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistTemplates', 'tpl-bad'),
        freshTemplate({ createdBy: UID.deactivatedA }),
      ),
    );
  });
});

describe('checklistTemplates — READ', () => {
  beforeEach(async () => {
    // Shared template in A — visible to everyone in A.
    await seedDoc('checklistTemplates', 'tpl-shared', freshTemplate());
    // Draft (un-shared) template in A — visible only to its creator.
    await seedDoc(
      'checklistTemplates',
      'tpl-draft',
      freshTemplate({ isSharedWithFamily: false }),
    );
    // Template in family B — never visible to family A.
    await seedDoc(
      'checklistTemplates',
      'tpl-B',
      freshTemplate({ familyId: FAMILY_B, createdBy: UID.memberB }),
    );
  });

  it('SHARED template: any same-family member CAN read (parent + member alike)', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      const db = env.authenticatedContext(uid).firestore();
      const { doc, getDoc } = await import('firebase/firestore');
      await assertSucceeds(getDoc(doc(db, 'checklistTemplates', 'tpl-shared')));
    }
  });

  it('DRAFT template: the creator CAN read', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'checklistTemplates', 'tpl-draft')));
  });

  it('DRAFT template: a same-family non-owner CANNOT read', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'checklistTemplates', 'tpl-draft')));
  });

  it('DRAFT template: a same-family PARENT (non-creator) CANNOT read', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'checklistTemplates', 'tpl-draft')));
  });

  it('cross-tenant: parent of B CANNOT read a family-A template', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'checklistTemplates', 'tpl-shared')));
  });
});

describe('checklistTemplates — UPDATE', () => {
  beforeEach(async () => {
    await seedDoc('checklistTemplates', 'tpl-A', freshTemplate());
  });

  it('the CREATOR CAN edit the template', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), {
        title: 'Morning Routine v2',
        updatedAt: Date.now(),
      }),
    );
  });

  it('a same-family PARENT (non-creator) CAN edit the template', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), {
        title: 'Tidied up',
        updatedAt: Date.now(),
      }),
    );
  });

  it('a same-family member who is NOT the creator and NOT a parent CANNOT edit (Q-A)', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), { title: 'pranked' }),
    );
  });

  it('CANNOT change familyId (tenant lock)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), {
        familyId: FAMILY_B,
        title: 'x',
      }),
    );
  });

  it('CANNOT rewrite createdBy', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), {
        createdBy: UID.parentA,
        title: 'x',
      }),
    );
  });

  it('CANNOT rewrite createdAt', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), {
        createdAt: 0,
        title: 'x',
      }),
    );
  });

  it('CANNOT update to an empty title', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), { title: '' }),
    );
  });

  it('cross-tenant CANNOT update', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistTemplates', 'tpl-A'), { title: 'x' }),
    );
  });
});

describe('checklistTemplates — DELETE', () => {
  beforeEach(async () => {
    await seedDoc('checklistTemplates', 'tpl-A', freshTemplate());
  });

  it('the CREATOR CAN delete', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'checklistTemplates', 'tpl-A')));
  });

  it('a same-family PARENT (non-creator) CAN delete', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'checklistTemplates', 'tpl-A')));
  });

  it('a same-family non-owner non-parent CANNOT delete (Q-A)', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'checklistTemplates', 'tpl-A')));
  });

  it('cross-tenant CANNOT delete', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'checklistTemplates', 'tpl-A')));
  });
});

// ===========================================================================
// checklistInstances
// ===========================================================================

describe('checklistInstances — CREATE', () => {
  it('a MEMBER can create an instance with userId=self', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'checklistInstances', 'inst-1'), freshInstance()),
    );
  });

  it('a PARENT can create an instance with userId=self', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'checklistInstances', 'inst-1'),
        freshInstance({ userId: UID.parentA }),
      ),
    );
  });

  it('CANNOT create an instance for another user (parents do not impersonate)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistInstances', 'inst-bad'),
        freshInstance({ userId: UID.memberA }),
      ),
    );
  });

  it('CANNOT create with isCompleted=true (spec: starts incomplete)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistInstances', 'inst-bad'),
        freshInstance({ isCompleted: true }),
      ),
    );
  });

  it('CANNOT create with a smuggled field', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistInstances', 'inst-bad'),
        freshInstance({ secret: 'pwned' }),
      ),
    );
  });

  it('cross-tenant: a member of B CANNOT create an instance in family A', async () => {
    const db = env.authenticatedContext(UID.memberB).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistInstances', 'inst-cross'),
        freshInstance({ familyId: FAMILY_A, userId: UID.memberB }),
      ),
    );
  });

  it('a DEACTIVATED member CANNOT create an instance', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'checklistInstances', 'inst-bad'),
        freshInstance({ userId: UID.deactivatedA }),
      ),
    );
  });
});

describe('checklistInstances — READ', () => {
  beforeEach(async () => {
    await seedDoc('checklistInstances', 'inst-A', freshInstance());
    await seedDoc(
      'checklistInstances',
      'inst-B',
      freshInstance({ familyId: FAMILY_B, userId: UID.memberB }),
    );
  });

  it('SAME-FAMILY caller CAN read (parent + members alike — parents see kid progress)', async () => {
    for (const uid of [UID.parentA, UID.memberA, UID.member2A]) {
      const db = env.authenticatedContext(uid).firestore();
      const { doc, getDoc } = await import('firebase/firestore');
      await assertSucceeds(getDoc(doc(db, 'checklistInstances', 'inst-A')));
    }
  });

  it('cross-tenant: parent of B CANNOT read a family-A instance', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'checklistInstances', 'inst-A')));
  });
});

describe('checklistInstances — UPDATE', () => {
  beforeEach(async () => {
    await seedDoc('checklistInstances', 'inst-A', freshInstance());
  });

  it('the OWNER CAN toggle isCompleted + itemsProgress', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), {
        isCompleted: true,
        completedAt: Date.now(),
        itemsProgress: { 'i-1': true, 'i-2': true },
      }),
    );
  });

  it('a same-family non-owner (even a parent) CANNOT update (owner-only)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), {
        itemsProgress: { 'i-1': true },
      }),
    );
  });

  it('a same-family non-owner member CANNOT update', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), {
        itemsProgress: { 'i-1': true },
      }),
    );
  });

  it('CANNOT change familyId (tenant lock)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), {
        familyId: FAMILY_B,
      }),
    );
  });

  it('CANNOT rewrite templateId', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), {
        templateId: 'tpl-other',
      }),
    );
  });

  it('CANNOT rewrite userId', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), {
        userId: UID.parentA,
      }),
    );
  });

  it('CANNOT rewrite date', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), {
        date: '2026-06-06',
      }),
    );
  });

  it('CANNOT rewrite createdAt', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), { createdAt: 0 }),
    );
  });

  it('cross-tenant CANNOT update', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'checklistInstances', 'inst-A'), { isCompleted: true }),
    );
  });
});

describe('checklistInstances — DELETE', () => {
  beforeEach(async () => {
    await seedDoc('checklistInstances', 'inst-A', freshInstance());
  });

  it('the OWNER CAN delete', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'checklistInstances', 'inst-A')));
  });

  it('a same-family PARENT (non-owner) CAN delete', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'checklistInstances', 'inst-A')));
  });

  it('a same-family non-owner non-parent CANNOT delete', async () => {
    const db = env.authenticatedContext(UID.member2A).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'checklistInstances', 'inst-A')));
  });

  it('cross-tenant CANNOT delete', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'checklistInstances', 'inst-A')));
  });
});
