/**
 * Bulletin Board screen — component contract (Task 9; handoff #04 BoardScreen,
 * preferences "empty + loading states", "dynamic family", "toast-everything").
 *
 * Level: component. The feed state and the delete action are injected so the
 * screen renders deterministically without Firestore. Server authority is
 * covered by test/rules/posts.test.ts; the feed query scoping by
 * useFamilyPosts.test.tsx.
 *
 * FAILS today: BoardScreen is a contract stub that throws on render.
 *
 * State traceability (designer-defined states):
 *  - loading -> Skeleton (role=status)
 *  - empty   -> friendly EmptyState message
 *  - populated -> one Card per post, newest first
 *  - parent-authored -> crown / role-to-AT affordance
 *  - delete affordance -> shown only where permitted; deleting toasts
 *
 * Isolation: injected props + ToastProvider; no clock/network/RNG; each test
 * builds its own props.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { BoardScreen, type BoardScreenProps } from './BoardScreen';
import { POST_DELETE_SUCCESS, type PostWithId } from './boardService';
import type { UserWithId } from '../../lib/types';

const MEMBERS: UserWithId[] = [
  {
    id: 'uid-parent-a',
    name: 'Sarah Kim',
    role: 'parent',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  },
  {
    id: 'uid-member-a',
    name: 'Maya Rivera',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  },
];

function mkPost(over: Partial<PostWithId> & { id: string }): PostWithId {
  return {
    content: 'A family post',
    authorId: 'uid-member-a',
    authorName: 'Maya Rivera',
    familyId: 'fam-A',
    createdAt: 1000,
    ...over,
  };
}

function renderBoard(overrides: Partial<BoardScreenProps> = {}) {
  const props: BoardScreenProps = {
    familyId: 'fam-A',
    viewer: { uid: 'uid-member-a', name: 'Maya Rivera', role: 'member' },
    members: MEMBERS,
    feed: { posts: [], loading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) },
    onDeletePost: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <ToastProvider>
      <BoardScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('BoardScreen — loading state', () => {
  it('renders a loading affordance (role=status) while the feed is loading', () => {
    renderBoard({
      feed: { posts: [], loading: true, error: null, refresh: vi.fn() },
    });
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('does NOT render the empty message while loading', () => {
    renderBoard({ feed: { posts: [], loading: true, error: null, refresh: vi.fn() } });
    expect(screen.queryByText(/no posts|nothing|share something/i)).not.toBeInTheDocument();
  });
});

describe('BoardScreen — empty state', () => {
  it('renders a friendly empty message when loaded with zero posts', () => {
    renderBoard({ feed: { posts: [], loading: false, error: null, refresh: vi.fn() } });
    // A non-empty, friendly prompt — not a raw "empty".
    const empty = screen.getByText(/post|share|family/i);
    expect(empty.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('BoardScreen — populated state', () => {
  it('renders one entry per post', () => {
    renderBoard({
      feed: {
        posts: [
          mkPost({ id: 'p1', content: 'First' }),
          mkPost({ id: 'p2', content: 'Second' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('renders posts newest-first in the order supplied by the feed', () => {
    renderBoard({
      feed: {
        posts: [
          mkPost({ id: 'newest', content: 'Newest post', createdAt: 3000 }),
          mkPost({ id: 'oldest', content: 'Oldest post', createdAt: 1000 }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const bodies = screen.getAllByText(/post$/);
    expect(bodies[0]).toHaveTextContent('Newest post');
    expect(bodies[bodies.length - 1]).toHaveTextContent('Oldest post');
  });

  it('shows the author name on a post', () => {
    renderBoard({
      feed: {
        posts: [mkPost({ id: 'p1', authorId: 'uid-member-a', authorName: 'Maya Rivera' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText('Maya Rivera')).toBeInTheDocument();
  });
});

describe('BoardScreen — parent crown derived from the live member list (a11y)', () => {
  it('a parent-authored post shows the crown badge', () => {
    renderBoard({
      feed: {
        posts: [mkPost({ id: 'p1', authorId: 'uid-parent-a', authorName: 'Sarah Kim' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByTestId('avatar-crown')).toBeInTheDocument();
  });

  it('exposes the parent author’s role to assistive tech as text (not crown alone)', () => {
    renderBoard({
      feed: {
        posts: [mkPost({ id: 'p1', authorId: 'uid-parent-a', authorName: 'Sarah Kim' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/parent/i)).toBeInTheDocument();
  });

  it('a member-authored post does NOT show the crown', () => {
    renderBoard({
      feed: {
        posts: [mkPost({ id: 'p1', authorId: 'uid-member-a', authorName: 'Maya Rivera' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.queryByTestId('avatar-crown')).not.toBeInTheDocument();
  });
});

describe('BoardScreen — delete affordance is permission-gated (security)', () => {
  it('a member sees a delete control on their OWN post', () => {
    renderBoard({
      viewer: { uid: 'uid-member-a', name: 'Maya Rivera', role: 'member' },
      feed: {
        posts: [mkPost({ id: 'mine', authorId: 'uid-member-a' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('a member does NOT see a delete control on another member’s post', () => {
    renderBoard({
      viewer: { uid: 'uid-member-a', name: 'Maya Rivera', role: 'member' },
      feed: {
        posts: [mkPost({ id: 'theirs', authorId: 'uid-parent-a', authorName: 'Sarah Kim' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('a parent sees a delete control on another member’s post', () => {
    renderBoard({
      viewer: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
      feed: {
        posts: [mkPost({ id: 'p1', authorId: 'uid-member-a', authorName: 'Maya Rivera' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('clicking delete calls onDeletePost with the post id and toasts (toast-everything)', async () => {
    const onDeletePost = vi.fn().mockResolvedValue(undefined);
    renderBoard({
      viewer: { uid: 'uid-member-a', name: 'Maya Rivera', role: 'member' },
      onDeletePost,
      feed: {
        posts: [mkPost({ id: 'mine', authorId: 'uid-member-a' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(onDeletePost).toHaveBeenCalledWith('mine'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(POST_DELETE_SUCCESS),
    );
  });
});

describe('BoardScreen — data-model gap: NO unread accent / tracking', () => {
  // The Post schema has no read/unread field; posts must render UNIFORMLY. We
  // assert the screen exposes no read-state affordance keyed off such a field.
  it('renders no "unread" affordance for any post', () => {
    renderBoard({
      feed: {
        posts: [mkPost({ id: 'p1' }), mkPost({ id: 'p2' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.queryByText(/unread/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('unread-accent')).not.toBeInTheDocument();
  });
});

describe('BoardScreen — pull-to-refresh wiring (contract)', () => {
  it('exposes a refresh trigger that invokes the feed refresh callback', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderBoard({
      feed: { posts: [mkPost({ id: 'p1' })], loading: false, error: null, refresh },
    });
    const trigger = screen.getByTestId('board-refresh');
    fireEvent.click(trigger);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

describe('BoardScreen — compose entry point', () => {
  it('renders a FAB/control to open the compose sheet', () => {
    renderBoard();
    expect(
      screen.getByRole('button', { name: /new post|compose|add post|post/i }),
    ).toBeInTheDocument();
  });

  it('opens the compose sheet when the FAB is activated', () => {
    renderBoard();
    const fab = screen.getByRole('button', { name: /new post|compose|add post/i });
    fireEvent.click(fab);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/new post/i)).toBeInTheDocument();
  });
});
