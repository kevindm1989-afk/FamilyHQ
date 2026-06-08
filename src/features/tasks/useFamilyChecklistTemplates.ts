/**
 * Live family checklist-templates feed (PR C).
 *
 * Subscribes to `checklistTemplates` scoped by `familyId == familyId`.
 *
 * Per the firestore.rules read predicate, a non-owner caller can ONLY
 * see templates where `isSharedWithFamily == true`. To avoid a
 * permission-denied per draft on every snapshot, we run TWO queries
 * and merge them client-side:
 *
 *   1) `familyId == familyId && isSharedWithFamily == true` — every
 *      shared template in the family.
 *   2) `familyId == familyId && createdBy == self` — every template
 *      the caller authored (covers their own drafts too).
 *
 * The set is de-duplicated by doc id (the same template can match both
 * predicates for a caller who shared their own template). `createdAt`
 * is normalised through `toMillis` for UI sorting.
 *
 * Both subscriptions live inside ONE useEffect so their lifecycles are
 * synchronised — a single firebase-config import, a single cleanup
 * tearing down both listeners.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { checklistTemplateConverter } from '../../lib/converters';
import type { ChecklistTemplate } from '../../lib/types';
import type { ChecklistTemplateWithId } from './checklistsService';

export interface UseFamilyChecklistTemplatesResult {
  templates: ChecklistTemplateWithId[];
  loading: boolean;
  error: string | null;
}

const TEMPLATE_LOAD_ERROR = 'We could not load routines. Please try again.';

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'number') return value;
  return Date.now();
}

function toTemplate(snap: QueryDocumentSnapshot<ChecklistTemplate>): ChecklistTemplateWithId {
  const data = snap.data() as ChecklistTemplate & { createdAt: unknown; updatedAt: unknown };
  return {
    id: snap.id,
    ...data,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

export function useFamilyChecklistTemplates(
  familyId: string | null,
  selfUid: string | null,
): UseFamilyChecklistTemplatesResult {
  const [sharedBatch, setSharedBatch] = useState<ChecklistTemplateWithId[]>([]);
  const [ownBatch, setOwnBatch] = useState<ChecklistTemplateWithId[]>([]);
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSharedBatch([]);
    setOwnBatch([]);
    if (familyId === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);

    let unsubShared: (() => void) | undefined;
    let unsubOwn: (() => void) | undefined;
    let cancelled = false;

    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        const baseRef = collection(db, 'checklistTemplates').withConverter(
          checklistTemplateConverter,
        );

        // (1) Shared templates in the family — readable by everyone in fam.
        unsubShared = onSnapshot(
          query(
            baseRef,
            where('familyId', '==', familyId),
            where('isSharedWithFamily', '==', true),
          ),
          (snap) => {
            setSharedBatch(snap.docs.map(toTemplate));
            setLoading(false);
            setError(null);
          },
          () => {
            setSharedBatch([]);
            setLoading(false);
            setError(TEMPLATE_LOAD_ERROR);
          },
        );

        // (2) Own templates (covers drafts). Skipped when there's no caller.
        if (selfUid !== null) {
          unsubOwn = onSnapshot(
            query(baseRef, where('familyId', '==', familyId), where('createdBy', '==', selfUid)),
            (snap) => {
              setOwnBatch(snap.docs.map(toTemplate));
              setLoading(false);
              setError(null);
            },
            () => {
              setOwnBatch([]);
              setLoading(false);
              setError(TEMPLATE_LOAD_ERROR);
            },
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(TEMPLATE_LOAD_ERROR);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubShared?.();
      unsubOwn?.();
    };
  }, [familyId, selfUid]);

  // Merge by id (a shared template authored by the caller appears in
  // both batches); sort by updatedAt desc so freshly-edited routines
  // float to the top.
  const templates = useMemo<ChecklistTemplateWithId[]>(() => {
    const map = new Map<string, ChecklistTemplateWithId>();
    for (const t of sharedBatch) map.set(t.id, t);
    for (const t of ownBatch) map.set(t.id, t);
    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sharedBatch, ownBatch]);

  return { templates, loading, error };
}
