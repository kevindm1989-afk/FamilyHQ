/**
 * useFamilyChecklistInstances — hook contract.
 *
 * Pins the same shape as useFamilyTodos: idle on null familyId, maps
 * docs through, surfaces a clean error string on snapshot failure,
 * unsubscribes on unmount.
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
  collection: () => ({ withConverter: () => ({ __ref: 'col:checklistInstances' }) }),
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
  checklistInstanceConverter: { __converter: 'instance' },
}));

import { useFamilyChecklistInstances } from './useFamilyChecklistInstances';

beforeEach(() => {
  lastNext = null;
  lastError = null;
  unsubSpy.mockReset();
  onSnapshotMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useFamilyChecklistInstances', () => {
  it('stays idle when familyId is null', () => {
    const { result } = renderHook(() => useFamilyChecklistInstances(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.instances).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('subscribes when familyId is provided and surfaces the mapped docs', async () => {
    const { result } = renderHook(() => useFamilyChecklistInstances('fam-A'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    act(() => {
      lastNext?.({
        docs: [
          {
            id: 'inst-1',
            data: () => ({
              familyId: 'fam-A',
              templateId: 'tpl-1',
              userId: 'uid-a',
              date: '2026-06-05',
              isCompleted: false,
              itemsProgress: {},
              createdAt: 1000,
            }),
          },
        ],
      });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.instances).toHaveLength(1);
    });
    expect(result.current.instances[0]?.id).toBe('inst-1');
  });

  it('surfaces a clean error on snapshot failure and clears the list', async () => {
    const { result } = renderHook(() => useFamilyChecklistInstances('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    act(() => lastError?.(new Error('boom')));
    await waitFor(() => {
      expect(result.current.error).toMatch(/could not load routine runs/i);
      expect(result.current.loading).toBe(false);
      expect(result.current.instances).toEqual([]);
    });
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useFamilyChecklistInstances('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    unmount();
    expect(unsubSpy).toHaveBeenCalled();
  });
});
