/**
 * useFamilyBirthdays — hook contract. Same shape as useFamilyTodos.
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
  collection: () => ({ withConverter: () => ({ __ref: 'col:birthdays' }) }),
  query: (...args: unknown[]) => ({ __query: args }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  onSnapshot: (
    q: unknown,
    next: (snap: FakeSnap) => void,
    error: (err: Error) => void,
  ) => onSnapshotMock(q, next, error),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));
vi.mock('../../lib/converters', () => ({ birthdayConverter: { __converter: 'birthday' } }));

import { useFamilyBirthdays } from './useFamilyBirthdays';

beforeEach(() => {
  lastNext = null;
  lastError = null;
  unsubSpy.mockReset();
  onSnapshotMock.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('useFamilyBirthdays', () => {
  it('stays idle when familyId is null', () => {
    const { result } = renderHook(() => useFamilyBirthdays(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.birthdays).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('subscribes and surfaces the mapped docs', async () => {
    const { result } = renderHook(() => useFamilyBirthdays('fam-A'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    act(() => {
      lastNext?.({
        docs: [
          {
            id: 'b-1',
            data: () => ({
              familyId: 'fam-A',
              createdBy: 'uid-a',
              name: 'Maya',
              monthDay: '06-15',
              type: 'birthday',
              createdAt: 1000,
            }),
          },
        ],
      });
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.birthdays).toHaveLength(1);
    });
    expect(result.current.birthdays[0]?.name).toBe('Maya');
  });

  it('surfaces a clean error on snapshot failure', async () => {
    const { result } = renderHook(() => useFamilyBirthdays('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    act(() => lastError?.(new Error('boom')));
    await waitFor(() => {
      expect(result.current.error).toMatch(/could not load birthdays/i);
      expect(result.current.loading).toBe(false);
      expect(result.current.birthdays).toEqual([]);
    });
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useFamilyBirthdays('fam-A'));
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    unmount();
    expect(unsubSpy).toHaveBeenCalled();
  });
});
