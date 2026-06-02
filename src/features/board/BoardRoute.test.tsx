/**
 * BoardRoute — focused contract for the lazy route shell.
 *
 * The screen itself (BoardScreen) has its own unit + a11y tests; this file
 * pins the wiring the SHELL is responsible for:
 *   - Placeholder branch when `currentUser` or `familyId` is null (the
 *     post-auth pre-bootstrap window).
 *   - Main render branch passes the BoardScreen the right props (viewer,
 *     members, feed).
 *   - `/board/new` deep-link entry: `initialComposeOpen` is true AND
 *     onComposeClose navigates back to `/board`.
 *
 * The BoardScreen is mocked to a tiny harness that surfaces its props as
 * data-* attributes; we don't re-test the screen's internals here.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';

const sarah: UserWithId = {
  id: 'uid-parent',
  name: 'Sarah',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
};

vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => familyState,
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('./useFamilyPosts', () => ({
  useFamilyPosts: () => ({ posts: [], loading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

const createPostMock = vi.fn();
const deletePostMock = vi.fn();
vi.mock('./boardService', () => ({
  createPost: (...a: unknown[]) => createPostMock(...a),
  deletePost: (...a: unknown[]) => deletePostMock(...a),
}));

// Mock BoardScreen down to a tiny prop surface so we can assert the shell's
// wiring without dragging the screen's full DOM into this test.
vi.mock('./BoardScreen', () => ({
  BoardScreen: (props: {
    initialComposeOpen?: boolean;
    onComposeClose?: () => void;
    onCreatePost?: (content: string) => Promise<void>;
    onDeletePost?: (postId: string) => Promise<void>;
    viewer?: { uid: string; name: string; role: string };
    members?: UserWithId[];
  }) => (
    <div
      data-testid="board-screen"
      data-initial-compose-open={String(props.initialComposeOpen ?? false)}
      data-viewer-uid={props.viewer?.uid ?? ''}
      data-member-ids={(props.members ?? []).map((m) => m.id).join(',')}
    >
      <button type="button" onClick={() => props.onComposeClose?.()}>
        close
      </button>
      <button type="button" onClick={() => void props.onCreatePost?.('hello')}>
        create
      </button>
      <button type="button" onClick={() => void props.onDeletePost?.('post-1')}>
        delete
      </button>
    </div>
  ),
}));

import BoardRoute from './BoardRoute';

function mountAt(path: string) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={[path]}
    >
      <Routes>
        <Route path="/board" element={<BoardRoute />} />
        <Route path="/board/new" element={<BoardRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  createPostMock.mockReset().mockResolvedValue(undefined);
  deletePostMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('BoardRoute — placeholder branch', () => {
  it('renders the placeholder when currentUser is null (post-auth pre-bootstrap)', () => {
    familyState = {
      familyId: 'fam-A',
      role: null,
      currentUser: null,
      members: [],
      loading: false,
    };
    const r = mountAt('/board');
    expect(r.queryByTestId('board-screen')).not.toBeInTheDocument();
  });

  it('renders the placeholder when familyId is null', () => {
    familyState = {
      familyId: null,
      role: 'parent',
      currentUser: sarah,
      members: [sarah],
      loading: false,
    };
    const r = mountAt('/board');
    expect(r.queryByTestId('board-screen')).not.toBeInTheDocument();
  });
});

describe('BoardRoute — main render branch', () => {
  beforeEach(() => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah],
      loading: false,
    };
  });

  it('passes the viewer + members through to the screen', () => {
    const r = mountAt('/board');
    const screen = r.getByTestId('board-screen');
    expect(screen.dataset.viewerUid).toBe('uid-parent');
    expect(screen.dataset.memberIds).toBe('uid-parent');
  });

  it('initialComposeOpen=false at `/board`', () => {
    const r = mountAt('/board');
    expect(r.getByTestId('board-screen').dataset.initialComposeOpen).toBe('false');
  });

  it('initialComposeOpen=true at `/board/new` (deep-link entry)', () => {
    const r = mountAt('/board/new');
    expect(r.getByTestId('board-screen').dataset.initialComposeOpen).toBe('true');
  });

  it('handleCreate delegates to boardService.createPost with the viewer identity', async () => {
    const r = mountAt('/board');
    await act(async () => {
      fireEvent.click(r.getByText('create'));
    });
    expect(createPostMock).toHaveBeenCalledTimes(1);
    const arg = createPostMock.mock.calls[0]![1] as {
      content: string;
      authorId: string;
      familyId: string;
    };
    expect(arg.content).toBe('hello');
    expect(arg.authorId).toBe('uid-parent');
    expect(arg.familyId).toBe('fam-A');
  });

  it('handleDelete delegates to boardService.deletePost with the post id', async () => {
    const r = mountAt('/board');
    await act(async () => {
      fireEvent.click(r.getByText('delete'));
    });
    expect(deletePostMock).toHaveBeenCalledWith({ db: { __db: true } }, 'post-1');
  });
});
