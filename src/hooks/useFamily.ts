/**
 * Family context (Task 7, system-design §2.6).
 *
 * Provides the caller's own user doc (role + familyId) and the live list of
 * ACTIVE members of the caller's family — derived from the `users` collection
 * scoped to the caller's familyId (never cross-family; deactivated members
 * excluded). `role` here is for UI affordances only; firestore.rules enforce
 * authority.
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
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { userConverter } from '../lib/converters';
import { deriveActiveMembers } from '../lib/familyMembers';
import type { Role, UserWithId } from '../lib/types';
import { useAuth } from './useAuth';

export { deriveActiveMembers };

export interface FamilyState {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
}

const FamilyContext = createContext<FamilyState | undefined>(undefined);

export function FamilyProvider(props: { children: ReactNode }): ReactElement {
  const { authUser, loading: authLoading } = useAuth();
  const [currentUser, setCurrentUser] = useState<UserWithId | null>(null);
  const [allFamilyUsers, setAllFamilyUsers] = useState<UserWithId[]>([]);
  const [userLoading, setUserLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);

  // Subscribe to the caller's own user doc. Firebase config is imported lazily
  // so this module's top level stays SDK-free (keeps the pure derivation
  // helper unit-testable without initializing Firebase).
  useEffect(() => {
    if (!authUser) {
      setCurrentUser(null);
      setUserLoading(false);
      return;
    }
    setUserLoading(true);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../firebase/config').then(({ db }) => {
      if (cancelled) return;
      const ref = doc(db, 'users', authUser.uid).withConverter(userConverter);
      unsub = onSnapshot(
        ref,
        (snap) => {
          setCurrentUser(snap.exists() ? { id: snap.id, ...snap.data() } : null);
          setUserLoading(false);
        },
        () => {
          setCurrentUser(null);
          setUserLoading(false);
        },
      );
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [authUser]);

  // Subscribe to the family's users, scoped to the caller's familyId (the
  // ONLY query allowed by the rules — never cross-family).
  const familyId = currentUser?.familyId ?? null;
  useEffect(() => {
    if (!familyId) {
      setAllFamilyUsers([]);
      setMembersLoading(false);
      return;
    }
    setMembersLoading(true);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../firebase/config').then(({ db }) => {
      if (cancelled) return;
      const q = query(
        collection(db, 'users').withConverter(userConverter),
        where('familyId', '==', familyId),
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          setAllFamilyUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setMembersLoading(false);
        },
        () => {
          setAllFamilyUsers([]);
          setMembersLoading(false);
        },
      );
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  const value = useMemo<FamilyState>(() => {
    const members = familyId ? deriveActiveMembers(allFamilyUsers, familyId) : [];
    return {
      familyId,
      role: currentUser?.role ?? null,
      currentUser,
      members,
      loading: authLoading || userLoading || (familyId ? membersLoading : false),
    };
  }, [familyId, allFamilyUsers, currentUser, authLoading, userLoading, membersLoading]);

  return createElement(FamilyContext.Provider, { value }, props.children);
}

export function useFamily(): FamilyState {
  const ctx = useContext(FamilyContext);
  if (ctx === undefined) {
    throw new Error('useFamily must be used within a FamilyProvider');
  }
  return ctx;
}
