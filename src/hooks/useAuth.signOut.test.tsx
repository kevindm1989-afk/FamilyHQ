/**
 * SECURITY/PRIVACY-CRITICAL — useAuth.signOut routes through the cache-clearing
 * path (M19, P6). The UI sign-out affordance must not call Firebase signOut
 * directly (that would leave the IndexedDB cache — and another family's
 * children's PI — on a shared device); it must go through
 * authService.signOutAndClearCache.
 *
 * Level: unit. The authService module and firebase/config are mocked so we
 * assert ONLY that the hook's signOut delegates to signOutAndClearCache with
 * the live auth + db. The ordering/cache semantics are covered by
 * features/auth/signOut.test.ts.
 *
 * FAILS today: useAuth.signOut is a contract stub that throws.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

const signOutAndClearCache = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve());

vi.mock('../features/auth/authService', () => ({
  signOutAndClearCache: (...a: unknown[]) => signOutAndClearCache(...a),
}));

// firebase/config is imported lazily by the hook; provide a deterministic stub
// (no real SDK init under tests).
const fakeAuth = { __auth: true };
const fakeDb = { __db: true };
const onAuthStateChanged = vi.fn((..._a: unknown[]) => () => {});

vi.mock('../firebase/config', () => ({
  auth: fakeAuth,
  db: fakeDb,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...a: unknown[]) => onAuthStateChanged(...a),
}));

import { AuthProvider, useAuth } from './useAuth';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(AuthProvider, null, children);

beforeEach(() => {
  vi.clearAllMocks();
  signOutAndClearCache.mockImplementation((..._a: unknown[]): Promise<void> =>
    Promise.resolve(),
  );
});

describe('useAuth.signOut — routes through the cache-clearing path', () => {
  it('delegates to authService.signOutAndClearCache with the live auth + db', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.signOut();
    });

    await waitFor(() => {
      expect(signOutAndClearCache).toHaveBeenCalledTimes(1);
    });
    expect(signOutAndClearCache).toHaveBeenCalledWith(
      expect.objectContaining({ auth: fakeAuth, db: fakeDb }),
    );
  });
});
