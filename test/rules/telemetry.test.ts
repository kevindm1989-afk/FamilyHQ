/**
 * SECURITY/PRIVACY — first-party telemetry collections (usageEvents,
 * clientErrors). See src/lib/telemetry.ts.
 *
 * Invariants pinned here:
 *  - CREATE allowed ONLY for an active member, and ONLY with the exact
 *    anonymous shape (no uid/familyId can be smuggled in; the create rule's
 *    hasOnly() + type/pattern/size checks reject anything else).
 *  - usageEvents.event must be on the allowlist; both docs' `day` must be an
 *    ISO date; clientErrors fields are size-capped server-side.
 *  - READ / UPDATE / DELETE are DENIED for everyone (review in the console).
 *  - A deactivated user cannot write (isActive gate).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { UID, getEnv, seedBaseline, teardownEnv } from './helpers';

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

const DAY = '2026-07-07';

describe('usageEvents — anonymous create-only', () => {
  it('an active member CAN create a well-formed {event, day} tick', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertSucceeds(
      addDoc(collection(db, 'usageEvents'), { event: 'chore_approved', day: DAY }),
    );
  });

  it('rejects an event NOT on the allowlist', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertFails(addDoc(collection(db, 'usageEvents'), { event: 'secret_probe', day: DAY }));
  });

  it('rejects a doc that smuggles a uid/familyId (shape not hasOnly)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertFails(
      addDoc(collection(db, 'usageEvents'), {
        event: 'chore_approved',
        day: DAY,
        uid: UID.memberA,
      }),
    );
  });

  it('rejects a malformed day', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertFails(
      addDoc(collection(db, 'usageEvents'), { event: 'chore_approved', day: 'yesterday' }),
    );
  });

  it('a DEACTIVATED user cannot create', async () => {
    const db = env.authenticatedContext(UID.deactivatedA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertFails(
      addDoc(collection(db, 'usageEvents'), { event: 'chore_approved', day: DAY }),
    );
  });

  it('nobody can READ the collection (no aggregate exposure to clients)', async () => {
    // Seed one doc with rules disabled, then attempt an authed read.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'usageEvents', 'seed'), { event: 'chore_approved', day: DAY });
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'usageEvents', 'seed')));
  });
});

describe('clientErrors — scrubbed, shaped, create-only', () => {
  const GOOD = {
    name: 'Error',
    message: 'render failed',
    stackHead: 'at ChoreCard',
    route: '/chores',
    day: DAY,
  };

  it('an active member CAN create a well-formed scrubbed error', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertSucceeds(addDoc(collection(db, 'clientErrors'), GOOD));
  });

  it('rejects an over-cap message (server re-enforces the size bound)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertFails(
      addDoc(collection(db, 'clientErrors'), { ...GOOD, message: 'x'.repeat(301) }),
    );
  });

  it('rejects an extra/smuggled field', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { addDoc, collection } = await import('firebase/firestore');
    await assertFails(
      addDoc(collection(db, 'clientErrors'), { ...GOOD, uid: UID.memberA }),
    );
  });

  it('nobody can READ the collection', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { doc, setDoc } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'clientErrors', 'seed'), GOOD);
    });
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'clientErrors', 'seed')));
  });
});
