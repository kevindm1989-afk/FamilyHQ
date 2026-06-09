/**
 * Recurring-events service contract — focused tests for the new
 * `expandRecurrenceDates`, the batch-spawn path inside `createEvent`,
 * and `deleteEventSeries`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface BatchedSet {
  ref: { __collection: string; __id: string };
  data: Record<string, unknown>;
}
interface BatchedDelete {
  ref: { __collection: string; __id: string };
}
interface BatchedUpdate {
  ref: { __collection: string; __id: string };
  data: Record<string, unknown>;
}

let batchSets: BatchedSet[];
let batchDeletes: BatchedDelete[];
let batchUpdates: BatchedUpdate[];
let batchCommits: number;
let lastQueryConstraints: { type: string; field?: string; op?: string; value?: unknown }[];
let mockQueryDocs: { id: string; data: () => Record<string, unknown>; ref: { __id: string } }[];
let nextDocId: number;

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ __collection: name }),
  doc: (_dbOrCol: unknown, name?: string, id?: string) => {
    if (typeof name === 'string' && typeof id === 'string') {
      return { __collection: name, __id: id };
    }
    // doc(col) — generate id
    const colName = (_dbOrCol as { __collection: string }).__collection;
    const generated = `auto-${++nextDocId}`;
    return { __collection: colName, __id: generated };
  },
  query: (_ref: unknown, ...constraints: { type: string }[]) => ({
    __query: true,
    __constraints: constraints,
  }),
  where: (field: string, op: string, value: unknown) => ({
    type: 'where',
    field,
    op,
    value,
  }),
  getDocs: vi.fn(async (q: { __constraints: unknown[] }) => {
    lastQueryConstraints = q.__constraints as typeof lastQueryConstraints;
    return {
      forEach(cb: (d: typeof mockQueryDocs[number]) => void) {
        for (const d of mockQueryDocs) cb(d);
      },
    };
  }),
  writeBatch: vi.fn(() => ({
    set: (ref: BatchedSet['ref'], data: Record<string, unknown>) => {
      batchSets.push({ ref, data });
    },
    delete: (ref: BatchedDelete['ref']) => {
      batchDeletes.push({ ref });
    },
    update: (ref: BatchedUpdate['ref'], data: Record<string, unknown>) => {
      batchUpdates.push({ ref, data });
    },
    commit: vi.fn(async () => {
      batchCommits += 1;
    }),
  })),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

import {
  EventActionError,
  RECURRENCE_MAX,
  createEvent,
  deleteEventSeries,
  expandRecurrenceDates,
  updateEventSeries,
} from './calendarService';

const db = {} as import('firebase/firestore').Firestore;

beforeEach(() => {
  batchSets = [];
  batchDeletes = [];
  batchUpdates = [];
  batchCommits = 0;
  lastQueryConstraints = [];
  mockQueryDocs = [];
  nextDocId = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('expandRecurrenceDates', () => {
  const source = '2026-06-01T09:00:00.000Z';

  it('returns the source date alone for count=1', () => {
    expect(expandRecurrenceDates(source, 'weekly', 1)).toEqual([source]);
  });

  it('weekly offsets the date by 7 days each step, preserving time-of-day', () => {
    const out = expandRecurrenceDates(source, 'weekly', 3);
    expect(out).not.toBeNull();
    expect(out).toHaveLength(3);
    expect(out![0]).toBe('2026-06-01T09:00:00.000Z');
    expect(out![1]).toMatch(/^2026-06-08T09:00:00/);
    expect(out![2]).toMatch(/^2026-06-15T09:00:00/);
  });

  it('biweekly offsets by 14 days', () => {
    const out = expandRecurrenceDates(source, 'biweekly', 3)!;
    expect(out[1]).toMatch(/^2026-06-15T09:00:00/);
    expect(out[2]).toMatch(/^2026-06-29T09:00:00/);
  });

  it('monthly stays on the same day-of-month', () => {
    const out = expandRecurrenceDates(source, 'monthly', 3)!;
    expect(out[1]).toMatch(/^2026-07-01T09:00:00/);
    expect(out[2]).toMatch(/^2026-08-01T09:00:00/);
  });

  it('monthly on Jan 31 clamps to the last day of short months (Feb 28/29, Mar 31)', () => {
    const out = expandRecurrenceDates('2026-01-31T09:00:00.000Z', 'monthly', 3)!;
    // 2026 is not a leap year → Feb 28.
    expect(out[1]).toMatch(/^2026-02-28T09:00:00/);
    expect(out[2]).toMatch(/^2026-03-31T09:00:00/);
  });

  it('returns null for a malformed source date', () => {
    expect(expandRecurrenceDates('not-a-date', 'weekly', 3)).toBeNull();
    expect(expandRecurrenceDates('2026-06-01', 'weekly', 3)).toBeNull();
  });
});

describe('createEvent — recurring path spawns N siblings via writeBatch', () => {
  const input = {
    title: 'Soccer practice',
    description: 'Bring cleats',
    date: '2026-06-01T17:30:00.000Z',
    tag: 'sports' as const,
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
  };

  it('writes count docs sharing a recurrenceGroupId', async () => {
    await createEvent(
      { db },
      { ...input, recurrenceFrequency: 'weekly', recurrenceCount: 3 },
    );
    expect(batchSets).toHaveLength(3);
    expect(batchCommits).toBe(1);
    const groupIds = batchSets.map((s) => s.data.recurrenceGroupId);
    expect(new Set(groupIds).size).toBe(1);
    expect(typeof groupIds[0]).toBe('string');
  });

  it('every sibling carries the same recurrenceFrequency + recurrenceCount', async () => {
    await createEvent(
      { db },
      { ...input, recurrenceFrequency: 'biweekly', recurrenceCount: 4 },
    );
    for (const s of batchSets) {
      expect(s.data.recurrenceFrequency).toBe('biweekly');
      expect(s.data.recurrenceCount).toBe(4);
    }
  });

  it('caps count at RECURRENCE_MAX (writes at most 26 docs even on a larger input)', async () => {
    await createEvent(
      { db },
      { ...input, recurrenceFrequency: 'weekly', recurrenceCount: 100 },
    );
    expect(batchSets).toHaveLength(RECURRENCE_MAX);
  });

  it('collapses to a single one-off doc when count === 1 (no recurrence fields)', async () => {
    // Calling with count=1 should NOT spawn siblings — the service treats
    // this as a one-off and goes through the legacy `addDoc` path; the
    // batch stays empty.
    await createEvent(
      { db },
      { ...input, recurrenceFrequency: 'weekly', recurrenceCount: 1 },
    );
    expect(batchSets).toHaveLength(0);
  });

  it('surfaces EventActionError on a malformed source date', async () => {
    await expect(
      createEvent(
        { db },
        {
          ...input,
          date: 'not-a-date',
          recurrenceFrequency: 'weekly',
          recurrenceCount: 3,
        },
      ),
    ).rejects.toBeInstanceOf(EventActionError);
  });
});

describe('deleteEventSeries', () => {
  const groupId = 'g-1';

  beforeEach(() => {
    mockQueryDocs = [
      { id: 'e1', data: () => ({ date: '2026-06-01T09:00:00.000Z' }), ref: { __id: 'e1' } },
      { id: 'e2', data: () => ({ date: '2026-06-08T09:00:00.000Z' }), ref: { __id: 'e2' } },
      { id: 'e3', data: () => ({ date: '2026-06-15T09:00:00.000Z' }), ref: { __id: 'e3' } },
    ];
  });

  it('queries by familyId + recurrenceGroupId', async () => {
    await deleteEventSeries({ db }, 'fam-A', groupId);
    const wheres = lastQueryConstraints.filter((c) => c.type === 'where');
    expect(wheres).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'familyId', op: '==', value: 'fam-A' }),
        expect.objectContaining({ field: 'recurrenceGroupId', op: '==', value: groupId }),
      ]),
    );
  });

  it('deletes every sibling when no fromDate is provided', async () => {
    await deleteEventSeries({ db }, 'fam-A', groupId);
    expect(batchDeletes.map((d) => d.ref.__id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(batchCommits).toBe(1);
  });

  it('with fromDate, deletes only siblings with date >= fromDate', async () => {
    await deleteEventSeries({ db }, 'fam-A', groupId, '2026-06-08T09:00:00.000Z');
    expect(batchDeletes.map((d) => d.ref.__id).sort()).toEqual(['e2', 'e3']);
  });

  it('does NOT commit the batch when no docs match', async () => {
    mockQueryDocs = [];
    await deleteEventSeries({ db }, 'fam-A', groupId);
    expect(batchCommits).toBe(0);
  });
});

describe('updateEventSeries', () => {
  const groupId = 'g-1';
  const patch = { title: 'Updated title', description: 'updated desc', tag: 'sports' as const };

  beforeEach(() => {
    mockQueryDocs = [
      { id: 'e1', data: () => ({ date: '2026-06-01T09:00:00.000Z' }), ref: { __id: 'e1' } },
      { id: 'e2', data: () => ({ date: '2026-06-08T09:00:00.000Z' }), ref: { __id: 'e2' } },
      { id: 'e3', data: () => ({ date: '2026-06-15T09:00:00.000Z' }), ref: { __id: 'e3' } },
    ];
  });

  it('queries by familyId + recurrenceGroupId (mirrors deleteEventSeries safety)', async () => {
    await updateEventSeries({ db }, 'fam-A', groupId, patch);
    const wheres = lastQueryConstraints.filter((c) => c.type === 'where');
    expect(wheres).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'familyId', op: '==', value: 'fam-A' }),
        expect.objectContaining({ field: 'recurrenceGroupId', op: '==', value: groupId }),
      ]),
    );
  });

  it('updates every sibling when no fromDate is provided', async () => {
    await updateEventSeries({ db }, 'fam-A', groupId, patch);
    expect(batchUpdates.map((u) => u.ref.__id).sort()).toEqual(['e1', 'e2', 'e3']);
    expect(batchCommits).toBe(1);
  });

  it('writes title / description / tag — NEVER date (per-instance is the model)', async () => {
    await updateEventSeries({ db }, 'fam-A', groupId, patch);
    for (const u of batchUpdates) {
      expect(Object.keys(u.data).sort()).toEqual(['description', 'tag', 'title']);
      expect(u.data.title).toBe('Updated title');
      expect(u.data.description).toBe('updated desc');
      expect(u.data.tag).toBe('sports');
      expect('date' in u.data).toBe(false);
    }
  });

  it('trims the title before persisting', async () => {
    await updateEventSeries({ db }, 'fam-A', groupId, { ...patch, title: '  Trimmed  ' });
    for (const u of batchUpdates) {
      expect(u.data.title).toBe('Trimmed');
    }
  });

  it('with fromDate, updates only siblings with date >= fromDate', async () => {
    await updateEventSeries({ db }, 'fam-A', groupId, patch, '2026-06-08T09:00:00.000Z');
    expect(batchUpdates.map((u) => u.ref.__id).sort()).toEqual(['e2', 'e3']);
  });

  it('REJECTS an empty / whitespace title BEFORE any write', async () => {
    await expect(
      updateEventSeries({ db }, 'fam-A', groupId, { ...patch, title: '   ' }),
    ).rejects.toBeInstanceOf(EventActionError);
    expect(batchUpdates).toHaveLength(0);
    expect(batchCommits).toBe(0);
  });

  it('does NOT commit the batch when no docs match', async () => {
    mockQueryDocs = [];
    await updateEventSeries({ db }, 'fam-A', groupId, patch);
    expect(batchCommits).toBe(0);
  });
});
