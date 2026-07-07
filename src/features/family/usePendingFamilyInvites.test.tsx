/**
 * usePendingFamilyInvites — unit contract.
 *
 * Pins:
 *   1. Subscribes to invites filtered by familyId + status='pending'.
 *   2. Sorts client-side newest-first by createdAt (avoids needing a
 *      composite firestore index over familyId+status+createdAt).
 *   3. Returns empty + settled when familyId is null.
 *   4. Tears down the listener on unmount + on familyId change (no leak
 *      into another family on switch-account).
 */
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectionMock = vi.fn();
const whereMock = vi.fn();
const queryMock = vi.fn();
const onSnapshotMock = vi.fn();
const unsubMock = vi.fn();

// `.withConverter` is chained on `collection(...)` inside the hook — the
// mock must expose it so the chained call doesn't throw a TypeError.
function refWithConverter(ref: { __ref?: true } = { __ref: true }) {
  return { ...ref, withConverter: () => ref };
}

vi.mock('firebase/firestore', () => ({
  collection: (...a: unknown[]) => {
    collectionMock(...a);
    return refWithConverter();
  },
  where: (...a: unknown[]) => whereMock(...a),
  query: (...a: unknown[]) => queryMock(...a),
  onSnapshot: (...a: unknown[]) => {
    onSnapshotMock(...a);
    return unsubMock;
  },
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

import { usePendingFamilyInvites } from './usePendingFamilyInvites';

function Harness({ familyId }: { familyId: string | null }) {
  const { invites, loading, error } = usePendingFamilyInvites(familyId);
  return (
    <ul data-testid="root" data-loading={String(loading)} data-error={String(error)}>
      {invites.map((i) => (
        <li key={i.id} data-id={i.id} data-created={String(i.createdAt)}>
          {i.email}
        </li>
      ))}
    </ul>
  );
}

// Reset in `beforeEach` (not `afterEach`): @testing-library/react's auto
// cleanup is registered as an `afterEach` at import time. afterEach hooks
// fire LIFO, so our local afterEach runs FIRST and RTL's unmount runs
// AFTER our reset — which means the previous test's cleanup fires unsubMock
// AFTER we cleared it, leaving stale counts at the start of the next test.
// beforeEach runs after the previous test's RTL cleanup completes, so the
// counters start clean.
beforeEach(() => {
  collectionMock.mockReset();
  whereMock.mockReset();
  queryMock.mockReset();
  onSnapshotMock.mockReset();
  unsubMock.mockReset();
});

describe('usePendingFamilyInvites', () => {
  it('returns empty + settled when familyId is null (never opens a listener)', () => {
    render(<Harness familyId={null} />);
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('subscribes with familyId + status pending filters', async () => {
    queryMock.mockImplementation((...args) => ({ __q: args }));
    render(<Harness familyId="fam-A" />);
    // FLAKE FIX (Verify run 28843173871): a single setTimeout(0) raced the
    // hook's effect + dynamic import('firebase/config') chain — on a loaded
    // CI runner the subscribe occasionally hadn't happened yet. waitFor
    // polls the REAL condition instead of hoping one macrotask is enough.
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalledTimes(1));
    expect(whereMock).toHaveBeenCalledWith('familyId', '==', 'fam-A');
    expect(whereMock).toHaveBeenCalledWith('status', '==', 'pending');
  });

  it('sorts the resulting invites newest-first by createdAt', async () => {
    queryMock.mockImplementation(() => ({}));
    type SnapHandler = (s: { docs: Array<{ id: string; data: () => unknown }> }) => void;
    const cap: { snapHandler: SnapHandler | null } = { snapHandler: null };
    onSnapshotMock.mockImplementation((_q, onNext) => {
      cap.snapHandler = onNext as SnapHandler;
    });
    const { getByTestId } = render(<Harness familyId="fam-A" />);
    // FLAKE FIX (Verify run 28843173871): the old `setTimeout(0)` +
    // `cap.snapHandler?.(...)` pair silently NO-OPed when the handler had
    // not been captured yet (optional chaining swallowed it), rendering []
    // and failing the order assertion. Wait for the capture, then feed
    // NON-optionally inside act() so a regression throws instead of no-oping.
    await waitFor(() => expect(cap.snapHandler).not.toBeNull());

    // Feed three docs with createdAt out of order; assert the rendered DOM
    // order is newest-first.
    act(() => {
      cap.snapHandler!({
        docs: [
          { id: 'a', data: () => ({ email: 'a@x', createdAt: 100 }) },
          { id: 'b', data: () => ({ email: 'b@x', createdAt: 300 }) },
          { id: 'c', data: () => ({ email: 'c@x', createdAt: 200 }) },
        ],
      });
    });
    await waitFor(() => {
      const ul = getByTestId('root');
      const order = Array.from(ul.children).map((li) => (li as HTMLElement).dataset.id);
      expect(order).toEqual(['b', 'c', 'a']);
    });
  });

  it('surfaces a generic error string when the snapshot listener errors', async () => {
    queryMock.mockImplementation(() => ({}));
    type ErrHandler = (e: unknown) => void;
    const cap: { errHandler: ErrHandler | null } = { errHandler: null };
    onSnapshotMock.mockImplementation((_q, _ok, onErr) => {
      cap.errHandler = onErr as ErrHandler;
    });
    const { getByTestId } = render(<Harness familyId="fam-A" />);
    // FLAKE FIX: same waitFor-the-capture pattern as the sort test above.
    await waitFor(() => expect(cap.errHandler).not.toBeNull());

    act(() => {
      cap.errHandler!(new Error('rules denied'));
    });
    await waitFor(() => {
      const ul = getByTestId('root');
      expect(ul.dataset.error).toBe('We could not load pending invitations.');
      expect(ul.dataset.loading).toBe('false');
    });
  });

  it('tears down the listener on unmount (no leak across switch-account)', async () => {
    queryMock.mockImplementation(() => ({}));
    const { unmount } = render(<Harness familyId="fam-A" />);
    // FLAKE FIX: unmounting before the subscribe landed would mean no unsub
    // to observe — wait for the listener to actually open first.
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalledTimes(1));
    unmount();
    expect(unsubMock).toHaveBeenCalledTimes(1);
  });
});
