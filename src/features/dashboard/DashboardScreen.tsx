/**
 * Dashboard home screen (Phase 4, Dashboard feature; the `/` landing route).
 *
 * SIGNATURE / PROPS CONTRACT ONLY. The test-writer authors this file to PIN the
 * injected-props shape the implementer must fulfill (the component tests import
 * it). The implementer replaces the `throw` body with the real render; the
 * implementer MUST NOT change this props interface without updating the tests.
 *
 * The screen is a DETERMINISTIC, INJECTED-PROPS composition over the existing
 * feeds — it contains NO Firebase. AppShell wires the real hooks
 * (useMyChores / useFamilyChores / useFamilyEvents / useFamilyPosts /
 * useAllowanceHistory) and passes their `{ items, loading, error }` plus the
 * caller's identity, role, members, and a single `onRefresh` that refreshes
 * ALL feeds.
 *
 * Layout (READ-ONLY composition; ADR-0002 role gating is cosmetic — rules are
 * authoritative):
 *  - MEMBER: greeting, current balance (formatMoney, gated -> indicator),
 *    recent earnings, my chores (soonest 3), upcoming events (future 3),
 *    recent posts (newest 3). Balance and earnings are INDEPENDENT facts —
 *    NEVER present earnings as summing to the balance (ADR-0004 honesty).
 *  - PARENT: greeting, approvals (queue capped 3 + pending count), upcoming
 *    events, recent posts. NO own-balance / own-chores section.
 *  - Every list section: heading, list capped at 3, a "View all <target>"
 *    control deep-linking via onNavigate, and INDEPENDENT loading (Skeleton) /
 *    empty (EmptyState) / error (compact inline, single-channel — never a
 *    toast) states.
 */
import type { ReactElement } from 'react';
import type { Role, UserWithId } from '../../lib/types';
import type { ChoreWithId } from '../chores/choresMemberService';
import type { EventWithId } from '../calendar/calendarService';
import type { PostWithId } from '../board/boardService';
import type { TransactionWithId } from '../allowance/allowanceService';
import type { ScreenId } from '../../app/routes';

/**
 * A section feed slice — the screen renders one of three independent states per
 * section from this shape: loading (Skeleton), error (compact inline), else the
 * items list (capped + empty fallback). Mirrors the live hook return minus the
 * refresh callback (the screen has a SINGLE refresh control via onRefresh).
 */
export interface SectionFeed<T> {
  items: T[];
  loading: boolean;
  /** User-safe copy only — never raw Firebase text / PII. Null when healthy. */
  error: string | null;
}

export interface DashboardScreenProps {
  /** Cosmetic role gate (ADR-0002): drives MEMBER vs PARENT layout. */
  role: Role;
  /** Personalized greeting target (the viewer's display name). */
  userName: string;
  /**
   * The viewer's allowance balance in INTEGER CENTS (member only). A non-finite
   * / invalid value renders MONEY_INVALID_INDICATOR, never "$0.00".
   */
  balanceCents: number;
  /** Active family members — used to resolve a chore's assignee name (parent). */
  members: UserWithId[];
  /** Deterministic "now" (ms) for relativeTime + the upcoming-events filter. */
  nowMs: number;
  /** Deep-link a section's "View all" to its full screen. */
  onNavigate: (screen: ScreenId) => void;
  /** The SINGLE refresh control — AppShell wires it to refresh ALL feeds. */
  onRefresh: () => void;

  // Per-section injected feeds. Each role reads the subset it renders.
  earnings: SectionFeed<TransactionWithId>; // member
  myChores: SectionFeed<ChoreWithId>; // member
  approvals: SectionFeed<ChoreWithId>; // parent (the full family-chore feed)
  events: SectionFeed<EventWithId>; // both
  posts: SectionFeed<PostWithId>; // both
}

export function DashboardScreen(_props: DashboardScreenProps): ReactElement {
  throw new Error('not implemented');
}
