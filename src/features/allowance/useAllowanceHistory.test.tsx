/**
 * Allowance-history feed hook — unit contract (Allowance History feature;
 * ADR-0004). Mirrors useMyChores.test.tsx.
 *
 * Level: hook unit. Firestore is mocked at the SDK boundary; we assert the hook
 * (a) issues a query over `transactions` scoped with BOTH equality filters the
 * rules allow — `where('familyId','==', fid)` AND `where('uid','==', uid)` —
 * so a viewer sees ONLY the selected member's OWN ledger, never a peer's nor
 * another family's (CRITICAL tenant/peer-leak pin: a familyId-only query for a
 * member would leak peers — assert it is NOT issued without the uid filter),
 * (b) returns `{transactions, loading, error}` with the right loading/empty/
 * error transitions, (c) exposes a `refresh()` with a monotonic token so a
 * stale refresh cannot clobber a newer result, (d) converts a Timestamp-shaped
 * `createdAt` to numeric ms (incl. a pending null -> ~now), and (e) CLEARS
 * transactions on a uid OR familyId change.
 *
 * FAILS today: useAllowanceHistory is a declare-only contract stub.
 *
 * Isolation: lazy `firebase/config` import is mocked; onSnapshot is driven
 * synchronously via a captured callback (no timers, no network). Each test
 * re-creates mocks (order-independent).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Captured {
  collection: string | null;
  whereCalls: unknown[][];
  orderByCalls: unknown[][];
  snapshotCb: ((snap: unknown) => void) | null;
  errorCb: ((err: unknown) => void) | null;
  getDocsFromServerCalls: number;
  unsubscribed: number;
  // A queue of results the NEXT getDocsFromServer call resolves to, used to test
  // the monotonic refresh token (a stale resolve must not clobber a newer one).
  nextServerDocs: Array<{ docs: unknown[] }>;
}
let cap: Captured;

const collectionMock = vi.fn((_db: unknown, name: string) => {
  cap.collection = name;
  return { __collection: name };
});
const whereMock = vi.fn((...args: unknown[]) => {
  cap.whereCalls.push(args);
  return { __where: args };
});
const orderByMock = vi.fn((...args: unknown[]) => {
  cap.orderByCalls.push(args);
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
  return cap.nextServerDocs.shift() ?? { docs: [] };
});

vi.mock('firebase/firestore', () => ({
  collection: (...a: [unknown, string]) => collectionMock(...a),
  where: (...a: unknown[]) => whereMock(...a),
  orderBy: (...a: unknown[]) => orderByMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
  onSnapshot: (...a: [unknown, (s: unknown) => void, (e: unknown) => void]) => onSnapshotMock(...a),
  getDocsFromServer: (...a: unknown[]) => getDocsFromServerMock(...(a as [])),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

import { useAllowanceHistory } from './useAllowanceHistory';

function Harness({ uid, familyId }: { uid: string | null; familyId: string | null }) {
  const { transactions, loading, error, refresh } = useAllowanceHistory(uid, familyId);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="count">{transactions.length}</span>
      <ul>
        {transactions.map((t) => (
          <li key={t.id} data-testid="txn-id" data-created-at={String(t.createdAt)}>
            {t.id}
          </li>
        ))}
      </ul>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

type TimestampLike = { toMillis: () => number } | null;
function tsOf(ms: number | null): TimestampLike {
  return ms === null ? null : { toMillis: () => ms };
}
function fakeSnapshot(
  docs: Array<{ id: string; uid: string; familyId: string; createdAtMs: number | null }>,
) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => ({
        uid: d.uid,
        choreId: 'chore-1',
        choreTitle: 'Take out trash',
        amount: 300,
        type: 'earning',
        familyId: d.familyId,
        createdAt: tsOf(d.createdAtMs),
      }),
    })),
  };
}

beforeEach(() => {
  cap = {
    collection: null,
    whereCalls: [],
    orderByCalls: [],
    snapshotCb: null,
    errorCb: null,
    getDocsFromServerCalls: 0,
    unsubscribed: 0,
    nextServerDocs: [],
  };
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAllowanceHistory — own-ledger scoping (security: tenant + per-member peer-leak)', () => {
  it('queries the transactions ledger collection', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.collection).toBe('transactions'));
  });

  it('filters by BOTH the family AND the selected member uid (order-independent)', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.whereCalls.length).toBeGreaterThanOrEqual(2));
    expect(cap.whereCalls).toContainEqual(['familyId', '==', 'fam-A']);
    expect(cap.whereCalls).toContainEqual(['uid', '==', 'uid-child-a']);
  });

  it('CRITICAL peer-leak pin: NEVER issues a familyId-only query without the uid equality filter', async () => {
    // A familyId-only query for a member would return EVERY family member's
    // ledger (a peer leak — another child's earnings). The uid equality filter
    // must always be present whenever a query is issued.
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    const hasUidEquality = cap.whereCalls.some(
      (call) => call[0] === 'uid' && call[1] === '==' && call[2] === 'uid-child-a',
    );
    expect(
      hasUidEquality,
      'the transactions query MUST carry where("uid","==",uid); a familyId-only query leaks peer ledgers',
    ).toBe(true);
    // And there must be no query that filters by familyId but NOT by uid.
    const familyOnly = cap.whereCalls.some((call) => call[0] === 'familyId') && !hasUidEquality;
    expect(familyOnly, 'no familyId-only (uid-less) query may be issued for a per-member ledger').toBe(
      false,
    );
  });

  it('orders the query by createdAt DESC (newest first — reverse-chronological)', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(orderByMock).toHaveBeenCalled());
    expect(orderByMock).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('does NOT subscribe when there is no family yet (familyId null) — not loading forever', () => {
    render(<Harness uid="uid-child-a" familyId={null} />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('does NOT subscribe when there is no uid yet (uid null) — not loading forever', () => {
    render(<Harness uid={null} familyId="fam-A" />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

describe('useAllowanceHistory — state transitions (happy / empty / error)', () => {
  it('starts loading, then resolves to the transactions from the snapshot', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 't1', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 2000 },
          { id: 't2', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 1000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('resolves to an empty list (loading false) when the snapshot has no docs', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => cap.snapshotCb!(fakeSnapshot([])));
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('sets a user-safe error (loading false) when the listener errors — no raw code surfaces', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.errorCb).not.toBeNull());
    act(() => cap.errorCb!(new Error('permission-denied: raw, must not surface')));
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    const surfaced = screen.getByTestId('error').textContent ?? '';
    expect(surfaced.length).toBeGreaterThan(0);
    expect(surfaced).not.toMatch(/permission-denied/);
  });

  it('unsubscribes the listener on unmount (no leak / no shared state)', async () => {
    const { unmount } = render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    unmount();
    expect(cap.unsubscribed).toBe(1);
  });
});

describe('useAllowanceHistory — refresh contract (monotonic token, no stale clobber)', () => {
  it('exposes a refresh() that forces a server fetch', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    await act(async () => {
      screen.getByText('refresh').click();
    });
    expect(cap.getDocsFromServerCalls).toBeGreaterThan(0);
  });

  it('a STALE refresh result cannot clobber a NEWER one (monotonic token)', async () => {
    // Two refreshes race: the FIRST resolves with one (stale) doc only AFTER the
    // SECOND has resolved with two (newer) docs. The hook must keep the newer
    // result — the late stale resolve is ignored by its token.
    let resolveFirst!: (v: { docs: unknown[] }) => void;
    const firstPromise = new Promise<{ docs: unknown[] }>((res) => {
      resolveFirst = res;
    });
    const newer = fakeSnapshot([
      { id: 'new-1', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 5000 },
      { id: 'new-2', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 4000 },
    ]);
    let call = 0;
    getDocsFromServerMock.mockImplementation(async () => {
      cap.getDocsFromServerCalls += 1;
      call += 1;
      // First refresh hangs until we resolve it manually; second resolves now.
      return call === 1 ? firstPromise : newer;
    });

    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    await act(async () => {
      screen.getByText('refresh').click(); // refresh #1 (will resolve LAST, stale)
    });
    await act(async () => {
      screen.getByText('refresh').click(); // refresh #2 (resolves now, newer)
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));

    // Now let the FIRST (stale) refresh resolve with a single old doc.
    await act(async () => {
      resolveFirst(
        fakeSnapshot([{ id: 'stale-1', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 1 }]),
      );
      await Promise.resolve();
    });

    // The stale result must NOT replace the newer two-doc result.
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(screen.queryByText('stale-1')).not.toBeInTheDocument();
  });
});

describe('useAllowanceHistory — Timestamp conversion (lessons.md Timestamp->millis)', () => {
  it('converts a Firestore Timestamp-shaped createdAt to NUMERIC ms before exposing it', async () => {
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 't1', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 1716000000000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const created = screen.getByTestId('txn-id').getAttribute('data-created-at');
    expect(
      created,
      'createdAt must be the numeric ms (Timestamp.toMillis()), not a Timestamp object or [object Object]',
    ).toBe('1716000000000');
    expect(Number.isFinite(Number(created))).toBe(true);
  });

  it('a PENDING serverTimestamp (createdAt null) yields a sane numeric createdAt (~now), never NaN/null/epoch', async () => {
    const before = Date.now();
    render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([{ id: 'pending', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: null }]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const raw = screen.getByTestId('txn-id').getAttribute('data-created-at');
    const value = Number(raw);
    expect(raw, 'pending createdAt must not surface as the string "null"').not.toBe('null');
    expect(Number.isFinite(value), 'pending createdAt must be a finite number, not NaN').toBe(true);
    expect(value, 'pending createdAt must be ~now, not the epoch (0)').toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

describe('useAllowanceHistory — switching member/family clears transactions (cross-display leak)', () => {
  it('resets transactions to empty on a uid CHANGE (child-a -> child-b), not only on null', async () => {
    const { rerender } = render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 'a-only-txn', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 1000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    // Parent picks a DIFFERENT child — the first child's ledger must NOT linger.
    rerender(<Harness uid="uid-child-b" familyId="fam-A" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(screen.queryByText('a-only-txn')).not.toBeInTheDocument();
  });

  it('resets transactions to empty on a familyId CHANGE (fam-A -> fam-B)', async () => {
    const { rerender } = render(<Harness uid="uid-child-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([{ id: 'a-txn', uid: 'uid-child-a', familyId: 'fam-A', createdAtMs: 1000 }]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    rerender(<Harness uid="uid-child-a" familyId="fam-B" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(screen.queryByText('a-txn')).not.toBeInTheDocument();
  });
});
