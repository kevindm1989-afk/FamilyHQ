/**
 * Family calendar feed hook (Phase 3, Task 13; handoff #03 CalendarScreen,
 * threat-model P2/M7). Mirrors useFamilyPosts.
 *
 * Subscribes to `events` scoped to the caller's family with the ONLY query the
 * rules allow: `where('familyId','==', familyId)`. Never an unconstrained or
 * cross-family query. Returns `{ events, loading, error, refresh }`; `refresh()`
 * forces a server re-fetch (pull-to-refresh).
 *
 * NOTE on `date`: the persisted `date` is an ISO datetime STRING (not a
 * Timestamp). It is surfaced as-is; only `createdAt` is Timestamp->millis
 * converted (mirrors posts) so a Timestamp object never reaches the UI.
 *
 * Clears events on a familyId CHANGE — not only when it goes null — so family
 * A's events never linger while family B's calendar loads (cross-tenant display
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
import type { FamilyEvent } from '../../lib/types';
import type { EventWithId } from './calendarService';

const EVENT_LOAD_ERROR = 'We could not load the calendar. Please try again.';

/**
 * Firestore returns `createdAt` as a `Timestamp` at read time, but
 * `FamilyEvent.createdAt` is typed `number` (ms). Convert here so a Timestamp
 * object never reaches the UI. A pending serverTimestamp (local write before the
 * server resolves) arrives as `null` — treat it as ~now so it never renders
 * NaN / null / epoch. Mirrors the posts conversion.
 */
function toMillis(createdAt: unknown): number {
  if (createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function') {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export interface UseFamilyEventsResult {
  events: EventWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function buildEventsQuery(db: Firestore, familyId: string) {
  return query(collection(db, 'events'), where('familyId', '==', familyId), orderBy('date', 'asc'));
}

function toEvent(snap: QueryDocumentSnapshot): EventWithId {
  const data = snap.data() as FamilyEvent & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

export function useFamilyEvents(familyId: string | null): UseFamilyEventsResult {
  const [events, setEvents] = useState<EventWithId[]>([]);
  // No family yet -> never query; not loading, empty list.
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic refresh token: a resolved fetch whose token is stale is ignored,
  // so the LATEST refresh() always wins even if an earlier call resolves last.
  const refreshToken = useRef(0);
  const dbRef = useRef<Firestore | null>(null);
  // Lesson 2026-05-28 #2: sign by id + every field the screen reads (here:
  // title, date, tag — list rows render these). An id-only signature would
  // drop a title edit / date reschedule / tag re-categorization on the same
  // event id as a redundant re-fire. `description` is not in the list rows;
  // an edit to description alone never re-renders the list, so it's not in
  // the signature. Reset per effect run so a familyId change does not carry
  // a stale signature.
  const lastSnapshotSig = useRef<string | null>(null);

  useEffect(() => {
    // Always clear stale events on a familyId CHANGE — not only when it goes
    // null — so family A's events never linger while family B's feed loads
    // (cross-tenant display leak).
    setEvents([]);
    if (familyId === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    lastSnapshotSig.current = null;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    // Firebase config is imported lazily so this module's top level stays SDK-
    // free (mirrors useFamily / useFamilyPosts).
    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        dbRef.current = db;
        unsub = onSnapshot(
          buildEventsQuery(db, familyId),
          (snap) => {
            const docs = (snap as { docs: QueryDocumentSnapshot[] }).docs;
            const sig = docs
              .map((d) => {
                const data = d.data() as FamilyEvent;
                return [d.id, data.title, data.date, data.tag].join(':');
              })
              .join(',');
            if (sig === lastSnapshotSig.current) {
              setLoading(false);
              return;
            }
            lastSnapshotSig.current = sig;
            refreshToken.current += 1;
            setEvents(docs.map(toEvent));
            setLoading(false);
          },
          () => {
            // Never surface a raw Firebase code / PII.
            setError(EVENT_LOAD_ERROR);
            setLoading(false);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(EVENT_LOAD_ERROR);
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
      const snap = await getDocsFromServer(buildEventsQuery(db, familyId));
      // Ignore a stale fetch: a newer refresh() has been issued since.
      if (token !== refreshToken.current) return;
      setEvents((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toEvent));
      setError(null);
    } catch {
      if (token !== refreshToken.current) return;
      setError(EVENT_LOAD_ERROR);
    }
  }, [familyId]);

  return { events, loading, error, refresh };
}
