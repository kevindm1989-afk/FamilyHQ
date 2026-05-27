/**
 * Calendar service — unit contract (Task 13; ADR-0001/0002, threat-model
 * T1.8/M8). Mirrors boardService.test.ts.
 *
 * Level: unit. Firestore is mocked at the SDK boundary so we assert the SERVICE
 * behavior (exact created-event shape, title validation, update/delete-by-id,
 * PII-free error mapping, the pure permission + tag->token derivations) without
 * a live emulator. Server-side authority is covered by test/rules/events.test.ts.
 *
 * FAILS today: calendarService.ts is a declare-only contract stub.
 *
 * Isolation: clock frozen via vi.useFakeTimers; no network/RNG; every test
 * re-creates its mocks (no shared mutable state, order-independent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface AddedDoc {
  collection: string;
  data: Record<string, unknown>;
}
interface UpdatedRef {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}
interface DeletedRef {
  collection: string;
  id: string;
}
let added: AddedDoc[];
let updated: UpdatedRef[];
let deleted: DeletedRef[];
let addShouldReject: boolean;
let updateShouldReject: boolean;
let deleteShouldReject: boolean;

const collectionMock = vi.fn((_db: unknown, name: string) => ({ __collection: name }));
const docMock = vi.fn((_db: unknown, name: string, id: string) => ({
  __collection: name,
  __id: id,
}));
const addDocMock = vi.fn(async (ref: { __collection: string }, data: Record<string, unknown>) => {
  if (addShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
  added.push({ collection: ref.__collection, data });
  return { id: 'generated-id' };
});
const updateDocMock = vi.fn(
  async (ref: { __collection: string; __id: string }, data: Record<string, unknown>) => {
    if (updateShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
    updated.push({ collection: ref.__collection, id: ref.__id, data });
  },
);
const deleteDocMock = vi.fn(async (ref: { __collection: string; __id: string }) => {
  if (deleteShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
  deleted.push({ collection: ref.__collection, id: ref.__id });
});

vi.mock('firebase/firestore', () => ({
  collection: (...a: [unknown, string]) => collectionMock(...a),
  doc: (...a: [unknown, string, string]) => docMock(...a),
  addDoc: (...a: [{ __collection: string }, Record<string, unknown>]) => addDocMock(...a),
  updateDoc: (...a: [{ __collection: string; __id: string }, Record<string, unknown>]) =>
    updateDocMock(...a),
  deleteDoc: (...a: [{ __collection: string; __id: string }]) => deleteDocMock(...a),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

import {
  EVENT_CREATE_SUCCESS,
  EVENT_DELETE_SUCCESS,
  EVENT_GENERIC_ERROR,
  EVENT_UPDATE_SUCCESS,
  EventActionError,
  canManageEvents,
  createEvent,
  deleteEvent,
  eventTagDotClass,
  updateEvent,
} from './calendarService';

const db = {} as import('firebase/firestore').Firestore;
const FIXED_NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

beforeEach(() => {
  added = [];
  updated = [];
  deleted = [];
  addShouldReject = false;
  updateShouldReject = false;
  deleteShouldReject = false;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const validInput = {
  title: 'Soccer practice',
  description: 'Bring cleats',
  date: '2026-06-01T17:30:00.000Z',
  tag: 'sports' as const,
  familyId: 'fam-A',
  createdBy: 'uid-parent-a',
};

describe('createEvent — happy path: writes EXACTLY the 7-field events shape', () => {
  it('writes to the events collection', async () => {
    await createEvent({ db }, validInput);
    expect(added).toHaveLength(1);
    expect(added[0]!.collection).toBe('events');
  });

  it('persists exactly {title, description, date, tag, familyId, createdBy, createdAt}', async () => {
    await createEvent({ db }, validInput);
    const data = added[0]!.data;
    expect(data).toMatchObject({
      title: 'Soccer practice',
      description: 'Bring cleats',
      date: '2026-06-01T17:30:00.000Z',
      tag: 'sports',
      familyId: 'fam-A',
      createdBy: 'uid-parent-a',
    });
    expect(typeof data.createdAt === 'number' || typeof data.createdAt === 'object').toBe(true);
    expect(Object.keys(data).sort()).toEqual(
      ['createdAt', 'createdBy', 'date', 'description', 'familyId', 'tag', 'title'].sort(),
    );
  });

  it('FORBIDS the handoff-only fields that are NOT in the schema (who/location/startTime/endTime)', async () => {
    // DATA-MODEL GAP: the handoff shows start/end time, "who's it for", and
    // location. None are in the locked 7-field schema — assert none leak in.
    await createEvent({ db }, validInput);
    const data = added[0]!.data;
    for (const forbidden of ['startTime', 'endTime', 'who', 'attendees', 'location']) {
      expect(forbidden in data, `${forbidden} must NOT be persisted (not in schema)`).toBe(false);
    }
  });

  it('carries the time-of-day on the ISO datetime `date` string (no separate time field)', async () => {
    await createEvent({ db }, validInput);
    expect(added[0]!.data.date).toBe('2026-06-01T17:30:00.000Z');
  });
});

describe('createEvent — validation (edge): empty / whitespace title rejected before any write', () => {
  it('rejects an empty title with an EventActionError and writes nothing', async () => {
    await expect(createEvent({ db }, { ...validInput, title: '' })).rejects.toBeInstanceOf(
      EventActionError,
    );
    expect(added).toHaveLength(0);
  });

  it('rejects a whitespace-only title (spaces/tabs/newlines) and writes nothing', async () => {
    await expect(
      createEvent({ db }, { ...validInput, title: '   \t\n  ' }),
    ).rejects.toBeInstanceOf(EventActionError);
    expect(added).toHaveLength(0);
  });

  it('trims surrounding whitespace from an accepted title', async () => {
    await createEvent({ db }, { ...validInput, title: '  Recital  ' });
    expect(added[0]!.data.title).toBe('Recital');
  });

  it('accepts unicode / emoji in the title', async () => {
    await createEvent({ db }, { ...validInput, title: 'Maya’s recital 🎻 — café' });
    expect(added[0]!.data.title).toBe('Maya’s recital 🎻 — café');
  });

  it('allows an EMPTY description (description is optional per the form)', async () => {
    await createEvent({ db }, { ...validInput, description: '' });
    expect(added[0]!.data.description).toBe('');
  });
});

describe('createEvent — error path (security/privacy): raw Firestore errors never surface', () => {
  it('maps a Firestore failure to the generic PII-free message', async () => {
    addShouldReject = true;
    await expect(createEvent({ db }, validInput)).rejects.toThrow(EVENT_GENERIC_ERROR);
  });

  it('the generic error copy contains no raw error text and no event title', async () => {
    addShouldReject = true;
    const err = await createEvent({ db }, validInput).then(
      () => new Error('expected createEvent to reject'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe(EVENT_GENERIC_ERROR);
    expect(err.message).not.toMatch(/emulated-firestore-failure/);
    expect(err.message).not.toContain(validInput.title);
  });
});

describe('updateEvent — happy + error path', () => {
  it('updates the events doc by id with title/description/date/tag only (no familyId)', async () => {
    await updateEvent({ db }, 'event-123', {
      title: 'Soccer (rescheduled)',
      description: 'New field',
      date: '2026-06-02T18:00:00.000Z',
      tag: 'family',
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]!.collection).toBe('events');
    expect(updated[0]!.id).toBe('event-123');
    expect('familyId' in updated[0]!.data, 'update must not write familyId (immutable)').toBe(
      false,
    );
    expect('createdBy' in updated[0]!.data, 'update must not write createdBy').toBe(false);
  });

  it('rejects an empty title on update and writes nothing', async () => {
    await expect(
      updateEvent({ db }, 'event-123', {
        title: '   ',
        description: '',
        date: '2026-06-02T18:00:00.000Z',
        tag: 'family',
      }),
    ).rejects.toBeInstanceOf(EventActionError);
    expect(updated).toHaveLength(0);
  });

  it('maps a Firestore update failure to the generic PII-free message', async () => {
    updateShouldReject = true;
    await expect(
      updateEvent({ db }, 'event-123', {
        title: 'ok',
        description: '',
        date: '2026-06-02T18:00:00.000Z',
        tag: 'work',
      }),
    ).rejects.toThrow(EVENT_GENERIC_ERROR);
  });
});

describe('deleteEvent — happy + error path', () => {
  it('deletes the events doc by id', async () => {
    await deleteEvent({ db }, 'event-123');
    expect(deleted).toEqual([{ collection: 'events', id: 'event-123' }]);
  });

  it('maps a Firestore delete failure to the generic PII-free message', async () => {
    deleteShouldReject = true;
    await expect(deleteEvent({ db }, 'event-123')).rejects.toThrow(EVENT_GENERIC_ERROR);
  });
});

describe('canManageEvents — UI permission mirrors the parent-only rule (security)', () => {
  it('a PARENT can manage events', () => {
    expect(canManageEvents({ role: 'parent' })).toBe(true);
  });

  it('a MEMBER cannot manage events (view-only)', () => {
    expect(canManageEvents({ role: 'member' })).toBe(false);
  });
});

describe('eventTagDotClass — tag maps to its TOKEN dot colour class (no raw hex)', () => {
  it('school -> the school dot token class', () => {
    expect(eventTagDotClass('school')).toBe('bg-category-school-dot');
  });
  it('sports -> the sports dot token class', () => {
    expect(eventTagDotClass('sports')).toBe('bg-category-sports-dot');
  });
  it('family -> the family dot token class', () => {
    expect(eventTagDotClass('family')).toBe('bg-category-family-dot');
  });
  it('work -> the work dot token class', () => {
    expect(eventTagDotClass('work')).toBe('bg-category-work-dot');
  });

  it('every returned class is a token class, never a raw hex value', () => {
    for (const tag of ['school', 'sports', 'family', 'work'] as const) {
      const cls = eventTagDotClass(tag);
      expect(cls).toMatch(/^bg-category-/);
      expect(cls, 'must not embed a raw hex colour').not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });

  // FINDING A (HIGH) — the dot class MUST come from a STATIC lookup map of full
  // literal class names. `bg-category-${tag}-dot` (string interpolation) is a
  // class Tailwind's JIT compiler CANNOT see at build time, so the rule is never
  // emitted and the dot is invisible in production. jsdom cannot observe Tailwind
  // emission, so we pin the OBSERVABLE proxy: every output is a member of the
  // finite set of FULL literal class strings that the static map / Badge.tsx
  // declare. An interpolation-built string still happens to equal these literals,
  // so additionally pin the UNKNOWN-tag fallback below, which interpolation
  // CANNOT satisfy (it would build `bg-category-???-dot`, not a real token).
  it('every valid tag maps to one of the FOUR known FULL literal dot classes (static set, not interpolation-shaped)', () => {
    const KNOWN_LITERALS = new Set([
      'bg-category-school-dot',
      'bg-category-sports-dot',
      'bg-category-family-dot',
      'bg-category-work-dot',
    ]);
    for (const tag of ['school', 'sports', 'family', 'work'] as const) {
      expect(
        KNOWN_LITERALS.has(eventTagDotClass(tag)),
        `${tag} must map to a known full literal token class (a static map member, not interpolated)`,
      ).toBe(true);
    }
  });

  it('an UNKNOWN/invalid tag returns a SAFE fallback literal — never undefined, empty, or an interpolated non-token', () => {
    // An invalid tag can arrive from stale cache / a future schema value. The
    // function must fail SAFE to a real, JIT-visible token class — NOT
    // `bg-category-undefined-dot` (what interpolation produces) and NOT '' /
    // undefined (which would render no colour and could break the class string).
    const KNOWN_LITERALS = new Set([
      'bg-category-school-dot',
      'bg-category-sports-dot',
      'bg-category-family-dot',
      'bg-category-work-dot',
    ]);
    const fallback = eventTagDotClass('totally-unknown-tag' as never);
    expect(typeof fallback, 'fallback must be a string').toBe('string');
    expect(fallback.length, 'fallback must be non-empty').toBeGreaterThan(0);
    expect(
      fallback,
      'fallback must not be the interpolation artefact for an unknown tag',
    ).not.toBe('bg-category-totally-unknown-tag-dot');
    expect(fallback).not.toMatch(/undefined|null/);
    expect(
      KNOWN_LITERALS.has(fallback),
      'fallback must be one of the four known full literal token classes',
    ).toBe(true);
  });
});

describe('toast copy — success + error messages defined for the toast-everything rule', () => {
  it('create / update / delete success + generic error copy are non-empty strings', () => {
    for (const s of [
      EVENT_CREATE_SUCCESS,
      EVENT_UPDATE_SUCCESS,
      EVENT_DELETE_SUCCESS,
      EVENT_GENERIC_ERROR,
    ]) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
