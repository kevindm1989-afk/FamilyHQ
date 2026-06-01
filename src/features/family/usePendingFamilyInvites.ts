/**
 * Subscribes to PENDING invites for a family. Parent-only — rules require
 * isParent + listScopedToOwnFamily; the screen that consumes this is already
 * parent-gated by the AppShell route guard. Returns
 * { invites, loading, error, refresh } with `invites` sorted newest-first
 * by createdAt.
 *
 * Defensive identity-key (mirrors useFamilyEvents / useFamilyChores): the
 * hook tears down the listener when familyId changes, so a switch-account
 * never bleeds another family's invites into the new context.
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
import { inviteConverter } from '../../lib/converters';
import type { Invite } from '../../lib/types';
import type { InviteWithId } from './inviteService';

interface InvitesFeed {
  invites: InviteWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function toInvite(snap: QueryDocumentSnapshot<Invite>): InviteWithId {
  return { id: snap.id, ...snap.data() };
}

function buildPendingQuery(db: Firestore, familyId: string) {
  return query(
    collection(db, 'invites').withConverter(inviteConverter),
    where('familyId', '==', familyId),
    where('status', '==', 'pending'),
  );
}

export function usePendingFamilyInvites(familyId: string | null): InvitesFeed {
  const [invites, setInvites] = useState<InviteWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!familyId) {
      setInvites([]);
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
        buildPendingQuery(db, familyId),
        (snap) => {
          const list = snap.docs.map(toInvite);
          // Sort client-side newest-first — avoids needing a composite
          // index over (familyId, status, createdAt).
          list.sort((a, b) => b.createdAt - a.createdAt);
          setInvites(list);
          setLoading(false);
          setError(null);
        },
        () => {
          setInvites([]);
          setLoading(false);
          setError('We could not load pending invitations.');
        },
      );
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  const refresh = async (): Promise<void> => {
    // onSnapshot already auto-refreshes; refresh() is a no-op kept on the
    // feed shape for parity with other hooks (useFamilyEvents/useFamilyPosts).
  };

  return { invites, loading, error, refresh };
}
