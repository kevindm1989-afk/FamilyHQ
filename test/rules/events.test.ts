/**
 * SECURITY-CRITICAL — `events` create / read / list / update / delete
 * authorization (Phase 3, Task 13).
 *
 * Threat-model §3 (tenant isolation P1/P2/P4), §5.2 (deactivated user, F3/M26),
 * §8 priority-1 cross-tenant rows; ADR-0002 role model; constraints.md
 * "Tenant isolation — the #1 security requirement".
 *
 * THE TIGHTENING this suite pins (Task 13 spec — event CRUD is PARENT-ONLY):
 *   The SHIPPED rule today is
 *     allow create: if isActive() && incomingSameFamily();
 *     allow update: if isActive() && sameFamily(resource) && incomingSameFamily()
 *                      && immutable('familyId');
 *     allow delete: if isActive() && sameFamily(resource);
 *   — which lets ANY active same-family MEMBER create/edit/delete events. The
 *   spec restricts event CRUD to PARENTS (members VIEW the shared calendar but
 *   cannot mutate it). These tests PIN the parent-only tightening:
 *     - a MEMBER create/update/delete is DENIED (FAILS the over-permissive rule);
 *     - a PARENT of the SAME family create/update/delete is ALLOWED;
 *     - a PARENT of ANOTHER family is DENIED (cross-tenant, P1/P4);
 *     - a DEACTIVATED parent/member is DENIED (F3/M26);
 *     - an UNAUTHENTICATED client is DENIED.
 *   The read/list scoping cases assert the EXISTING guarantees still hold (no
 *   weakening): own-family get/list allowed for any ACTIVE member; cross-family
 *   get/list and the UNCONSTRAINED list are denied (P1/P2/M7).
 *
 *   Create also requires incomingSameFamily() + createdBy == uid + a SHAPE LOCK
 *   (keys().hasOnly the 7 schema fields — mirrors posts). Update keeps
 *   immutable('familyId').
 *
 * Determinism: emulator-backed; each test seeds with rules disabled then asserts
 * through the rules. Per-test clearFirestore + reseed (no shared mutable state,
 * order-independent). No real clock/network/RNG beyond the emulator.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;

// seedBaseline seeds one event per family: `event-${FAMILY_A}` (createdBy
// parentA, tag 'family') and `event-${FAMILY_B}` (createdBy parentB).
const EVENT_A = `event-${FAMILY_A}`;
const EVENT_B = `event-${FAMILY_B}`;

/** The exact 7-field locked schema, parameterized for a given family/creator. */
function eventDoc(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    title: 'Soccer practice',
    description: 'Bring cleats',
    date: '2026-06-01T17:30:00.000Z',
    tag: 'sports',
    familyId: FAMILY_A,
    createdBy: UID.parentA,
    createdAt: Date.now(),
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

describe('events read — own-family only for any ACTIVE member (existing guarantee, P1/P7)', () => {
  it('an active MEMBER CAN get an own-family event', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'events', EVENT_A)));
  });

  it('an active PARENT CAN get an own-family event', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(db, 'events', EVENT_A)));
  });

  it('a family-A member CANNOT get a family-B event (cross-tenant, P1)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'events', EVENT_B)));
  });

  it('a DEACTIVATED user CANNOT get an own-family event (F3/M26)', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'events', EVENT_A)));
  });

  it('an UNAUTHENTICATED client CANNOT get an event', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'events', EVENT_A)));
  });
});

describe('events list — own-family where filter only (existing guarantee, P2/M7)', () => {
  it('own-family where(familyId==A) list of events is allowed for a member', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertSucceeds(
      getDocs(query(collection(db, 'events'), where('familyId', '==', FAMILY_A))),
    );
  });

  it('an UNCONSTRAINED list of events is denied (P2/M7)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'events')));
  });

  it('a cross-family where(familyId==B) list of events is denied (P2/M7)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs, query, where } = await import('firebase/firestore');
    await assertFails(
      getDocs(query(collection(db, 'events'), where('familyId', '==', FAMILY_B))),
    );
  });
});

describe('events CREATE — PARENT-ONLY, own family, self as createdBy, shape-locked (Task 13 tightening)', () => {
  it('a same-family PARENT CAN create an own-family event with the 7-field shape', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(doc(db, 'events', 'new-by-parent-a'), eventDoc({ createdBy: UID.parentA })),
    );
  });

  it('a MEMBER CANNOT create an event (tightening — FAILS the over-permissive rule)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'events', 'new-by-member-a'), eventDoc({ createdBy: UID.memberA })),
    );
  });

  it('a create with a FOREIGN familyId is denied (no cross-tenant write, P4)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'events', 'forged-family'),
        eventDoc({ familyId: FAMILY_B, createdBy: UID.parentA }),
      ),
    );
  });

  it('a create whose createdBy != the caller is denied (identity binding)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'events', 'forged-createdby'), eventDoc({ createdBy: UID.parentB })),
    );
  });

  it('a create carrying an EXTRA/unexpected key (beyond the 7-field shape) is denied (shape-lock)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'events', 'smuggled-field'),
        eventDoc({ createdBy: UID.parentA, location: 'forbidden field' }),
      ),
    );
  });

  it('a create MISSING a required schema key (e.g. tag) is denied (shape-lock)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    const { tag: _omit, ...withoutTag } = eventDoc({ createdBy: UID.parentA });
    void _omit;
    await assertFails(setDoc(doc(db, 'events', 'missing-tag'), withoutTag));
  });

  it('a DEACTIVATED user CANNOT create an event (F3/M26)', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'events', 'by-deactivated'), eventDoc({ createdBy: UID.deactivatedA })),
    );
  });

  it('a cross-family PARENT CANNOT create an event in another family (P4)', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(
        doc(db, 'events', 'by-foreign-parent'),
        eventDoc({ familyId: FAMILY_A, createdBy: UID.parentB }),
      ),
    );
  });

  it('an UNAUTHENTICATED client CANNOT create an event', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'events', 'by-anon'), eventDoc({ createdBy: 'nobody' })),
    );
  });
});

