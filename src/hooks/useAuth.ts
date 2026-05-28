/**
 * Auth context (Task 7).
 *
 * Exposes the current Firebase Auth user (or null) and a loading flag while the
 * initial auth state resolves. Authorization is NEVER decided here —
 * firestore.rules is the boundary; this is for UI gating only.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
// Type-only — erased at compile time, so no firebase/auth runtime dependency
// is created. The actual onAuthStateChanged function is re-exported from
// firebase/config and reached via the dynamic loadFirebaseConfig() promise.
import type { User as FirebaseUser } from 'firebase/auth';

export interface AuthState {
  authUser: FirebaseUser | null;
  loading: boolean;
  /**
   * Sign the user out AND clear the on-device IndexedDB cache (M19, CRITICAL).
   * MUST route through authService.signOutAndClearCache so a shared device
   * never retains the prior family's children's PI. Contract pinned by
   * useAuth.signOut.test.tsx.
   */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

// localStorage marker for the startup uid-guard (Finding 3). Compares the
// authenticated uid against the last cached uid so a session that ended WITHOUT
// signOutAndClearCache (crash / tab kill / token expiry on a shared device)
// cannot leave the prior user's family PI readable from the IndexedDB cache.
const LAST_UID_KEY = 'familyhq.lastCachedUid';

// Single lazy loader for the Firebase config so the module stays SDK-free at
// load time (Firebase init throws on a missing API key under tests). Both the
// auth listener and sign-out share ONE import promise, so they always see the
// same module instance (and the same mock under tests).
let configPromise: Promise<typeof import('../firebase/config')> | null = null;
function loadFirebaseConfig(): Promise<typeof import('../firebase/config')> {
  configPromise ??= import('../firebase/config');
  return configPromise;
}

export function AuthProvider(props: { children: ReactNode }): ReactElement {
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Lazy import keeps the module SDK-free at load time (Firebase init throws on
  // a missing API key under tests); the auth listener wires up on mount.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void loadFirebaseConfig()
      .then(({ auth, db, onAuthStateChanged }) => {
        if (cancelled) return;
        unsub = onAuthStateChanged(auth, (user) => {
          // Finding 3 + Finding A — startup uid-guard, FAIL CLOSED. On a
          // CONFIRMED authenticated session, before the app uses Firestore for
          // that session, terminate + wipe the IndexedDB cache if the
          // authenticated uid differs from the last cached uid.
          //
          // The guard (clearCacheIfUserChanged) returns { reloadRequired }:
          //  - reloadRequired:true (uid MISMATCH) — do NOT release the session
          //    (loading stays true, authUser stays unset) so no feature reads
          //    the foreign cache; force a full page reload to swap in a fresh
          //    Firestore client (the terminated singleton is unusable).
          //  - reloadRequired:false (same-uid / cold-start) — release the
          //    session normally; no reload.
          //
          // FAIL CLOSED: if the guard REJECTS (e.g. the clear failed on a still-
          // running client), the rejection must NOT be swallowed and must NOT
          // release the session — we still force the reload so a dirty cache is
          // never used. The promise is awaited/caught here so there is no
          // unhandled rejection.
          if (user) {
            void import('../features/auth/authService').then(({ clearCacheIfUserChanged }) =>
              clearCacheIfUserChanged({
                db,
                currentUid: user.uid,
                getLastUid: () => localStorage.getItem(LAST_UID_KEY),
                setLastUid: (u) => localStorage.setItem(LAST_UID_KEY, u),
              }).then(
                ({ reloadRequired }) => {
                  if (reloadRequired) {
                    // Mismatch: keep the session gated (loading true, no
                    // authUser) and force a fresh client.
                    window.location.reload();
                    return;
                  }
                  // Same-uid / cold-start: safe to release the session.
                  setAuthUser(user);
                  setLoading(false);
                },
                () => {
                  // Guard rejected (fail closed): never release the session;
                  // force the reload so the dirty cache is never read.
                  window.location.reload();
                },
              ),
            );
            return;
          }
          // No user: release the logged-out state.
          setAuthUser(user);
          setLoading(false);
        });
      })
      .catch(() => {
        // SDK init can fail when no Firebase config is present (e.g. under unit
        // tests). Resolve the loading gate so the UI falls back to the
        // logged-out state instead of leaving an unhandled rejection.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // Sign-out routes through signOutAndClearCache (M19). Firebase config and the
  // auth service are imported lazily (same pattern as the auth listener) so the
  // module stays SDK-free at load time.
  const signOut = async (): Promise<void> => {
    const { auth, db } = await loadFirebaseConfig();
    const { signOutAndClearCache } = await import('../features/auth/authService');
    // Inject a full-page reload (Finding 2) so the service rebuilds a fresh
    // Firestore client after the terminated client + cache clear.
    await signOutAndClearCache({ auth, db, reload: () => window.location.reload() });
  };

  const value = useMemo<AuthState>(() => ({ authUser, loading, signOut }), [authUser, loading]);

  return createElement(AuthContext.Provider, { value }, props.children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
