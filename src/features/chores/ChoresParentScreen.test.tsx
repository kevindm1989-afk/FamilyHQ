/**
 * Chores PARENT screen — component contract (Task 11; handoff #05b
 * ChoresParentScreen; preferences "empty + loading states", "dynamic family",
 * "toast-everything").
 *
 * Level: component. Feed state, members, and actions are INJECTED so the screen
 * renders deterministically without Firestore or the real clock. Server
 * authority + transaction integrity are covered by test/rules/*.ts; the
 * approve/reject/add SERVICE shapes by choresParentService.test.ts.
 *
 * FAILS today: ChoresParentScreen is a declare-only contract stub that throws.
 *
 * State traceability (designer-defined states):
 *  - loading            -> Skeleton (role=status)
 *  - empty              -> friendly EmptyState
 *  - approvals queue    -> complete chores with Approve + Reject buttons
 *  - reject flow        -> required reason input -> onReject(id, reason)
 *  - pending-approval badge -> derived count of complete chores
 *  - balance chips      -> a chip per active member with allowanceBalance
 *  - member filter tabs -> All + one per active member (dynamic); filters list
 *  - empty per tab      -> friendly empty when a member has no chores
 *  - FAB                -> opens Add Chore
 *
 * Isolation: injected props + ToastProvider; no clock/network/RNG; each test
 * builds its own props (order-independent). Money/date matchers are PRECISE so a
 * stray digit cannot false-match (member-view matcher lesson).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { ChoresParentScreen, type ChoresParentScreenProps } from './ChoresParentScreen';
import { CHORE_APPROVE_SUCCESS, CHORE_REJECT_SUCCESS } from './choresParentService';
import type { ChoreWithId } from './choresMemberService';
import type { UserWithId } from '../../lib/types';

const MEMBERS: UserWithId[] = [
  {
    id: 'uid-maya',
    name: 'Maya',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 38.5,
    theme: 'light',
  },
  {
    id: 'uid-ben',
    name: 'Ben',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 12,
    theme: 'light',
  },
];

function mkChore(over: Partial<ChoreWithId> & { id: string }): ChoreWithId {
  return {
    title: 'Take out the trash',
    assignedTo: 'uid-maya',
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

function renderScreen(overrides: Partial<ChoresParentScreenProps> = {}) {
  const props: ChoresParentScreenProps = {
    familyId: 'fam-A',
    viewer: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
    members: MEMBERS,
    feed: {
      chores: [],
      loading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    onApprove: vi.fn().mockResolvedValue(undefined),
    onReject: vi.fn().mockResolvedValue(undefined),
    onAddChore: vi.fn(),
    ...overrides,
  };
  render(
    <ToastProvider>
      <ChoresParentScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('ChoresParentScreen — loading + empty states', () => {
  it('renders a loading affordance (role=status) while the feed is loading', () => {
    renderScreen({ feed: { chores: [], loading: true, error: null, refresh: vi.fn() } });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a friendly empty message when there are no chores at all', () => {
    renderScreen({ feed: { chores: [], loading: false, error: null, refresh: vi.fn() } });
    expect(
      screen.getByText(/no chores|nothing|all caught up|add a chore/i),
    ).toBeInTheDocument();
  });
});

describe('ChoresParentScreen — approvals queue (complete chores)', () => {
  function withQueue() {
    return renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'c1', title: 'Vacuum', status: 'complete', assignedTo: 'uid-maya' }),
          mkChore({ id: 'p1', title: 'Pending one', status: 'pending', assignedTo: 'uid-ben' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('lists a complete chore in the approvals queue with Approve + Reject buttons', () => {
    withQueue();
    expect(screen.getByText('Vacuum')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reject|send back/i })).toBeInTheDocument();
  });

  it('does NOT put a pending (not-yet-complete) chore in the approvals queue', () => {
    withQueue();
    // Only one Approve button — the pending chore is not awaiting approval.
    expect(screen.getAllByRole('button', { name: /approve/i })).toHaveLength(1);
  });

  it('clicking Approve calls onApprove with the chore id and toasts the approve copy', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      onApprove,
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Vacuum', status: 'complete' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.getByText(CHORE_APPROVE_SUCCESS)).toBeInTheDocument());
  });
});

describe('ChoresParentScreen — reject flow requires a non-empty reason', () => {
  function withOneComplete(onReject = vi.fn().mockResolvedValue(undefined)) {
    renderScreen({
      onReject,
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Vacuum', status: 'complete' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    return onReject;
  }

  it('clicking Reject opens a reason text input', () => {
    withOneComplete();
    fireEvent.click(screen.getByRole('button', { name: /reject|send back/i }));
    expect(screen.getByRole('textbox', { name: /reason|why|send back/i })).toBeInTheDocument();
  });

  it('submitting a NON-EMPTY reason calls onReject with the chore id and reason, then toasts', async () => {
    const onReject = withOneComplete();
    fireEvent.click(screen.getByRole('button', { name: /reject|send back/i }));
    const reason = screen.getByRole('textbox', { name: /reason|why|send back/i });
    fireEvent.change(reason, { target: { value: 'Half the plates are dirty' } });
    // The confirm button inside the reject form (distinct from the row's Reject).
    fireEvent.click(screen.getByRole('button', { name: /send back|confirm|submit reason/i }));
    await waitFor(() =>
      expect(onReject).toHaveBeenCalledWith('c1', 'Half the plates are dirty'),
    );
    await waitFor(() => expect(screen.getByText(CHORE_REJECT_SUCCESS)).toBeInTheDocument());
  });

  it('does NOT call onReject when the reason is empty/whitespace (validation in the UI)', async () => {
    const onReject = withOneComplete();
    fireEvent.click(screen.getByRole('button', { name: /reject|send back/i }));
    const reason = screen.getByRole('textbox', { name: /reason|why|send back/i });
    fireEvent.change(reason, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /send back|confirm|submit reason/i }));
    // Give an erroneous call a chance to register, then assert it never happened.
    await Promise.resolve();
    expect(onReject).not.toHaveBeenCalled();
  });
});

describe('ChoresParentScreen — pending-approval count badge (derived selector)', () => {
  it('shows the count of complete chores awaiting approval', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'c1', status: 'complete' }),
          mkChore({ id: 'c2', status: 'complete' }),
          mkChore({ id: 'p', status: 'pending' }),
          mkChore({ id: 'a', status: 'approved' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // The queue heading carries the count "2" awaiting approval. Use a precise
    // matcher so a stray balance/date digit does not false-match.
    expect(screen.getByText(/\b2\b.*awaiting|awaiting.*\b2\b/i)).toBeInTheDocument();
  });
});

describe('ChoresParentScreen — per-member allowance balance chips (dynamic)', () => {
  it('shows a balance chip for EACH active member with their balance', () => {
    renderScreen();
    // Maya $38.50 and Ben $12.00 — precise money matchers (no digit false-match).
    expect(screen.getByText(/Maya/)).toBeInTheDocument();
    expect(screen.getByText(/\$38\.50/)).toBeInTheDocument();
    expect(screen.getByText(/Ben/)).toBeInTheDocument();
    expect(screen.getByText(/\$12\.00/)).toBeInTheDocument();
  });

  it('reflects a DIFFERENT roster (proves chips are derived from members, not hardcoded)', () => {
    renderScreen({
      members: [
        {
          id: 'uid-zoe',
          name: 'Zoe',
          role: 'member',
          familyId: 'fam-A',
          isActive: true,
          allowanceBalance: 5,
          theme: 'light',
        },
      ],
    });
    expect(screen.getByText(/Zoe/)).toBeInTheDocument();
    expect(screen.getByText(/\$5\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/Maya|Ben/)).not.toBeInTheDocument();
  });
});

describe('ChoresParentScreen — member filter tabs (dynamic; All + per-member)', () => {
  function withMixedRoster() {
    renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'm1', title: 'Maya chore', assignedTo: 'uid-maya', status: 'pending' }),
          mkChore({ id: 'b1', title: 'Ben chore', assignedTo: 'uid-ben', status: 'pending' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('renders an "All" tab plus one tab per active member (dynamic)', () => {
    withMixedRoster();
    expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /maya/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /ben/i })).toBeInTheDocument();
  });

  it('selecting a member tab filters the list to that member’s chores', () => {
    withMixedRoster();
    fireEvent.click(screen.getByRole('tab', { name: /maya/i }));
    expect(screen.getByText('Maya chore')).toBeInTheDocument();
    expect(screen.queryByText('Ben chore')).not.toBeInTheDocument();
  });

  it('the "All" tab shows every member’s chores', () => {
    withMixedRoster();
    fireEvent.click(screen.getByRole('tab', { name: /all/i }));
    expect(screen.getByText('Maya chore')).toBeInTheDocument();
    expect(screen.getByText('Ben chore')).toBeInTheDocument();
  });

  it('a member tab with NO chores shows a per-tab empty state', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'm1', title: 'Maya chore', assignedTo: 'uid-maya' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getByRole('tab', { name: /ben/i }));
    expect(screen.getByText(/no chores|nothing|all caught up|add a chore/i)).toBeInTheDocument();
    expect(screen.queryByText('Maya chore')).not.toBeInTheDocument();
  });

  it('the tabs are NOT hardcoded "Maya/Ben" — a different roster yields different tabs', () => {
    renderScreen({
      members: [
        {
          id: 'uid-zoe',
          name: 'Zoe',
          role: 'member',
          familyId: 'fam-A',
          isActive: true,
          allowanceBalance: 0,
          theme: 'light',
        },
      ],
      feed: {
        chores: [mkChore({ id: 'z1', title: 'Zoe chore', assignedTo: 'uid-zoe' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByRole('tab', { name: /zoe/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /maya|ben/i })).not.toBeInTheDocument();
  });
});

describe('ChoresParentScreen — FAB opens Add Chore', () => {
  it('renders a FAB / add-chore affordance that calls onAddChore', () => {
    const onAddChore = vi.fn();
    renderScreen({ onAddChore });
    fireEvent.click(screen.getByRole('button', { name: /add chore|new chore|add/i }));
    expect(onAddChore).toHaveBeenCalledTimes(1);
  });
});

describe('ChoresParentScreen — money precision (member-view matcher lesson)', () => {
  it('a member with $1.00 balance does not false-match against a chore pointValue of 1', () => {
    renderScreen({
      members: [
        {
          id: 'uid-one',
          name: 'Solo',
          role: 'member',
          familyId: 'fam-A',
          isActive: true,
          allowanceBalance: 1,
          theme: 'light',
        },
      ],
      feed: {
        chores: [mkChore({ id: 'c', title: 'A chore', pointValue: 1, dollarValue: 1, assignedTo: 'uid-one' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // The balance chip must render the money form "$1.00", distinct from "1 pts".
    expect(screen.getByText(/\$1\.00/)).toBeInTheDocument();
  });
});
