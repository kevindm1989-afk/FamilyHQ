/**
 * SECURITY/PRIVACY-CRITICAL — startup uid-guard FAIL-CLOSED wiring (Finding A,
 * HIGH; M19, P6, threat-model §2.4 TB4 / T4.1).
 *
 * A previous session may end WITHOUT signOutAndClearCache (tab killed, crash,
 * token expiry on a shared device). On the next app start the authenticated uid
 * may differ from the persisted "last cached uid" marker, meaning the IndexedDB
 * cache still holds the PRIOR user's family PI. The auth listener must:
 *   1. on a uid MISMATCH, force a full page reload (fresh Firestore client)
 *      BEFORE any feature code can read Firestore;
 *   2. force that reload EVEN IF clearCacheIfUserChanged REJECTS (fail closed —
 *      a failed clear must not silently let the session proceed against a dirty
 *      cache);
 *   3. NOT release the session to a loaded/readable state on the mismatch path
 *      (loading stays true and authUser is NOT set), so no feature gets a chance
 *      to read the foreign cache before the reload swaps in a fresh client.
 * On a SAME-uid (or cold-start) start the session is released normally and NO
 * reload fires.
 *
 * Level: unit. authService (clearCacheIfUserChanged) + firebase/config +
 * firebase/auth are mocked at the boundary; we drive the onAuthStateChanged
 * callback directly and assert the hook's observable state + the injected
 * reload. No real IndexedDB / SDK / clock / network.
 *
 * Isolation: mocks + localStorage cleared per test; window.location.reload is
 * stubbed per test; the auth callback is captured fresh each render.
 *
 * FAILS today: the listener sets authUser / loading:false synchronously
 * regardless of the mismatch, never awaits the guard, swallows a guard
 * rejection (no .catch), and does not gate the session behind the reload.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

// The startup guard (mocked at the boundary so we control mismatch + rejection).
const clearCacheIfUserChanged = vi.fn(
  (..._a: unknown[]): Promise<{ reloadRequired: boolean }> =>
    Promise.resolve({ reloadRequired: false }),
);
const signOutAndClearCache = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve());

vi.mock('../features/auth/authService', () => ({
  clearCacheIfUserChanged: (...a: unknown[]) => clearCacheIfUserChanged(...a),
  signOutAndClearCache: (...a: unknown[]) => signOutAndClearCache(...a),
}));

const fakeAuth = { __auth: true };
const fakeDb = { __db: true };

// Capture the onAuthStateChanged callback so a test can drive it with a user.
// useAuth now reaches onAuthStateChanged via the firebase/config re-export
// (single dynamic-import promise; keeps firebase/auth out of the main bundle).
// Mock the re-export at the config boundary; firebase/auth no longer needs
// to be mocked here because useAuth has no static reference to it.
let authCallback: ((user: unknown) => void) | undefined;
const onAuthStateChanged = vi.fn((_auth: unknown, cb: (user: unknown) => void) => {
  authCallback = cb;
  return () => {};
});

vi.mock('../firebase/config', () => ({
  auth: fakeAuth,
  db: fakeDb,
  onAuthStateChanged: (...a: [unknown, (user: unknown) => void]) => onAuthStateChanged(...a),
}));

import { AuthProvider, useAuth } from './useAuth';

const LAST_UID_KEY = 'familyhq.lastCachedUid';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(AuthProvider, null, children);

const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  authCallback = undefined;
  // jsdom's window.location.reload is non-configurable; replace it for the test.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
  clearCacheIfUserChanged.mockImplementation(
    (..._a: unknown[]): Promise<{ reloadRequired: boolean }> =>
      Promise.resolve({ reloadRequired: false }),
  );
  signOutAndClearCache.mockImplementation((..._a: unknown[]): Promise<void> => Promise.resolve());
});

afterEach(() => {
  localStorage.clear();
});

/** Render the provider and wait for the lazy firebase config import to wire the listener. */
async function renderAndWaitForListener() {
  const view = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => {
    expect(authCallback, 'auth listener should have wired up').toBeTypeOf('function');
  });
  return view;
}

describe('useAuth startup uid-guard — uid MISMATCH (Finding A)', () => {
  it('forces a page reload when the authenticated uid differs from the persisted marker', async () => {
    localStorage.setItem(LAST_UID_KEY, 'uid-prev-user');
    clearCacheIfUserChanged.mockResolvedValue({ reloadRequired: true });

    await renderAndWaitForListener();

    await act(async () => {
      authCallback?.({ uid: 'uid-new-user' });
    });

    await waitFor(() => {
      expect(reload, 'a uid mismatch at startup must force a fresh-client reload').toHaveBeenCalledTimes(1);
    });
  });

  it('FAIL CLOSED: forces the reload even when clearCacheIfUserChanged REJECTS', async () => {
    localStorage.setItem(LAST_UID_KEY, 'uid-prev-user');
    clearCacheIfUserChanged.mockRejectedValue(new Error('clear failed on running client'));

    await renderAndWaitForListener();

    await act(async () => {
      authCallback?.({ uid: 'uid-new-user' });
    });

    await waitFor(() => {
      expect(
        reload,
        'a rejected clear must not be swallowed — the session must still be reloaded so a dirty cache is never used',
      ).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT release the session (loading stays true, authUser unset) on the mismatch path until reload', async () => {
    localStorage.setItem(LAST_UID_KEY, 'uid-prev-user');
    // Keep the guard pending so we can observe the gated state before it resolves.
    let resolveGuard: (v: { reloadRequired: boolean }) => void = () => {};
    clearCacheIfUserChanged.mockImplementation(
      () =>
        new Promise<{ reloadRequired: boolean }>((res) => {
          resolveGuard = res;
        }),
    );

    const { result } = await renderAndWaitForListener();

    await act(async () => {
      authCallback?.({ uid: 'uid-new-user' });
    });

    // The mismatch must NOT release the session to a readable state: feature
    // code keyed off `loading === false` / a set authUser must not run before
    // the cache is cleared and the client is replaced via reload.
    expect(
      result.current.loading,
      'loading must stay true on the mismatch path so no feature reads the foreign cache before reload',
    ).toBe(true);
    expect(
      result.current.authUser,
      'authUser must NOT be set on the mismatch path before the cache is cleared',
    ).toBeNull();

    // Drain the pending guard so the test ends cleanly (no dangling promise).
    await act(async () => {
      resolveGuard({ reloadRequired: true });
    });
  });
});

describe('useAuth startup uid-guard — SAME uid / cold start releases the session', () => {
  it('releases the session (loading:false, authUser set) and does NOT reload when the uid matches the marker', async () => {
    localStorage.setItem(LAST_UID_KEY, 'uid-same-user');
    clearCacheIfUserChanged.mockResolvedValue({ reloadRequired: false });

    const { result } = await renderAndWaitForListener();
    const user = { uid: 'uid-same-user' };

    await act(async () => {
      authCallback?.(user);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.authUser).toEqual(user);
    expect(
      reload,
      'a same-user warm start must NOT reload',
    ).not.toHaveBeenCalled();
  });

  it('releases the session on a cold start (no prior marker) without reloading', async () => {
    // No marker set -> cold start.
    clearCacheIfUserChanged.mockResolvedValue({ reloadRequired: false });

    const { result } = await renderAndWaitForListener();
    const user = { uid: 'uid-first-user' };

    await act(async () => {
      authCallback?.(user);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.authUser).toEqual(user);
    expect(reload, 'a cold start must NOT reload').not.toHaveBeenCalled();
  });
});
