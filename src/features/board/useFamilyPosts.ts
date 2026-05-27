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
import type { Post } from '../../lib/types';
import type { PostWithId } from './boardService';

const POST_LOAD_ERROR = 'We could not load the board. Please try again.';

/**
 * Firestore returns `createdAt` as a `Timestamp` at read time, but
 * `Post.createdAt` is typed `number` (ms). Convert here so a Timestamp object
 * never reaches the UI (where `relativeTime`/`new Date(...)` would render
 * "Invalid Date"). A pending serverTimestamp (local write before the server
 * resolves) arrives as `null` — treat it as ~now so it renders "just now",
 * never NaN / null / epoch. This conversion is reusable for the other
 * Timestamp-bearing collections (events/chores/transactions); only the posts
 * path is wired here.
 */
function toMillis(createdAt: unknown): number {
  if (createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function') {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  // Pending serverTimestamp (null) — or any unexpected shape — falls back to now.
  return Date.now();
}

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
  const data = snap.data() as Post & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

export function useFamilyPosts(familyId: string | null): UseFamilyPostsResult {
  const [posts, setPosts] = useState<PostWithId[]>([]);
  // No family yet -> never query; not loading, empty list.
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic refresh token: a resolved fetch whose token is stale is ignored,
  // so the LATEST refresh() always wins even if an earlier call resolves last.
  const refreshToken = useRef(0);
  // The lazily-imported Firestore instance is cached here once the subscribe
  // effect resolves it, so refresh() reuses it rather than awaiting a second
  // dynamic import on every call.
  const dbRef = useRef<Firestore | null>(null);

  // Firebase config is imported lazily so this module's top level stays SDK-
  // free (mirrors useFamily) — App.test.tsx renders the shell without a live
  // Firebase project.
  useEffect(() => {
    // Always clear stale posts on a familyId CHANGE — not only when it goes
    // null — so family A's posts never linger while family B's feed loads
    // (cross-tenant display leak).
    setPosts([]);
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
      })
      .catch(() => {
        // Lazy config import / query construction failed — surface a user-safe
        // error and stop loading (no permanent skeleton, no unhandled
        // rejection).
        if (cancelled) return;
        setError(POST_LOAD_ERROR);
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
      const snap = await getDocsFromServer(buildPostsQuery(db, familyId));
      // Ignore a stale fetch: a newer refresh() has been issued since.
      if (token !== refreshToken.current) return;
      setPosts((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toPost));
      setError(null);
    } catch {
      if (token !== refreshToken.current) return;
      setError(POST_LOAD_ERROR);
    }
  }, [familyId]);

  return { posts, loading, error, refresh };
}
