/**
 * Calendar service (Phase 3, Task 13; ADR-0001/0002, handoff #03 CalendarScreen
 * + #07 AddEventScreen). Mirrors boardService.
 *
 * The well-behaved client: it shapes the `events` payload (EXACTLY the 7-field
 * locked schema), derives UI-level permission affordances, maps a tag to its
 * token dot colour class, and maps raw errors to user-safe, PII-free toast copy
 * (constraints "No PII in error messages"; threat-model T1.8/M8).
 *
 * DATA-MODEL FIDELITY (architect-locked, system-design §2.2): the persisted
 * `events` schema is EXACTLY
 *   { title, description, date, tag, familyId, createdBy, createdAt }
 * `date` is an ISO DATETIME string so a time-of-day rides on it. The create
 * write must contain ONLY those 7 keys (shape-lock).
 *
 * HANDOFF-vs-SCHEMA GAP (deferred): the Add Event handoff (#07) also shows
 * start/end time, a "who's it for" multi-select, and a location field. NONE are
 * in the locked schema — they are NOT collected and NOT persisted here.
 *
 * Event CRUD is PARENT-ONLY: only a parent gets the + FAB and edit/delete
 * affordances. Members VIEW the shared calendar but cannot mutate it. Authority
 * is enforced SERVER-SIDE in firestore.rules and proven by
 * test/rules/events.test.ts; canManageEvents() is a cosmetic UI affordance.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { EventTag, FamilyEvent, RecurrenceFrequency, Role } from '../../lib/types';
import { trackUsage } from '../../lib/telemetry';

/** An event enriched with its document id for list rendering + edit/delete. */
export interface EventWithId extends FamilyEvent {
  id: string;
}

/** User-safe copy the service surfaces; asserted by the tests. */
export const EVENT_CREATE_SUCCESS = 'Event added to the calendar.';
export const EVENT_UPDATE_SUCCESS = 'Event updated.';
export const EVENT_DELETE_SUCCESS = 'Event deleted.';
export const EVENT_GENERIC_ERROR = 'Something went wrong. Please try again.';

/** A generic, user-safe error — never leaks a raw Firebase code or PII. */
export class EventActionError extends Error {
  constructor(message: string = EVENT_GENERIC_ERROR) {
    super(message);
    this.name = 'EventActionError';
  }
}

const EVENTS_COLLECTION = 'events';

/** Max occurrences in a single recurring series. The rule layer enforces the
 *  same cap (`recurrenceCount <= 26` in firestore.rules). 26 = ~6 months at
 *  weekly, ~1 year at biweekly, ~2 years at monthly — a sensible upper bound
 *  for a family calendar before it makes more sense to recreate the series. */
export const RECURRENCE_MAX = 26;

/**
 * Input to create an event. The caller passes only the content + its own
 * identity + family — never a forged familyId/createdBy. `date` is an ISO
 * datetime string (carries the time-of-day).
 *
 * Optional recurrence fields make a single create-call spawn N siblings:
 *  - `recurrenceFrequency` — 'weekly' | 'biweekly' | 'monthly'
 *  - `recurrenceCount` — 2-26 (1 = a single occurrence == one-off)
 * When `recurrenceFrequency` is omitted or `'none'`, the service writes a
 * single one-off event with no recurrence fields (legacy shape).
 */
export interface CreateEventInput {
  title: string;
  description: string;
  date: string;
  tag: EventTag;
  familyId: string;
  createdBy: string;
  recurrenceFrequency?: RecurrenceFrequency;
  recurrenceCount?: number;
}

/** Fields an edit may change. familyId/createdBy/createdAt are NOT editable. */
export interface UpdateEventInput {
  title: string;
  description: string;
  date: string;
  tag: EventTag;
}

/**
 * Create an `events` doc shaped EXACTLY as the 7-field schema. Trims the title;
 * rejects an empty/whitespace-only title BEFORE any write. Maps any Firestore
 * failure to EVENT_GENERIC_ERROR (no raw error / PII surfaced).
 */
