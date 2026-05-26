/**
 * CONTRACT — auth context (Task 7).
 *
 * Signatures only. Exposes the current Firebase Auth user (or null) and a
 * loading flag while the initial auth state resolves. Authorization is NEVER
 * decided here — firestore.rules is the boundary; this is for UI gating only.
 */
import type { ReactElement, ReactNode } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';

export interface AuthState {
  /** The signed-in Firebase Auth user, or null when signed out. */
  authUser: FirebaseUser | null;
  /** True until the first auth-state callback resolves. */
  loading: boolean;
}

export declare function AuthProvider(props: { children: ReactNode }): ReactElement;

export declare function useAuth(): AuthState;
