/**
 * My-chores feed hook — unit contract (Task 10; handoff #05a ChoresTeenScreen,
 * threat-model P2/M7). Mirrors useFamilyEvents.test.tsx.
 *
 * Level: hook unit. Firestore is mocked at the SDK boundary; we assert the hook
 * (a) issues a query scoped with BOTH equality filters the rules allow —
 * `where('familyId','==', fid)` AND `where('assignedTo','==', uid)` — so a
 * member sees ONLY their OWN chores, never another member's nor another family's,
 * (b) returns `{chores, loading, error}` with the right loading/empty/error
 * transitions, (c) exposes a `refresh()`, (d) converts a Timestamp-shaped
 * `createdAt` to numeric ms (incl. a pending null -> ~now), and (e) CLEARS
 * chores on a uid OR familyId change.
 *
 * FAILS today: useMyChores is a declare-only contract stub.
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

import { useMyChores } from './useMyChores';

function Harness({ uid, familyId }: { uid: string | null; familyId: string | null }) {
  const { chores, loading, error, refresh } = useMyChores(uid, familyId);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="count">{chores.length}</span>
      <ul>
        {chores.map((c) => (
          <li key={c.id} data-testid="chore-id" data-created-at={String(c.createdAt)}>
            {c.id}
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
  docs: Array<{ id: string; assignedTo: string; familyId: string; createdAtMs: number | null }>,
) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => ({
        title: 'Take out trash',
        assignedTo: d.assignedTo,
        dueDate: '2026-05-30',
        pointValue: 10,
        dollarValue: 3,
        status: 'pending',
        familyId: d.familyId,
        createdBy: 'uid-parent-a',
        createdAt: tsOf(d.createdAtMs),
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
    getDocsFromServerCalls: 0,
    unsubscribed: 0,
  };
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMyChores — own-chore scoping (security: P2/M7 + own-assignment)', () => {
  it('queries the chores collection', async () => {
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.collection).toBe('chores'));
  });

  it('filters by BOTH the caller’s own familyId AND their own uid (assignedTo)', async () => {
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.whereCalls.length).toBeGreaterThanOrEqual(2));
    // Both equality filters must be present (order-independent).
    expect(cap.whereCalls).toContainEqual(['familyId', '==', 'fam-A']);
    expect(cap.whereCalls).toContainEqual(['assignedTo', '==', 'uid-member-a']);
  });

  it('does NOT subscribe when there is no family yet (familyId null)', () => {
    render(<Harness uid="uid-member-a" familyId={null} />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('does NOT subscribe when there is no uid yet (uid null)', () => {
    render(<Harness uid={null} familyId="fam-A" />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

describe('useMyChores — state transitions (happy / empty / error)', () => {
  it('starts loading, then resolves to the chores from the snapshot', async () => {
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 'c1', assignedTo: 'uid-member-a', familyId: 'fam-A', createdAtMs: 1000 },
          { id: 'c2', assignedTo: 'uid-member-a', familyId: 'fam-A', createdAtMs: 2000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('resolves to an empty list (loading false) when the snapshot has no docs', async () => {
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => cap.snapshotCb!(fakeSnapshot([])));
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('sets a user-safe error (loading false) when the snapshot listener errors — no raw code surfaces', async () => {
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.errorCb).not.toBeNull());
    act(() => cap.errorCb!(new Error('permission-denied: raw, must not surface')));
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    const surfaced = screen.getByTestId('error').textContent ?? '';
    expect(surfaced.length).toBeGreaterThan(0);
    expect(surfaced).not.toMatch(/permission-denied/);
  });

  it('unsubscribes the listener on unmount (no leak / no shared state)', async () => {
    const { unmount } = render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    unmount();
    expect(cap.unsubscribed).toBe(1);
  });
});

describe('useMyChores — pull-to-refresh contract', () => {
  it('exposes a refresh() that forces a server fetch', async () => {
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    await act(async () => {
      screen.getByText('refresh').click();
    });
    expect(cap.getDocsFromServerCalls).toBeGreaterThan(0);
  });
});

describe('useMyChores — Timestamp conversion (lessons.md Timestamp->millis)', () => {
  it('converts a Firestore Timestamp-shaped createdAt to NUMERIC ms before exposing it', async () => {
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 'c1', assignedTo: 'uid-member-a', familyId: 'fam-A', createdAtMs: 1716000000000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const created = screen.getByTestId('chore-id').getAttribute('data-created-at');
    expect(
      created,
      'createdAt must be the numeric ms (Timestamp.toMillis()), not a Timestamp object or [object Object]',
    ).toBe('1716000000000');
    expect(Number.isFinite(Number(created))).toBe(true);
  });

  it('a PENDING serverTimestamp (createdAt null) yields a sane numeric createdAt (~now), never NaN/null/epoch', async () => {
    const before = Date.now();
    render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([{ id: 'pending', assignedTo: 'uid-member-a', familyId: 'fam-A', createdAtMs: null }]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const raw = screen.getByTestId('chore-id').getAttribute('data-created-at');
    const value = Number(raw);
    expect(raw, 'pending createdAt must not surface as the string "null"').not.toBe('null');
    expect(Number.isFinite(value), 'pending createdAt must be a finite number, not NaN').toBe(true);
    expect(value, 'pending createdAt must be ~now, not the epoch (0)').toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

describe('useMyChores — switching member/family clears chores (cross-display leak)', () => {
  it('resets chores to empty on a uid CHANGE (member-a -> member-2-a), not only on null', async () => {
    const { rerender } = render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 'a-only-chore', assignedTo: 'uid-member-a', familyId: 'fam-A', createdAtMs: 1000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    rerender(<Harness uid="uid-member-2-a" familyId="fam-A" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(screen.queryByText('a-only-chore')).not.toBeInTheDocument();
  });

  it('resets chores to empty on a familyId CHANGE (fam-A -> fam-B)', async () => {
    const { rerender } = render(<Harness uid="uid-member-a" familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 'a-chore', assignedTo: 'uid-member-a', familyId: 'fam-A', createdAtMs: 1000 },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    rerender(<Harness uid="uid-member-a" familyId="fam-B" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
  });
});
