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
 * Finding A (HIGH) — the cache is on a STARTED Firestore client (config.ts
 * enables persistentLocalCache at module load), so clearIndexedDbPersistence
 * REJECTS unless the client is terminated first. This file additionally pins:
 *  - terminate(db) is called BEFORE clearIndexedDbPersistence(db) on a mismatch;
 *  - same-uid / cold-start paths NEVER terminate or clear;
 *  - the function returns { reloadRequired: true } on a mismatch so the caller
 *    can guarantee a fresh-client reload, and { reloadRequired: false } else;
 *  - FAIL-CLOSED: if terminate OR clearIndexedDbPersistence rejects, the
 *    rejection PROPAGATES (the function does not resolve to a "safe to proceed"
 *    value), so a failed clear can never silently leave a foreign cache
 *    readable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clearIndexedDbPersistence = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve());
const terminate = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  clearIndexedDbPersistence: (...a: unknown[]) => clearIndexedDbPersistence(...a),
  terminate: (...a: unknown[]) => terminate(...a),
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
  terminate.mockImplementation((..._a: unknown[]): Promise<void> => Promise.resolve());
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

  it('Finding A: terminates the Firestore client BEFORE clearing (clear rejects on a running client)', async () => {
    const order: string[] = [];
    terminate.mockImplementation((..._a: unknown[]): Promise<void> => {
      order.push('terminate');
      return Promise.resolve();
    });
    clearIndexedDbPersistence.mockImplementation((..._a: unknown[]): Promise<void> => {
      order.push('clear');
      return Promise.resolve();
    });
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-new-user',
      getLastUid: () => 'uid-prev-user',
      setLastUid: vi.fn(),
    });
    expect(
      order,
      'terminate(db) must run before clearIndexedDbPersistence(db) so the clear succeeds on the started client',
    ).toEqual(['terminate', 'clear']);
    expect(terminate).toHaveBeenCalledWith(db);
  });

  it('Finding A: returns { reloadRequired: true } on a mismatch so the caller can force a fresh client', async () => {
    const result = await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-new-user',
      getLastUid: () => 'uid-prev-user',
      setLastUid: vi.fn(),
    });
    expect(result).toEqual({ reloadRequired: true });
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

  it('Finding A: does NOT terminate the Firestore client when the uid matches (no needless client teardown)', async () => {
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-same-user',
      getLastUid: () => 'uid-same-user',
      setLastUid: vi.fn(),
    });
    expect(
      terminate,
      'the same user must not have their live Firestore client torn down',
    ).not.toHaveBeenCalled();
  });

  it('Finding A: returns { reloadRequired: false } when the uid matches (no reload needed)', async () => {
    const result = await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-same-user',
      getLastUid: () => 'uid-same-user',
      setLastUid: vi.fn(),
    });
    expect(result).toEqual({ reloadRequired: false });
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

  it('Finding A: does NOT terminate the Firestore client on a cold start', async () => {
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-first-user',
      getLastUid: () => null,
      setLastUid: vi.fn(),
    });
    expect(
      terminate,
      'a cold start with no foreign cache must not tear down the client',
    ).not.toHaveBeenCalled();
  });

  it('Finding A: returns { reloadRequired: false } on a cold start (no reload needed)', async () => {
    const result = await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-first-user',
      getLastUid: () => null,
      setLastUid: vi.fn(),
    });
    expect(result).toEqual({ reloadRequired: false });
  });
});

describe('clearCacheIfUserChanged — FAIL CLOSED when the clear cannot complete (Finding A)', () => {
  it('propagates (rejects) when clearIndexedDbPersistence rejects, so the caller cannot treat the cache as cleared', async () => {
    clearIndexedDbPersistence.mockImplementation((..._a: unknown[]): Promise<void> =>
      Promise.reject(new Error('clear failed')),
    );
    await expect(
      clearCacheIfUserChanged({
        db,
        currentUid: 'uid-new-user',
        getLastUid: () => 'uid-prev-user',
        setLastUid: vi.fn(),
      }),
      'a failed clear must reject — it must NOT resolve to a value the caller can read as "safe to proceed"',
    ).rejects.toThrow('clear failed');
  });

  it('propagates (rejects) when terminate rejects (the client never stopped, so the cache is still live)', async () => {
    terminate.mockImplementation((..._a: unknown[]): Promise<void> =>
      Promise.reject(new Error('terminate failed')),
    );
    await expect(
      clearCacheIfUserChanged({
        db,
        currentUid: 'uid-new-user',
        getLastUid: () => 'uid-prev-user',
        setLastUid: vi.fn(),
      }),
      'a failed terminate must reject — a live client means the foreign cache is still readable',
    ).rejects.toThrow('terminate failed');
  });

  it('does NOT record the new uid marker when the clear rejects (the session was never safely confirmed)', async () => {
    clearIndexedDbPersistence.mockImplementation((..._a: unknown[]): Promise<void> =>
      Promise.reject(new Error('clear failed')),
    );
    const setLastUid = vi.fn();
    await clearCacheIfUserChanged({
      db,
      currentUid: 'uid-new-user',
      getLastUid: () => 'uid-prev-user',
      setLastUid,
    }).catch(() => {
      /* expected rejection — assertion is on the marker not advancing */
    });
    expect(
      setLastUid,
      'a failed clear must not advance the marker to the new uid, or the next start would treat the dirty cache as confirmed',
    ).not.toHaveBeenCalled();
  });
});
