/**
 * SECURITY-CRITICAL — Managed (email-less) child accounts
 * (ADR-0003 Option C; docs/specs/managed-child-accounts.md §6).
 *
 * A managed child is a `member` + metadata: `accountType: 'managed'` +
 * `loginHandle`. Its Auth sign-in address is derived from loginHandle, so both
 * fields are identity/authority: the child must NOT be able to self-promote out
 * of 'managed' or repoint its loginHandle. The createManagedChild callable
 * writes these via the Admin SDK (which bypasses rules); the CLIENT-side guards
 * asserted here are the selfUpdate immutability pins + the server-only
 * familyLoginCodes ledger.
 *
 * Mirrors user-immutability.test.ts (M3/F2). Runs against the emulator.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FAMILY_A, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: Awaited<ReturnType<typeof getEnv>>;

const CHILD_UID = 'uid-child-a';
const LOGIN_CODE = 'otter4';

/** Seed a managed child in FAMILY_A + a familyLoginCodes ledger doc (rules off). */
async function seedManagedChild(): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'users', CHILD_UID), {
      name: 'Maya',
      role: 'member',
      familyId: FAMILY_A,
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
      accountType: 'managed',
      loginHandle: 'maya',
    });
    await setDoc(doc(db, 'userPrivate', CHILD_UID), {
      email: `maya@${LOGIN_CODE}.familyhq.invalid`,
      familyId: FAMILY_A,
    });
    await setDoc(doc(db, 'familyLoginCodes', LOGIN_CODE), { familyId: FAMILY_A });
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
  await seedManagedChild();
});
afterEach(async () => {
  await env.clearFirestore();
});

describe('managed child — self-update authority guards', () => {
  it('CAN change own name (a managed child is still a normal member)', async () => {
    const db = env.authenticatedContext(CHILD_UID).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', CHILD_UID), { name: 'Maya R.' }));
  });

  it('CAN change own theme', async () => {
    const db = env.authenticatedContext(CHILD_UID).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', CHILD_UID), { theme: 'dark' }));
  });

  it('CANNOT self-promote out of managed (accountType is immutable)', async () => {
    const db = env.authenticatedContext(CHILD_UID).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', CHILD_UID), { accountType: 'standard' }));
  });

  it('CANNOT repoint own loginHandle (breaks the sign-in identity)', async () => {
    const db = env.authenticatedContext(CHILD_UID).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', CHILD_UID), { loginHandle: 'someoneelse' }));
  });

  it('CANNOT elevate own role to parent', async () => {
    const db = env.authenticatedContext(CHILD_UID).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', CHILD_UID), { role: 'parent' }));
  });

  it('CANNOT smuggle an accountType change alongside a name change (mixed write denied)', async () => {
    const db = env.authenticatedContext(CHILD_UID).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'users', CHILD_UID), { name: 'Maya R.', accountType: 'standard' }),
    );
  });
});

describe('managed child — parent cannot mutate identity fields either', () => {
  it('parent CAN rename a managed child', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'users', CHILD_UID), { name: 'Maya (kid)' }));
  });

  it('parent CANNOT change a managed child accountType (only name/isActive are parent-writable)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', CHILD_UID), { accountType: 'standard' }));
  });

  it('parent CANNOT change a managed child loginHandle', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'users', CHILD_UID), { loginHandle: 'newhandle' }));
  });
});

describe('familyLoginCodes — server-only ledger, no client access', () => {
  it('a parent CANNOT read the login-code ledger (no family-enumeration oracle)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'familyLoginCodes', LOGIN_CODE)));
  });

  it('a parent CANNOT write the login-code ledger', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(setDoc(doc(db, 'familyLoginCodes', 'newcode'), { familyId: FAMILY_A }));
  });

  it('a member/child CANNOT read the login-code ledger', async () => {
    const db = env.authenticatedContext(CHILD_UID).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'familyLoginCodes', LOGIN_CODE)));
  });
});
