/**
 * Family calendar feed hook — CONTRACT STUB (Phase 3, Task 13; handoff #03
 * CalendarScreen, threat-model P2/M7).
 *
 * Signatures only — NO logic. Mirrors useFamilyPosts: subscribes to `events`
 * scoped to the caller's family with the ONLY query the rules allow —
 * `where('familyId','==', familyId)` — never an unconstrained or cross-family
 * query. Converts the stored `createdAt` Timestamp to numeric ms (Timestamp ->
 * millis pattern). Clears events on a familyId CHANGE (cross-tenant display
 * leak guard). Returns `{ events, loading, error, refresh }`.
 *
 * NOTE on `date`: the persisted `date` is an ISO datetime STRING (not a
 * Timestamp). It is surfaced as-is; only `createdAt` is Timestamp->millis
 * converted (mirrors posts).
 */
import type { EventWithId } from './calendarService';

export interface UseFamilyEventsResult {
  events: EventWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export declare function useFamilyEvents(familyId: string | null): UseFamilyEventsResult;
