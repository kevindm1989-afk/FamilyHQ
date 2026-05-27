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
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import type { EventTag, FamilyEvent, Role } from '../../lib/types';

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

/**
 * Input to create an event. The caller passes only the content + its own
 * identity + family — never a forged familyId/createdBy. `date` is an ISO
 * datetime string (carries the time-of-day).
 */
export interface CreateEventInput {
  title: string;
  description: string;
  date: string;
  tag: EventTag;
  familyId: string;
  createdBy: string;
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
    // Never surface a raw Firebase code / PII to the caller.
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
 * Pure mapping from a category/tag to its token DOT colour class (style-guide
 * §category colours; tokens, never raw hex):
 *   school -> blue, sports -> green, family -> indigo, work -> grey.
 * Returns the Tailwind token class (e.g. `bg-category-school-dot`).
 */
export function eventTagDotClass(tag: EventTag): string {
  return `bg-category-${tag}-dot`;
}
