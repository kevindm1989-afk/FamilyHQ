/**
 * Board feed hook (Phase 3, Task 9; handoff #04 BoardScreen, threat-model
 * P2/M7).
 *
 * Subscribes to `posts` scoped to the caller's family with the ONLY query the
 * rules allow: `where('familyId','==', familyId)` ordered `createdAt` desc
 * (newest first). Never an unconstrained or cross-family query. Returns
 * `{ posts, loading, error, refresh }`; `refresh()` forces a server re-fetch
 * (pull-to-refresh; Board is a pull-to-refresh screen, preferences.md).
 *
 * DATA-MODEL NOTE: no read/unread field exists on `Post`; this hook neither
 * sorts nor styles by read-state. All posts are returned uniformly.
 */
import { useCallback, useEffect, useState } from 'react';
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
import type { Post } from '../../lib/types';
import type { PostWithId } from './boardService';

const POST_LOAD_ERROR = 'We could not load the board. Please try again.';

export interface UseFamilyPostsResult {
  posts: PostWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function buildPostsQuery(db: Firestore, familyId: string) {
  return query(
    collection(db, 'posts'),
    where('familyId', '==', familyId),
    orderBy('createdAt', 'desc'),
  );
}

function toPost(snap: QueryDocumentSnapshot): PostWithId {
  return { id: snap.id, ...(snap.data() as Post) };
}

export function useFamilyPosts(familyId: string | null): UseFamilyPostsResult {
  const [posts, setPosts] = useState<PostWithId[]>([]);
  // No family yet -> never query; not loading, empty list.
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);

  // Firebase config is imported lazily so this module's top level stays SDK-
  // free (mirrors useFamily) — App.test.tsx renders the shell without a live
  // Firebase project.
  useEffect(() => {
    if (familyId === null) {
      setPosts([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../../firebase/config').then(({ db }) => {
      if (cancelled) return;
      unsub = onSnapshot(
        buildPostsQuery(db, familyId),
        (snap) => {
          setPosts((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toPost));
          setLoading(false);
        },
        () => {
          // Never surface a raw Firebase code / PII.
          setError(POST_LOAD_ERROR);
          setLoading(false);
        },
      );
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (familyId === null) return;
    try {
      const { db } = await import('../../firebase/config');
      const snap = await getDocsFromServer(buildPostsQuery(db, familyId));
      setPosts((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toPost));
      setError(null);
    } catch {
      setError(POST_LOAD_ERROR);
    }
  }, [familyId]);

  return { posts, loading, error, refresh };
}
