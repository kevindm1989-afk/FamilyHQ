/**
 * inviteService — unit contract.
 *
 * Pins:
 *   - createInvite normalises the email (trim + lowercase) and rejects an
 *     obviously-invalid one before reaching addDoc.
 *   - getInviteById returns null for missing OR non-pending docs (so the
 *     redeem UI cannot distinguish revoked vs. accepted — privacy).
 *   - revokeInvite calls deleteDoc with the right path and surfaces a
 *     user-safe error on rules denial.
 *   - acceptInvite throws user-safe errors on:
 *       - empty trimmed name (client-side validation)
 *       - missing invite
 *       - email mismatch with the invite's recorded email
 *
 * Acceptance batch wiring (createUserWithEmailAndPassword + writeBatch)
 * is exercised end-to-end by the authed e2e suite (the redeem flow is
 * the natural integration test); here we only pin the validation gates.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const addDocMock = vi.fn();
const getDocMock = vi.fn();
const deleteDocMock = vi.fn();
const collectionMock = vi.fn();
const docMock = vi.fn();
const createUserMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  addDoc: (...a: unknown[]) => addDocMock(...a),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  deleteDoc: (...a: unknown[]) => deleteDocMock(...a),
  collection: (...a: unknown[]) => collectionMock(...a),
  doc: (...a: unknown[]) => docMock(...a),
  writeBatch: vi.fn(),
  serverTimestamp: vi.fn(),
}));
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...a: unknown[]) => createUserMock(...a),
}));

import {
  createInvite,
  getInviteById,
  revokeInvite,
  acceptInvite,
  InviteActionError,
  INVITE_EMAIL_IN_USE_ERROR,
  INVITE_TTL_MS,
} from './inviteService';

const db = { __db: true } as never;
const auth = { __auth: true } as never;

beforeEach(() => {
  addDocMock.mockReset();
  getDocMock.mockReset();
  deleteDocMock.mockReset();
  collectionMock.mockReset();
  docMock.mockReset();
  createUserMock.mockReset();
  // `.withConverter` is chained in the service — the mock collection and
  // doc refs must support it without throwing, otherwise the try/catch
  // swallows a TypeError and surfaces as a generic InviteActionError that
  // masks the real assertion.
  const refWithConverter = (ref: { __ref?: true }) => ({
    ...ref,
    withConverter: () => ref,
  });
  collectionMock.mockImplementation(() => refWithConverter({ __ref: true }));
  docMock.mockImplementation(() => refWithConverter({ __ref: true }));
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('createInvite', () => {
  it('rejects an empty email before reaching addDoc', async () => {
    await expect(createInvite({ db }, { email: '   ', role: 'member', familyId: 'fam-A', invitedBy: 'p1' })).rejects.toBeInstanceOf(InviteActionError);
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed email (no @) before reaching addDoc', async () => {
    await expect(createInvite({ db }, { email: 'no-at-sign', role: 'member', familyId: 'fam-A', invitedBy: 'p1' })).rejects.toBeInstanceOf(InviteActionError);
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('normalises the email (trim + lowercase) before writing the doc', async () => {
    addDocMock.mockResolvedValue({ id: 'new-invite' });
    const id = await createInvite(
      { db },
      { email: '  Alice@Example.Test  ', role: 'parent', familyId: 'fam-A', invitedBy: 'p1' },
    );
    expect(id).toBe('new-invite');
    const writtenPayload = addDocMock.mock.calls[0]![1] as { email: string; role: string; status: string };
    expect(writtenPayload.email).toBe('alice@example.test');
    expect(writtenPayload.role).toBe('parent');
    expect(writtenPayload.status).toBe('pending');
  });

  it('writes an explicit expiresAt = createdAt + INVITE_TTL_MS so the redeem page can enforce TTL', async () => {
    addDocMock.mockResolvedValue({ id: 'new-invite' });
    await createInvite(
      { db },
      { email: 'a@b.com', role: 'member', familyId: 'fam-A', invitedBy: 'p1' },
    );
    const payload = addDocMock.mock.calls[0]![1] as { createdAt: number; expiresAt: number };
    // Use approximate equality — Date.now() advances between the test's read
    // and the service's write, but the delta should be exactly INVITE_TTL_MS.
    expect(payload.expiresAt - payload.createdAt).toBe(INVITE_TTL_MS);
  });

  it('wraps a Firestore failure in a user-safe InviteActionError (no raw code)', async () => {
    addDocMock.mockRejectedValue(new Error('permission-denied'));
    await expect(createInvite({ db }, { email: 'a@b.com', role: 'member', familyId: 'fam-A', invitedBy: 'p1' })).rejects.toBeInstanceOf(InviteActionError);
  });
});

describe('getInviteById', () => {
  it('returns null when the invite does not exist', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const result = await getInviteById({ db }, 'missing');
    expect(result).toBeNull();
  });

  it('returns null when the invite is no longer pending (accepted)', async () => {
    getDocMock.mockResolvedValue({
      id: 'inv-1',
      exists: () => true,
      data: () => ({ status: 'accepted', email: 'a@b.com', role: 'member', familyId: 'fam-A' }),
    });
    const result = await getInviteById({ db }, 'inv-1');
    expect(result).toBeNull();
  });

  it('returns null when the invite is expired (past its expiresAt) — indistinguishable from missing/accepted/revoked', async () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    getDocMock.mockResolvedValue({
      id: 'inv-1',
      exists: () => true,
      data: () => ({
        status: 'pending',
        email: 'a@b.com',
        role: 'member',
        familyId: 'fam-A',
        invitedBy: 'p1',
        createdAt: oneHourAgo - INVITE_TTL_MS,
        expiresAt: oneHourAgo, // Already past — strictly expired.
      }),
    });
    const result = await getInviteById({ db }, 'inv-1');
    expect(result).toBeNull();
  });

  it('returns null on a legacy pending invite (no expiresAt) whose createdAt + TTL is in the past', async () => {
    // Pre-TTL invites have no expiresAt; the service falls back to
    // createdAt + INVITE_TTL_MS and still enforces the cutoff. Important
    // so old links don't outlive the policy.
    getDocMock.mockResolvedValue({
      id: 'inv-1',
      exists: () => true,
      data: () => ({
        status: 'pending',
        email: 'a@b.com',
        role: 'member',
        familyId: 'fam-A',
        invitedBy: 'p1',
        createdAt: Date.now() - INVITE_TTL_MS - 1000,
        // expiresAt deliberately omitted to simulate a legacy doc.
      }),
    });
    const result = await getInviteById({ db }, 'inv-1');
    expect(result).toBeNull();
  });

  it('returns the invite + id when pending', async () => {
    getDocMock.mockResolvedValue({
      id: 'inv-1',
      exists: () => true,
      data: () => ({
        status: 'pending',
        email: 'a@b.com',
        role: 'member',
        familyId: 'fam-A',
        invitedBy: 'p1',
        // Created just now with an explicit expiry well in the future — the
        // happy path. Hardcoded timestamps would trip the TTL check and
        // surface as a false-negative "expired" return.
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL_MS,
      }),
    });
    const result = await getInviteById({ db }, 'inv-1');
    expect(result).toMatchObject({
      id: 'inv-1',
      status: 'pending',
      email: 'a@b.com',
      role: 'member',
      familyId: 'fam-A',
      invitedBy: 'p1',
    });
  });

  it('swallows network errors and returns null (UI shows the generic "invalid link" state)', async () => {
    getDocMock.mockRejectedValue(new Error('network'));
    const result = await getInviteById({ db }, 'inv-1');
    expect(result).toBeNull();
  });
});

describe('revokeInvite', () => {
  it('calls deleteDoc and resolves on success', async () => {
    deleteDocMock.mockResolvedValue(undefined);
    await expect(revokeInvite({ db }, 'inv-1')).resolves.toBeUndefined();
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
  });

  it('wraps a Firestore failure in a user-safe InviteActionError', async () => {
    deleteDocMock.mockRejectedValue(new Error('rules-denied'));
    await expect(revokeInvite({ db }, 'inv-1')).rejects.toBeInstanceOf(InviteActionError);
  });
});

describe('acceptInvite — validation gates', () => {
  it('rejects an empty trimmed name', async () => {
    await expect(
      acceptInvite({ auth, db }, { inviteId: 'inv-1', email: 'a@b.com', password: 'pw', name: '   ' }),
    ).rejects.toBeInstanceOf(InviteActionError);
  });

  it('rejects when the invite is missing', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await expect(
      acceptInvite(
        { auth, db },
        { inviteId: 'gone', email: 'a@b.com', password: 'pw', name: 'Alice' },
      ),
    ).rejects.toBeInstanceOf(InviteActionError);
  });

  it('rejects when the email does not match the invite', async () => {
    getDocMock.mockResolvedValue({
      id: 'inv-1',
      exists: () => true,
      data: () => ({
        status: 'pending',
        email: 'bound@invite.test',
        role: 'member',
        familyId: 'fam-A',
        invitedBy: 'p1',
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL_MS,
      }),
    });
    await expect(
      acceptInvite(
        { auth, db },
        { inviteId: 'inv-1', email: 'WRONG@example.test', password: 'pw', name: 'Alice' },
      ),
    ).rejects.toBeInstanceOf(InviteActionError);
  });

  it('maps `auth/email-already-in-use` to the specific INVITE_EMAIL_IN_USE_ERROR message (so the UI can offer "Sign in instead")', async () => {
    getDocMock.mockResolvedValue({
      id: 'inv-1',
      exists: () => true,
      data: () => ({
        status: 'pending',
        email: 'invitee@example.test',
        role: 'member',
        familyId: 'fam-A',
        invitedBy: 'p1',
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL_MS,
      }),
    });
    // Firebase auth errors carry a `code` string. acceptInvite must
    // distinguish this one code from the generic "something went wrong".
    const firebaseErr = Object.assign(new Error('Firebase: email already in use'), {
      code: 'auth/email-already-in-use',
    });
    createUserMock.mockRejectedValue(firebaseErr);
    await expect(
      acceptInvite(
        { auth, db },
        { inviteId: 'inv-1', email: 'invitee@example.test', password: 'pw', name: 'Alice' },
      ),
    ).rejects.toMatchObject({
      name: 'InviteActionError',
      message: INVITE_EMAIL_IN_USE_ERROR,
    });
  });

  it('still collapses other Firebase auth errors (e.g. weak-password) to the generic message', async () => {
    getDocMock.mockResolvedValue({
      id: 'inv-1',
      exists: () => true,
      data: () => ({
        status: 'pending',
        email: 'invitee@example.test',
        role: 'member',
        familyId: 'fam-A',
        invitedBy: 'p1',
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL_MS,
      }),
    });
    const firebaseErr = Object.assign(new Error('Firebase: weak password'), {
      code: 'auth/weak-password',
    });
    createUserMock.mockRejectedValue(firebaseErr);
    await expect(
      acceptInvite(
        { auth, db },
        { inviteId: 'inv-1', email: 'invitee@example.test', password: 'pw', name: 'Alice' },
      ),
    ).rejects.toMatchObject({
      name: 'InviteActionError',
      // The generic message — NOT the email-in-use one — so the UI shows
      // a plain retry toast without the "Sign in instead" affordance.
      message: expect.not.stringContaining(INVITE_EMAIL_IN_USE_ERROR),
    });
  });
});
