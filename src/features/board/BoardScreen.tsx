/**
 * Bulletin Board screen (Phase 3, Task 9; handoff #04 BoardScreen).
 *
 *  - LOADING: while the feed is loading, renders the Skeleton (role="status").
 *  - EMPTY: when loaded with zero posts, renders a friendly EmptyState message.
 *  - POPULATED: renders one Card per post, NEWEST FIRST (feed order), each with
 *    the author avatar (role derived from the live member list — crown for a
 *    parent author), author name, a relative timestamp, and the content.
 *  - DELETE affordance is shown ONLY where permitted (canDeletePost); deleting
 *    fires a toast.
 *  - A FAB opens the ComposePost sheet.
 *  - Pull-to-refresh is wired to the feed's refresh().
 *
 * DATA-MODEL NOTE: posts render UNIFORMLY — there is NO read/unread accent or
 * tracking, because the `Post` schema has no read-state field.
 */
import { useId, useState, type ReactElement } from 'react';
import { Avatar, Card, EmptyState, Fab, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { Role, UserWithId } from '../../lib/types';
import {
  authorRole,
  canDeletePost,
  POST_DELETE_SUCCESS,
  POST_GENERIC_ERROR,
  type PostWithId,
} from './boardService';
import { ComposePost } from './ComposePost';
import { relativeTime } from './relativeTime';

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
  /** Injected create action (wired to boardService.createPost + toast). */
  onCreatePost?: (content: string) => Promise<void>;
}

const ABSOLUTE_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function BoardScreen(props: BoardScreenProps): ReactElement {
  const { viewer, members, feed, onDeletePost, onCreatePost } = props;
  const { showToast } = useToast();
  const [composeOpen, setComposeOpen] = useState(false);
  const labelBase = useId();

  const handleDelete = (postId: string): void => {
    void onDeletePost(postId)
      .then(() => showToast(POST_DELETE_SUCCESS))
      .catch(() => showToast(POST_GENERIC_ERROR));
  };

  const handleCreate = async (content: string): Promise<void> => {
    if (onCreatePost) {
      await onCreatePost(content);
    }
  };

  const now = Date.now();

  return (
    <>
      <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-display font-display font-extrabold text-ink">Board</h1>
          <button
            type="button"
            data-testid="board-refresh"
            aria-label="Refresh the board"
            onClick={() => void feed.refresh()}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            <RefreshIcon />
          </button>
        </div>

        {feed.loading ? (
          <Skeleton label="Loading the board…" />
        ) : feed.posts.length === 0 ? (
          <EmptyState message="No posts yet — share something with the family." />
        ) : (
          <ul className="flex flex-col gap-12" aria-label="Family posts">
            {feed.posts.map((post) => {
              const role = authorRole(members, post.authorId);
              const showDelete = canDeletePost(viewer, post);
              const authorNameId = `${labelBase}-author-${post.id}`;
              const isoDate = new Date(post.createdAt).toISOString();
              const absoluteDate = ABSOLUTE_DATE_FORMAT.format(new Date(post.createdAt));
              return (
                <li key={post.id}>
                  <Card>
                    <article className="flex flex-col gap-8" aria-labelledby={authorNameId}>
                      <header className="flex items-center gap-12">
                        <Avatar name={post.authorName} role={role} size="default" showRoleForA11y />
                        <div className="flex flex-1 flex-col">
                          <span id={authorNameId} className="text-body font-semibold text-ink">
                            {post.authorName}
                          </span>
                          <time
                            dateTime={isoDate}
                            title={absoluteDate}
                            aria-label={absoluteDate}
                            className="text-meta text-ink-mute"
                          >
                            {relativeTime(post.createdAt, now)}
                          </time>
                        </div>
                        {showDelete && (
                          <button
                            type="button"
                            aria-label={`Delete post by ${post.authorName}`}
                            onClick={() => handleDelete(post.id)}
                            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute hover:text-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </header>
                      <p className="text-body text-ink">{post.content}</p>
                    </article>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <div className="fixed bottom-fab-from-bottom right-16 z-fab">
          <Fab label="New post" onClick={() => setComposeOpen(true)} />
        </div>
      </section>

      {/* ComposePost lives in its OWN wrapper, OUTSIDE the content <section>, so
          the BottomSheet's "make my siblings inert" guard never inerts the post
          list (delete affordances) or the toast region — both must stay reachable
          while the sheet is open. The wrapper's only child is the sheet, so the
          sheet has no siblings to inert. */}
      <div>
        <ComposePost
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          author={viewer}
          onCreate={handleCreate}
        />
      </div>

      {/* The single toast live region for board flows. ComposePost's own
          ToastViewport instance is inert (global singleton, Finding F) — both
          create and delete toasts surface through this one region, so a message
          is never announced twice. Kept outside the section + the sheet wrapper
          so it is never inerted while the sheet is open. */}
      <ToastViewport />
    </>
  );
}

function RefreshIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-24 w-24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        d="M20 11a8 8 0 10-2.3 5.7M20 11V5m0 6h-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-20 w-20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0v12a1 1 0 001 1h8a1 1 0 001-1V7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
