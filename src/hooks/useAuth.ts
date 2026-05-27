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
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';

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
      .then(({ auth }) => {
        if (cancelled) return;
        unsub = onAuthStateChanged(auth, (user) => {
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
    await signOutAndClearCache({ auth, db });
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
