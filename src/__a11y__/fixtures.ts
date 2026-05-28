/**
 * Shared a11y-test fixtures (Phase 4 / Task 17).
 *
 * These mirror the per-screen component-test fixtures — same shapes, same
 * money-collision discipline (lessons.md 2026-05-27) — but stripped down to
 * the fields the screens actually render. Keeping them here lets each
 * `*.a11y.test.tsx` stay focused on "render + assert no violations" without
 * re-declaring the same User/Chore/Event/Post/Transaction shape per file.
 */
import { configureAxe } from 'vitest-axe';
import type { UserWithId } from '../lib/types';
import type { ChoreWithId } from '../features/chores/choresMemberService';
import type { EventWithId } from '../features/calendar/calendarService';
import type { PostWithId } from '../features/board/boardService';
import type { TransactionWithId } from '../features/allowance/allowanceService';

/**
 * Project axe runner. Disables `color-contrast` because jsdom doesn't
 * implement `HTMLCanvasElement.getContext`, which axe-core's contrast rule
 * relies on to read computed pixels — leaving it enabled spams stderr with
 * "Not implemented" noise without producing useful signal. Contrast is owned
 * by the accessibility-specialist + the design tokens (style-guide.md §3),
 * not this gate. All other axe rules run with their defaults.
 */
export const axeA11y = configureAxe({
  rules: { 'color-contrast': { enabled: false } },
});

/** Deterministic reference "now" — must NOT come from Date.now(). */
export const A11Y_NOW = new Date('2026-06-15T19:00:00.000Z').getTime();
const ONE_HOUR = 60 * 60 * 1000;

export const mkMember = (over: Partial<UserWithId> & { id: string }): UserWithId => ({
  name: `Member ${over.id}`,
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 1200,
  theme: 'light',
  ...over,
});

export const mkParent = (over: Partial<UserWithId> & { id: string }): UserWithId => ({
  name: `Parent ${over.id}`,
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
  ...over,
});

export const mkChore = (over: Partial<ChoreWithId> & { id: string }): ChoreWithId => ({
  title: `Chore ${over.id}`,
  assignedTo: 'uid-member-a',
  dueDate: '2026-06-20',
  pointValue: 10,
  dollarValue: 710,
  status: 'pending',
  familyId: 'fam-A',
  createdBy: 'uid-parent-a',
  createdAt: A11Y_NOW,
  isRecurring: false,
  recurrenceFrequency: 'none',
  ...over,
});

export const mkEvent = (over: Partial<EventWithId> & { id: string }): EventWithId => ({
  title: `Event ${over.id}`,
  description: '',
  date: '2026-06-20T17:30:00.000Z',
  tag: 'family',
  familyId: 'fam-A',
  createdBy: 'uid-parent-a',
  createdAt: A11Y_NOW,
  ...over,
});

export const mkPost = (over: Partial<PostWithId> & { id: string }): PostWithId => ({
  content: `Post ${over.id} content`,
  authorId: 'uid-parent-a',
  authorName: 'Sarah Kim',
  familyId: 'fam-A',
  createdAt: A11Y_NOW - ONE_HOUR,
  ...over,
});

export const mkTxn = (over: Partial<TransactionWithId> & { id: string }): TransactionWithId => ({
  uid: 'uid-member-a',
  choreId: 'chore-x',
  choreTitle: `Earning ${over.id}`,
  amount: 425,
  type: 'earning',
  familyId: 'fam-A',
  createdAt: A11Y_NOW - ONE_HOUR,
  ...over,
});

/** Shared empty `noop` for action handlers — the gate doesn't fire them. */
export const noopAsync = async (): Promise<void> => {};
export const noop = (): void => {};
