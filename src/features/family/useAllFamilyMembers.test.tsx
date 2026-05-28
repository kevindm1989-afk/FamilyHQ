/**
 * useAllFamilyMembers — hook unit contract (Phase 4 — Family Management).
 *
 * APPROACH (test-writer decision pinned here):
 * a NEW hook `useAllFamilyMembers(familyId)` — NOT an extension of useFamily.
 * Mirrors useFamilyChores's shape `{ members, loading, error, refresh }`, the
 * same lazy `firebase/config` import, monotonic refresh token, clears on a
 * familyId change, and null familyId -> no query. Splitting it keeps the
 * existing `useFamily()` consumers (which only need ACTIVE members) untouched
 * while letting the Family Management screen subscribe to the all-status
 * feed it needs for the Reactivate flow.
 *
 * SCOPING contract pinned here (security-critical for cross-tenant safety):
 * the query is `where('familyId','==', familyId)` ONLY — there is NO
 * `where('isActive',…)` filter (the list MUST include inactive members so the
 * parent can reactivate them).
 *
 * ASSERTION MECHANISM (also stated for the report): the test inspects
 * cap.whereCalls — every `where()` call's arg tuple is captured. We assert
 *   (a) `['familyId','==',<fid>]` IS present, and
 *   (b) NO captured tuple's first arg is `'isActive'`.
 * That is the most direct, deterministic way to pin the query shape without
 * an emulator.
 *
 * FAILS today: useAllFamilyMembers.ts is a declare-only stub that throws.
 *
 * Isolation: `firebase/firestore` mocked at the SDK boundary; the lazy
 * `firebase/config` import is mocked; each test re-creates mocks
 * (order-independent); no clock / RNG / real network.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Captured {
  collection: string | null;
  whereCalls: unknown[][];
  snapshotCb: ((snap: unknown) => void) | null;
  errorCb: ((err: unknown) => void) | null;
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
const getDocsFromServerMock = vi.fn((): Promise<{ docs: unknown[] }> => {
  cap.getDocsFromServerCalls += 1;
  return new Promise((resolve) => {
    cap.refreshResolvers.push(resolve);
  });
});

vi.mock('firebase/firestore', () => ({
  collection: (...a: [unknown, string]) => collectionMock(...a),
  where: (...a: unknown[]) => whereMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
  onSnapshot: (...a: [unknown, (s: unknown) => void, (e: unknown) => void]) =>
    onSnapshotMock(...a),
  getDocsFromServer: () => getDocsFromServerMock(),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

import { useAllFamilyMembers } from './useAllFamilyMembers';

function Harness({ familyId }: { familyId: string | null }) {
  const { members, loading, error, refresh } = useAllFamilyMembers(familyId);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? ''}</span>
      <span data-testid="count">{members.length}</span>
      <span data-testid="ids">{members.map((m) => m.id).join(',')}</span>
      <span data-testid="actives">{members.filter((m) => m.isActive).map((m) => m.id).join(',')}</span>
      <span data-testid="inactives">
        {members.filter((m) => !m.isActive).map((m) => m.id).join(',')}
      </span>
      {/* Expose name+isActive for F1 (field-change dedupe) assertions. */}
      <span data-testid="names">{members.map((m) => `${m.id}:${m.name}`).join('|')}</span>
      <span data-testid="activeFlags">
        {members.map((m) => `${m.id}:${m.isActive ? 'on' : 'off'}`).join('|')}
      </span>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

