/**
 * CONTRACT STUB — board feed hook (Phase 3, Task 9; handoff #04 BoardScreen).
 *
 * Signature only, no logic. The implementer writes the body to satisfy
 * useFamilyPosts.test.tsx.
 *
 * Contract:
 *  - Subscribes to `posts` scoped to the caller's family with the ONLY query the
 *    rules allow: `where('familyId','==', familyId)` ordered `createdAt` desc
 *    (newest first). Never an unconstrained or cross-family query (threat-model
 *    P2/M7).
 *  - Returns `{ posts, loading, error }`. `posts` is `PostWithId[]`. While the
 *    first snapshot is pending, `loading` is true and `posts` is `[]`. On a
 *    snapshot error, `error` is set (user-safe) and `loading` is false.
 *  - When there is no family yet (familyId null), it does not query: `loading`
 *    false, `posts` empty.
 *  - Exposes a `refresh()` callback for pull-to-refresh (Board is one of the two
 *    pull-to-refresh screens, preferences.md) that forces a server re-fetch. The
 *    test asserts the contract (a callable refresh that triggers a fetch), not
 *    the gesture.
 *
 * DATA-MODEL NOTE: no read/unread field exists on `Post`; this hook neither
 * sorts nor styles by read-state. All posts are returned uniformly.
 */
import type { PostWithId } from './boardService';

export interface UseFamilyPostsResult {
  posts: PostWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export declare function useFamilyPosts(familyId: string | null): UseFamilyPostsResult;
