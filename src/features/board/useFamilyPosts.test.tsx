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
const getDocsFromServerMock = vi.fn(async (): Promise<{ docs: unknown[] }> => {
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
          <li key={p.id} data-testid="post-id" data-created-at={String(p.createdAt)}>
            {p.id}
          </li>
        ))}
      </ul>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

/**
 * A snapshot whose `createdAt` is TIMESTAMP-SHAPED — an object with a
 * `.toMillis()` method (or `null` for a pending serverTimestamp write) — exactly
 * as the Firestore SDK returns at read time. The previous fixture fed a plain
 * `number`, which masked the "Invalid Date" bug (the hook never converted, so a
 * real Timestamp reached the UI and `new Date(timestampObject)` produced
 * Invalid Date). createdAtMs is the ms the converter MUST expose; pass `null` to
 * model a not-yet-resolved serverTimestamp.
 */
type TimestampLike = { toMillis: () => number } | null;
function tsOf(ms: number | null): TimestampLike {
  return ms === null ? null : { toMillis: () => ms };
}
function fakeSnapshot(
  docs: Array<{ id: string; familyId: string; createdAtMs: number | null }>,
) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => ({
        content: 'c',
        authorId: 'a',
        authorName: 'A',
        familyId: d.familyId,
        createdAt: tsOf(d.createdAtMs),
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
          { id: 'p2', familyId: 'fam-A', createdAtMs: 2000 },
          { id: 'p1', familyId: 'fam-A', createdAtMs: 1000 },
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

describe('useFamilyPosts — Timestamp conversion (Finding B, HIGH: masked "Invalid Date")', () => {
  it('converts a Firestore Timestamp-shaped createdAt to NUMERIC ms before exposing it', async () => {
    // The SDK returns a Timestamp object (with .toMillis()), NOT a number. The
    // hook/converter MUST convert it; otherwise a Timestamp object reaches the
    // UI and relativeTime(new Date(obj)) yields "Invalid Date". This is the
    // assertion the old numeric fixture could not make.
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([{ id: 'p1', familyId: 'fam-A', createdAtMs: 1716000000000 }]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const created = screen.getByTestId('post-id').getAttribute('data-created-at');
    expect(
      created,
      'createdAt must be the numeric ms (Timestamp.toMillis()), not a Timestamp object or [object Object]',
    ).toBe('1716000000000');
    expect(Number.isFinite(Number(created))).toBe(true);
  });

  it('a PENDING serverTimestamp (createdAt null) yields a sane numeric createdAt (~now), never NaN/null/epoch', async () => {
    // Optimistic local write: the snapshot fires with createdAt === null before
    // the server resolves it. The hook must surface a usable numeric ms (treat
    // as ~now), so relativeTime renders "just now" rather than NaN / epoch / a
    // crash.
    const before = Date.now();
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(fakeSnapshot([{ id: 'pending', familyId: 'fam-A', createdAtMs: null }]));
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const raw = screen.getByTestId('post-id').getAttribute('data-created-at');
    const value = Number(raw);
    expect(raw, 'pending createdAt must not surface as the string "null"').not.toBe('null');
    expect(Number.isFinite(value), 'pending createdAt must be a finite number, not NaN').toBe(true);
    expect(value, 'pending createdAt must be ~now, not the epoch (0)').toBeGreaterThanOrEqual(
      before,
    );
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

describe('useFamilyPosts — family switch clears posts (Finding C, HIGH: cross-tenant display leak)', () => {
  it('resets posts to empty on a familyId CHANGE (fam-A -> fam-B), not only on null', async () => {
    const { rerender } = render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([{ id: 'a-only-post', familyId: 'fam-A', createdAtMs: 1000 }]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    // Switch family. Before fam-B's snapshot arrives the fam-A posts MUST be
    // gone — a stale fam-A post must never be visible while signed into fam-B.
    rerender(<Harness familyId="fam-B" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(screen.queryByText('a-only-post')).not.toBeInTheDocument();
  });
});

describe('useFamilyPosts — refresh() concurrency + import failure (Finding D)', () => {
  it('the LATEST refresh() wins when an earlier call resolves last (request-token guard)', async () => {
    // Two overlapping refreshes; the FIRST resolves LAST. Without a request
    // token, the stale first response clobbers the newer second one. We control
    // resolution order via deferred promises returned by getDocsFromServer.
    const deferreds: Array<{
      resolve: (v: { docs: unknown[] }) => void;
    }> = [];
    getDocsFromServerMock.mockImplementation(() => {
      cap.getDocsFromServerCalls += 1;
      return new Promise<{ docs: unknown[] }>((resolve) => {
        deferreds.push({ resolve });
      });
    });

    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    act(() => {
      screen.getByText('refresh').click(); // request #1
      screen.getByText('refresh').click(); // request #2 (latest)
    });
    await waitFor(() => expect(deferreds.length).toBe(2));

    // Resolve the SECOND (latest) first, then the FIRST (stale) last.
    await act(async () => {
      deferreds[1]!.resolve(
        fakeSnapshot([{ id: 'latest-2', familyId: 'fam-A', createdAtMs: 2000 }]),
      );
    });
    await act(async () => {
      deferreds[0]!.resolve(
        fakeSnapshot([{ id: 'stale-1', familyId: 'fam-A', createdAtMs: 1000 }]),
      );
    });

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(
      screen.getByTestId('post-id').textContent,
      'the latest refresh result must win; a late-resolving earlier call must not clobber it',
    ).toBe('latest-2');
  });

  it('sets error + stops loading when the subscribe path REJECTS/throws (no permanent skeleton)', async () => {
    // Model the lazy config import / query construction failing inside the
    // subscribe effect. The hook must catch it, surface a user-safe error, and
    // stop loading — never leave a permanent skeleton (loading stuck true).
    // We force the failure deterministically by making the query builder throw
    // for this one test (the effect must not let that escape unhandled).
    collectionMock.mockImplementationOnce(() => {
      throw new Error('boom: config/query path failed inside subscribe effect');
    });
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(
      (screen.getByTestId('error').textContent ?? '').length,
      'a failed subscribe must set a user-safe error, not hang on loading',
    ).toBeGreaterThan(0);
  });
});