function snapshotOfUsers(
  users: Array<{
    id: string;
    name?: string;
    role?: 'parent' | 'member';
    familyId?: string;
    isActive?: boolean;
    allowanceBalance?: number;
    theme?: 'light' | 'dark';
  }>,
) {
  return {
    docs: users.map((u) => ({
      id: u.id,
      data: () => ({
        name: u.name ?? `Name-${u.id}`,
        role: u.role ?? 'member',
        familyId: u.familyId ?? 'fam-A',
        isActive: u.isActive ?? true,
        allowanceBalance: u.allowanceBalance ?? 0,
        theme: u.theme ?? 'light',
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

// =====================================================================
// Scoping — familyId-only query, NO isActive filter
// =====================================================================
describe('useAllFamilyMembers — scoping: familyId only, NO isActive filter', () => {
  it('queries the users collection (not chores / events / posts)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.collection).toBe('users'));
  });

  it('applies a where("familyId","==",familyId) filter — and ONLY that filter', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.whereCalls.length).toBeGreaterThan(0));
    expect(
      cap.whereCalls,
      'the familyId scope is required (defense-in-depth against cross-tenant leak)',
    ).toContainEqual(['familyId', '==', 'fam-A']);
  });

  it('does NOT add a where("isActive",…) filter (must surface INACTIVE members so the parent can Reactivate)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.whereCalls.length).toBeGreaterThan(0));
    expect(
      cap.whereCalls.some((c) => c[0] === 'isActive'),
      'an isActive filter would hide deactivated members from the Reactivate UI — must NOT be present',
    ).toBe(false);
  });
});

// =====================================================================
// Surfaces ACTIVE + INACTIVE members in the returned list
// =====================================================================
describe('useAllFamilyMembers — surfaces ACTIVE and INACTIVE members alike', () => {
  it('returns active + inactive members of the family (no client-side isActive filter)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() =>
      cap.snapshotCb!(
        snapshotOfUsers([
          { id: 'u-active-1', isActive: true },
          { id: 'u-inactive-1', isActive: false },
          { id: 'u-active-2', isActive: true },
        ]),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    expect(screen.getByTestId('actives').textContent).toBe('u-active-1,u-active-2');
    expect(
      screen.getByTestId('inactives').textContent,
      'the inactive member must be present so the parent can reactivate them',
    ).toBe('u-inactive-1');
  });
});

// =====================================================================
// Null familyId -> no subscription
// =====================================================================
describe('useAllFamilyMembers — null familyId is a no-op (no query, no listener)', () => {
  it('does NOT subscribe when familyId is null', () => {
    render(<Harness familyId={null} />);
    expect(onSnapshotMock, 'no listener when there is no family yet').not.toHaveBeenCalled();
  });

  it('reports loading=false on a null familyId (nothing to wait for)', () => {
    render(<Harness familyId={null} />);
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('returns an empty members list on a null familyId', () => {
    render(<Harness familyId={null} />);
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});

// =====================================================================
// Clears on a familyId CHANGE (cross-family display leak)
// =====================================================================
describe('useAllFamilyMembers — clears members on a familyId CHANGE (cross-family leak guard)', () => {
  it('resets members to empty on a familyId CHANGE (fam-A -> fam-B)', async () => {
    const { rerender } = render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    act(() => cap.snapshotCb!(snapshotOfUsers([{ id: 'a1' }, { id: 'a2' }])));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));

    rerender(<Harness familyId="fam-B" />);
    expect(
      screen.getByTestId('count').textContent,
      'family-A members must NOT linger into a family-B session',
    ).toBe('0');
  });
});

// =====================================================================
// Refresh — monotonic-token coordination (mirrors useFamilyChores Finding 9)
// =====================================================================
describe('useAllFamilyMembers — refresh works and a stale snapshot cannot clobber a newer refresh', () => {
  it('refresh() triggers a server fetch on the same scoping query', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());
    await act(async () => {
      screen.getByText('refresh').click();
    });
    expect(cap.getDocsFromServerCalls).toBe(1);
  });

  it('a STALE live snapshot delivered AFTER a newer refresh result is IGNORED (refresh wins)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    act(() => cap.snapshotCb!(snapshotOfUsers([{ id: 'old-1' }, { id: 'old-2' }])));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));

    await act(async () => {
      screen.getByText('refresh').click();
    });
    expect(cap.getDocsFromServerCalls).toBe(1);

    await act(async () => {
      cap.refreshResolvers[0]!(snapshotOfUsers([{ id: 'fresh-1' }]));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('ids').textContent).toBe('fresh-1'));

    // Stale snapshot lands AFTER the refresh has won — must be ignored.
    act(() => cap.snapshotCb!(snapshotOfUsers([{ id: 'old-1' }, { id: 'old-2' }])));
    expect(
      screen.getByTestId('ids').textContent,
      'a stale snapshot delivered after a newer refresh must not overwrite the fresh result',
    ).toBe('fresh-1');
  });
});

// =====================================================================
// Error mapping — generic, PII-free
// =====================================================================
describe('useAllFamilyMembers — error surface is generic and PII-free', () => {
  it('a listener error surfaces a generic, user-safe error message (no raw provider text)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.errorCb).not.toBeNull());
    act(() => cap.errorCb!(new Error('permission-denied: raw firebase, must not surface')));
    await waitFor(() => {
      const text = screen.getByTestId('error').textContent ?? '';
      expect(text.length, 'a load failure must surface a user-safe error string').toBeGreaterThan(0);
      expect(text).not.toMatch(/permission-denied|firebase|firestore/i);
    });
  });
});

