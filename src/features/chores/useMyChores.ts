/**
 * My-chores feed hook (Phase 3, Task 10; handoff #05 ChoresTeenScreen;
 * threat-model P2/M7). Mirrors useFamilyEvents / useFamilyPosts.
 *
 * Subscribes to `chores` scoped with BOTH equality filters the rules allow —
 * `where('familyId','==', familyId)` AND `where('assignedTo','==', uid)` — so a
 * member sees ONLY their OWN chores, never another member's nor another
 * family's. Never an unconstrained or cross-assignee/cross-family query.
 *
 * Returns `{ chores, loading, error, refresh }`; `refresh()` forces a server
 * re-fetch (pull-to-refresh). `createdAt` (and a pending serverTimestamp ->
 * ~now) is Timestamp->millis converted so a Timestamp object never reaches the
 * UI (lessons.md Timestamp->millis). `dueDate` is a plain ISO STRING (mirrors
 * events `date`) and is surfaced as-is.
 *
 * Clears chores on a uid OR familyId CHANGE — not only when null — so one
 * member's chores never linger while another member's list loads (cross-display
 * leak).
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

const CHORE_LOAD_ERROR = 'We could not load your chores. Please try again.';

/**
 * Firestore returns `createdAt` as a `Timestamp` at read time, but
 * `Chore.createdAt` is typed `number` (ms). Convert here so a Timestamp object
 * never reaches the UI. A pending serverTimestamp (local write before the server
 * resolves) arrives as `null` — treat it as ~now so it never renders NaN / null
 * / epoch. Mirrors the events/posts conversion.
 */
function toMillis(createdAt: unknown): number {
  if (createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function') {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export interface UseMyChoresResult {
  chores: ChoreWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function buildChoresQuery(db: Firestore, uid: string, familyId: string) {
  // BOTH equality filters: own family AND own assignment (order-independent).
  // The orderBy may require a composite index in firestore.indexes.json.
  return query(
    collection(db, 'chores'),
    where('familyId', '==', familyId),
    where('assignedTo', '==', uid),
    orderBy('createdAt', 'desc'),
  );
}

function toChore(snap: QueryDocumentSnapshot): ChoreWithId {
  const data = snap.data() as Chore & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

export function useMyChores(uid: string | null, familyId: string | null): UseMyChoresResult {
  const [chores, setChores] = useState<ChoreWithId[]>([]);
  // No uid/family yet -> never query; not loading, empty list.
  const [loading, setLoading] = useState<boolean>(uid !== null && familyId !== null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic refresh token: a resolved fetch whose token is stale is ignored,
  // so the LATEST refresh() always wins even if an earlier call resolves last.
  const refreshToken = useRef(0);
  const dbRef = useRef<Firestore | null>(null);

  useEffect(() => {
    // Always clear stale chores on a uid OR familyId CHANGE — not only when one
    // goes null — so one member's chores never linger while another member's
    // list loads (cross-display leak).
    setChores([]);
    if (uid === null || familyId === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    // Firebase config is imported lazily so this module's top level stays SDK-
    // free (mirrors useFamily / useFamilyEvents).
    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        dbRef.current = db;
        unsub = onSnapshot(
          buildChoresQuery(db, uid, familyId),
          (snap) => {
            setChores((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toChore));
            setLoading(false);
          },
          () => {
            // Never surface a raw Firebase code / PII.
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
  }, [uid, familyId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (uid === null || familyId === null) return;
    const token = (refreshToken.current += 1);
    try {
      const db = dbRef.current ?? (await import('../../firebase/config')).db;
      dbRef.current = db;
      const snap = await getDocsFromServer(buildChoresQuery(db, uid, familyId));
      // Ignore a stale fetch: a newer refresh() has been issued since.
      if (token !== refreshToken.current) return;
      setChores((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toChore));
      setError(null);
    } catch {
      if (token !== refreshToken.current) return;
      setError(CHORE_LOAD_ERROR);
    }
  }, [uid, familyId]);

  return { chores, loading, error, refresh };
}
