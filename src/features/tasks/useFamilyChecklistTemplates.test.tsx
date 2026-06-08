/**
 * useFamilyChecklistTemplates — hook contract.
 *
 * Pins the two-query merge pattern: shared templates from query #1 +
 * own templates (including drafts) from query #2 are de-duplicated by
 * id and sorted by updatedAt desc.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeSnap {
  docs: { id: string; data(): unknown }[];
}

interface Sub {
  next: (snap: FakeSnap) => void;
  error: (err: Error) => void;
  whereClauses: { field: string; op: string; value: unknown }[];
}

const subs: Sub[] = [];
const unsubSpy = vi.fn();
const onSnapshotMock = vi.fn(
  (
    q: { __whereClauses?: { field: string; op: string; value: unknown }[] },
    next: (snap: FakeSnap) => void,
    error: (err: Error) => void,
  ) => {
    subs.push({ next, error, whereClauses: q.__whereClauses ?? [] });
    return unsubSpy;
  },
);

vi.mock('firebase/firestore', () => ({
  collection: () => ({ withConverter: () => ({ __ref: 'col:checklistTemplates' }) }),
  query: (
    _ref: unknown,
    ...clauses: { field: string; op: string; value: unknown }[]
  ) => ({ __whereClauses: clauses }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  onSnapshot: (
    q: unknown,
    next: (snap: FakeSnap) => void,
    error: (err: Error) => void,
  ) =>
    onSnapshotMock(
      q as { __whereClauses?: { field: string; op: string; value: unknown }[] },
      next,
      error,
    ),
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));
vi.mock('../../lib/converters', () => ({
  checklistTemplateConverter: { __converter: 'template' },
}));

import { useFamilyChecklistTemplates } from './useFamilyChecklistTemplates';

function mkDoc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

beforeEach(() => {
  subs.length = 0;
  unsubSpy.mockReset();
  onSnapshotMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useFamilyChecklistTemplates', () => {
  it('opens two scoped subscriptions when both familyId and selfUid are set', async () => {
    renderHook(() => useFamilyChecklistTemplates('fam-A', 'uid-a'));
    await waitFor(() => expect(subs.length).toBe(2));
    // One sub is the shared-only query, the other is the createdBy==self query.
    const fields = subs.map((s) =>
      s.whereClauses.map((c) => `${c.field}=${String(c.value)}`).join(','),
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        'familyId=fam-A,isSharedWithFamily=true',
        'familyId=fam-A,createdBy=uid-a',
      ]),
    );
  });

  it('merges shared + own batches by id and sorts by updatedAt desc', async () => {
    const { result } = renderHook(() => useFamilyChecklistTemplates('fam-A', 'uid-a'));
    await waitFor(() => expect(subs.length).toBe(2));

    const sharedSub = subs.find((s) =>
      s.whereClauses.some((c) => c.field === 'isSharedWithFamily'),
    )!;
    const ownSub = subs.find((s) =>
      s.whereClauses.some((c) => c.field === 'createdBy'),
    )!;

    act(() => {
      sharedSub.next({
        docs: [
          // A shared template authored by SOMEONE ELSE (only reachable via shared sub).
          mkDoc('shared-other', {
            familyId: 'fam-A',
            createdBy: 'uid-b',
            title: 'Other shared',
            isSharedWithFamily: true,
            items: [],
            createdAt: 100,
            updatedAt: 200,
          }),
          // A template authored by self that also happens to be shared — appears in BOTH subs.
          mkDoc('shared-mine', {
            familyId: 'fam-A',
            createdBy: 'uid-a',
            title: 'Mine shared',
            isSharedWithFamily: true,
            items: [],
            createdAt: 100,
            updatedAt: 300,
          }),
        ],
      });
      ownSub.next({
        docs: [
          // Same id as above — must de-dupe.
          mkDoc('shared-mine', {
            familyId: 'fam-A',
            createdBy: 'uid-a',
            title: 'Mine shared',
            isSharedWithFamily: true,
            items: [],
            createdAt: 100,
            updatedAt: 300,
          }),
          // A draft (not shared) — only reachable via the own sub.
          mkDoc('mine-draft', {
            familyId: 'fam-A',
            createdBy: 'uid-a',
            title: 'Draft of mine',
            isSharedWithFamily: false,
            items: [],
            createdAt: 100,
            updatedAt: 500,
          }),
        ],
      });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const ids = result.current.templates.map((t) => t.id);
    expect(ids).toEqual(['mine-draft', 'shared-mine', 'shared-other']);
  });

  it('stays idle (no subscriptions) when familyId is null', () => {
    renderHook(() => useFamilyChecklistTemplates(null, 'uid-a'));
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('surfaces a clean error string on snapshot failure', async () => {
    const { result } = renderHook(() => useFamilyChecklistTemplates('fam-A', 'uid-a'));
    await waitFor(() => expect(subs.length).toBe(2));
    act(() => subs[0]?.error(new Error('boom')));
    await waitFor(() => {
      expect(result.current.error).toMatch(/could not load routines/i);
    });
  });
});
