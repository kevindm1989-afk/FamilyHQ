/**
 * `rateLimits/{any}` rules contract — privacy review Fix 3 (PR D
 * round-2 fix-up).
 *
 * The notify-callables write per-caller counter docs at
 * `rateLimits/{kind}__{callerUid}` from the server (Admin SDK,
 * which bypasses these rules). NO authenticated client — and no
 * unauthenticated client — should ever be able to read, list, or
 * write any doc under this collection:
 *   - A client read would let a caller probe their own rate window
 *     (or a peer's), which is operationally noisy.
 *   - A client write would let a caller pre-poison their own counter
 *     to disable rate limiting, OR write a high-count doc against
 *     another uid as a denial-of-service against that user.
 *
 * The default-deny catch-all at the end of `firestore.rules` already
 * covers `rateLimits/*`, but the explicit `match /rateLimits/{any}`
 * block in front of it makes the intent obvious and survives any
 * future rule reorder.
 */
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: RulesTestEnvironment;

const RATE_LIMIT_DOC_ID = 'choreApproved__uid-parent-a';

async function seedRateLimitDoc(): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'rateLimits', RATE_LIMIT_DOC_ID), {
      count: 1,
      windowStartMs: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
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
});
afterEach(async () => {
  await env.clearFirestore();
});

describe('rateLimits/*: authenticated user cannot list/read/write any doc', () => {
  it('authenticated user CANNOT read an existing rateLimits doc', async () => {
    await seedRateLimitDoc();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'rateLimits', RATE_LIMIT_DOC_ID)));
  });

  it('authenticated user CANNOT list the rateLimits collection', async () => {
    await seedRateLimitDoc();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'rateLimits')));
  });

  it('authenticated user CANNOT create a new rateLimits doc', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'rateLimits', RATE_LIMIT_DOC_ID), {
        count: 0,
        windowStartMs: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }),
    );
  });

  it('authenticated user CANNOT update an existing rateLimits doc (no counter reset)', async () => {
    await seedRateLimitDoc();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'rateLimits', RATE_LIMIT_DOC_ID), { count: 0 }));
  });

  it('authenticated user CANNOT delete a rateLimits doc', async () => {
    await seedRateLimitDoc();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { deleteDoc, doc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'rateLimits', RATE_LIMIT_DOC_ID)));
  });

  it('unauthenticated caller CANNOT read or write any rateLimits doc', async () => {
    await seedRateLimitDoc();
    const db = env.unauthenticatedContext().firestore();
    const { doc, getDoc, setDoc, collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'rateLimits', RATE_LIMIT_DOC_ID)));
    await assertFails(getDocs(collection(db, 'rateLimits')));
    await assertFails(setDoc(doc(db, 'rateLimits', 'forged'), { count: 0, windowStartMs: 0 }));
  });
});
