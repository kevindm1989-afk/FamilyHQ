/**
 * Live savings-goals feed scoped by family + role (Feature 1).
 *
 * For a PARENT: subscribes to ALL family goals — used by the parent dashboard
 * widget + the dedicated Goals screen.
 *
 * For a MEMBER: subscribes ONLY to goals whose `ownerUid == self`. This
 * mirrors the rules-level read constraint (members can't enumerate other
 * members' goals — privacy by query). The subscription closes the moment
 * familyId / uid changes (switch-account).
 *
 * Defensive identity-key + teardown mirror `usePendingFamilyInvites`.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { savingsGoalConverter } from '../../lib/converters';
import type { SavingsGoal } from '../../lib/types';
import type { SavingsGoalWithId } from './savingsGoalsService';

export interface SavingsGoalsFeed {
  goals: SavingsGoalWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function toGoal(snap: QueryDocumentSnapshot<SavingsGoal>): SavingsGoalWithId {
  return { id: snap.id, ...snap.data() };
}

function buildQuery(
  db: Firestore,
  familyId: string,
  scope: { role: 'parent' | 'member'; uid: string },
) {
  const base = collection(db, 'savingsGoals').withConverter(savingsGoalConverter);
  // Parents see every family goal; members are scoped to their own. The
  // member-side ownerUid filter is BOTH a privacy boundary AND a rule-
  // compatibility one (the firestore rule for member-list is keyed on
  // ownerUid == auth.uid).
  return scope.role === 'parent'
    ? query(base, where('familyId', '==', familyId))
    : query(base, where('familyId', '==', familyId), where('ownerUid', '==', scope.uid));
}

export function useFamilySavingsGoals(
  familyId: string | null,
  scope: { role: 'parent' | 'member'; uid: string } | null,
): SavingsGoalsFeed {
  const [goals, setGoals] = useState<SavingsGoalWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId || !scope) {
      setGoals([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../../firebase/config').then(({ db }) => {
      if (cancelled) return;
      unsub = onSnapshot(
        buildQuery(db, familyId, scope),
        (snap) => {
          const list = snap.docs.map(toGoal);
          // Sort client-side: active goals first (createdAt asc within),
          // then completed (updatedAt desc), then archived (updatedAt
          // desc). Keeps the screen list deterministic without needing
          // a composite Firestore index.
          list.sort((a, b) => {
            const rank = (g: SavingsGoalWithId): number =>
              g.status === 'active' ? 0 : g.status === 'completed' ? 1 : 2;
            const dRank = rank(a) - rank(b);
            if (dRank !== 0) return dRank;
            if (a.status === 'active') return a.createdAt - b.createdAt;
            return b.updatedAt - a.updatedAt;
          });
          setGoals(list);
          setLoading(false);
          setError(null);
        },
        () => {
          setGoals([]);
          setLoading(false);
          setError('We could not load savings goals.');
        },
      );
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
    // We depend on the role + uid (the identity keys), NOT the `scope`
    // object reference — passing the object would re-subscribe on every
    // render if the caller builds it inline. Same shape as the other
    // family-scoped hooks (useFamilyChores etc.).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, scope?.role, scope?.uid]);

  const refresh = async (): Promise<void> => {
    // onSnapshot auto-refreshes; refresh() exists for API parity with
    // sibling feeds (useFamilyEvents / useFamilyPosts).
  };

  return { goals, loading, error, refresh };
}