// =====================================================================
// F1 (BLOCKER) — field-change snapshots must NOT be deduped
//
// Today's hook signs the snapshot by id-list only:
//   const sig = docs.map((d) => d.id).join(',');
// A rename or isActive flip on the SAME id-set is then dropped — the screen
// would never reflect the change. The dedupe key must include the read fields
// (at minimum name + isActive; ideally also role + familyId + allowanceBalance),
// OR the guard must be removed for this hook.
//
// MECHANISM: deliver snapshot A, then snapshot A' where the doc ids are
// IDENTICAL but a field has been mutated (name change; isActive flip). The
// fresh field value MUST be reflected — currently fails because the id-only
// signature treats A' as a redundant re-fire and short-circuits.
// =====================================================================
describe('useAllFamilyMembers — F1: dedupe must use field values, not just id-set', () => {
  it('a RENAME on the same id (snap A then A\') is APPLIED — the new name surfaces', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    // Snapshot A: one user "Maya" (id u1)
    act(() =>
      cap.snapshotCb!(snapshotOfUsers([{ id: 'u1', name: 'Maya', isActive: true }])),
    );
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('u1:Maya'));

    // Snapshot A': SAME id 'u1', but the name has been edited to 'Maya Rivera'.
    // The id-set is unchanged, so today's id-only signature drops the snapshot
    // and the screen stays on 'Maya' — that's the bug. The new value MUST win.
    act(() =>
      cap.snapshotCb!(
        snapshotOfUsers([{ id: 'u1', name: 'Maya Rivera', isActive: true }]),
      ),
    );
    await waitFor(
      () =>
        expect(
          screen.getByTestId('names').textContent,
          'a rename on the same id-set must NOT be deduped by an id-only signature',
        ).toBe('u1:Maya Rivera'),
      { timeout: 1000 },
    );
  });

  it('an isActive FLIP on the same id (snap A then A\') is APPLIED — the new flag surfaces', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    // Snapshot A: one user, active.
    act(() =>
      cap.snapshotCb!(snapshotOfUsers([{ id: 'u1', name: 'Maya', isActive: true }])),
    );
    await waitFor(() => expect(screen.getByTestId('activeFlags').textContent).toBe('u1:on'));

    // Snapshot A': SAME id 'u1', isActive flipped to false. Today the id-only
    // signature drops this snapshot and the row stays "Active" — must NOT.
    act(() =>
      cap.snapshotCb!(snapshotOfUsers([{ id: 'u1', name: 'Maya', isActive: false }])),
    );
    await waitFor(
      () =>
        expect(
          screen.getByTestId('activeFlags').textContent,
          'an isActive flip on the same id-set must NOT be deduped by an id-only signature',
        ).toBe('u1:off'),
      { timeout: 1000 },
    );
  });

  it('positive control: an IDENTICAL re-fire of snap A (same ids, same fields) is still a no-op (no spurious churn)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    act(() =>
      cap.snapshotCb!(snapshotOfUsers([{ id: 'u1', name: 'Maya', isActive: true }])),
    );
    await waitFor(() => expect(screen.getByTestId('names').textContent).toBe('u1:Maya'));

    // Re-fire EXACTLY the same docs (same ids AND same field values). The
    // resulting state is identical to before — the dedupe key with field
    // values is still allowed to short-circuit identical re-fires.
    act(() =>
      cap.snapshotCb!(snapshotOfUsers([{ id: 'u1', name: 'Maya', isActive: true }])),
    );
    expect(
      screen.getByTestId('names').textContent,
      'an identical re-fire must not crash or churn — the rendered state stays the same',
    ).toBe('u1:Maya');
    expect(screen.getByTestId('activeFlags').textContent).toBe('u1:on');
  });
});

