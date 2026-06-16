/**
 * F13 — family doc subscription hook.
 *
 * Reads the caller's `families/{familyId}` doc so the Family Management screen
 * can render the current `timezone` (and any other family-level settings added
 * later). Mirrors the lazy `firebase/config` import + cleanup pattern used by
 * `useFamily` and `useAllFamilyMembers`. Tenant scoping is server-side: the
 * rule allows `get` only for an active same-family member, so a stolen
 * familyId still can't leak another family's settings.
 *
 * Privacy: the family doc carries no PI today (familyName + createdBy +
 * createdAt + timezone). On error the hook surfaces nothing user-visible —
 * the screen treats the timezone as "not loaded yet" and falls back to the
 * universal default for display.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot, type Firestore } from 'firebase/firestore';
import { familyConverter } from '../../lib/converters';
import type { Family } from '../../lib/types';

export interface UseFamilyDocResult {
  family: Family | null;
  loading: boolean;
}

export function useFamilyDoc(familyId: string | null): UseFamilyDocResult {
  const [family, setFamily] = useState<Family | null>(null);
  const [loading, setLoading] = useState<boolean>(familyId !== null);

  useEffect(() => {
    if (familyId === null) {
      setFamily(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../../firebase/config')
      .then(({ db }: { db: Firestore }) => {
        if (cancelled) return;
        const ref = doc(db, 'families', familyId).withConverter(familyConverter);
        unsub = onSnapshot(
          ref,
          (snap) => {
            setFamily(snap.exists() ? snap.data() : null);
            setLoading(false);
          },
          () => {
            // Fail closed for the screen's purposes — render the fallback
            // shortlist with no current selection rather than echo a raw
            // Firebase code.
            setFamily(null);
            setLoading(false);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setFamily(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  return { family, loading };
}