export async function createEvent(deps: { db: Firestore }, input: CreateEventInput): Promise<void> {
  const title = input.title.trim();
  if (title.length === 0) {
    // Reject before any write — an empty/whitespace-only title is never stored.
    throw new EventActionError();
  }

  const frequency = input.recurrenceFrequency;
  const isRecurring =
    frequency !== undefined &&
    frequency !== 'none' &&
    input.recurrenceCount !== undefined &&
    input.recurrenceCount > 1;

  // One-off path (the existing behavior — keeps the locked 7-field shape
  // for events created without recurrence).
  if (!isRecurring) {
    try {
      await addDoc(collection(deps.db, EVENTS_COLLECTION), {
        title,
        description: input.description,
        date: input.date,
        tag: input.tag,
        familyId: input.familyId,
        createdBy: input.createdBy,
        createdAt: serverTimestamp(),
      });
    } catch {
      throw new EventActionError();
    }
    trackUsage('calendar_event_created');
    return;
  }

  // Recurring path: spawn N siblings in a single batch.
  const count = Math.min(Math.max(1, input.recurrenceCount!), RECURRENCE_MAX);
  if (count <= 1) {
    // Defensive: count of 1 collapses to one-off; recurse via the same path
    // with the recurrence keys stripped (exactOptionalPropertyTypes-safe).
    const { recurrenceFrequency: _rf, recurrenceCount: _rc, ...oneOffInput } = input;
    void _rf;
    void _rc;
    return createEvent(deps, oneOffInput);
  }
  const groupId = newRecurrenceGroupId();
  const dates = expandRecurrenceDates(input.date, frequency!, count);
  if (dates === null) {
    // Malformed source date — surface the same user-safe error.
    throw new EventActionError();
  }

  try {
    const batch = writeBatch(deps.db);
    const col = collection(deps.db, EVENTS_COLLECTION);
    for (const date of dates) {
      const ref = doc(col);
      batch.set(ref, {
        title,
        description: input.description,
        date,
        tag: input.tag,
        familyId: input.familyId,
        createdBy: input.createdBy,
        createdAt: serverTimestamp(),
        recurrenceFrequency: frequency,
        recurrenceCount: count,
        recurrenceGroupId: groupId,
      });
    }
    await batch.commit();
  } catch {
    throw new EventActionError();
  }
  trackUsage('calendar_event_created');
}

/**
 * Generate N occurrence dates starting at `sourceDate` (ISO datetime,
 * `YYYY-MM-DDThh:mm:ss...`) at the given frequency. Returns `null` on a
 * malformed source date so the caller surfaces a user-safe error instead
 * of throwing.
 *
 * Date arithmetic uses local-calendar `Date` math so a "weekly at 9am" event
 * stays at 9am local across DST transitions (we add days, not 7×24h).
 * Monthly is "same day-of-month next month"; when the source is Jan 31 and
 * next month is Feb (no day 31), JS Date overflows to Mar 3 — we clamp to
 * the last day of the target month instead so a "monthly on the 31st"
 * series stays on the last day for short months.
 */
export function expandRecurrenceDates(
  sourceDate: string,
  frequency: RecurrenceFrequency,
  count: number,
): string[] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(.*)$/.exec(sourceDate);
  if (m === null) return null;
  const [, y, mo, d, hh, mm, ss, rest] = m;
  const year = Number.parseInt(y!, 10);
  const month = Number.parseInt(mo!, 10);
  const day = Number.parseInt(d!, 10);
  const hour = Number.parseInt(hh!, 10);
  const minute = Number.parseInt(mm!, 10);
  const second = Number.parseInt(ss!, 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }

  const out: string[] = [sourceDate];
  if (count <= 1) return out;

  const stepDays = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 0;
  const fmt = (dt: Date): string => {
    const yy = String(dt.getFullYear()).padStart(4, '0');
    const mmm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const HH = String(dt.getHours()).padStart(2, '0');
    const MM = String(dt.getMinutes()).padStart(2, '0');
    const SS = String(dt.getSeconds()).padStart(2, '0');
    return `${yy}-${mmm}-${dd}T${HH}:${MM}:${SS}${rest ?? ''}`;
  };

  for (let i = 1; i < count; i++) {
    if (frequency === 'monthly') {
      const targetMonthIdx = month - 1 + i; // 0-based month + i
      const targetYear = year + Math.floor(targetMonthIdx / 12);
      const targetMonth = targetMonthIdx % 12; // 0-based
      // Clamp day to the last day of the target month so "monthly on Jan 31"
      // becomes Feb 28/29 + Mar 31 + Apr 30 …, not Mar 3 (the JS overflow).
      const lastDayOfTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
      const targetDay = Math.min(day, lastDayOfTarget);
      out.push(fmt(new Date(targetYear, targetMonth, targetDay, hour, minute, second)));
    } else {
      const dt = new Date(year, month - 1, day + stepDays * i, hour, minute, second);
      out.push(fmt(dt));
    }
  }
  return out;
}

/**
 * Generate a recurrence-group id. Uses `crypto.randomUUID()` when available
 * (every modern browser + Node 19+); falls back to a timestamp+random string
 * for older test envs. Same pattern as the checklist-item ids.
 */
function newRecurrenceGroupId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Delete every event in a recurrence series. When `fromDate` is provided,
 * only siblings whose `date >= fromDate` are deleted ("this and all future");
 * absent, the entire series is removed. The query is filtered by both
 * `familyId` (rule scope) and `recurrenceGroupId` so a parent never deletes
 * another family's series even if the UI passed a wrong groupId.
 */
export async function deleteEventSeries(
  deps: { db: Firestore },
  familyId: string,
  recurrenceGroupId: string,
  fromDate?: string,
): Promise<void> {
  try {
    const snap = await getDocs(
      query(
        collection(deps.db, EVENTS_COLLECTION),
        where('familyId', '==', familyId),
        where('recurrenceGroupId', '==', recurrenceGroupId),
      ),
    );
    const batch = writeBatch(deps.db);
    let touched = 0;
    snap.forEach((d) => {
      const data = d.data() as { date?: unknown };
      if (fromDate === undefined || (typeof data.date === 'string' && data.date >= fromDate)) {
        batch.delete(d.ref);
        touched += 1;
      }
    });
    if (touched > 0) await batch.commit();
  } catch {
    throw new EventActionError();
  }
}

