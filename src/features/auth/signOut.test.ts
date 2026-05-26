/**
 * SECURITY/PRIVACY-CRITICAL — sign-out clears the on-device cache (M19, P6,
 * threat-model §2.4 TB4 / T4.1; constraints "IndexedDB cache ... clear on
 * sign-out"). Security finding 2 / privacy finding 1, CRITICAL.
 *
 * After sign-out the on-device IndexedDB Firestore cache may hold ANOTHER
 * family's children's PI; the next user on a shared device must not be able to
 * read it. `signOutAndClearCache` must:
 *   1. call signOut(auth)            — revoke the live session FIRST,
 *   2. then terminate(db)            — stop the Firestore client,
 *   3. then clearIndexedDbPersistence(db) — wipe the cache,
 * in that exact order. A failure of signOut must NOT skip cache clearing (a
 * failed sign-out must never leave child PI on the device).
 *
 * Level: unit. firebase/auth + firebase/firestore are mocked at the boundary so
 * we assert the orchestration (which APIs, in what order) WITHOUT a real
 * IndexedDB. Server enforcement is irrelevant here — this is purely client
 * cache hygiene.
 *
 * Isolation: no real clock/network/RNG/IndexedDB; mocks reset each test; the
 * call-order log is local to each test (no shared mutable state).
 *
 * FAILS today: signOutAndClearCache is a contract stub that throws.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ordered log of which mocked SDK call fired, in call order.
let callOrder: string[];

const signOut = vi.fn((..._a: unknown[]): Promise<void> => {
  callOrder.push('signOut');
  return Promise.resolve();
});
const terminate = vi.fn((..._a: unknown[]): Promise<void> => {
  callOrder.push('terminate');
  return Promise.resolve();
});
const clearIndexedDbPersistence = vi.fn((..._a: unknown[]): Promise<void> => {
  callOrder.push('clearIndexedDbPersistence');
  return Promise.resolve();
});

vi.mock('firebase/auth', () => ({
  signOut: (...a: unknown[]) => signOut(...a),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  terminate: (...a: unknown[]) => terminate(...a),
  clearIndexedDbPersistence: (...a: unknown[]) => clearIndexedDbPersistence(...a),
  doc: vi.fn(),
  writeBatch: vi.fn(),
}));

// Imported AFTER the mocks are registered.
import { signOutAndClearCache } from './authService';

const auth = { currentUser: { uid: 'u1' } } as unknown as import('firebase/auth').Auth;
const db = { __db: true } as unknown as import('firebase/firestore').Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  callOrder = [];
  signOut.mockImplementation((..._a: unknown[]): Promise<void> => {
    callOrder.push('signOut');
    return Promise.resolve();
  });
  terminate.mockImplementation((..._a: unknown[]): Promise<void> => {
    callOrder.push('terminate');
    return Promise.resolve();
  });
  clearIndexedDbPersistence.mockImplementation((..._a: unknown[]): Promise<void> => {
    callOrder.push('clearIndexedDbPersistence');
    return Promise.resolve();
  });
});

describe('signOutAndClearCache — happy path', () => {
  it('calls signOut, terminate, then clearIndexedDbPersistence in that order', async () => {
    await signOutAndClearCache({ auth, db });
    expect(callOrder).toEqual(['signOut', 'terminate', 'clearIndexedDbPersistence']);
  });

  it('passes the Auth instance to signOut', async () => {
    await signOutAndClearCache({ auth, db });
    expect(signOut).toHaveBeenCalledWith(auth);
  });

  it('passes the Firestore instance to terminate and clearIndexedDbPersistence', async () => {
    await signOutAndClearCache({ auth, db });
    expect(terminate).toHaveBeenCalledWith(db);
    expect(clearIndexedDbPersistence).toHaveBeenCalledWith(db);
  });

  it('clears the cache exactly once (no double-clear)', async () => {
    await signOutAndClearCache({ auth, db });
    expect(clearIndexedDbPersistence).toHaveBeenCalledTimes(1);
  });
});

describe('signOutAndClearCache — sign-out failure still clears the cache', () => {
  it('clears the IndexedDB cache even when signOut rejects (child PI must not survive)', async () => {
    signOut.mockImplementation((..._a: unknown[]): Promise<void> => {
      callOrder.push('signOut');
      return Promise.reject(new Error('network-signout-failure'));
    });

    await expect(signOutAndClearCache({ auth, db })).rejects.toThrow();

    // The cache MUST still be cleared despite the signOut failure.
    expect(
      clearIndexedDbPersistence,
      'cache must be cleared even if signOut fails',
    ).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
