/**
 * SECURITY/PRIVACY-CRITICAL — startup uid-guard cache clear (M19, P6, threat-
 * model §2.4 TB4 / T4.1; adversarial review Finding 3).
 *
 * A previous session may end WITHOUT routing through signOutAndClearCache (tab
 * killed, crash, token expiry on a shared device). In that case the IndexedDB
 * Firestore cache still holds the prior user's family PI. On app startup, before
 * Firestore is used for a session, `clearCacheIfUserChanged` compares the
 * authenticated uid against a persisted "last cached uid" marker and wipes the
 * cache if the user changed.
 *
 * Required behavior (this file pins it):
 *  - prior uid recorded AND differs from currentUid -> clearIndexedDbPersistence
 *    is called BEFORE returning, then setLastUid(currentUid) records the new
 *    session marker.
 *  - prior uid === currentUid -> NO clear (warm cache is the same user's data);
 *    marker is (idempotently) recorded.
 *  - NO prior uid (null) -> NO clear (cold start, nothing foreign cached) but
 *    the marker IS recorded for next time.
 *
 * Level: unit. firebase/firestore is mocked at the boundary; getLastUid /
 * setLastUid are injected (no real localStorage), so no real IndexedDB or
 * storage is touched. No clock/network/RNG.
 *
 * Isolation: mocks reset per test; injected get/set are local to each test.
 *
 * FAILS today: clearCacheIfUserChanged is a contract stub that throws.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearIndexedDbPersistence = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  clearIndexedDbPersistence: (...a: unknown[]) => clearIndexedDbPersistence(...a),
  terminate: vi.fn(),
  doc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

import { clearCacheIfUserChanged } from './authService';

const db = { __db: true } as unknown as import('firebase/firestore').Firestore;

beforeEach(() => {
  vi.clearAllMocks();
  clearIndexedDbPersistence.mockImplementation((..._a: unknown[]): Promise<void> =>
    Promise.resolve(),
  );
});

describe('clearCacheIfUserChanged — uid differs from the persisted marker', () => {
  it('Finding 3: clears the IndexedDB cache when the authenticated uid differs from the last cached uid', async () => {
    const setLastUid = vi.fn();
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-new-user',
      getLastUid: () => 'uid-prev-user',
      setLastUid,
    });
    expect(
      clearIndexedDbPersistence,
      'a different user at startup must wipe the foreign cache',
    ).toHaveBeenCalledTimes(1);
    expect(clearIndexedDbPersistence).toHaveBeenCalledWith(db);
  });

  it('records the current uid as the new marker after a differing-user clear', async () => {
    const setLastUid = vi.fn();
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-new-user',
      getLastUid: () => 'uid-prev-user',
      setLastUid,
    });
    expect(setLastUid).toHaveBeenCalledWith('uid-new-user');
  });

  it('clears BEFORE recording the marker (cache wiped before the session is confirmed)', async () => {
    const order: string[] = [];
    clearIndexedDbPersistence.mockImplementation((..._a: unknown[]): Promise<void> => {
      order.push('clear');
      return Promise.resolve();
    });
    const setLastUid = vi.fn(() => {
      order.push('setLastUid');
    });
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-new-user',
      getLastUid: () => 'uid-prev-user',
      setLastUid,
    });
    expect(order).toEqual(['clear', 'setLastUid']);
  });
});

describe('clearCacheIfUserChanged — same uid as the marker', () => {
  it('does NOT clear the cache when the uid matches the persisted marker (same user, warm cache)', async () => {
    const setLastUid = vi.fn();
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-same-user',
      getLastUid: () => 'uid-same-user',
      setLastUid,
    });
    expect(
      clearIndexedDbPersistence,
      'the same user re-opening must keep their own warm cache',
    ).not.toHaveBeenCalled();
  });
});

describe('clearCacheIfUserChanged — no prior marker (cold start)', () => {
  it('does NOT clear the cache when there is no prior uid recorded', async () => {
    const setLastUid = vi.fn();
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-first-user',
      getLastUid: () => null,
      setLastUid,
    });
    expect(
      clearIndexedDbPersistence,
      'a cold start with no foreign cache must not clear',
    ).not.toHaveBeenCalled();
  });

  it('records the uid marker on a cold start so the next session can compare', async () => {
    const setLastUid = vi.fn();
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-first-user',
      getLastUid: () => null,
      setLastUid,
    });
    expect(setLastUid).toHaveBeenCalledWith('uid-first-user');
  });
});
