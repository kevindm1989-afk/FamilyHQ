/**
 * Family-chores feed hook (Phase 3, Task 11; parent approval queue + filters).
 * Mirrors useMyChores, but scoped to the WHOLE family for a PARENT viewer: it
 * subscribes to `chores` with ONLY `where('familyId','==', familyId)` (the query
 * the parent read rule allows — the isParent() branch needs no own-assignment
 * predicate). A member must never use this hook (their rule denies a
 * family-only chore list); the route only renders the parent screen for a
 * parent viewer.
 *
 * Returns `{ chores, loading, error, refresh }`; `createdAt` is Timestamp->millis
 * converted (lessons.md) so a Timestamp object never reaches the UI. `dueDate`
 * is a plain ISO string surfaced as-is. Clears chores on a familyId CHANGE so
 * one family's chores never linger while another loads.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Chore } from '../../lib/types';
import type { ChoreWithId } from './choresMemberService';

const CHORE_LOAD_ERROR = 'We could not load chores. Please try again.';

function toMillis(createdAt: unknown): number {
  if (createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function') {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export interface UseFamilyChoresResult {
  chores: ChoreWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function buildQuery(db: Firestore, familyId: string) {
  return query(
    collection(db, 'chores'),
    where('familyId', '==', familyId),
    orderBy('createdAt', 'desc'),
  );
}

function toChore(snap: QueryDocumentSnapshot): ChoreWithId {
  const data = snap.data() as Chore & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

export function useFamilyChores(familyId: string | null): UseFamilyChoresResult {
  const [chores, setChores] = useState<ChoreWithId[]>([]);
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);
  const refreshToken = useRef(0);
  const dbRef = useRef<Firestore | null>(null);

  useEffect(() => {
    setChores([]);
    if (familyId === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        dbRef.current = db;
        unsub = onSnapshot(
          buildQuery(db, familyId),
          (snap) => {
            setChores((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toChore));
            setLoading(false);
          },
          () => {
            setError(CHORE_LOAD_ERROR);
            setLoading(false);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(CHORE_LOAD_ERROR);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (familyId === null) return;
    const token = (refreshToken.current += 1);
    try {
      const db = dbRef.current ?? (await import('../../firebase/config')).db;
      dbRef.current = db;
      const snap = await getDocsFromServer(buildQuery(db, familyId));
      if (token !== refreshToken.current) return;
      setChores((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toChore));
      setError(null);
    } catch {
      if (token !== refreshToken.current) return;
      setError(CHORE_LOAD_ERROR);
    }
  }, [familyId]);

  return { chores, loading, error, refresh };
}
