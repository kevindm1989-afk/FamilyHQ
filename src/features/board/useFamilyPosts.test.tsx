/**
 * Board feed hook — unit contract (Task 9; handoff #04 BoardScreen, threat-model
 * P2/M7).
 *
 * Level: hook unit. Firestore is mocked at the SDK boundary; we assert the hook
 * (a) issues the ONLY query the rules allow — `where('familyId','==', fid)`
 * ordered by `createdAt` desc — never an unconstrained or cross-family query,
 * (b) returns `{posts, loading, error}` with the right loading/empty/error
 * transitions, and (c) exposes a `refresh()` callback (pull-to-refresh contract).
 *
 * FAILS today: useFamilyPosts is a declare-only contract stub.
 *
 * Isolation: lazy `firebase/config` import is mocked; onSnapshot is driven
 * synchronously via a captured callback (no timers, no network). Each test
 * re-creates mocks.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the query constraints the hook builds so we can assert scoping.
interface Captured {
  collection: string | null;
  whereArgs: unknown[] | null;
  orderByArgs: unknown[] | null;
  snapshotCb: ((snap: unknown) => void) | null;
  errorCb: ((err: unknown) => void) | null;
  getDocsFromServerCalls: number;
  unsubscribed: number;
}
let cap: Captured;

const collectionMock = vi.fn((_db: unknown, name: string) => {
  cap.collection = name;
  return { __collection: name };
});
const whereMock = vi.fn((...args: unknown[]) => {
  cap.whereArgs = args;
  return { __where: args };
});
const orderByMock = vi.fn((...args: unknown[]) => {
  cap.orderByArgs = args;
  return { __orderBy: args };
});
const queryMock = vi.fn((...parts: unknown[]) => ({ __query: parts }));
const onSnapshotMock = vi.fn(
  (_q: unknown, next: (snap: unknown) => void, err: (e: unknown) => void) => {
    cap.snapshotCb = next;
    cap.errorCb = err;
    return () => {
      cap.unsubscribed += 1;
    };
  },
);
const getDocsFromServerMock = vi.fn(async () => {
  cap.getDocsFromServerCalls += 1;
  return { docs: [] };
});

vi.mock('firebase/firestore', () => ({
  collection: (...a: [unknown, string]) => collectionMock(...a),
  where: (...a: unknown[]) => whereMock(...a),
  orderBy: (...a: unknown[]) => orderByMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
  onSnapshot: (...a: [unknown, (s: unknown) => void, (e: unknown) => void]) =>
    onSnapshotMock(...a),
  getDocsFromServer: (...a: unknown[]) => getDocsFromServerMock(...(a as [])),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));
vi.mock('../../lib/converters', () => ({ postConverter: { __converter: true } }));

import { useFamilyPosts } from './useFamilyPosts';

// A tiny harness that renders the hook's state so we can assert via the DOM and
// drive the captured snapshot callback through `act`.
function Harness({ familyId }: { familyId: string | null }) {
  const { posts, loading, error, refresh } = useFamilyPosts(familyId);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="count">{posts.length}</span>
      <ul>
        {posts.map((p) => (
          <li key={p.id} data-testid="post-id">
            {p.id}
          </li>
        ))}
      </ul>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

function fakeSnapshot(docs: Array<{ id: string; familyId: string; createdAt: number }>) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => ({
        content: 'c',
        authorId: 'a',
        authorName: 'A',
        familyId: d.familyId,
        createdAt: d.createdAt,
      }),
    })),
  };
}

beforeEach(() => {
  cap = {
    collection: null,
    whereArgs: null,
    orderByArgs: null,
    snapshotCb: null,
    errorCb: null,
    getDocsFromServerCalls: 0,
    unsubscribed: 0,
  };
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFamilyPosts — family scoping (security: P2/M7)', () => {
  it('queries the posts collection filtered to the caller’s own familyId', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.collection).toBe('posts'));
    expect(cap.whereArgs).toEqual(['familyId', '==', 'fam-A']);
  });

  it('orders by createdAt descending (newest first)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.orderByArgs).not.toBeNull());
    expect(cap.orderByArgs).toEqual(['createdAt', 'desc']);
  });

  it('does NOT subscribe at all when there is no family yet (familyId null)', () => {
    render(<Harness familyId={null} />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

describe('useFamilyPosts — state transitions (happy / empty / error)', () => {
  it('starts loading, then resolves to the posts from the snapshot', async () => {
    render(<Harness familyId="fam-A" />);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 'p2', familyId: 'fam-A', createdAt: 2000 },
          { id: 'p1', familyId: 'fam-A', createdAt: 1000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('resolves to an empty list (loading false) when the snapshot has no docs', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => cap.snapshotCb!(fakeSnapshot([])));
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('sets a user-safe error (loading false) when the snapshot listener errors', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.errorCb).not.toBeNull());
    act(() => cap.errorCb!(new Error('permission-denied: raw, must not surface')));
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    const surfaced = screen.getByTestId('error').textContent ?? '';
    expect(surfaced.length).toBeGreaterThan(0);
    expect(surfaced).not.toMatch(/permission-denied/);
  });

  it('unsubscribes the listener on unmount (no leak / no shared state)', async () => {
    const { unmount } = render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    unmount();
    expect(cap.unsubscribed).toBe(1);
  });
});

describe('useFamilyPosts — pull-to-refresh contract', () => {
  it('exposes a refresh() that forces a server fetch', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    await act(async () => {
      screen.getByText('refresh').click();
    });
    expect(cap.getDocsFromServerCalls).toBeGreaterThan(0);
  });
});
