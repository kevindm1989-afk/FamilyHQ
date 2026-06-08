/**
 * Live family checklist-instances feed (PR C).
 *
 * Subscribes to `checklistInstances` scoped by `familyId == familyId`.
 * Any active same-family member can READ every instance (firestore.rules
 * — parents see kid progress, kids see siblings' runs). No role
 * branching here; UPDATE is owner-only at the rule layer.
 *
 * `createdAt` is normalised through `toMillis` so the UI deals in a
 * single numeric shape.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { checklistInstanceConverter } from '../../lib/converters';
import type { ChecklistInstance } from '../../lib/types';
import type { ChecklistInstanceWithId } from './checklistsService';

export interface UseFamilyChecklistInstancesResult {
  instances: ChecklistInstanceWithId[];
  loading: boolean;
  error: string | null;
}

const INSTANCE_LOAD_ERROR = 'We could not load routine runs. Please try again.';

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'number') return value;
  return Date.now();
}

function toInstance(snap: QueryDocumentSnapshot<ChecklistInstance>): ChecklistInstanceWithId {
  const data = snap.data() as ChecklistInstance & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

export function useFamilyChecklistInstances(
  familyId: string | null,
): UseFamilyChecklistInstancesResult {
  const [instances, setInstances] = useState<ChecklistInstanceWithId[]>([]);
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInstances([]);
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
        const q = query(
          collection(db, 'checklistInstances').withConverter(checklistInstanceConverter),
          where('familyId', '==', familyId),
        );
        unsub = onSnapshot(
          q,
          (snap) => {
            setInstances(snap.docs.map(toInstance));
            setLoading(false);
            setError(null);
          },
          () => {
            setInstances([]);
            setLoading(false);
            setError(INSTANCE_LOAD_ERROR);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(INSTANCE_LOAD_ERROR);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  return { instances, loading, error };
}
