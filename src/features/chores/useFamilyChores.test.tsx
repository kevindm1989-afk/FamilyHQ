/**
 * Family-chores feed hook — unit contract + the snapshot/refresh race fix
 * (Task 11; adversarial Finding 9). Mirrors useMyChores.test.tsx.
 *
 * Level: hook unit. Firestore is mocked at the SDK boundary; the live
 * `onSnapshot` callback and the `getDocsFromServer` refresh are driven
 * synchronously via captured handles (no timers, no real network).
 *
 * FINDING 9 (the focus of this file): the live snapshot callback and `refresh()`
 * both write `chores`. Without coordination, a STALE snapshot delivery arriving
 * AFTER a newer refresh can overwrite the fresh result (and vice-versa). The fix
 * gates the snapshot callback by the SAME monotonic token `refresh()` uses, so a
 * snapshot write is IGNORED once a newer refresh has superseded it. These tests
 * interleave a refresh and a late snapshot and assert the stale one does not win.
 *
 * FAILS today: useFamilyChores's onSnapshot callback writes `chores`
 * unconditionally (no token guard), so a late stale snapshot overwrites a newer
 * refresh result — the assertions below catch exactly that.
 *
 * Isolation: lazy `firebase/config` import is mocked; each test re-creates mocks
 * (order-independent); no clock/RNG.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Captured {
  collection: string | null;
  whereCalls: unknown[][];
  snapshotCb: ((snap: unknown) => void) | null;
  errorCb: ((err: unknown) => void) | null;
  // A queue of deferred refresh resolvers so a test can control WHEN each
  // getDocsFromServer call resolves (to interleave with a snapshot delivery).
  refreshResolvers: Array<(snap: { docs: unknown[] }) => void>;
  getDocsFromServerCalls: number;
  unsubscribed: number;
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
const orderByMock = vi.fn((...args: unknown[]) => ({ __orderBy: args }));
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
// Each refresh returns a promise the test resolves explicitly, so we can land a
// stale snapshot in between the refresh START and its resolution.
const getDocsFromServerMock = vi.fn((): Promise<{ docs: unknown[] }> => {
  cap.getDocsFromServerCalls += 1;
  return new Promise((resolve) => {
    cap.refreshResolvers.push(resolve);
  });
});

vi.mock('firebase/firestore', () => ({
  collection: (...a: [unknown, string]) => collectionMock(...a),
  where: (...a: unknown[]) => whereMock(...a),
  orderBy: (...a: unknown[]) => orderByMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
  onSnapshot: (...a: [unknown, (s: unknown) => void, (e: unknown) => void]) =>
    onSnapshotMock(...a),
  getDocsFromServer: () => getDocsFromServerMock(),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

import { useFamilyChores } from './useFamilyChores';

function Harness({ familyId }: { familyId: string | null }) {
  const { chores, loading, error, refresh } = useFamilyChores(familyId);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="count">{chores.length}</span>
      <span data-testid="ids">{chores.map((c) => c.id).join(',')}</span>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

type TimestampLike = { toMillis: () => number };
function snapshotOf(ids: string[]) {
  return {
    docs: ids.map((id) => ({
      id,
      data: () => ({
        title: 'Take out trash',
        assignedTo: 'uid-member-a',
        dueDate: '2026-05-30',
        pointValue: 10,
        dollarValue: 300, // integer cents — $3.00
        status: 'pending',
        familyId: 'fam-A',
        createdBy: 'uid-parent-a',
        createdAt: { toMillis: () => 1000 } as TimestampLike,
        isRecurring: false,
        recurrenceFrequency: 'none',
      }),
    })),
  };
}

beforeEach(() => {
  cap = {
    collection: null,
    whereCalls: [],
    snapshotCb: null,
    errorCb: null,
    refreshResolvers: [],
    getDocsFromServerCalls: 0,
    unsubscribed: 0,
  };
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useFamilyChores — parent family scoping (familyId only)', () => {
  it('queries the chores collection filtered by ONLY the caller’s familyId (parent reads any in-family)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.collection).toBe('chores'));
    expect(cap.whereCalls).toContainEqual(['familyId', '==', 'fam-A']);
    // The parent feed must NOT add an assignedTo filter (it reads the whole family).
    expect(cap.whereCalls.some((c) => c[0] === 'assignedTo')).toBe(false);
  });

  it('does NOT subscribe when there is no family yet (familyId null)', () => {
    render(<Harness familyId={null} />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
});

describe('useFamilyChores — Finding 9: snapshot/refresh token coordination (stale snapshot cannot clobber a newer refresh)', () => {
  it('a STALE snapshot delivered AFTER a newer refresh result is IGNORED (refresh wins)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    // 1) An initial live snapshot lands with the OLD docs.
    act(() => cap.snapshotCb!(snapshotOf(['old-1', 'old-2'])));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));

    // 2) A refresh starts (newer request, higher token) ...
    await act(async () => {
      screen.getByText('refresh').click();
    });
    expect(cap.getDocsFromServerCalls).toBe(1);

    // 3) ... and resolves with the NEW canonical docs.
    await act(async () => {
      cap.refreshResolvers[0]!(snapshotOf(['fresh-1']));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('fresh-1'));

    // 4) A STALE live snapshot (the listener firing late with the OLD data) now
    //    arrives. It is older than the refresh and MUST be ignored — the token
    //    guard rejects a snapshot write once a newer refresh has superseded it.
    act(() => cap.snapshotCb!(snapshotOf(['old-1', 'old-2'])));

    // The fresh refresh result must STILL be shown — the stale snapshot lost.
    expect(
      screen.getByTestId('ids').textContent,
      'a stale snapshot delivered after a newer refresh must not overwrite the fresh result',
    ).toBe('fresh-1');
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('a refresh whose result resolves BEFORE a newer live snapshot does not block that newer snapshot', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    // Seed an initial snapshot.
    act(() => cap.snapshotCb!(snapshotOf(['s0'])));
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('s0'));

    // A refresh runs and resolves.
    await act(async () => {
      screen.getByText('refresh').click();
    });
    await act(async () => {
      cap.refreshResolvers[0]!(snapshotOf(['r1']));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('r1'));

    // A genuinely NEWER live snapshot then arrives. Because it is newer than the
    // last refresh, the token guard must ALLOW it (the coordination is monotonic,
    // not a permanent lock-out of the live listener).
    act(() => cap.snapshotCb!(snapshotOf(['s2', 's3'])));
    await waitFor(() =>
      expect(screen.getByTestId('ids').textContent, 'a newer snapshot after a refresh is honored').toBe(
        's2,s3',
      ),
    );
  });
});

describe('useFamilyChores — clears chores on a familyId change (cross-display leak)', () => {
  it('resets chores to empty on a familyId CHANGE (fam-A -> fam-B)', async () => {
    const { rerender } = render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => cap.snapshotCb!(snapshotOf(['a1'])));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    rerender(<Harness familyId="fam-B" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
  });
});
