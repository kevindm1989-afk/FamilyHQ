/**
 * Chores member screen — component contract (Task 10; handoff #05a
 * ChoresTeenScreen; preferences "empty + loading states", "toast-everything").
 *
 * Level: component. Feed state + actions are INJECTED so the screen renders
 * deterministically without Firestore or the real clock. Server authority is
 * covered by test/rules/chores-*.ts; the feed query scoping by
 * useMyChores.test.tsx; the write/badge map by choresMemberService.test.ts.
 *
 * FAILS today: ChoresMemberScreen is a declare-only contract stub.
 *
 * State traceability (designer-defined states):
 *  - loading            -> Skeleton (role=status, aria-busy)
 *  - empty (no chores)  -> friendly EmptyState
 *  - earnings card      -> the member's current allowanceBalance
 *  - pending section    -> rows WITH a "Mark done" button
 *  - waiting section    -> complete chores, no button
 *  - approved section   -> approved chores, "$X earned"
 *  - rejected           -> shows the parent's rejectionReason, no button
 *  - recurring          -> recurrence-frequency badge
 *  - status badge       -> tone from statusBadgeClass
 *
 * Isolation: injected props + ToastProvider; no clock/network/RNG; each test
 * builds its own props (order-independent).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { ChoresMemberScreen, type ChoresMemberScreenProps } from './ChoresMemberScreen';
import { CHORE_COMPLETE_SUCCESS, type ChoreWithId } from './choresMemberService';

const VIEWER = {
  uid: 'uid-member-a',
  name: 'Maya Rivera',
  role: 'member' as const,
  allowanceBalance: 38.5,
};

function mkChore(over: Partial<ChoreWithId> & { id: string }): ChoreWithId {
  return {
    title: 'Take out the trash',
    assignedTo: 'uid-member-a',
    dueDate: '2026-05-30',
    pointValue: 10,
    dollarValue: 3,
    status: 'pending',
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
    createdAt: 1000,
    isRecurring: false,
    recurrenceFrequency: 'none',
    ...over,
  };
}

function renderScreen(overrides: Partial<ChoresMemberScreenProps> = {}) {
  const props: ChoresMemberScreenProps = {
    familyId: 'fam-A',
    viewer: VIEWER,
    feed: {
      chores: [],
      loading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    onMarkComplete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <ToastProvider>
      <ChoresMemberScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('ChoresMemberScreen — loading state', () => {
  it('renders a loading affordance (role=status, aria-busy) while the feed is loading', () => {
    renderScreen({ feed: { chores: [], loading: true, error: null, refresh: vi.fn() } });
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ChoresMemberScreen — earnings card (balance only; month-sum DEFERRED)', () => {
  it('shows the member’s current allowanceBalance prominently', () => {
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 38.5 } });
    // The balance is shown as currency. Pin the value, not the exact element.
    expect(screen.getByText(/\$?38\.50/)).toBeInTheDocument();
  });

  it('shows a zero balance as $0.00 (edge: new member, never NaN/blank)', () => {
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 0 } });
    expect(screen.getByText(/\$?0\.00/)).toBeInTheDocument();
  });

  it('does NOT render a computed "earned this month" sum (deferred — depends on the ledger)', () => {
    // The transactions ledger is not built yet; the screen must not fabricate a
    // monthly total. A static "View history" affordance is allowed, but no
    // "earned this month" dollar figure derived from transactions.
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 38.5 } });
    expect(screen.queryByText(/earned this month/i)).not.toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — empty state', () => {
  it('shows a friendly empty message when the member has no chores', () => {
    renderScreen({ feed: { chores: [], loading: false, error: null, refresh: vi.fn() } });
    expect(screen.getByText(/no chores|all caught up|nothing to do|you're all set/i)).toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — pending section + Mark done', () => {
  it('renders a pending chore with its title and due date in a <time> element', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Walk the dog', dueDate: '2026-05-30' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText('Walk the dog')).toBeInTheDocument();
    const time = document.querySelector('time[datetime="2026-05-30"]');
    expect(time, 'due date must be a <time datetime> element').not.toBeNull();
  });

  it('renders the point value and dollar value on a chore row', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', pointValue: 10, dollarValue: 3 })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/10/)).toBeInTheDocument();
    expect(screen.getByText(/\$?3(\.00)?/)).toBeInTheDocument();
  });

  it('shows a "Mark done" button ONLY on a pending chore', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: /mark done|mark complete/i })).toBeInTheDocument();
  });

  it('clicking "Mark done" calls onMarkComplete with the chore id and toasts the design copy', async () => {
    const onMarkComplete = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      onMarkComplete,
      feed: {
        chores: [mkChore({ id: 'c1', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /mark done|mark complete/i }));
    await waitFor(() => expect(onMarkComplete).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.getByText(CHORE_COMPLETE_SUCCESS)).toBeInTheDocument());
  });

  it('does NOT show "Mark done" on a complete/approved/rejected chore', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'c-complete', status: 'complete' }),
          mkChore({ id: 'c-approved', status: 'approved' }),
          mkChore({ id: 'c-rejected', status: 'rejected', rejectionReason: 'redo it' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.queryByRole('button', { name: /mark done|mark complete/i })).not.toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — sections (pending / waiting-for-approval / approved)', () => {
  it('renders a "waiting for approval" section for a complete chore', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Vacuum', status: 'complete' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/waiting for approval/i)).toBeInTheDocument();
    expect(screen.getByText('Vacuum')).toBeInTheDocument();
  });

  it('renders an approved chore with its "$X earned" amount', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Mow lawn', status: 'approved', dollarValue: 5 })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText('Mow lawn')).toBeInTheDocument();
    // The approved row shows the earned amount.
    expect(screen.getByText(/\$?5(\.00)?\s*earned/i)).toBeInTheDocument();
  });

  it('places each chore in its OWN status section (pending vs complete vs approved are distinct)', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'p', title: 'Pending chore', status: 'pending' }),
          mkChore({ id: 'w', title: 'Waiting chore', status: 'complete' }),
          mkChore({ id: 'a', title: 'Approved chore', status: 'approved' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // Pending chore has the only Mark-done button; the others do not.
    const pendingBtn = screen.getByRole('button', { name: /mark done|mark complete/i });
    expect(pendingBtn).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /mark done|mark complete/i })).toHaveLength(1);
    expect(screen.getByText('Pending chore')).toBeInTheDocument();
    expect(screen.getByText('Waiting chore')).toBeInTheDocument();
    expect(screen.getByText('Approved chore')).toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — status badge (text label, not colour alone — WCAG 1.4.1)', () => {
  it('a rejected chore shows the parent’s rejectionReason', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({
            id: 'c1',
            title: 'Dishes',
            status: 'rejected',
            rejectionReason: 'Half the plates are still dirty',
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/Half the plates are still dirty/)).toBeInTheDocument();
  });

  it('conveys the complete status as the TEXT "waiting for approval", not colour alone', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', status: 'complete' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/waiting for approval/i)).toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — recurring indicator', () => {
  it('shows a recurrence badge with the frequency when isRecurring is true', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'c1', isRecurring: true, recurrenceFrequency: 'weekly', status: 'pending' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/weekly/i)).toBeInTheDocument();
  });

  it('does NOT show a recurrence badge for a one-off chore (isRecurring false)', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'c1', isRecurring: false, recurrenceFrequency: 'none', status: 'pending' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.queryByText(/weekly|biweekly/i)).not.toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — Mark done button accessibility (focusable, aria-disabled pattern)', () => {
  it('the Mark done button is a real focusable button (keyboard reachable)', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const btn = screen.getByRole('button', { name: /mark done|mark complete/i });
    // A real <button> (not a div) is keyboard reachable by default.
    expect(btn.tagName).toBe('BUTTON');
    btn.focus();
    expect(btn).toHaveFocus();
  });
});
