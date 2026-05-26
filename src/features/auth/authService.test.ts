/**
 * Auth + tenant bootstrap — unit contract (Task 4, ADR-0006).
 *
 * Level: unit. Firebase Auth + Firestore are mocked at the SDK boundary so we
 * assert the SERVICE behavior (which APIs it calls, atomic batch shape, the
 * no-second-family guard, error mapping) without a live emulator. The
 * server-side enforcement of the same invariants is covered by the emulator
 * rules suite (test/rules/signup-bootstrap.test.ts, tests A-G).
 *
 * These FAIL today because src/features/auth/authService.ts is a contract stub
 * (declare-only) — the implementer writes the bodies to satisfy these.
 *
 * Isolation: no real clock/network/RNG; all SDK calls are vi.fn mocks; each
 * test re-creates its mocks (no shared mutable state).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock the Firebase SDK surfaces the service depends on. ---
const createUserWithEmailAndPassword = vi.fn();
const signInWithEmailAndPassword = vi.fn();
const sendPasswordResetEmail = vi.fn();

vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...a: unknown[]) =>
    createUserWithEmailAndPassword(...a),
  signInWithEmailAndPassword: (...a: unknown[]) => signInWithEmailAndPassword(...a),
  sendPasswordResetEmail: (...a: unknown[]) => sendPasswordResetEmail(...a),
}));

// Track batch operations so we can assert the atomic write shape.
interface BatchOp {
  path: string;
  data: Record<string, unknown>;
}
let batchOps: BatchOp[];
let batchCommitted: boolean;
let commitShouldReject: boolean;

const docMock = vi.fn((_db: unknown, collection: string, id: string) => ({
  __path: `${collection}/${id}`,
}));
const collectionMock = vi.fn((_db: unknown, collection: string) => ({
  __collection: collection,
}));
const writeBatchMock = vi.fn(() => ({
  set: (ref: { __path: string }, data: Record<string, unknown>) => {
    batchOps.push({ path: ref.__path, data });
  },
  commit: async () => {
    if (commitShouldReject) throw new Error('emulated-commit-failure');
    batchCommitted = true;
  },
}));

vi.mock('firebase/firestore', () => ({
  doc: (...a: [unknown, string, string]) => docMock(...a),
  collection: (...a: [unknown, string]) => collectionMock(...a),
  writeBatch: () => writeBatchMock(),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

// Imported AFTER mocks are registered.
import {
  sendPasswordReset,
  signIn,
  signUpFoundingParent,
} from './authService';

const auth = { currentUser: null } as unknown as import('firebase/auth').Auth;
const db = {} as import('firebase/firestore').Firestore;

const validSignup = {
  familyName: 'The Smiths',
  name: 'A Parent',
  email: 'parent@example.test',
  password: 'longenoughpw',
};

beforeEach(() => {
  vi.clearAllMocks();
  batchOps = [];
  batchCommitted = false;
  commitShouldReject = false;
  createUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'new-uid' } });
  signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'new-uid' } });
  sendPasswordResetEmail.mockResolvedValue(undefined);
});

describe('signUpFoundingParent — atomic bootstrap (happy path)', () => {
  it('creates the Auth user then commits exactly one families + one parent users doc', async () => {
    await signUpFoundingParent({ auth, db }, validSignup);

    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(batchCommitted).toBe(true);

    const families = batchOps.filter((o) => o.path.startsWith('families/'));
    const users = batchOps.filter((o) => o.path.startsWith('users/'));
    expect(families).toHaveLength(1);
    expect(users).toHaveLength(1);
  });

  it("writes the parent users doc keyed by the new Auth uid with role 'parent', isActive true, allowanceBalance 0", async () => {
    await signUpFoundingParent({ auth, db }, validSignup);

    const userDoc = batchOps.find((o) => o.path === 'users/new-uid');
    expect(userDoc).toBeDefined();
    expect(userDoc?.data).toMatchObject({
      role: 'parent',
      isActive: true,
      allowanceBalance: 0,
      name: 'A Parent',
    });
  });

  it('does NOT write email onto the family-readable users doc (privacy finding 2)', async () => {
    await signUpFoundingParent({ auth, db }, validSignup);
    const userDoc = batchOps.find((o) => o.path === 'users/new-uid');
    expect(userDoc).toBeDefined();
    expect(
      userDoc?.data,
      'email is adult [PI] and must not live on the family-readable users doc',
    ).not.toHaveProperty('email');
  });

  it('writes the email to userPrivate/{uid} in the SAME atomic batch', async () => {
    await signUpFoundingParent({ auth, db }, validSignup);

    const privateDoc = batchOps.find((o) => o.path === 'userPrivate/new-uid');
    expect(privateDoc, 'a userPrivate/{uid} doc must be written for the email').toBeDefined();
    expect(privateDoc?.data).toMatchObject({ email: 'parent@example.test' });
    // It is part of the SAME batch (one commit) so there is no orphaned email.
    expect(batchCommitted).toBe(true);
  });

  it('scopes the userPrivate doc to the same familyId as the family/users docs (rule scoping)', async () => {
    await signUpFoundingParent({ auth, db }, validSignup);

    const familyDoc = batchOps.find((o) => o.path.startsWith('families/'));
    const familyId = familyDoc?.path.split('/')[1];
    const privateDoc = batchOps.find((o) => o.path === 'userPrivate/new-uid');
    expect(privateDoc?.data.familyId).toBe(familyId);
  });

  it('the userPrivate doc carries ONLY email + familyId (no extra PI)', async () => {
    await signUpFoundingParent({ auth, db }, validSignup);
    const privateDoc = batchOps.find((o) => o.path === 'userPrivate/new-uid');
    expect(privateDoc).toBeDefined();
    expect(Object.keys(privateDoc?.data ?? {}).sort()).toEqual(['email', 'familyId']);
  });

  it('points the parent users doc at the SAME familyId as the family doc it creates', async () => {
    await signUpFoundingParent({ auth, db }, validSignup);

    const familyDoc = batchOps.find((o) => o.path.startsWith('families/'));
    const userDoc = batchOps.find((o) => o.path.startsWith('users/'));
    const familyId = familyDoc?.path.split('/')[1];
    expect(familyId).toBeTruthy();
    expect(userDoc?.data.familyId).toBe(familyId);
  });

  it('records the founding parent as families.createdBy (== the new uid)', async () => {
    await signUpFoundingParent({ auth, db }, validSignup);
    const familyDoc = batchOps.find((o) => o.path.startsWith('families/'));
    expect(familyDoc?.data.createdBy).toBe('new-uid');
  });

  it('returns the new uid and familyId', async () => {
    const result = await signUpFoundingParent({ auth, db }, validSignup);
    expect(result.uid).toBe('new-uid');
    expect(result.familyId).toEqual(expect.any(String));
    expect(result.familyId.length).toBeGreaterThan(0);
  });
});

describe('signUpFoundingParent — error / atomicity paths', () => {
  it('rejects when an existing user is already signed in (no second-family bootstrap)', async () => {
    const signedInAuth = {
      currentUser: { uid: 'existing-uid' },
    } as unknown as import('firebase/auth').Auth;

    await expect(
      signUpFoundingParent({ auth: signedInAuth, db }, validSignup),
    ).rejects.toThrow();
    // Must not attempt to create another Auth user or commit a family.
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(batchCommitted).toBe(false);
  });

  it('does not commit a partial family/user when the batch commit fails (no orphan)', async () => {
    commitShouldReject = true;
    await expect(
      signUpFoundingParent({ auth, db }, validSignup),
    ).rejects.toThrow();
    expect(batchCommitted).toBe(false);
  });

  it('surfaces a user-safe error (no raw Firebase code / PII) when Auth creation fails', async () => {
    createUserWithEmailAndPassword.mockRejectedValue(
      Object.assign(new Error('Firebase: auth/email-already-in-use'), {
        code: 'auth/email-already-in-use',
      }),
    );
    let caught: unknown;
    try {
      await signUpFoundingParent({ auth, db }, validSignup);
    } catch (e) {
      caught = e;
    }
    expect(caught, 'signup should reject when Auth creation fails').toBeDefined();
    const msg = caught instanceof Error ? caught.message : String(caught);
    // Must NOT leak the raw firebase code or the email PII (constraints).
    expect(msg, 'error message must not leak raw firebase auth/ code').not.toMatch(
      /auth\//,
    );
    expect(msg, 'error message must not leak the email PII').not.toContain(
      'parent@example.test',
    );
  });
});

describe('signIn / sendPasswordReset — call the right Firebase APIs', () => {
  it('signIn calls signInWithEmailAndPassword with the credentials', async () => {
    await signIn({ auth }, 'parent@example.test', 'longenoughpw');
    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
      auth,
      'parent@example.test',
      'longenoughpw',
    );
  });

  it('sendPasswordReset calls sendPasswordResetEmail with the email', async () => {
    await sendPasswordReset({ auth }, 'parent@example.test');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(auth, 'parent@example.test');
  });
});
