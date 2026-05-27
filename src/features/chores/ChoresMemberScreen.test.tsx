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
import {
  CHORE_COMPLETE_SUCCESS,
  CHORE_GENERIC_ERROR,
  ChoreActionError,
  type ChoreWithId,
} from './choresMemberService';

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
    expect(screen.getByText(/\$3\.00/)).toBeInTheDocument();
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

/**
 * Deferred-promise helper: hold an onMarkComplete write IN FLIGHT so a second
 * rapid click happens while the first has not resolved. No timers/clock — the
 * promise resolves only when we call `resolve()`.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('ChoresMemberScreen — mark-complete in-flight guard (double-click bug)', () => {
  it('disables the Mark done button while a mark-complete is in flight (aria-disabled or disabled)', async () => {
    const d = deferred();
    const onMarkComplete = vi.fn().mockReturnValue(d.promise);
    renderScreen({
      onMarkComplete,
      feed: {
        chores: [mkChore({ id: 'c1', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const btn = screen.getByRole('button', { name: /mark .*done|mark complete/i });
    fireEvent.click(btn);
    // While in flight the button must be non-actionable to a screen reader and
    // pointer alike — either the disabled property or aria-disabled="true".
    await waitFor(() => {
      const ariaDisabled = btn.getAttribute('aria-disabled') === 'true';
      const domDisabled = (btn as HTMLButtonElement).disabled === true;
      expect(
        ariaDisabled || domDisabled,
        'in-flight Mark done must be disabled or aria-disabled="true"',
      ).toBe(true);
    });
    d.resolve();
  });

  it('a SECOND rapid click does NOT invoke onMarkComplete again while the first is in flight', async () => {
    const d = deferred();
    const onMarkComplete = vi.fn().mockReturnValue(d.promise);
    renderScreen({
      onMarkComplete,
      feed: {
        chores: [mkChore({ id: 'c1', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const btn = screen.getByRole('button', { name: /mark .*done|mark complete/i });
    fireEvent.click(btn);
    fireEvent.click(btn); // second rapid click — must be ignored
    await waitFor(() => expect(onMarkComplete).toHaveBeenCalledTimes(1));
    // Give any erroneous second call a chance to register, then re-assert.
    expect(onMarkComplete).toHaveBeenCalledTimes(1);
    d.resolve();
  });

  it('a double-clicked Mark done shows the success toast and NEVER the scary error toast', async () => {
    // Model the real bug: the FIRST write succeeds (chore -> complete); a SECOND
    // write (if it fired) hits a now-complete chore and REJECTS, surfacing the
    // generic error toast. The guard must stop the second invocation, so only
    // the success copy is ever announced — the error copy must NEVER appear.
    const d = deferred();
    let call = 0;
    const onMarkComplete = vi.fn(() => {
      call += 1;
      // First call resolves on demand; any second call rejects immediately (the
      // chore is already complete server-side).
      return call === 1 ? d.promise : Promise.reject(new ChoreActionError());
    });
    renderScreen({
      onMarkComplete,
      feed: {
        chores: [mkChore({ id: 'c1', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const btn = screen.getByRole('button', { name: /mark .*done|mark complete/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    d.resolve();
    await waitFor(() => expect(screen.getByText(CHORE_COMPLETE_SUCCESS)).toBeInTheDocument());
    expect(onMarkComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CHORE_GENERIC_ERROR)).not.toBeInTheDocument();
  });
});

// Build a rejected chore, omitting rejectionReason entirely when absent (so the
// "no reason" case is a genuinely missing field, not an explicit undefined —
// exactOptionalPropertyTypes is on).
function mkRejected(id: string, title: string, reason: string | undefined): ChoreWithId {
  const base = { id, title, status: 'rejected' as const };
  return reason === undefined ? mkChore(base) : mkChore({ ...base, rejectionReason: reason });
}

describe('ChoresMemberScreen — rejected chore gets its OWN section (not "To do")', () => {
  function renderRejected(reason: string | undefined) {
    return renderScreen({
      feed: {
        chores: [mkRejected('rej', 'Fold laundry', reason)],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('renders a rejected chore under its OWN section heading, NOT under "To do"', () => {
    renderRejected('Socks are still on the floor');
    // The rejected chore lives under a distinct heading (e.g. "Needs another
    // try" / "Sent back"), separate from the pending "To do" bucket.
    const rejectedHeading = screen.getByRole('heading', {
      name: /needs another try|sent back|try again|rejected/i,
    });
    expect(rejectedHeading).toBeInTheDocument();
    // A "To do" heading must NOT exist when the only chore is rejected — the
    // rejected chore must not be miscategorised as pending work.
    expect(screen.queryByRole('heading', { name: /^to do$/i })).not.toBeInTheDocument();
  });

  it('a rejected chore still shows its rejectionReason in its own section', () => {
    renderRejected('Socks are still on the floor');
    expect(screen.getByText(/Socks are still on the floor/)).toBeInTheDocument();
  });

  it('a rejected chore does NOT get a Mark done button (re-submit flow is deferred)', () => {
    renderRejected('Socks are still on the floor');
    expect(
      screen.queryByRole('button', { name: /mark .*done|mark complete/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps a pending chore under "To do" while a rejected chore sits in its own section', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'p', title: 'Pending task', status: 'pending' }),
          mkChore({ id: 'r', title: 'Rejected task', status: 'rejected', rejectionReason: 'redo' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // The pending "To do" section exists; the rejected one is separate.
    expect(screen.getByRole('heading', { name: /^to do$/i })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /needs another try|sent back|try again|rejected/i }),
    ).toBeInTheDocument();
    // Only the pending chore has a Mark done button.
    expect(screen.getAllByRole('button', { name: /mark .*done|mark complete/i })).toHaveLength(1);
  });
});

describe('ChoresMemberScreen — rejected reason robustness (no empty red paragraph)', () => {
  function renderRejected(reason: string | undefined) {
    renderScreen({
      feed: {
        chores: [mkRejected('rej', 'Fold laundry', reason)],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  // The robustness contract: an absent/empty/whitespace reason must NOT produce
  // a bare empty danger-coloured paragraph. The chosen, PINNED fallback is the
  // visible line "No reason given." (a sensible fallback, not nothing) so the
  // rejection is still legible. A real reason renders verbatim.
  const FALLBACK = /no reason given|sent back without a note|no note/i;

  it('a rejected chore with NO rejectionReason shows a sensible fallback line, not an empty paragraph', () => {
    renderRejected(undefined);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  });

  it('a rejected chore with an EMPTY-STRING reason shows the fallback, not an empty paragraph', () => {
    renderRejected('');
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  });

  it('a rejected chore with a WHITESPACE-ONLY reason shows the fallback, not the blank string', () => {
    renderRejected('   \n\t  ');
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  });

  it('a rejected chore with a REAL reason shows that reason verbatim (not the fallback)', () => {
    renderRejected('Half the plates are still dirty');
    expect(screen.getByText('Half the plates are still dirty')).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — unknown/out-of-enum status stays coherent', () => {
  // Adversarial: a chore arrives with a status outside the ChoreStatus enum
  // (stale cache / future schema). PINNED behavior: it is EXCLUDED from the
  // "has chores" check — so when the ONLY chore is unknown-status, the screen
  // shows the friendly empty state rather than claiming chores exist while
  // rendering nothing in any section. It must never silently count as "has
  // chores" yet appear in no section (an invisible, inconsistent screen).
  function renderUnknownOnly() {
    renderScreen({
      feed: {
        chores: [
          mkChore({
            id: 'weird',
            title: 'Mystery chore',
            // deliberately out-of-enum — cast through unknown to bypass the union
            status: 'archived' as unknown as ChoreWithId['status'],
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('an out-of-enum status does NOT count as "has chores" (screen stays the empty state, not a blank list)', () => {
    renderUnknownOnly();
    expect(
      screen.getByText(/no chores|all caught up|nothing to do|you're all set/i),
    ).toBeInTheDocument();
  });

  it('an out-of-enum status is not rendered as a phantom row with a Mark done button', () => {
    renderUnknownOnly();
    expect(
      screen.queryByRole('button', { name: /mark .*done|mark complete/i }),
    ).not.toBeInTheDocument();
  });
});

describe('ChoresMemberScreen — accessibility (a11y findings)', () => {
  it('the due date is VISIBLE text inside the <time> element (not only in the attribute)', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', dueDate: '2026-05-30', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const time = document.querySelector('time[datetime="2026-05-30"]');
    expect(time, 'a <time datetime> element must exist for the due date').not.toBeNull();
    // Sighted users must SEE the friendly date; it cannot live only in the
    // attribute / aria-label. The <time> element must have non-empty visible text.
    expect((time?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('the due date <time> visible text is the friendly date (May 2026), not the raw ISO digits only', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', dueDate: '2026-05-30', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const time = document.querySelector('time[datetime="2026-05-30"]');
    expect((time?.textContent ?? '')).toMatch(/May/);
  });

  it('the rejection reason is programmatically associated with the chore (aria-describedby or a visible "sent back" label)', () => {
    renderScreen({
      feed: {
        chores: [
          mkChore({
            id: 'rej',
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
    const reason = screen.getByText('Half the plates are still dirty');
    // Association is satisfied by EITHER: the chore title points at the reason
    // via aria-describedby, OR the reason carries a visible "why it was sent
    // back" label so it is self-describing.
    const title = screen.getByText('Dishes');
    const describedBy = title.getAttribute('aria-describedby');
    const associatedById =
      describedBy != null && reason.id !== '' && describedBy.split(/\s+/).includes(reason.id);
    const hasVisibleLabel =
      screen.queryByText(/why it was sent back|sent back|reason/i) !== null;
    expect(
      associatedById || hasVisibleLabel,
      'rejection reason must be associated via aria-describedby OR carry a visible "sent back" label',
    ).toBe(true);
  });

  it('the Mark done button accessible name identifies the chore (not a bare "Mark done")', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Walk the dog', status: 'pending' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // The accessible name must include the chore title so a screen-reader user
    // hearing several "Mark done" buttons can tell them apart.
    expect(
      screen.getByRole('button', { name: /mark .*walk the dog.* done|walk the dog/i }),
    ).toBeInTheDocument();
  });

  it('the balance has an accessible name that reads as the balance, not a bare number', () => {
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 38.5 } });
    // The amount element exposes a meaningful accessible name like
    // "Your balance $38.50", so it is not announced as a lone "$38.50".
    expect(
      screen.getByText((_content, el) => {
        if (el === null) return false;
        const label = el.getAttribute('aria-label') ?? '';
        return /your balance/i.test(label) && /38\.50/.test(label);
      }),
    ).toBeInTheDocument();
  });

  it('the "View history" placeholder is aria-disabled (coming soon), not an actionable no-op', () => {
    renderScreen();
    const viewHistory = screen.getByText(/view history/i);
    const el = viewHistory.closest('button, a') ?? viewHistory;
    expect(
      el.getAttribute('aria-disabled'),
      '"View history" must be aria-disabled (coming soon) so it is not a silent no-op',
    ).toBe('true');
  });
});

describe('ChoresMemberScreen — focus after mark-complete (jsdom best-effort; real-AT is a launch gate)', () => {
  it('moves focus to a sensible target after a chore moves out of the To-do section', async () => {
    // When a pending chore is marked complete it leaves the "To do" section, so
    // its Mark done button is unmounted; focus must NOT be lost to <body>. The
    // PINNED target is a focusable "Waiting for approval" heading. NOTE: focus
    // restoration after async DOM change is only loosely observable in jsdom;
    // the authoritative check is a real-AT pass at launch (flagged).
    const d = deferred();
    const onMarkComplete = vi.fn().mockReturnValue(d.promise);
    const { rerender } = render(
      <ToastProvider>
        <ChoresMemberScreen
          familyId="fam-A"
          viewer={VIEWER}
          feed={{
            chores: [mkChore({ id: 'c1', title: 'Walk the dog', status: 'pending' })],
            loading: false,
            error: null,
            refresh: vi.fn().mockResolvedValue(undefined),
          }}
          onMarkComplete={onMarkComplete}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /mark .*done|mark complete/i }));
    d.resolve();
    await waitFor(() => expect(onMarkComplete).toHaveBeenCalled());

    // The feed flips the chore to complete (the hook re-snapshots in production).
    rerender(
      <ToastProvider>
        <ChoresMemberScreen
          familyId="fam-A"
          viewer={VIEWER}
          feed={{
            chores: [mkChore({ id: 'c1', title: 'Walk the dog', status: 'complete' })],
            loading: false,
            error: null,
            refresh: vi.fn().mockResolvedValue(undefined),
          }}
          onMarkComplete={onMarkComplete}
        />
      </ToastProvider>,
    );

    const waitingHeading = screen.getByRole('heading', { name: /waiting for approval/i });
    await waitFor(() => expect(waitingHeading).toHaveFocus());
  });
});