/**
 * Update an event by id (title/description/date/tag only). familyId/createdBy/
 * createdAt are NOT written here (familyId is server-immutable). Trims + rejects
 * an empty title before any write. Maps failures to EVENT_GENERIC_ERROR.
 */
export async function updateEvent(
  deps: { db: Firestore },
  eventId: string,
  input: UpdateEventInput,
): Promise<void> {
  const title = input.title.trim();
  if (title.length === 0) {
    throw new EventActionError();
  }

  try {
    await updateDoc(doc(deps.db, EVENTS_COLLECTION, eventId), {
      title,
      description: input.description,
      date: input.date,
      tag: input.tag,
    });
  } catch {
    throw new EventActionError();
  }
}

/**
 * Update every sibling in a recurrence series at once (title/description/tag).
 * `date` is INTENTIONALLY NOT part of this operation: each occurrence's date
 * is the whole point of materialising siblings (ADR-0012), so a series-wide
 * date rewrite would defeat the model. Use `updateEvent(...)` for a single
 * occurrence's date.
 *
 * When `fromDate` is provided, only siblings whose `date >= fromDate` are
 * touched ("this and all future" — pass the edited event's own date). When
 * absent the whole series is updated.
 *
 * Mirrors `deleteEventSeries`'s safety stance: the query is filtered by both
 * `familyId` (rule scope) and `recurrenceGroupId` so a parent never reaches
 * across families even if the UI passed a wrong groupId. Empty-title input
 * is rejected before any write. Failures map to EVENT_GENERIC_ERROR.
 */
export async function updateEventSeries(
  deps: { db: Firestore },
  familyId: string,
  recurrenceGroupId: string,
  patch: { title: string; description: string; tag: EventTag },
  fromDate?: string,
): Promise<void> {
  const title = patch.title.trim();
  if (title.length === 0) {
    throw new EventActionError();
  }
  try {
    const snap = await getDocs(
      query(
        collection(deps.db, EVENTS_COLLECTION),
        where('familyId', '==', familyId),
        where('recurrenceGroupId', '==', recurrenceGroupId),
      ),
    );
    const batch = writeBatch(deps.db);
    let touched = 0;
    snap.forEach((d) => {
      const data = d.data() as { date?: unknown };
      if (fromDate === undefined || (typeof data.date === 'string' && data.date >= fromDate)) {
        batch.update(d.ref, {
          title,
          description: patch.description,
          tag: patch.tag,
        });
        touched += 1;
      }
    });
    if (touched > 0) await batch.commit();
  } catch (err) {
    if (err instanceof EventActionError) throw err;
    throw new EventActionError();
  }
}

/** Delete an `events` doc by id. Maps failures to EVENT_GENERIC_ERROR. */
export async function deleteEvent(deps: { db: Firestore }, eventId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, EVENTS_COLLECTION, eventId));
  } catch {
    throw new EventActionError();
  }
}

/**
 * Pure UI-permission derivation (mirrors the firestore.rules events write rule):
 * only a PARENT may create/edit/delete events. Cosmetic affordance — the server
 * rule is authoritative.
 */
export function canManageEvents(viewer: { role: Role }): boolean {
  return viewer.role === 'parent';
}

/**
 * The single source of truth for a category/tag's human display label
 * (School / Sports / Family / Work). Shared by AddEvent's category radios,
 * CalendarScreen's agenda badges, and the Dashboard's upcoming-events badge so
 * the capitalized label is never re-invented per surface.
 */
export const EVENT_TAG_LABEL: Record<EventTag, string> = {
  school: 'School',
  sports: 'Sports',
  family: 'Family',
  work: 'Work',
};

/**
 * STATIC lookup from a category/tag to its FULL literal token DOT colour class
 * (mirrors Badge.tsx's `TONE_CLASS`). The full literal strings are what make the
 * `bg-category-*-dot` utilities visible to Tailwind's JIT — a `bg-category-
 * ${tag}-dot` template is NOT statically analysable, so the rule would never be
 * emitted and the dot would disappear in production (Finding A, HIGH).
 */
const TAG_DOT_CLASS: Record<EventTag, string> = {
  school: 'bg-category-school-dot',
  sports: 'bg-category-sports-dot',
  family: 'bg-category-family-dot',
  work: 'bg-category-work-dot',
};

/**
 * Pure mapping from a category/tag to its token DOT colour class (style-guide
 * §category colours; tokens, never raw hex).
 *
 * An UNKNOWN/invalid tag (stale cache, a future schema value) falls SAFE to a
 * real literal token class — never `undefined`, empty, or an interpolated
 * non-token.
 */
export function eventTagDotClass(tag: EventTag): string {
  return TAG_DOT_CLASS[tag] ?? TAG_DOT_CLASS.family;
}
