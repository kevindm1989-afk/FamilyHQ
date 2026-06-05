/**
 * useFamilyTodos — hook contract.
 *
 * Pins:
 *  - sets loading=false + empty list when familyId is null,
 *  - opens an onSnapshot when familyId is provided and maps docs through,
 *  - flips loading=false and surfaces a clean string error on snapshot failure,
 *  - unsubscribes on unmount.
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
  collection: () => ({ withConverter: () => ({ __ref: 'col:todos' }) }),
  query: (...args: unknown[]) => ({ __query: args }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  onSnapshot: (
    q: unknown,
    next: (snap: FakeSnap) => void,
    error: (err: Error) => void,
  ) => onSnapshotMock(q, next, error),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));
vi.mock('../../lib/converters', () => ({ todoConverter: { __converter: 'todo' } }));

import { useFamilyTodos } from './useFamilyTodos';

beforeEach(() => {
  lastNext = null;
  lastError = null;
  unsubSpy.mockReset();
  onSnapshotMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useFamilyTodos', () => {
  it('stays idle (no subscription, no loading) when familyId is null', () => {
    const { result } = renderHook(() => useFamilyTodos(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.todos).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('subscribes when familyId is provided and surfaces the mapped docs', async () => {
    const { result } = renderHook(() => useFamilyTodos('fam-A'));
    // Initial render: loading=true while the snapshot hasn't fired yet.
    expect(result.current.loading).toBe(true);

    // Wait for the dynamic firebase/config import + onSnapshot wiring.
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());

    act(() => {
      lastNext?.({
        docs: [
          {
            id: 't-1',
            data: () => ({
              familyId: 'fam-A',
              createdBy: 'uid-a',
              title: 'Walk the dog',
              isCompleted: false,
              createdAt: 1000,
            }),
          },
        ],
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.todos).toHaveLength(1);
    });
    expect(result.current.todos[0]).toMatchObject({
      id: 't-1',
      title: 'Walk the dog',
      createdAt: 1000,
    });
  });

  it('surfaces a clean error string and clears the list on snapshot failure', async () => {
    const { result } = renderHook(() => useFamilyTodos('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());

    act(() => {
      lastError?.(new Error('boom'));
    });

    await waitFor(() => {
      expect(result.current.error).toMatch(/could not load to-dos/i);
      expect(result.current.loading).toBe(false);
      expect(result.current.todos).toEqual([]);
    });
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useFamilyTodos('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    unmount();
    expect(unsubSpy).toHaveBeenCalled();
  });
});
