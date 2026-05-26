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
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider(props: { children: ReactNode }): ReactElement {
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Lazy import keeps the module SDK-free at load time (Firebase init throws on
  // a missing API key under tests); the auth listener wires up on mount.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../firebase/config').then(({ auth }) => {
      if (cancelled) return;
      unsub = onAuthStateChanged(auth, (user) => {
        setAuthUser(user);
        setLoading(false);
      });
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const value = useMemo<AuthState>(() => ({ authUser, loading }), [authUser, loading]);

  return createElement(AuthContext.Provider, { value }, props.children);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
