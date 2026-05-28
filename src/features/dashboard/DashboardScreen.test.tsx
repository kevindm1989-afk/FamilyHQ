/**
 * DashboardScreen contract (Phase 4, Dashboard feature).
 *
 * Level: component (injected props, deterministic — NO Firebase, NO clock). The
 * screen receives section feeds + role + identity + a fixed `nowMs`, so every
 * assertion is reproducible. relativeTime/upcoming-events take `nowMs`, never the
 * real clock.
 *
 * Money-collision guard (lesson 2026-05-27): every money surface uses a DISTINCT
 * value so a `$X.XX` matcher resolves to exactly one node, and section queries
 * are scoped with `within(section)`:
 *   balance $38.50 / chore $7.10 / earning $4.25 / approval $9.30.
 *
 * Single-error-channel: a per-section feed error renders a COMPACT INLINE error
 * WITHIN that section only (user-safe copy, no raw Firebase / PII) — never a
 * toast, and four failing feeds must never spam four toasts.
 *
 * FAILS today: DashboardScreen throws `not implemented` (props-contract stub).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UserWithId } from '../../lib/types';
import type { ChoreWithId } from '../chores/choresMemberService';
import type { EventWithId } from '../calendar/calendarService';
import type { PostWithId } from '../board/boardService';
import type { TransactionWithId } from '../allowance/allowanceService';
import { MONEY_INVALID_INDICATOR } from '../chores/choresParentService';
import { DashboardScreen, type DashboardScreenProps, type SectionFeed } from './DashboardScreen';

// Deterministic reference clock for relativeTime + the upcoming-events filter.
const NOW = new Date('2026-06-15T19:00:00.000Z').getTime();
const ONE_HOUR = 60 * 60 * 1000;

const memberUser: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya Rivera',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 3850,
  theme: 'light',
};
const childB: UserWithId = {
  id: 'uid-child-b',
  name: 'Ben Rivera',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 1200,
  theme: 'light',
};
const parentUser: UserWithId = {
  id: 'uid-parent-a',
  name: 'Sarah Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

function mkChore(over: Partial<ChoreWithId> & { id: string }): ChoreWithId {
  return {
    title: `Chore ${over.id}`,
    assignedTo: 'uid-member-a',
    dueDate: '2026-06-20',
    pointValue: 0,
    dollarValue: 710, // $7.10 — distinct money surface
    status: 'pending',
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
    createdAt: NOW,
    isRecurring: false,
    recurrenceFrequency: 'none',
    ...over,
  };
}
function mkEvent(over: Partial<EventWithId> & { id: string }): EventWithId {
  return {
    title: `Event ${over.id}`,
    description: '',
    date: '2026-06-20',
    tag: 'family',
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
    createdAt: NOW,
    ...over,
  };
}
function mkPost(over: Partial<PostWithId> & { id: string }): PostWithId {
  return {
    content: `Post ${over.id} content`,
    authorId: 'uid-parent-a',
    authorName: 'Sarah Kim',
    familyId: 'fam-A',
    createdAt: NOW - ONE_HOUR,
    ...over,
  };
}
function mkTxn(over: Partial<TransactionWithId> & { id: string }): TransactionWithId {
  return {
    uid: 'uid-member-a',
    choreId: 'chore-x',
    choreTitle: `Earning ${over.id}`,
    amount: 425, // $4.25 — distinct money surface
    type: 'earning',
    familyId: 'fam-A',
    createdAt: NOW - ONE_HOUR,
    ...over,
  };
}

function settled<T>(items: T[]): SectionFeed<T> {
  return { items, loading: false, error: null };
}
function loadingFeed<T>(): SectionFeed<T> {
  return { items: [], loading: true, error: null };
}
function erroredFeed<T>(error: string): SectionFeed<T> {
  return { items: [], loading: false, error };
}

function baseProps(over: Partial<DashboardScreenProps> = {}): DashboardScreenProps {
  return {
    role: 'member',
    userName: memberUser.name,
    balanceCents: memberUser.allowanceBalance,
    members: [parentUser, memberUser, childB],
    nowMs: NOW,
    onNavigate: vi.fn(),
    onRefresh: vi.fn(),
    earnings: settled<TransactionWithId>([]),
    myChores: settled<ChoreWithId>([]),
    approvals: settled<ChoreWithId>([]),
    events: settled<EventWithId>([]),
    posts: settled<PostWithId>([]),
    ...over,
  };
}

function renderDash(over: Partial<DashboardScreenProps> = {}) {
  const props = baseProps(over);
  render(<DashboardScreen {...props} />);
  return props;
}

/** Scope to a section by its accessible heading name (region landmark). */
function section(name: RegExp): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('DashboardScreen — shared chrome (greeting, refresh, structure)', () => {
  it('renders a personalized greeting containing the userName', () => {
    renderDash({ role: 'member', userName: 'Maya Rivera' });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/maya/i);
  });

  it('has exactly one page-level <h1>', () => {
    renderDash();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('renders a single labelled refresh control that calls onRefresh once', () => {
    const props = renderDash();
    const refresh = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refresh);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardScreen — MEMBER layout', () => {
  it('shows the current balance via formatMoney with an accessible "Current balance" name', () => {
    renderDash({ role: 'member', balanceCents: 3850 });
    // $38.50 is the balance value and is distinct from every other money surface.
    expect(screen.getByText(/current balance/i)).toHaveTextContent(/\$38\.50/);
  });

  it('renders the indicator (not "$0.00") for a NON-FINITE balance, still announced', () => {
    renderDash({ role: 'member', balanceCents: Number.NaN });
    const balance = screen.getByText(/current balance/i);
    expect(balance).toHaveTextContent(MONEY_INVALID_INDICATOR);
    expect(balance).not.toHaveTextContent(/\$0\.00/);
    expect(screen.queryByText(/\$NaN/)).not.toBeInTheDocument();
  });

  it('does NOT claim earnings sum to the balance (ADR-0004 honesty)', () => {
    renderDash({
      role: 'member',
      balanceCents: 3850,
      earnings: settled([mkTxn({ id: 't1' }), mkTxn({ id: 't2' })]),
    });
    // No "total", "sum", "adds up to", "= balance" framing anywhere on the page.
    expect(screen.queryByText(/sums? to|adds? up|total balance|= ?balance/i)).toBeNull();
  });

  it('renders recent earnings rows with gated money and a valid <time dateTime>', () => {
    renderDash({
      role: 'member',
      earnings: settled([mkTxn({ id: 't1', amount: 425, createdAt: NOW - ONE_HOUR })]),
    });
    const earnings = section(/earnings/i);
    expect(within(earnings).getByText(/\$4\.25/)).toBeInTheDocument();
    const time = within(earnings).getByText(/ago|just now|jun/i, { selector: 'time' });
    expect(time).toHaveAttribute('dateTime');
    expect(new Date(time.getAttribute('dateTime') ?? 'invalid').toString()).not.toBe('Invalid Date');
  });

  it('renders an earning whose amount is non-finite/negative/over-max as the indicator, not $NaN/-$x', () => {
    renderDash({
      role: 'member',
      earnings: settled([
        mkTxn({ id: 'bad-nan', amount: Number.NaN }),
        mkTxn({ id: 'bad-neg', amount: -500 }),
      ]),
    });
    const earnings = section(/earnings/i);
    expect(within(earnings).queryByText(/\$NaN/)).not.toBeInTheDocument();
    expect(within(earnings).queryByText(/-\$5\.00/)).not.toBeInTheDocument();
    expect(within(earnings).getAllByText(MONEY_INVALID_INDICATOR).length).toBeGreaterThanOrEqual(1);
  });

  it('caps my-chores at 3, soonest dueDate first, with status Badge text + gated dollarValue', () => {
    renderDash({
      role: 'member',
      myChores: settled([
        mkChore({ id: 'c-late', dueDate: '2026-06-25', title: 'Mow lawn', status: 'pending', dollarValue: 730 }),
        mkChore({ id: 'c-soon', dueDate: '2026-06-16', title: 'Dishes', status: 'complete', dollarValue: 710 }),
        mkChore({ id: 'c-mid', dueDate: '2026-06-20', title: 'Trash', status: 'rejected', dollarValue: 720 }),
        mkChore({ id: 'c-overflow', dueDate: '2026-06-30', title: 'Vacuum', status: 'pending', dollarValue: 740 }),
      ]),
    });
    const chores = section(/my chores/i);
    const rows = within(chores).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    // Soonest first: Dishes (06-16) before Trash (06-20) before Mow lawn (06-25).
    expect(within(chores).getByText('Dishes')).toBeInTheDocument();
    expect(within(chores).queryByText('Vacuum')).not.toBeInTheDocument();
    // Every displayed chore shows its own value regardless of status (distinct
    // fixtures avoid a $X.XX collision); the overflow chore is not rendered.
    expect(within(chores).getByText(/\$7\.10/)).toBeInTheDocument();
    expect(within(chores).getByText(/\$7\.20/)).toBeInTheDocument();
    expect(within(chores).getByText(/\$7\.30/)).toBeInTheDocument();
    expect(within(chores).queryByText(/\$7\.40/)).not.toBeInTheDocument();
  });

  it('renders only FUTURE events (local today or later), soonest first, capped at 3', () => {
    renderDash({
      role: 'member',
      events: settled([
        mkEvent({ id: 'e-past', date: '2026-06-10', title: 'Old picnic' }),
        mkEvent({ id: 'e-today', date: '2026-06-15', title: 'Today game' }),
        mkEvent({ id: 'e-soon', date: '2026-06-18', title: 'Recital' }),
      ]),
    });
    const events = section(/upcoming events/i);
    expect(within(events).queryByText('Old picnic')).not.toBeInTheDocument();
    expect(within(events).getByText('Today game')).toBeInTheDocument();
    const times = within(events).getAllByRole('listitem');
    expect(times.length).toBeGreaterThan(0);
    const time = within(events).getAllByText(/./, { selector: 'time' })[0];
    expect(time).toHaveAttribute('dateTime');
  });

  it('renders the newest 3 posts with authorName, content, and relativeTime', () => {
    renderDash({
      role: 'member',
      posts: settled([
        mkPost({ id: 'p1', authorName: 'Sarah Kim', content: 'Newest news', createdAt: NOW - ONE_HOUR }),
        mkPost({ id: 'p2', authorName: 'Tom Lee', content: 'Older news', createdAt: NOW - 5 * ONE_HOUR }),
      ]),
    });
    const posts = section(/recent posts/i);
    // Each post shows its own author (distinct fixtures avoid a name collision).
    expect(within(posts).getByText('Sarah Kim')).toBeInTheDocument();
    expect(within(posts).getByText('Tom Lee')).toBeInTheDocument();
    expect(within(posts).getByText(/newest news/i)).toBeInTheDocument();
    expect(within(posts).getByText(/older news/i)).toBeInTheDocument();
    expect(within(posts).getByText(/1h ago/)).toBeInTheDocument();
  });

  it('renders NO approvals section for a member', () => {
    renderDash({ role: 'member' });
    expect(screen.queryByRole('region', { name: /approval/i })).not.toBeInTheDocument();
  });
});

describe('DashboardScreen — PARENT layout', () => {
  const parentProps = (over: Partial<DashboardScreenProps> = {}) =>
    renderDash({ role: 'parent', userName: parentUser.name, ...over });

  it('renders the approvals queue capped at 3 with the assignee CHILD name and gated amount', () => {
    parentProps({
      approvals: settled([
        // Distinct approval money ($9.30) vs every other surface.
        mkChore({ id: 'a1', title: 'Sweep', status: 'complete', assignedTo: 'uid-member-a', dollarValue: 930 }),
        mkChore({ id: 'a2', title: 'Fold', status: 'complete', assignedTo: 'uid-child-b', dollarValue: 930 }),
        // pending/approved/rejected must NOT appear in the queue.
        mkChore({ id: 'a-pending', title: 'Pending one', status: 'pending', dollarValue: 930 }),
        mkChore({ id: 'a-approved', title: 'Approved one', status: 'approved', dollarValue: 930 }),
      ]),
    });
    const approvals = section(/approval/i);
    const rows = within(approvals).getAllByRole('listitem');
    expect(rows.length).toBe(2);
    expect(within(approvals).queryByText('Pending one')).not.toBeInTheDocument();
    // Assignee child name resolved from members (uid-member-a -> Maya Rivera).
    expect(within(approvals).getByText(/maya rivera/i)).toBeInTheDocument();
    expect(within(approvals).getByText(/ben rivera/i)).toBeInTheDocument();
    expect(within(approvals).getAllByText(/\$9\.30/).length).toBe(2);
  });

  it('shows the pending-approval count (N awaiting approval)', () => {
    parentProps({
      approvals: settled([
        mkChore({ id: 'a1', status: 'complete' }),
        mkChore({ id: 'a2', status: 'complete' }),
        mkChore({ id: 'a3', status: 'pending' }),
      ]),
    });
    const approvals = section(/approval/i);
    expect(within(approvals).getByText(/2 awaiting approval/i)).toBeInTheDocument();
  });

  it('shows a friendly EmptyState (not blank) when nothing is awaiting approval', () => {
    parentProps({ approvals: settled([mkChore({ id: 'a-approved', status: 'approved' })]) });
    const approvals = section(/approval/i);
    expect(within(approvals).getByText(/nothing to approve/i)).toBeInTheDocument();
  });

  it('renders NO balance and NO own-chores section for a parent', () => {
    parentProps();
    expect(screen.queryByText(/current balance/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /my chores/i })).not.toBeInTheDocument();
  });

  it('still renders upcoming events and recent posts for a parent', () => {
    parentProps({
      events: settled([mkEvent({ id: 'e1', date: '2026-06-20', title: 'Soccer' })]),
      posts: settled([mkPost({ id: 'p1', content: 'Family note' })]),
    });
    expect(within(section(/upcoming events/i)).getByText('Soccer')).toBeInTheDocument();
    expect(within(section(/recent posts/i)).getByText(/family note/i)).toBeInTheDocument();
  });
});

describe('DashboardScreen — independent per-section states', () => {
  it('shows a Skeleton (role=status) within a loading section only', () => {
    renderDash({ role: 'member', posts: loadingFeed<PostWithId>(), events: settled([mkEvent({ id: 'e1' })]) });
    const posts = section(/recent posts/i);
    expect(within(posts).getByRole('status')).toBeInTheDocument();
    // The events section is NOT loading, so it shows content, not a skeleton.
    const events = section(/upcoming events/i);
    expect(within(events).queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a friendly EmptyState (not blank) for a settled empty section', () => {
    renderDash({ role: 'member', posts: settled<PostWithId>([]) });
    const posts = section(/recent posts/i);
    // Some user-facing text exists — the section is never silently blank.
    expect(posts.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(within(posts).queryByRole('listitem')).not.toBeInTheDocument();
  });
});

describe('DashboardScreen — single-error-channel (no toast spam, PII-safe inline)', () => {
  it('renders a COMPACT INLINE error within the failing section only — not a toast', () => {
    renderDash({
      role: 'member',
      posts: erroredFeed<PostWithId>('We could not load posts. Please try again.'),
      events: settled([mkEvent({ id: 'e1', title: 'Soccer' })]),
    });
    const posts = section(/recent posts/i);
    expect(within(posts).getByText(/could not load/i)).toBeInTheDocument();
    // The error is inline within the section, NOT an alert/toast/status region.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A healthy sibling section still renders its content.
    expect(within(section(/upcoming events/i)).getByText('Soccer')).toBeInTheDocument();
  });

  it('does NOT spam a toast per failing feed when all four feeds error (single channel)', () => {
    renderDash({
      role: 'member',
      earnings: erroredFeed<TransactionWithId>('We could not load earnings.'),
      myChores: erroredFeed<ChoreWithId>('We could not load chores.'),
      events: erroredFeed<EventWithId>('We could not load events.'),
      posts: erroredFeed<PostWithId>('We could not load posts.'),
    });
    // Four failing feeds must never produce four toasts (role=alert/toast).
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('never leaks raw Firebase text or PII (choreTitle/child name) in a section error', () => {
    renderDash({
      role: 'parent',
      userName: parentUser.name,
      approvals: erroredFeed<ChoreWithId>('We could not load approvals. Please try again.'),
    });
    const approvals = section(/approval/i);
    const text = approvals.textContent ?? '';
    expect(text).not.toMatch(/FirebaseError|permission-denied|PERMISSION_DENIED|code: |\bquota\b/i);
    expect(text).not.toMatch(/maya rivera|ben rivera/i);
  });
});

describe('DashboardScreen — "View all" deep links + a11y structure', () => {
  it('member "View all" controls navigate to the right ScreenId with target-specific names', () => {
    const props = renderDash({ role: 'member' });

    fireEvent.click(screen.getByRole('button', { name: /view all allowance/i }));
    fireEvent.click(screen.getByRole('button', { name: /view all chores/i }));
    fireEvent.click(screen.getByRole('button', { name: /view all events|view all calendar/i }));
    fireEvent.click(screen.getByRole('button', { name: /view all posts|view all board/i }));

    const targets = (props.onNavigate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(targets).toContain('allowance');
    expect(targets).toContain('chores');
    expect(targets).toContain('calendar');
    expect(targets).toContain('board');
  });

  it('parent approvals "View all" navigates to the chores screen', () => {
    const props = renderDash({ role: 'parent', userName: parentUser.name });
    fireEvent.click(screen.getByRole('button', { name: /view all (chores|approvals)/i }));
    expect(props.onNavigate).toHaveBeenCalledWith('chores');
  });

  it('does not use the bare ambiguous "View all" label (each names its target)', () => {
    renderDash({ role: 'member' });
    // An accessible name of EXACTLY "View all" is ambiguous and disallowed.
    expect(screen.queryByRole('button', { name: /^view all$/i })).not.toBeInTheDocument();
  });

  it('each section is a region landmark with an <h2> heading (sane heading order)', () => {
    renderDash({ role: 'member', myChores: settled([mkChore({ id: 'c1' })]) });
    const regions = screen.getAllByRole('region');
    expect(regions.length).toBeGreaterThanOrEqual(3);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.length).toBeGreaterThanOrEqual(3);
  });

  it('renders section lists as <ul>/<li>', () => {
    renderDash({ role: 'member', posts: settled([mkPost({ id: 'p1' }), mkPost({ id: 'p2' })]) });
    const posts = section(/recent posts/i);
    expect(within(posts).getByRole('list')).toBeInTheDocument();
    expect(within(posts).getAllByRole('listitem').length).toBe(2);
  });

  it('the refresh and View-all controls are real, focusable <button> elements (platform keyboard-operable)', () => {
    renderDash({ role: 'member' });
    const refresh = screen.getByRole('button', { name: /refresh/i });
    const viewAll = screen.getByRole('button', { name: /view all chores/i });
    // A native <button> is Enter/Space-activatable by the platform (no custom
    // keydown handler needed). Pin that these controls are real buttons, focusable.
    expect(refresh.tagName).toBe('BUTTON');
    expect(viewAll.tagName).toBe('BUTTON');
    viewAll.focus();
    expect(viewAll).toHaveFocus();
  });
});
