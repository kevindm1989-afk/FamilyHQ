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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { ChoresParentScreen, type ChoresParentScreenProps } from './ChoresParentScreen';
import {
  CHORE_APPROVE_SUCCESS,
  CHORE_REJECT_SUCCESS,
  MONEY_INVALID_INDICATOR,
} from './choresParentService';
import type { ChoreWithId } from './choresMemberService';
import type { UserWithId } from '../../lib/types';

/** A controllable promise so a test can hold an injected action "in flight" and
 * resolve it deterministically — no timers, no real network. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// MONEY IS INTEGER CENTS (second-opinion #4 / Finding 7): allowanceBalance and a
// chore's dollarValue are whole cents. $38.50 -> 3850, $12.00 -> 1200, $3.00 ->
// 300. The screen formats cents to "$X.XX" only for display (formatMoney).
const MEMBERS: UserWithId[] = [
  {
    id: 'uid-maya',
    name: 'Maya',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 3850, // $38.50 in cents
    theme: 'light',
  },
  {
    id: 'uid-ben',
    name: 'Ben',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 1200, // $12.00 in cents
    theme: 'light',
  },
];

function mkChore(over: Partial<ChoreWithId> & { id: string }): ChoreWithId {
  return {
    title: 'Take out the trash',
    assignedTo: 'uid-maya',
    dueDate: '2026-05-30',
    pointValue: 10, // integer POINTS
    dollarValue: 300, // integer CENTS — $3.00
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
          allowanceBalance: 500, // $5.00 in cents
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

  // A11y CHANGE (BLOCKER fix): the filter "tabs" are now real TOGGLE BUTTONS with
  // aria-pressed={selected}, NOT role=tab/tablist. A tablist is a composite widget
  // requiring full arrow-key + roving-tabindex semantics; here each filter must be
  // INDIVIDUALLY focusable and announced as a toggle. So these tests query by
  // role=button + accessible name (the prior role=tab assertions are replaced).
  it('renders an "All" filter plus one filter per active member (dynamic), as toggle buttons (NOT role=tab)', () => {
    withMixedRoster();
    expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /maya/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ben/i })).toBeInTheDocument();
    // The old composite-widget roles must be GONE (individually-focusable buttons).
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('each member filter is a toggle button exposing aria-pressed reflecting selection', () => {
    withMixedRoster();
    const maya = screen.getByRole('button', { name: /maya/i });
    // Default: "All" selected, so Maya's toggle is not pressed.
    expect(maya).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(maya);
    expect(maya).toHaveAttribute('aria-pressed', 'true');
    // "All" is now unpressed.
    expect(screen.getByRole('button', { name: /all/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('selecting a member filter shows that member’s chores', () => {
    withMixedRoster();
    fireEvent.click(screen.getByRole('button', { name: /maya/i }));
    expect(screen.getByText('Maya chore')).toBeInTheDocument();
    expect(screen.queryByText('Ben chore')).not.toBeInTheDocument();
  });

  it('the "All" filter shows every member’s chores', () => {
    withMixedRoster();
    fireEvent.click(screen.getByRole('button', { name: /all/i }));
    expect(screen.getByText('Maya chore')).toBeInTheDocument();
    expect(screen.getByText('Ben chore')).toBeInTheDocument();
  });

  it('a member filter with NO chores shows a per-filter empty state', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'm1', title: 'Maya chore', assignedTo: 'uid-maya' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /ben/i }));
    expect(screen.getByText(/no chores|nothing|all caught up|add a chore/i)).toBeInTheDocument();
    expect(screen.queryByText('Maya chore')).not.toBeInTheDocument();
  });

  it('the filters are NOT hardcoded "Maya/Ben" — a different roster yields different filters', () => {
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
    expect(screen.getByRole('button', { name: /zoe/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /maya|ben/i })).not.toBeInTheDocument();
  });

  it('each member filter button carries the min-w-tap (44px) tap-target class', () => {
    withMixedRoster();
    expect(screen.getByRole('button', { name: /maya/i }).className).toMatch(/min-w-tap/);
    expect(screen.getByRole('button', { name: /all/i }).className).toMatch(/min-w-tap/);
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
  it('a member with $1.00 balance (100 cents) does not false-match against a chore pointValue of 1', () => {
    renderScreen({
      members: [
        {
          id: 'uid-one',
          name: 'Solo',
          role: 'member',
          familyId: 'fam-A',
          isActive: true,
          allowanceBalance: 100, // $1.00 in cents
          theme: 'light',
        },
      ],
      feed: {
        chores: [
          mkChore({
            id: 'c',
            title: 'A chore',
            pointValue: 1,
            dollarValue: 250, // $2.50 — distinct from the $1.00 balance so /\$1\.00/ matches only the chip
            assignedTo: 'uid-one',
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // The balance chip must render the money form "$1.00", distinct from "1 pts".
    // Precise matcher: a stray pointValue digit "1" must never satisfy "$1.00".
    expect(screen.getByText(/\$1\.00/)).toBeInTheDocument();
  });
});

// =====================================================================
// Finding 4 (adversarial): a parent card MISLABELS the dollar reward as
// "points". Pin: each chore card shows the dollar reward as FORMATTED MONEY
// ("$3.00") in VISIBLE text, labelled as a DOLLAR reward (NOT "points"); the
// point value shows SEPARATELY as points. Money is integer cents -> formatMoney.
// =====================================================================
describe('ChoresParentScreen — Finding 4: dollar reward shown as money, NOT mislabeled "points"', () => {
  function withOnePending() {
    return renderScreen({
      members: [
        {
          id: 'uid-maya',
          name: 'Maya',
          role: 'member',
          familyId: 'fam-A',
          // Balance distinct from the chore reward so a chip cannot satisfy the
          // card-reward assertion (and vice-versa): $99.99 vs the chore's $3.00.
          isActive: true,
          allowanceBalance: 9999,
          theme: 'light',
        },
      ],
      feed: {
        chores: [
          mkChore({
            id: 'c1',
            title: 'Vacuum',
            status: 'pending',
            assignedTo: 'uid-maya',
            pointValue: 10,
            dollarValue: 300, // $3.00 in cents
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('the chore card shows the dollar reward as VISIBLE formatted money "$3.00"', () => {
    withOnePending();
    const card = screen.getByText('Vacuum').closest('div')!;
    // The card itself carries the visible "$3.00" money text (not only an
    // aria-label). Scope to the card so the $99.99 balance chip can't satisfy it.
    expect(within(card).getByText(/\$3\.00/)).toBeInTheDocument();
  });

  it('the dollar reward is NOT labelled "points" / "pts" (Finding 4 mislabel)', () => {
    withOnePending();
    const card = screen.getByText('Vacuum').closest('div')!;
    // The text node carrying the money "$3.00" must not also read "reward
    // points"/"pts" — that is the mislabel. The "$3.00" element's text content
    // must be money only.
    const money = within(card).getByText(/\$3\.00/);
    expect(money.textContent ?? '').not.toMatch(/points|pts/i);
    // There must be NO visible "3 reward points"-style mislabel for the dollars.
    expect(within(card).queryByText(/3 reward points?/i)).not.toBeInTheDocument();
  });

  it('the point value shows SEPARATELY as points (10 pts), distinct from the money', () => {
    withOnePending();
    const card = screen.getByText('Vacuum').closest('div')!;
    // Points render as "10 pts"/"10 points" — and 10 is NOT the dollar figure.
    expect(within(card).getByText(/10\s*(pts|points)/i)).toBeInTheDocument();
  });
});

// =====================================================================
// Finding 3 (adversarial): the in-flight guard must be PER-CHORE, not global.
// =====================================================================
describe('ChoresParentScreen — Finding 3: per-row in-flight guard (not global)', () => {
  function twoComplete(onApprove: (id: string) => Promise<void>) {
    return renderScreen({
      onApprove,
      feed: {
        chores: [
          mkChore({ id: 'row1', title: 'Row One', status: 'complete', assignedTo: 'uid-maya' }),
          mkChore({ id: 'row2', title: 'Row Two', status: 'complete', assignedTo: 'uid-ben' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  function approveButtonFor(title: string): HTMLElement {
    const row = screen.getByText(title).closest('li')!;
    return within(row).getByRole('button', { name: /approve/i });
  }

  it('a stuck (never-resolving) Approve on row 1 does NOT block Approve on row 2', async () => {
    const d1 = deferred();
    const onApprove = vi.fn((id: string) => (id === 'row1' ? d1.promise : Promise.resolve()));
    twoComplete(onApprove);

    // Row 1 approve starts and never resolves (held in flight).
    fireEvent.click(approveButtonFor('Row One'));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('row1'));

    // Row 2 approve must STILL fire — the guard is per-chore, not global.
    fireEvent.click(approveButtonFor('Row Two'));
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('row2'));

    d1.resolve(); // cleanup the held promise
  });

  it('only the IN-FLIGHT row reflects aria-busy while ITS action runs (row 2 stays idle)', async () => {
    const d1 = deferred();
    const onApprove = vi.fn((id: string) => (id === 'row1' ? d1.promise : Promise.resolve()));
    twoComplete(onApprove);

    fireEvent.click(approveButtonFor('Row One'));
    // Row 1's Approve is busy; row 2's Approve is not.
    await waitFor(() =>
      expect(approveButtonFor('Row One')).toHaveAttribute('aria-busy', 'true'),
    );
    expect(approveButtonFor('Row Two')).not.toHaveAttribute('aria-busy', 'true');

    d1.resolve();
    // After the row-1 action settles, its own busy state clears.
    await waitFor(() =>
      expect(approveButtonFor('Row One')).not.toHaveAttribute('aria-busy', 'true'),
    );
  });

  it('clicking the SAME in-flight row Approve twice does not double-invoke (per-row guard)', async () => {
    const d1 = deferred();
    const onApprove = vi.fn((id: string) => (id === 'row1' ? d1.promise : Promise.resolve()));
    twoComplete(onApprove);
    fireEvent.click(approveButtonFor('Row One'));
    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
    // Second click while row 1 is still in flight is a no-op for THAT row.
    fireEvent.click(approveButtonFor('Row One'));
    expect(onApprove).toHaveBeenCalledTimes(1);
    d1.resolve();
  });
});

// =====================================================================
// Finding 8 (adversarial): a NON-FINITE allowanceBalance must render a DISTINCT
// indicator (e.g. "—" with an aria-label), NOT a misleading "$0.00".
// =====================================================================
describe('ChoresParentScreen — Finding 8: non-finite balance shows a distinct indicator (not "$0.00")', () => {
  function withBalance(balance: number) {
    return renderScreen({
      members: [
        {
          id: 'uid-nan',
          name: 'Nia',
          role: 'member',
          familyId: 'fam-A',
          isActive: true,
          allowanceBalance: balance,
          theme: 'light',
        },
      ],
    });
  }

  it('a NaN balance renders the distinct invalid indicator, NOT "$0.00"', () => {
    withBalance(Number.NaN);
    expect(screen.getByText(MONEY_INVALID_INDICATOR)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('an Infinity balance renders the distinct invalid indicator, NOT "$0.00"', () => {
    withBalance(Number.POSITIVE_INFINITY);
    expect(screen.getByText(MONEY_INVALID_INDICATOR)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('the invalid indicator carries an aria-label so AT does not announce a bare dash', () => {
    withBalance(Number.NaN);
    // The indicator (or its labelled wrapper) must expose an accessible name —
    // a bare "—" is meaningless to a screen reader.
    const indicator = screen.getByText(MONEY_INVALID_INDICATOR);
    const labelled = indicator.closest('[aria-label]');
    expect(labelled, 'the invalid-balance indicator must have an aria-label').not.toBeNull();
  });

  it('a genuine $0.00 balance (0 cents) still renders "$0.00", not the invalid indicator', () => {
    withBalance(0);
    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
  });
});

// =====================================================================
// A11y — Approve/Reject accessible names include the assignee member (so an
// AT user knows WHOSE chore they are approving when several rows are present).
// =====================================================================
describe('ChoresParentScreen — a11y: Approve/Reject names include the chore + member', () => {
  function withTwoMembersComplete() {
    return renderScreen({
      feed: {
        chores: [
          mkChore({ id: 'c1', title: 'Vacuum', status: 'complete', assignedTo: 'uid-maya' }),
          mkChore({ id: 'c2', title: 'Dishes', status: 'complete', assignedTo: 'uid-ben' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('the Approve button name includes the chore title AND the assignee name', () => {
    withTwoMembersComplete();
    expect(
      screen.getByRole('button', { name: /approve.*vacuum.*maya|approve.*maya.*vacuum/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /approve.*dishes.*ben|approve.*ben.*dishes/i }),
    ).toBeInTheDocument();
  });

  it('the Reject button name includes the chore title AND the assignee name', () => {
    withTwoMembersComplete();
    expect(
      screen.getByRole('button', { name: /(reject|send back).*vacuum.*maya|(reject|send back).*maya.*vacuum/i }),
    ).toBeInTheDocument();
  });

  it('Approve/Reject buttons carry the min-w-tap (44px) tap-target class', () => {
    withTwoMembersComplete();
    const approve = screen.getAllByRole('button', { name: /approve/i })[0]!;
    const reject = screen.getAllByRole('button', { name: /reject|send back/i })[0]!;
    expect(approve.className).toMatch(/min-w-tap/);
    expect(reject.className).toMatch(/min-w-tap/);
  });
});

// =====================================================================
// A11y — the Reject reason field + the reject disclosure.
// =====================================================================
describe('ChoresParentScreen — a11y: reject reason field + disclosure semantics', () => {
  function withOneComplete(onReject = vi.fn().mockResolvedValue(undefined)) {
    renderScreen({
      onReject,
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Vacuum', status: 'complete', assignedTo: 'uid-maya' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    return onReject;
  }

  function rowRejectButton(): HTMLElement {
    const row = screen.getByText('Vacuum').closest('li')!;
    return within(row).getByRole('button', { name: /reject|send back/i });
  }

  it('the reject toggle button exposes aria-expanded (false before, true after reveal) + aria-controls', () => {
    withOneComplete();
    const toggle = rowRejectButton();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls, 'reject toggle must reference the reason region via aria-controls').toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // aria-controls must point at an element that now exists (the reason region).
    expect(document.getElementById(controls!)).not.toBeNull();
  });

  it('the reason input uses its VISIBLE <label> as accessible name (no aria-label override) and is aria-required', () => {
    withOneComplete();
    fireEvent.click(rowRejectButton());
    // The visible label "Why are you sending it back?" is the accessible name —
    // NOT a generic aria-label "Reason" override.
    const input = screen.getByRole('textbox', { name: /why are you sending it back/i });
    expect(input).toHaveAttribute('aria-required', 'true');
    // No aria-label override is present (the label association is the a11y name).
    expect(input).not.toHaveAttribute('aria-label');
  });

  it('confirming with an EMPTY reason sets aria-invalid + an associated aria-describedby error (not a silent no-op)', async () => {
    const onReject = withOneComplete();
    fireEvent.click(rowRejectButton());
    const input = screen.getByRole('textbox', { name: /why are you sending it back/i });
    // Confirm with no reason.
    fireEvent.click(screen.getByRole('button', { name: /send back|confirm|submit reason/i }));
    await Promise.resolve();
    // Not a silent no-op: the field is flagged invalid and an error is associated.
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy, 'an empty-reason confirm must associate an error via aria-describedby').toBeTruthy();
    const errorEl = document.getElementById(describedBy!.split(/\s+/)[0]!);
    expect(errorEl, 'the aria-describedby error element must exist').not.toBeNull();
    expect((errorEl?.textContent ?? '').length).toBeGreaterThan(0);
    // And onReject is still NOT called for the empty reason.
    expect(onReject).not.toHaveBeenCalled();
  });

  it('focus moves INTO the reason input when the reject disclosure is revealed', () => {
    withOneComplete();
    fireEvent.click(rowRejectButton());
    const input = screen.getByRole('textbox', { name: /why are you sending it back/i });
    expect(document.activeElement, 'focus must move into the revealed reason input').toBe(input);
  });

  it('the confirm "send back" button carries min-w-tap', () => {
    withOneComplete();
    fireEvent.click(rowRejectButton());
    const confirm = screen.getByRole('button', { name: /send back|confirm|submit reason/i });
    expect(confirm.className).toMatch(/min-w-tap/);
  });
});

// =====================================================================
// A11y — aria-busy on Approve/Reject while their action is in flight.
// =====================================================================
describe('ChoresParentScreen — a11y: aria-busy while an action is in flight', () => {
  it('Approve carries aria-busy while onApprove is pending, and clears after it resolves', async () => {
    const d = deferred();
    const onApprove = vi.fn(() => d.promise);
    renderScreen({
      onApprove,
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Vacuum', status: 'complete', assignedTo: 'uid-maya' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const approve = screen.getByRole('button', { name: /approve/i });
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toHaveAttribute('aria-busy', 'true'));
    d.resolve();
    await waitFor(() => expect(approve).not.toHaveAttribute('aria-busy', 'true'));
  });
});

// =====================================================================
// A11y — focus moves to the "N awaiting approval" heading after a row is
// removed by a successful approve/reject (so focus is not stranded).
// =====================================================================
describe('ChoresParentScreen — a11y: focus moves to the awaiting heading after a row is resolved', () => {
  it('the "N awaiting approval" heading is programmatically focusable (tabIndex -1)', () => {
    renderScreen({
      feed: {
        chores: [mkChore({ id: 'c1', title: 'Vacuum', status: 'complete', assignedTo: 'uid-maya' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const heading = screen.getByRole('heading', { name: /awaiting approval/i });
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('after a successful approve, focus moves to the awaiting-approval heading (not stranded)', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      onApprove,
      feed: {
        chores: [
          mkChore({ id: 'c1', title: 'Vacuum', status: 'complete', assignedTo: 'uid-maya' }),
          mkChore({ id: 'c2', title: 'Dishes', status: 'complete', assignedTo: 'uid-ben' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /approve/i })[0]!);
    await waitFor(() => expect(onApprove).toHaveBeenCalled());
    const heading = screen.getByRole('heading', { name: /awaiting approval/i });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
