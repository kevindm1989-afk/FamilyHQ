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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  // INTEGER CENTS per ADR-0009. 3850 cents == $38.50. A prior fixture used the
  // float 38.5 (dollars), which only worked because the local formatMoney was
  // also typed-as-dollars — both halves of the bug paired up to display the
  // wrong value as the "right" value. Cents is the canonical convention.
  allowanceBalance: 3850,
};

function mkChore(over: Partial<ChoreWithId> & { id: string }): ChoreWithId {
  return {
    title: 'Take out the trash',
    assignedTo: 'uid-member-a',
    dueDate: '2026-05-30',
    pointValue: 10,
    // INTEGER CENTS per ADR-0009. 300 cents == $3.00.
    dollarValue: 300,
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
    onViewHistory: vi.fn(),
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
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 3850 } });
    // The balance is shown as currency. Pin the value, not the exact element.
    expect(screen.getByText(/\$?38\.50/)).toBeInTheDocument();
  });

  it('shows a zero balance as $0.00 (edge: new member, never NaN/blank)', () => {
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 0 } });
    expect(screen.getByText(/\$?0\.00/)).toBeInTheDocument();
  });

  // REGRESSION pin (PR: kid-side cents-vs-dollars). The local formatMoney in
  // ChoresMemberScreen.tsx used to treat the input as DOLLARS, displaying
  // $800.00 for a chore stored as 800 cents (= $8.00). Same bug on the
  // allowance-balance chip. Pin both directions of the conversion so a
  // future refactor can't reintroduce the 100× display drift.
  it('formats an 800-cent reward as $8.00 (not $800.00) — cents-vs-dollars regression', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', pointValue: 8, dollarValue: 800 })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/\$8\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/\$800\.00/), 'must NOT display 100x the stored value').toBeNull();
  });

  it('formats an 80000-cent balance as $800.00 (not $80,000) — cents-vs-dollars regression', () => {
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 80000 } });
    expect(screen.getByText(/\$800\.00/)).toBeInTheDocument();
    expect(
      screen.queryByText(/\$80,000\.00|\$80000\.00/),
      'must NOT display 100x the stored cents balance',
    ).toBeNull();
  });

  it('does NOT render a computed "earned this month" sum (deferred — depends on the ledger)', () => {
    // The transactions ledger is not built yet; the screen must not fabricate a
    // monthly total. A static "View history" affordance is allowed, but no
    // "earned this month" dollar figure derived from transactions.
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 3850 } });
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
        chores: [mkChore({ id: 'c1', pointValue: 10, dollarValue: 300 })],
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
        chores: [mkChore({ id: 'c1', title: 'Mow lawn', status: 'approved', dollarValue: 500 })],
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
    // Resolve inside act() so the downstream re-render (clearing the
    // in-flight flag) commits inside an act boundary. Without the wrap the
    // setState lands after the test returns and React logs an "update to
    // ChoresMemberScreen inside a test was not wrapped in act(...)" warning.
    await act(async () => {
      d.resolve();
    });
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
    // Resolve inside act() — see the comment in the previous test for the
    // rationale (avoids the post-test out-of-act setState warning).
    await act(async () => {
      d.resolve();
    });
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

  it('a rejected chore gets a "Try again" redo button (NOT the "Mark done" pending affordance)', () => {
    // Lifecycle decision (Phase 3, Task 11): a member CAN redo a rejected chore
    // (rejected -> complete). The rejected section now carries a "Try again"
    // button — distinct from the pending section's "Mark done" so the two
    // affordances are not conflated.
    renderRejected('Socks are still on the floor');
    expect(screen.getByRole('button', { name: /try again|redo|resubmit/i })).toBeInTheDocument();
    // It is NOT labelled "Mark done" (that label belongs to the pending bucket).
    expect(
      screen.queryByRole('button', { name: /^mark done$|^mark complete$/i }),
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
    renderScreen({ viewer: { ...VIEWER, allowanceBalance: 3850 } });
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

  it('the "View history" control is now ENABLED (no longer the aria-disabled "coming soon" placeholder)', () => {
    // Allowance History shipped: the deferred placeholder becomes a live control.
    renderScreen();
    const viewHistory = screen.getByText(/view history/i);
    const el = viewHistory.closest('button, a') ?? viewHistory;
    // Must NOT be aria-disabled and must NOT be a disabled <button>.
    expect(
      el.getAttribute('aria-disabled'),
      '"View history" must no longer be aria-disabled once Allowance History ships',
    ).not.toBe('true');
    if (el.tagName === 'BUTTON') {
      expect((el as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it('clicking "View history" navigates to allowance history (calls onViewHistory)', () => {
    const onViewHistory = vi.fn();
    renderScreen({ onViewHistory });
    const viewHistory = screen.getByText(/view history/i);
    const el = (viewHistory.closest('button, a') ?? viewHistory) as HTMLElement;
    fireEvent.click(el);
    expect(onViewHistory).toHaveBeenCalledTimes(1);
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
          onViewHistory={vi.fn()}
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
          onViewHistory={vi.fn()}
        />
      </ToastProvider>,
    );

    const waitingHeading = screen.getByRole('heading', { name: /waiting for approval/i });
    await waitFor(() => expect(waitingHeading).toHaveFocus());
  });
});

/**
 * The redo loop (Phase 3, Task 11; lifecycle decision): a member CAN re-attempt
 * a REJECTED chore (rejected -> complete). The rejected section gains a "Try
 * again" button that calls onMarkComplete (the SAME action the pending bucket
 * uses — the rules now permit BOTH pending->complete and rejected->complete) and
 * toasts; after the redo the chore moves to the waiting-for-approval section.
 * The rejection reason stays visible. These FAIL today: the rejected section is
 * currently action-less (the member screen pre-dates this decision).
 */
describe('ChoresMemberScreen — "Try again" redo on a rejected chore (rejected -> complete)', () => {
  function renderRejected(onMarkComplete = vi.fn().mockResolvedValue(undefined)) {
    renderScreen({
      onMarkComplete,
      feed: {
        chores: [
          mkChore({
            id: 'rej',
            title: 'Fold laundry',
            status: 'rejected',
            rejectionReason: 'Socks are still on the floor',
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    return onMarkComplete;
  }

  it('shows a "Try again" button on a rejected chore', () => {
    renderRejected();
    expect(screen.getByRole('button', { name: /try again|redo|resubmit/i })).toBeInTheDocument();
  });

  it('clicking "Try again" calls onMarkComplete with the chore id (rejected -> complete)', async () => {
    const onMarkComplete = renderRejected();
    fireEvent.click(screen.getByRole('button', { name: /try again|redo|resubmit/i }));
    await waitFor(() => expect(onMarkComplete).toHaveBeenCalledWith('rej'));
  });

  it('toasts the complete-success copy after a successful redo (toast-everything)', async () => {
    renderRejected(vi.fn().mockResolvedValue(undefined));
    fireEvent.click(screen.getByRole('button', { name: /try again|redo|resubmit/i }));
    await waitFor(() => expect(screen.getByText(CHORE_COMPLETE_SUCCESS)).toBeInTheDocument());
  });

  it('keeps the rejection reason visible alongside the "Try again" affordance', () => {
    renderRejected();
    expect(screen.getByText(/Socks are still on the floor/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again|redo|resubmit/i })).toBeInTheDocument();
  });

  it('after a redo the chore is shown under "Waiting for approval", not the rejected section', async () => {
    // The feed flips the chore to complete after the redo resolves (the hook
    // re-snapshots in production); the screen must move it into the waiting
    // bucket and out of the rejected section.
    const onMarkComplete = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ToastProvider>
        <ChoresMemberScreen
          familyId="fam-A"
          viewer={VIEWER}
          feed={{
            chores: [
              mkChore({
                id: 'rej',
                title: 'Fold laundry',
                status: 'rejected',
                rejectionReason: 'Socks are still on the floor',
              }),
            ],
            loading: false,
            error: null,
            refresh: vi.fn().mockResolvedValue(undefined),
          }}
          onMarkComplete={onMarkComplete}
          onViewHistory={vi.fn()}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /try again|redo|resubmit/i }));
    await waitFor(() => expect(onMarkComplete).toHaveBeenCalledWith('rej'));

    rerender(
      <ToastProvider>
        <ChoresMemberScreen
          familyId="fam-A"
          viewer={VIEWER}
          feed={{
            chores: [mkChore({ id: 'rej', title: 'Fold laundry', status: 'complete' })],
            loading: false,
            error: null,
            refresh: vi.fn().mockResolvedValue(undefined),
          }}
          onMarkComplete={onMarkComplete}
          onViewHistory={vi.fn()}
        />
      </ToastProvider>,
    );
    // Target the SECTION HEADING specifically — under vitest 3 the success
    // toast ("Marked complete — waiting for approval") may still be in the
    // DOM during the assertion window, so getByText(/waiting for approval/i)
    // matches both the toast and the heading. Querying by role + name
    // disambiguates to the heading we actually care about.
    expect(
      screen.getByRole('heading', { name: /waiting for approval/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Fold laundry')).toBeInTheDocument();
    // The rejected section heading is gone (no rejected chore remains).
    expect(
      screen.queryByRole('heading', { name: /needs another try|sent back|^rejected$/i }),
    ).not.toBeInTheDocument();
  });

  it('the "Try again" button accessible name identifies the chore (not a bare "Try again")', () => {
    renderRejected();
    expect(
      screen.getByRole('button', { name: /try again.*fold laundry|fold laundry.*try again/i }),
    ).toBeInTheDocument();
  });
});