describe('events UPDATE — PARENT-ONLY, own family, familyId immutable (Task 13 tightening)', () => {
  it('a same-family PARENT CAN edit an own-family event (title/date/tag)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'events', EVENT_A), {
        title: 'Soccer (rescheduled)',
        date: '2026-06-02T18:00:00.000Z',
        tag: 'family',
      }),
    );
  });

  it('a MEMBER CANNOT edit an event (tightening — FAILS the over-permissive rule)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { title: 'member edit' }));
  });

  it('a PARENT mutating familyId on an event is denied (immutable familyId, P? M5)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { familyId: FAMILY_B }));
  });

  it('a cross-family PARENT CANNOT edit an event in another family (P1)', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { title: 'cross-tenant edit' }));
  });

  it('a DEACTIVATED user CANNOT edit an event (F3/M26)', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { title: 'deactivated edit' }));
  });

  // FINDING C — authorship/creation are IMMUTABLE on update, mirroring the create
  // binding (createdBy == auth.uid). An edit may change content (title/description/
  // date/tag) but must NEVER rewrite who created the event or when.
  it('a same-family PARENT changing createdBy is DENIED (authorship immutable)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { createdBy: UID.memberA }));
  });

  it('a same-family PARENT changing createdBy to THEMSELVES is still DENIED (createdBy is write-once)', async () => {
    // Even a no-op-looking self re-assert must be denied — createdBy is immutable
    // after create, not merely "must equal the caller".
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { createdBy: UID.parentA }));
  });

  it('a same-family PARENT changing createdAt is DENIED (creation time immutable)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { createdAt: 12345 }));
  });

  it('a same-family PARENT may update title + description + date + tag together (content stays editable)', async () => {
    // Guards against an over-tightening that accidentally freezes the editable
    // content fields along with createdBy/createdAt/familyId.
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'events', EVENT_A), {
        title: 'Soccer (rescheduled)',
        description: 'New venue',
        date: '2026-06-03T18:30:00.000Z',
        tag: 'sports',
      }),
    );
  });
});

describe('events VALUE VALIDATION — tag enum + ISO datetime date, on CREATE and UPDATE (Finding C)', () => {
  const VALID_TAGS = ['school', 'sports', 'family', 'work'] as const;

  it('CREATE with each VALID tag is allowed (no false rejection of the enum)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    for (const tag of VALID_TAGS) {
      await assertSucceeds(
        setDoc(doc(db, 'events', `valid-tag-${tag}`), eventDoc({ createdBy: UID.parentA, tag })),
      );
    }
  });

  it('CREATE with a tag OUTSIDE the enum is DENIED', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'events', 'bad-tag'), eventDoc({ createdBy: UID.parentA, tag: 'chores' })),
    );
  });

  it('CREATE with an empty-string tag is DENIED', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'events', 'empty-tag'), eventDoc({ createdBy: UID.parentA, tag: '' })),
    );
  });

  it('CREATE with a date that is NOT an ISO datetime is DENIED (e.g. date-only / free text)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    // Date-only (no time component) — does not match YYYY-MM-DDTHH:MM:SS...Z.
    await assertFails(
      setDoc(doc(db, 'events', 'date-only'), eventDoc({ createdBy: UID.parentA, date: '2026-06-01' })),
    );
    // Free-text garbage.
    await assertFails(
      setDoc(
        doc(db, 'events', 'date-garbage'),
        eventDoc({ createdBy: UID.parentA, date: 'next Tuesday' }),
      ),
    );
  });

  it('CREATE with a well-formed ISO datetime date is allowed', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertSucceeds(
      setDoc(
        doc(db, 'events', 'good-date'),
        eventDoc({ createdBy: UID.parentA, date: '2026-06-01T17:30:00.000Z' }),
      ),
    );
  });

  it('UPDATE setting tag OUTSIDE the enum is DENIED', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { tag: 'not-a-tag' }));
  });

  it('UPDATE setting tag to a VALID enum value is allowed', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'events', EVENT_A), { tag: 'work' }));
  });

  it('UPDATE setting date to a NON-ISO-datetime value is DENIED', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'events', EVENT_A), { date: '2026-06-01' }));
  });

  it('UPDATE setting date to a well-formed ISO datetime is allowed', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'events', EVENT_A), { date: '2026-06-02T08:15:00.000Z' }));
  });
});

describe('events DELETE — PARENT-ONLY, own family (Task 13 tightening)', () => {
  it('a same-family PARENT CAN delete an own-family event', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertSucceeds(deleteDoc(doc(db, 'events', EVENT_A)));
  });

  it('a MEMBER CANNOT delete an event (tightening — FAILS the over-permissive rule)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'events', EVENT_A)));
  });

  it('a cross-family PARENT CANNOT delete an event in another family (P1)', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'events', EVENT_A)));
  });

  it('a DEACTIVATED user CANNOT delete an event (F3/M26)', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'events', EVENT_A)));
  });

  it('an UNAUTHENTICATED client CANNOT delete an event', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'events', EVENT_A)));
  });
});
