/**
 * CONTRACT STUB — Bulletin Board screen (Phase 3, Task 9; handoff #04
 * BoardScreen).
 *
 * Signature only, no implementation. The implementer writes the body to satisfy
 * BoardScreen.test.tsx. Throws on render so the component tests FAIL for the
 * right reason (not built yet) rather than passing vacuously.
 *
 * Contract (handoff #04 + preferences "empty + loading states", "dynamic
 * family", "toast-everything"):
 *  - LOADING: while the feed hook is loading, renders the Skeleton
 *    (role="status").
 *  - EMPTY: when loaded with zero posts, renders a friendly EmptyState message.
 *  - POPULATED: renders one Card per post, NEWEST FIRST, each with the author
 *    avatar (role-derived from the live member list — crown for a parent
 *    author), author name, a relative timestamp, and the content.
 *  - DELETE affordance is shown ONLY where permitted (canDeletePost); deleting
 *    fires a toast.
 *  - A FAB opens the ComposePost sheet.
 *  - Pull-to-refresh is wired to the hook's refresh() (Board is a
 *    pull-to-refresh screen).
 *
 * DATA-MODEL NOTE: posts render UNIFORMLY — there is NO read/unread accent or
 * tracking, because the `Post` schema has no read-state field. The Dashboard
 * "Unread Posts" count is a separate later decision; do NOT add a read flag here.
 */
import type { ReactElement } from 'react';
import type { PostWithId } from './boardService';
import type { Role, UserWithId } from '../../lib/types';

export interface BoardScreenProps {
  /** Caller's family (drives the feed query). Null until known. */
  familyId: string | null;
  /** Current viewer identity (drives delete affordance + compose author). */
  viewer: { uid: string; name: string; role: Role };
  /** Live active members of the family (author role derivation; dynamic). */
  members: UserWithId[];
  /**
   * Injected feed state. Real screen calls useFamilyPosts(familyId); injected
   * here so the screen renders deterministically under test without Firestore.
   */
  feed: {
    posts: PostWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** Injected delete action (wired to boardService.deletePost + toast). */
  onDeletePost: (postId: string) => Promise<void>;
}

export function BoardScreen(_props: BoardScreenProps): ReactElement {
  throw new Error('BoardScreen not implemented (contract stub — Task 9)');
}
