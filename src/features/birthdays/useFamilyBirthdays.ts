/**
 * Live family birthdays feed.
 *
 * Subscribes to `birthdays` scoped by `familyId == familyId`. Any active
 * same-family caller can read (firestore.rules). No role branching.
 *
 * `createdAt` is normalised through `toMillis` so the UI sees a single
 * numeric shape regardless of whether the doc was just written (server
 * Timestamp pending) or settled (number).
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
import { birthdayConverter } from '../../lib/converters';
import type { Birthday } from '../../lib/types';
import type { BirthdayWithId } from './birthdaysService';

export interface UseFamilyBirthdaysResult {
  birthdays: BirthdayWithId[];
  loading: boolean;
  error: string | null;
}

const LOAD_ERROR = 'We could not load birthdays. Please try again.';

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'number') return value;
  return Date.now();
}

function toBirthday(snap: QueryDocumentSnapshot<Birthday>): BirthdayWithId {
  const data = snap.data() as Birthday & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

function buildQuery(db: Firestore, familyId: string) {
  return query(
    collection(db, 'birthdays').withConverter(birthdayConverter),
    where('familyId', '==', familyId),
  );
}

export function useFamilyBirthdays(familyId: string | null): UseFamilyBirthdaysResult {
  const [birthdays, setBirthdays] = useState<BirthdayWithId[]>([]);
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBirthdays([]);
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
        unsub = onSnapshot(
          buildQuery(db, familyId),
          (snap) => {
            setBirthdays(snap.docs.map(toBirthday));
            setLoading(false);
            setError(null);
          },
          () => {
            setBirthdays([]);
            setLoading(false);
            setError(LOAD_ERROR);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(LOAD_ERROR);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  return { birthdays, loading, error };
}
