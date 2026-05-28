/**
 * All-family-members feed hook (Phase 4 — Family Management screen).
 *
 * Mirrors useFamilyChores's shape `{ members, loading, error, refresh }`, the
 * same lazy `firebase/config` import, monotonic refresh-token coordination,
 * clears on familyId change, null familyId -> no query. Family Management is a
 * parent-only screen and needs INACTIVE members visible so the parent can
 * reactivate them — useFamily already filters to active members via
 * deriveActiveMembers, so this hook is split out (keeps the existing
 * useFamily() consumers untouched).
 *
 * Query: `where('familyId','==', familyId)` ONLY — NO `where('isActive',…)`
 * filter (the list MUST include inactive members so the parent can reactivate
 * them). Defense-in-depth: `deriveAllMembers` post-filters by familyId so a
 * prefix-collision in cached docs cannot leak across families.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  getDocsFromServer,
  onSnapshot,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { deriveAllMembers } from '../../lib/familyMembers';
import type { User, UserWithId } from '../../lib/types';

const FAMILY_MEMBERS_LOAD_ERROR = 'We could not load family members. Please try again.';

export interface UseAllFamilyMembersResult {
  members: UserWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function buildQuery(db: Firestore, familyId: string) {
  return query(collection(db, 'users'), where('familyId', '==', familyId));
}

function toUser(snap: QueryDocumentSnapshot): UserWithId {
  const data = snap.data() as User;
  return { id: snap.id, ...data };
}

export function useAllFamilyMembers(familyId: string | null): UseAllFamilyMembersResult {
  const [members, setMembers] = useState<UserWithId[]>([]);
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);
  const refreshToken = useRef(0);
  const dbRef = useRef<Firestore | null>(null);
  // Mirror useFamilyChores's redundant re-fire guard: the live listener can
  // re-emit the same doc set. After a refresh has written a newer canonical
  // result, a redundant re-fire whose signature is unchanged is ignored, while
  // a genuinely newer snapshot is still applied. Reset per effect run so a
  // familyId change does not carry a stale signature.
  const lastSnapshotSig = useRef<string | null>(null);

  useEffect(() => {
    setMembers([]);
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
    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        dbRef.current = db;
        unsub = onSnapshot(
          buildQuery(db, familyId),
          (snap) => {
            const docs = (snap as { docs: QueryDocumentSnapshot[] }).docs;
            const sig = docs.map((d) => d.id).join(',');
            if (sig === lastSnapshotSig.current) {
              setLoading(false);
              return;
            }
            lastSnapshotSig.current = sig;
            // Claim the next monotonic token so an in-flight refresh knows a
            // newer live snapshot has superseded it.
            refreshToken.current += 1;
            // Defense-in-depth: filter by familyId in JS too so a prefix
            // collision in the cache cannot leak across families.
            setMembers(deriveAllMembers(docs.map(toUser), familyId));
            setLoading(false);
          },
          () => {
            // Never surface a raw Firebase code / PII to the caller.
            setError(FAMILY_MEMBERS_LOAD_ERROR);
            setLoading(false);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(FAMILY_MEMBERS_LOAD_ERROR);
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
      const docs = (snap as { docs: QueryDocumentSnapshot[] }).docs;
      // Do NOT update lastSnapshotSig here — the snapshot guard relies on the
      // last-LIVE-snapshot signature to detect a redundant re-fire of the same
      // doc set. A late snapshot replaying that doc set after this fresh refresh
      // would carry the OLD signature; if we wrote the fresh sig here, that old
      // redundant snapshot would mismatch and clobber the fresh result.
      setMembers(deriveAllMembers(docs.map(toUser), familyId));
      setError(null);
    } catch {
      if (token !== refreshToken.current) return;
      setError(FAMILY_MEMBERS_LOAD_ERROR);
    }
  }, [familyId]);

  return { members, loading, error, refresh };
}
