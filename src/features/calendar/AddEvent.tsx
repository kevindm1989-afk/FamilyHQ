/**
 * Add Event sheet/modal — CONTRACT STUB (Phase 3, Task 13; handoff #07
 * AddEventScreen).
 *
 * Signatures only — the body THROWS so AddEvent.test.tsx fails until the
 * implementer builds it. The create ACTION is injected (resolve/reject) so the
 * sheet is unit-testable without Firestore.
 *
 * Collects ONLY the locked-schema-relevant fields: title (autofocus, required),
 * optional description, date (chip row Today / Tomorrow / Pick date — produces
 * an ISO datetime string), and category/tag (segmented control: School / Sports
 * / Family / Work, each with its colour dot). The Add-event submit is
 * aria-disabled (focusable) while the trimmed title is empty.
 *
 * HANDOFF-vs-SCHEMA GAP (deferred): the handoff also shows start/end time, a
 * "who's it for" multi-select, and a location field — NONE are in the locked
 * 7-field schema, so this form does NOT collect or submit them.
 */
import type { ReactElement } from 'react';
import type { EventTag, Role } from '../../lib/types';

export interface AddEventValue {
  title: string;
  description: string;
  /** ISO datetime string carrying the chosen day (and any time-of-day). */
  date: string;
  tag: EventTag;
}

export interface AddEventProps {
  open: boolean;
  onClose: () => void;
  author: { uid: string; name: string; role: Role };
  /**
   * Injected create action (the screen wires this to calendarService.createEvent
   * + useToast). Receives the collected value. Resolves on success, rejects on
   * failure.
   */
  onCreate: (value: AddEventValue) => Promise<void>;
  /** The reference "today" so the Today/Tomorrow chips are deterministic. */
  today: { year: number; month: number; day: number };
}

export function AddEvent(_props: AddEventProps): ReactElement {
  throw new Error('AddEvent not implemented (Task 13 contract stub)');
}
