/**
 * Family calendar feed hook — unit contract (Task 13; handoff #03 CalendarScreen,
 * threat-model P2/M7). Mirrors useFamilyPosts.test.tsx.
 *
 * Level: hook unit. Firestore is mocked at the SDK boundary; we assert the hook
 * (a) issues the ONLY query the rules allow — `where('familyId','==', fid)` —
 * never an unconstrained or cross-family query, (b) returns
 * `{events, loading, error}` with the right loading/empty/error transitions,
 * (c) exposes a `refresh()`, (d) converts the Timestamp-shaped `createdAt` to
 * numeric ms (incl. a pending null), and (e) CLEARS events on a familyId change
 * (cross-tenant display-leak guard).
 *
 * FAILS today: useFamilyEvents is a declare-only contract stub.
 *
 * Isolation: lazy `firebase/config` import is mocked; onSnapshot is driven
 * synchronously via a captured callback (no timers, no network). Each test
 * re-creates mocks (order-independent).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Captured {
  collection: string | null;
  whereArgs: unknown[] | null;
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
vi.mock('../../lib/converters', () => ({ eventConverter: { __converter: true } }));

import { useFamilyEvents } from './useFamilyEvents';

function Harness({ familyId }: { familyId: string | null }) {
  const { events, loading, error, refresh } = useFamilyEvents(familyId);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="count">{events.length}</span>
      <ul>
        {events.map((e) => (
          <li key={e.id} data-testid="event-id" data-created-at={String(e.createdAt)}>
            {e.id}
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
  docs: Array<{ id: string; familyId: string; createdAtMs: number | null }>,
) {
  return {
    docs: docs.map((d) => ({
      id: d.id,
      data: () => ({
        title: 'Event',
        description: '',
        date: '2026-06-01T17:30:00.000Z',
        tag: 'family',
        familyId: d.familyId,
        createdBy: 'uid-parent-a',
        createdAt: tsOf(d.createdAtMs),
      }),
    })),
  };
}

beforeEach(() => {
  cap = {
    collection: null,
    whereArgs: null,
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

describe('useFamilyEvents — family scoping (security: P2/M7)', () => {
  it('queries the events collection filtered to the caller’s own familyId', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.collection).toBe('events'));
    expect(cap.whereArgs).toEqual(['familyId', '==', 'fam-A']);
  });

  it('does NOT subscribe at all when there is no family yet (familyId null)', () => {
    render(<Harness familyId={null} />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

describe('useFamilyEvents — state transitions (happy / empty / error)', () => {
  it('starts loading, then resolves to the events from the snapshot', async () => {
    render(<Harness familyId="fam-A" />);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([
          { id: 'e1', familyId: 'fam-A', createdAtMs: 1000 },
          { id: 'e2', familyId: 'fam-A', createdAtMs: 2000 },
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

describe('useFamilyEvents — pull-to-refresh contract', () => {
  it('exposes a refresh() that forces a server fetch', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    await act(async () => {
      screen.getByText('refresh').click();
    });
    expect(cap.getDocsFromServerCalls).toBeGreaterThan(0);
  });
});

describe('useFamilyEvents — Timestamp conversion (mirrors posts: masked "Invalid Date")', () => {
  it('converts a Firestore Timestamp-shaped createdAt to NUMERIC ms before exposing it', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([{ id: 'e1', familyId: 'fam-A', createdAtMs: 1716000000000 }]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const created = screen.getByTestId('event-id').getAttribute('data-created-at');
    expect(
      created,
      'createdAt must be the numeric ms (Timestamp.toMillis()), not a Timestamp object or [object Object]',
    ).toBe('1716000000000');
    expect(Number.isFinite(Number(created))).toBe(true);
  });

  it('a PENDING serverTimestamp (createdAt null) yields a sane numeric createdAt (~now), never NaN/null/epoch', async () => {
    const before = Date.now();
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(fakeSnapshot([{ id: 'pending', familyId: 'fam-A', createdAtMs: null }]));
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    const raw = screen.getByTestId('event-id').getAttribute('data-created-at');
    const value = Number(raw);
    expect(raw, 'pending createdAt must not surface as the string "null"').not.toBe('null');
    expect(Number.isFinite(value), 'pending createdAt must be a finite number, not NaN').toBe(true);
    expect(value, 'pending createdAt must be ~now, not the epoch (0)').toBeGreaterThanOrEqual(
      before,
    );
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});

describe('useFamilyEvents — family switch clears events (cross-tenant display leak)', () => {
  it('resets events to empty on a familyId CHANGE (fam-A -> fam-B), not only on null', async () => {
    const { rerender } = render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => {
      cap.snapshotCb!(
        fakeSnapshot([{ id: 'a-only-event', familyId: 'fam-A', createdAtMs: 1000 }]),
      );
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));

    rerender(<Harness familyId="fam-B" />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(screen.queryByText('a-only-event')).not.toBeInTheDocument();
  });
});
