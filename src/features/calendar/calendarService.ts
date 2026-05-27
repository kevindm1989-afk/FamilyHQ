/**
 * Calendar service — CONTRACT STUB (Phase 3, Task 13; ADR-0001/0002,
 * handoff #03 CalendarScreen + #07 AddEventScreen).
 *
 * Signatures only — NO logic. Authored by the test-writer to PIN the shape the
 * implementer must fulfill; calendarService.test.ts imports these. The
 * implementer fills the bodies (mirroring boardService) so the tests pass.
 *
 * DATA-MODEL FIDELITY (architect-locked, system-design §2.2): the persisted
 * `events` schema is EXACTLY
 *   { title, description, date, tag, familyId, createdBy, createdAt }
 * Add Event collects title, optional description, date (an ISO DATETIME so a
 * time-of-day can be carried on the `date` string), and tag/category. The
 * create write must contain ONLY those 7 keys (shape-lock, mirrors posts).
 *
 * HANDOFF-vs-SCHEMA GAP (deliberately deferred): the Add Event handoff (#07)
 * also shows start/end time, a "who's it for" multi-select, and a location
 * field. NONE of those are in the locked schema. They are NOT collected and NOT
 * persisted here. Deferred — do not build extra fields around them.
 *
 * Event CRUD is PARENT-ONLY (spec): only a parent gets the + FAB and the
 * edit/delete affordances. Members VIEW the shared calendar but cannot create/
 * edit/delete. Authority is enforced SERVER-SIDE in firestore.rules and proven
 * by test/rules/events.test.ts; canManageEvents() is a cosmetic UI affordance.
 */
import type { Firestore } from 'firebase/firestore';
import type { EventTag, FamilyEvent, Role } from '../../lib/types';

/** An event enriched with its document id for list rendering + edit/delete. */
export interface EventWithId extends FamilyEvent {
  id: string;
}

/** A generic, user-safe error — never leaks a raw Firebase code or PII. */
export declare class EventActionError extends Error {
  constructor(message?: string);
}

/** User-safe copy the service surfaces; asserted by the tests. */
export declare const EVENT_CREATE_SUCCESS: string;
export declare const EVENT_UPDATE_SUCCESS: string;
export declare const EVENT_DELETE_SUCCESS: string;
export declare const EVENT_GENERIC_ERROR: string;

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
export declare function createEvent(
  deps: { db: Firestore },
  input: CreateEventInput,
): Promise<void>;

/**
 * Update an event by id (title/description/date/tag only). familyId is immutable
 * (server-enforced). Maps failures to EVENT_GENERIC_ERROR.
 */
export declare function updateEvent(
  deps: { db: Firestore },
  eventId: string,
  input: UpdateEventInput,
): Promise<void>;

/** Delete an `events` doc by id. Maps failures to EVENT_GENERIC_ERROR. */
export declare function deleteEvent(deps: { db: Firestore }, eventId: string): Promise<void>;

/**
 * Pure UI-permission derivation (mirrors the firestore.rules events write rule):
 * only a PARENT may create/edit/delete events. Cosmetic affordance — the server
 * rule is authoritative.
 */
export declare function canManageEvents(viewer: { role: Role }): boolean;

/**
 * Pure mapping from a category/tag to its token DOT colour class (style-guide
 * §category colours; tokens, never raw hex):
 *   school -> blue, sports -> green, family -> indigo, work -> grey.
 * Returns the Tailwind token class (e.g. `bg-category-school-dot`).
 */
export declare function eventTagDotClass(tag: EventTag): string;