// =====================================================================
// F5 (MED) — deterministic display order independent of Firestore doc order
//
// The query has no orderBy; Firestore is free to return docs in any order
// and the order can SHUFFLE between snapshots. The hook MUST stabilize the
// order in JS. Pinned ordering: alphabetical by NAME (ascending, case-
// insensitive) with the uid as a secondary tiebreak.
//
// MECHANISM: deliver two snapshots with the SAME members in DIFFERENT doc
// orders. The hook's returned `members` array order must be identical and
// deterministic both times, matching the alphabetical-by-name (then uid)
// rule.
// =====================================================================
describe('useAllFamilyMembers — F5: deterministic order (alphabetical-by-name ci, uid tiebreak)', () => {
  it('two snapshots with the SAME members in DIFFERENT doc orders yield identical, deterministic ordering', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    // Distinct names chosen to make the sort visible: Alice / bob / Charlie /
    // dora (mixed case to exercise case-insensitive compare).
    act(() =>
      cap.snapshotCb!(
        snapshotOfUsers([
          // Firestore "doc order" — arbitrary.
          { id: 'u-3', name: 'Charlie', isActive: true },
          { id: 'u-1', name: 'Alice', isActive: true },
          { id: 'u-4', name: 'dora', isActive: false },
          { id: 'u-2', name: 'bob', isActive: true },
        ]),
      ),
    );
    // Expected stable order: Alice (u-1), bob (u-2), Charlie (u-3), dora (u-4).
    await waitFor(() =>
      expect(screen.getByTestId('ids').textContent).toBe('u-1,u-2,u-3,u-4'),
    );

    // Now the SAME members in a different Firestore doc order — the rendered
    // order MUST be identical (deterministic).
    act(() =>
      cap.snapshotCb!(
        snapshotOfUsers([
          { id: 'u-2', name: 'bob', isActive: true },
          { id: 'u-4', name: 'dora', isActive: false },
          { id: 'u-1', name: 'Alice', isActive: true },
          { id: 'u-3', name: 'Charlie', isActive: true },
        ]),
      ),
    );
    await waitFor(
      () =>
        expect(
          screen.getByTestId('ids').textContent,
          'rendered order must be stable across snapshots, regardless of Firestore doc order',
        ).toBe('u-1,u-2,u-3,u-4'),
      { timeout: 1000 },
    );
  });

  it('uid tiebreaks names that compare equal (case-insensitive)', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.snapshotCb).not.toBeNull());

    // Same case-insensitive name; uid breaks the tie alphabetically.
    act(() =>
      cap.snapshotCb!(
        snapshotOfUsers([
          { id: 'uid-z', name: 'sam', isActive: true },
          { id: 'uid-a', name: 'Sam', isActive: true },
          { id: 'uid-m', name: 'SAM', isActive: true },
        ]),
      ),
    );
    await waitFor(
      () =>
        expect(
          screen.getByTestId('ids').textContent,
          'on equal case-insensitive names, uid is the secondary tiebreak',
        ).toBe('uid-a,uid-m,uid-z'),
      { timeout: 1000 },
    );
  });
});

// =====================================================================
// F2 (HIGH) — error clears when a subsequent snapshot succeeds
//
// Today's onSnapshot success callback never resets `error`. A transient
// listener error remains stuck forever (Firestore detaches on error, but
// subsequent snapshots can still resume — the user-visible error must clear).
// =====================================================================
describe('useAllFamilyMembers — F2: a successful snapshot CLEARS a previously set error', () => {
  it('error is set on listener failure, then CLEARED to null on the next successful snapshot', async () => {
    render(<Harness familyId="fam-A" />);
    await waitFor(() => expect(cap.errorCb).not.toBeNull());

    // Fire a listener error first.
    act(() => cap.errorCb!(new Error('permission-denied: raw firebase, must not surface')));
    await waitFor(() => {
      const text = screen.getByTestId('error').textContent ?? '';
      expect(text.length, 'a listener error must surface a user-safe error').toBeGreaterThan(0);
    });

    // Now a SUCCESS snapshot lands. The error must clear AND members must populate.
    act(() =>
      cap.snapshotCb!(
        snapshotOfUsers([
          { id: 'u1', name: 'Maya', isActive: true },
          { id: 'u2', name: 'Ben', isActive: false },
        ]),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('error').textContent,
        'a successful snapshot must CLEAR the prior error (mirror the allowance hook F6 pin)',
      ).toBe(''),
    );
    expect(
      screen.getByTestId('count').textContent,
      'and members must populate from the successful snapshot',
    ).toBe('2');
  });
});
