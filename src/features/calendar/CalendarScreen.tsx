/**
 * Calendar screen — CONTRACT STUB (Phase 3, Task 13; handoff #03 CalendarScreen).
 *
 * Signatures only — the body THROWS so CalendarScreen.test.tsx fails until the
 * implementer builds it. Feed state + actions are INJECTED so the screen renders
 * deterministically without Firestore.
 *
 * Designer states this screen must render (traced in CalendarScreen.test.tsx):
 *  - loading -> Skeleton (role=status)
 *  - month grid (6x7) with month header (prev/next), day-of-week strip, today cell
 *  - day with events -> up-to-3 category-colored dots
 *  - selected-day agenda -> time + title + tag rows
 *  - empty (selected day, no events) -> friendly empty message
 *  - parent -> + FAB + edit/delete affordances; member -> none (VIEW only)
 */
import type { ReactElement } from 'react';
import type { Role, UserWithId } from '../../lib/types';
import type { EventWithId } from './calendarService';

export interface CalendarScreenProps {
  familyId: string | null;
  viewer: { uid: string; name: string; role: Role };
  members: UserWithId[];
  feed: {
    events: EventWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** The reference "today" (injected so the today-cell highlight is deterministic). */
  today: { year: number; month: number; day: number };
  onDeleteEvent: (eventId: string) => Promise<void>;
  onCreateEvent?: (input: {
    title: string;
    description: string;
    date: string;
    tag: import('../../lib/types').EventTag;
  }) => Promise<void>;
}

export function CalendarScreen(_props: CalendarScreenProps): ReactElement {
  throw new Error('CalendarScreen not implemented (Task 13 contract stub)');
}
