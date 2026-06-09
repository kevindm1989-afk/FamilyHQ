/**
 * useFamilyWishlistItems — hook contract. Same shape as useFamilyShoppingList.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSnap {
  docs: { id: string; data(): unknown }[];
}

let lastNext: ((snap: FakeSnap) => void) | null = null;
let lastError: ((err: Error) => void) | null = null;
const unsubSpy = vi.fn();
const onSnapshotMock = vi.fn(
  (_q: unknown, next: (snap: FakeSnap) => void, error: (err: Error) => void) => {
    lastNext = next;
    lastError = error;
    return unsubSpy;
  },
);

vi.mock('firebase/firestore', () => ({
  collection: () => ({ withConverter: () => ({ __ref: 'col:wishlistItems' }) }),
  query: (...args: unknown[]) => ({ __query: args }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  onSnapshot: (
    q: unknown,
    next: (snap: FakeSnap) => void,
    error: (err: Error) => void,
  ) => onSnapshotMock(q, next, error),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));
vi.mock('../../lib/converters', () => ({
  wishlistItemConverter: { __converter: 'wishlistItem' },
}));

import { useFamilyWishlistItems } from './useFamilyWishlistItems';

beforeEach(() => {
  lastNext = null;
  lastError = null;
  unsubSpy.mockReset();
  onSnapshotMock.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('useFamilyWishlistItems', () => {
  it('stays idle when familyId is null', () => {
    const { result } = renderHook(() => useFamilyWishlistItems(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('subscribes and surfaces mapped docs', async () => {
    const { result } = renderHook(() => useFamilyWishlistItems('fam-A'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    act(() => {
      lastNext?.({
        docs: [
          {
            id: 'i-1',
            data: () => ({
              familyId: 'fam-A',
              ownerUid: 'uid-a',
              title: 'Switch',
              costCents: 30000,
              status: 'wishing',
              createdAt: 1000,
            }),
          },
        ],
      });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0]?.title).toBe('Switch');
    expect(result.current.items[0]?.costCents).toBe(30000);
  });

  it('normalises a Timestamp-shaped createdAt to epoch ms', async () => {
    const { result } = renderHook(() => useFamilyWishlistItems('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    act(() => {
      lastNext?.({
        docs: [
          {
            id: 'i-2',
            data: () => ({
              familyId: 'fam-A',
              ownerUid: 'uid-a',
              title: 'Book',
              costCents: 1500,
              status: 'wishing',
              createdAt: { toMillis: () => 4242 },
            }),
          },
        ],
      });
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.createdAt).toBe(4242);
  });

  it('surfaces clean error on snapshot failure', async () => {
    const { result } = renderHook(() => useFamilyWishlistItems('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    act(() => lastError?.(new Error('boom')));
    await waitFor(() => {
      expect(result.current.error).toMatch(/could not load the wishlist/i);
    });
    expect(result.current.error).not.toMatch(/firebase|boom/i);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useFamilyWishlistItems('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    unmount();
    expect(unsubSpy).toHaveBeenCalled();
  });
});
