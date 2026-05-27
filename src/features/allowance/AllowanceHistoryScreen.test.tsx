/**
 * Allowance History screen — component contract (Allowance History feature;
 * ADR-0004). Mirrors ChoresMemberScreen.test.tsx / ChoresParentScreen.test.tsx.
 *
 * Level: component. Feed state + the selected member + "now" are INJECTED so the
 * screen renders deterministically without Firestore or the real clock. The
 * query scoping (per-member peer-leak guard) is covered by
 * useAllowanceHistory.test.tsx; the money formatter by choresParentService.test.
 *
 * FAILS today: AllowanceHistoryScreen is a declare-only contract stub.
 *
 * State traceability (designer-defined states):
 *  - loading        -> Skeleton (role=status, aria-busy)
 *  - empty          -> friendly EmptyState ("No allowance yet"-style)
 *  - error          -> generic toast (no raw Firebase text / no PII choreTitle)
 *  - balance (top)   -> formatMoney(balanceCents); non-finite -> indicator
 *  - list           -> reverse-chron, grouped by day; row: title, amount, <time>
 *  - parent picker  -> toggle <button aria-pressed> per child (member mode: none)
 *
 * Fixtures use DISTINCT amounts / titles / balances per row so a getByText /
 * within(row) matcher can only resolve to its intended node (lessons.md: avoid
 * money/value collisions; prefer scoped within(row) / getAllByText).
 *
 * Isolation: injected props + ToastProvider; no clock/network/RNG; each test
 * builds its own props (order-independent).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import type { UserWithId } from '../../lib/types';
import {
  AllowanceHistoryScreen,
  type AllowanceHistoryScreenProps,
} from './AllowanceHistoryScreen';
import { MONEY_INVALID_INDICATOR, type TransactionWithId } from './allowanceService';

// A fixed "now" so day grouping / relative dates are deterministic (no real
// clock). 2026-05-27 18:00:00Z.
const NOW_MS = Date.UTC(2026, 4, 27, 18, 0, 0);
// Three distinct calendar days (UTC noon to avoid TZ edge flips).
const DAY_TODAY = Date.UTC(2026, 4, 27, 12, 0, 0);
const DAY_YESTERDAY = Date.UTC(2026, 4, 26, 12, 0, 0);
const DAY_TWO_AGO = Date.UTC(2026, 4, 25, 12, 0, 0);

const MEMBER_VIEWER = { uid: 'uid-child-a', name: 'Maya Rivera', role: 'member' as const };
const PARENT_VIEWER = { uid: 'uid-parent-a', name: 'Dana Rivera', role: 'parent' as const };

function mkTxn(over: Partial<TransactionWithId> & { id: string }): TransactionWithId {
  return {
    uid: 'uid-child-a',
    choreId: 'chore-1',
    choreTitle: 'Take out the trash',
    amount: 300,
    type: 'earning',
    familyId: 'fam-A',
    createdAt: DAY_TODAY,
    ...over,
  };
}

function mkMember(over: Partial<UserWithId> & { id: string }): UserWithId {
  return {
    name: 'Member',
    role: 'member',
    familyId: 'fam-A',
    allowanceBalance: 0,
    isActive: true,
    theme: 'light',
    ...over,
  };
}

function renderScreen(overrides: Partial<AllowanceHistoryScreenProps> = {}) {
  const props: AllowanceHistoryScreenProps = {
    viewer: MEMBER_VIEWER,
    selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
    members: [],
    feed: {
      transactions: [],
      loading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    onSelectMember: vi.fn(),
    nowMs: NOW_MS,
    ...overrides,
  };
  render(
    <ToastProvider>
      <AllowanceHistoryScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('AllowanceHistoryScreen — loading state', () => {
  it('renders a loading affordance (role=status, aria-busy) while the feed is loading', () => {
    renderScreen({
      feed: { transactions: [], loading: true, error: null, refresh: vi.fn() },
    });
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('AllowanceHistoryScreen — empty state', () => {
  it('shows a friendly "no allowance yet" message when the ledger is empty (not blank)', () => {
    renderScreen({
      feed: { transactions: [], loading: false, error: null, refresh: vi.fn() },
    });
    expect(
      screen.getByText(/no allowance yet|nothing here yet|no earnings yet/i),
    ).toBeInTheDocument();
  });

  it('still shows the current balance at the top even when the ledger is empty', () => {
    // The balance and list are independent facts (ADR-0004): an empty list does
    // NOT imply a zero balance.
    renderScreen({
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
      feed: { transactions: [], loading: false, error: null, refresh: vi.fn() },
    });
    expect(screen.getByText(/\$38\.50/)).toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — current balance shown SEPARATELY at the top', () => {
  it('renders the selected member’s balance via formatMoney(balanceCents)', () => {
    renderScreen({
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 4215 },
    });
    expect(screen.getByText(/\$42\.15/)).toBeInTheDocument();
  });

  it('renders a zero balance as $0.00 (valid edge), not the invalid indicator', () => {
    renderScreen({
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 0 },
    });
    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
    expect(screen.queryByText(MONEY_INVALID_INDICATOR)).not.toBeInTheDocument();
  });

  it('renders a NON-FINITE balance as the invalid indicator, NOT a misleading "$0.00"', () => {
    renderScreen({
      selectedMember: {
        uid: 'uid-child-a',
        name: 'Maya Rivera',
        balanceCents: Number.NaN,
      },
    });
    expect(screen.getByText(MONEY_INVALID_INDICATOR)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it('the balance carries an accessible name that reads as the balance (not a lone number)', () => {
    renderScreen({
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
    });
    expect(
      screen.getByText((_content, el) => {
        if (el === null) return false;
        const label = el.getAttribute('aria-label') ?? '';
        return /balance/i.test(label) && /38\.50/.test(label);
      }),
    ).toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — transaction list (reverse-chron, grouped by day)', () => {
  // DISTINCT titles + amounts + days so each row resolves unambiguously.
  function renderList() {
    return renderScreen({
      feed: {
        transactions: [
          mkTxn({ id: 't-new', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
          mkTxn({ id: 't-mid', choreTitle: 'Wash dishes', amount: 225, createdAt: DAY_YESTERDAY }),
          mkTxn({ id: 't-old', choreTitle: 'Walk the dog', amount: 150, createdAt: DAY_TWO_AGO }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('renders a list with list semantics (role=list / <ul>)', () => {
    renderList();
    expect(screen.getAllByRole('list').length).toBeGreaterThan(0);
  });

  it('renders one row per transaction (3 list items)', () => {
    renderList();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('each row shows its chore title (distinct fixtures, no collision)', () => {
    renderList();
    expect(screen.getByText('Mow the lawn')).toBeInTheDocument();
    expect(screen.getByText('Wash dishes')).toBeInTheDocument();
    expect(screen.getByText('Walk the dog')).toBeInTheDocument();
  });

  it('each row shows its amount as a positive credit via formatMoney(amount)', () => {
    renderList();
    // Amounts are distinct so each resolves to exactly one node.
    expect(screen.getByText(/\$5\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$2\.25/)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.50/)).toBeInTheDocument();
  });

  it('scopes the amount to its OWN row (within(row) — no cross-row money collision)', () => {
    renderList();
    const mowRow = screen.getByText('Mow the lawn').closest('li');
    expect(mowRow, 'each transaction row must be a list item').not.toBeNull();
    expect(within(mowRow as HTMLElement).getByText(/\$5\.00/)).toBeInTheDocument();
    // The $5.00 amount must NOT appear in the "Wash dishes" row.
    const dishRow = screen.getByText('Wash dishes').closest('li') as HTMLElement;
    expect(within(dishRow).queryByText(/\$5\.00/)).not.toBeInTheDocument();
  });

  it('each row carries a <time dateTime> with the transaction date', () => {
    renderList();
    const times = document.querySelectorAll('time[datetime]');
    expect(times.length, 'every transaction row must carry a <time dateTime>').toBeGreaterThanOrEqual(
      3,
    );
    // The dateTime attribute is non-empty (a machine-readable date).
    times.forEach((t) => {
      expect((t.getAttribute('datetime') ?? '').length).toBeGreaterThan(0);
    });
  });

  it('orders rows reverse-chronologically (newest transaction first)', () => {
    renderList();
    const items = screen.getAllByRole('listitem');
    const text = items.map((li) => li.textContent ?? '');
    const idxNew = text.findIndex((t) => /Mow the lawn/.test(t));
    const idxMid = text.findIndex((t) => /Wash dishes/.test(t));
    const idxOld = text.findIndex((t) => /Walk the dog/.test(t));
    expect(idxNew).toBeGreaterThanOrEqual(0);
    expect(idxNew, 'newest (today) row must come before yesterday').toBeLessThan(idxMid);
    expect(idxMid, 'yesterday row must come before two-days-ago').toBeLessThan(idxOld);
  });

  it('groups transactions by day (a day heading exists for each distinct date)', () => {
    // Two transactions on the SAME day must sit under a single day group; rows on
    // different days under different groups. Use 2 same-day + 1 other-day.
    renderScreen({
      feed: {
        transactions: [
          mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
          mkTxn({ id: 't2', choreTitle: 'Wash dishes', amount: 225, createdAt: DAY_TODAY }),
          mkTxn({ id: 't3', choreTitle: 'Walk the dog', amount: 150, createdAt: DAY_YESTERDAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // There must be at least two distinct day-group headings (today vs yesterday)
    // — the list is grouped by day, not a flat undated list.
    const headings = screen.getAllByRole('heading');
    expect(
      headings.length,
      'a grouped-by-day list must render a day-group heading per distinct date',
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('AllowanceHistoryScreen — error state (generic, PII-free; A1: inline role=alert is the SOLE channel)', () => {
  // A1 channel decision (pinned here): the inline role="alert" region is the
  // SINGLE error surface; the load-error toast is DROPPED. The persistent,
  // visible/associated alert is preferred over a transient toast, and a single
  // channel avoids the assertive+polite double-announce. This test was
  // previously "surfaces a generic error toast" — it is rewritten so the
  // contract is now: inline alert shows the user-safe copy, and NO toast fires
  // for a load error.
  const SAFE_ERROR = 'We could not load the allowance history. Please try again.';

  it('shows the user-safe copy in the inline role="alert" (no raw Firebase text, no choreTitle PII)', async () => {
    renderScreen({
      feed: {
        transactions: [],
        loading: false,
        // The hook maps to user-safe copy; the screen must surface THAT, never a
        // raw code. We pass the safe copy and assert no raw/PII leaks.
        error: SAFE_ERROR,
        refresh: vi.fn(),
      },
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').toMatch(/could not load the allowance history/i);
    expect(alert.textContent ?? '').not.toMatch(/permission-denied|firestore|FirebaseError/i);
    // No PII (a child's name / a chore title) in the error surface.
    expect(alert.textContent ?? '').not.toMatch(/Maya|Mow the lawn|trash/i);
  });

  it('does NOT also fire a toast for the load error (single error channel — no double-announce)', () => {
    renderScreen({
      feed: { transactions: [], loading: false, error: SAFE_ERROR, refresh: vi.fn() },
    });
    // The inline alert is role="alert"; a toast is a SEPARATE role="status" live
    // region (ToastViewport/Toast). For a load error there must be NO toast: no
    // role="status" element carries the error copy. (A polite + assertive pair
    // announcing the same message is the A1 double-announce we are eliminating.)
    const statusRegions = screen.queryAllByRole('status');
    const toastWithError = statusRegions.find((el) =>
      /could not load the allowance history/i.test(el.textContent ?? ''),
    );
    expect(
      toastWithError,
      'a load error must surface ONLY via the inline role="alert"; the duplicate toast is dropped (A1)',
    ).toBeUndefined();
  });
});

describe('AllowanceHistoryScreen — honesty (ADR-0004: balance and list are independent)', () => {
  it('does NOT claim the list sums to / equals the balance', () => {
    renderScreen({
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
      feed: {
        transactions: [
          mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(
      screen.queryByText(/sums to|adds up to|total.*equals.*balance|equals your balance/i),
    ).not.toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — a11y', () => {
  it('a transaction row reads meaningfully ("Earned $X for <chore> on <date>")', () => {
    renderScreen({
      feed: {
        transactions: [
          mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // The row exposes an accessible sentence: it must include the verb "earned",
    // the amount, and the chore — not three disconnected fragments.
    const row = screen.getByText('Mow the lawn').closest('li') as HTMLElement;
    const label = row.getAttribute('aria-label') ?? row.textContent ?? '';
    expect(/earn(ed)?/i.test(label), 'row should read as "Earned ..."').toBe(true);
    expect(/\$5\.00/.test(label)).toBe(true);
    expect(/Mow the lawn/.test(label)).toBe(true);
  });

  it('any interactive control meets the 44px tap-target class (min-h-tap / min-w-tap)', () => {
    // In member mode the only candidate interactive control is the refresh
    // affordance, if present. Any interactive element rendered must carry the
    // tap-target class. (Parent picker tap targets are asserted in PARENT mode.)
    renderScreen({
      feed: {
        transactions: [
          mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const buttons = screen.queryAllByRole('button');
    buttons.forEach((b) => {
      expect(
        /min-h-tap|min-w-tap/.test(b.className),
        'every interactive control must carry a >=44px tap-target class',
      ).toBe(true);
    });
  });

  it('respects reduced motion (no class forcing animation without a motion-reduce guard)', () => {
    // Any animated element must pair its animation with a motion-reduce: guard,
    // so prefers-reduced-motion is honoured (AODA / WCAG). We assert no element
    // carries an animate-* class WITHOUT a matching motion-reduce:* token.
    renderScreen({
      feed: {
        transactions: [
          mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const animated = Array.from(document.querySelectorAll('[class*="animate-"]'));
    animated.forEach((el) => {
      expect(
        /motion-reduce:/.test(el.className),
        'an animated element must pair animate-* with a motion-reduce:* guard',
      ).toBe(true);
    });
  });
});

describe('AllowanceHistoryScreen — MEMBER mode (own ledger, NO picker)', () => {
  it('does NOT render a member picker for a member viewer (own ledger only)', () => {
    renderScreen({
      viewer: MEMBER_VIEWER,
      members: [
        mkMember({ id: 'uid-child-a', name: 'Maya Rivera' }),
        mkMember({ id: 'uid-child-b', name: 'Ben Rivera' }),
      ],
      feed: {
        transactions: [mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500 })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // No toggle button for picking a sibling — a member never sees a peer picker.
    expect(screen.queryByRole('button', { name: /ben rivera/i })).not.toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — PARENT mode (member picker)', () => {
  const MEMBERS = [
    mkMember({ id: 'uid-child-a', name: 'Maya Rivera', allowanceBalance: 3850 }),
    mkMember({ id: 'uid-child-b', name: 'Ben Rivera', allowanceBalance: 1200 }),
  ];

  function renderParent(overrides: Partial<AllowanceHistoryScreenProps> = {}) {
    return renderScreen({
      viewer: PARENT_VIEWER,
      members: MEMBERS,
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
      onSelectMember: vi.fn(),
      ...overrides,
    });
  }

  it('renders a member picker with a toggle button per child (accessible name identifies the child)', () => {
    renderParent();
    expect(screen.getByRole('button', { name: /maya rivera/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ben rivera/i })).toBeInTheDocument();
  });

  it('the picker buttons are toggle buttons exposing aria-pressed reflecting the selection', () => {
    renderParent();
    // Maya is the selected member -> pressed; Ben is not.
    expect(screen.getByRole('button', { name: /maya rivera/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /ben rivera/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('picking a different child calls onSelectMember with that child’s uid', () => {
    const onSelectMember = vi.fn();
    renderParent({ onSelectMember });
    fireEvent.click(screen.getByRole('button', { name: /ben rivera/i }));
    expect(onSelectMember).toHaveBeenCalledWith('uid-child-b');
  });

  it('the picker buttons are keyboard-reachable real <button>s with a >=44px tap target', () => {
    renderParent();
    const ben = screen.getByRole('button', { name: /ben rivera/i });
    expect(ben.tagName).toBe('BUTTON');
    ben.focus();
    expect(ben).toHaveFocus();
    expect(
      /min-h-tap|min-w-tap/.test(ben.className),
      'picker toggle must carry a >=44px tap-target class',
    ).toBe(true);
  });

  it('shows the SELECTED child’s balance + ledger (the injected feed is the selected child’s)', () => {
    // The parent has selected Maya; her balance + her ledger row show. The feed
    // injected is already the selected child's (the hook re-queries per uid —
    // covered by the hook test); the screen renders what it is given.
    renderParent({
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
      feed: {
        transactions: [mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500 })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText(/\$38\.50/)).toBeInTheDocument();
    expect(screen.getByText('Mow the lawn')).toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — F1: picker lists CHILDREN only, never parents (defensive)', () => {
  // Distinct identities so a toggle resolves to exactly one role.
  const PARENT_MEMBER = mkMember({
    id: 'uid-parent-a',
    name: 'Dana Rivera',
    role: 'parent',
    allowanceBalance: 999999,
  });
  const CHILD_A = mkMember({
    id: 'uid-child-a',
    name: 'Maya Rivera',
    role: 'member',
    allowanceBalance: 3850,
  });
  const CHILD_B = mkMember({
    id: 'uid-child-b',
    name: 'Ben Rivera',
    role: 'member',
    allowanceBalance: 1200,
  });

  function renderParentPicker(overrides: Partial<AllowanceHistoryScreenProps> = {}) {
    return renderScreen({
      viewer: PARENT_VIEWER,
      // The active-members list (filtered only by familyId+isActive upstream)
      // can contain a parent. The screen must defensively render toggles only
      // for role === 'member'.
      members: [PARENT_MEMBER, CHILD_A, CHILD_B],
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
      onSelectMember: vi.fn(),
      ...overrides,
    });
  }

  it('(a) renders NO picker toggle for a parent member', () => {
    renderParentPicker();
    expect(
      screen.queryByRole('button', { name: /dana rivera/i }),
      'a parent must never appear as a selectable member in the picker (F1)',
    ).not.toBeInTheDocument();
  });

  it('(a) still renders a toggle for each CHILD member', () => {
    renderParentPicker();
    expect(screen.getByRole('button', { name: /maya rivera/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ben rivera/i })).toBeInTheDocument();
  });

  it('(c) the top balance shown is the selected CHILD’s, not the parent’s huge balance', () => {
    renderParentPicker();
    // Maya (child) is selected -> $38.50. The parent's $9,999.99 must NOT show.
    expect(screen.getByText(/\$38\.50/)).toBeInTheDocument();
    expect(screen.queryByText(/\$9,?999\.99/)).not.toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — F2: no cross-child flash (rows must match the selected member uid)', () => {
  it('does NOT render a row whose uid !== selectedMember.uid (stale feed shows childB nothing, never childA rows)', () => {
    // Parent has switched to childB, but the injected feed still carries childA's
    // rows for one commit (the hook clears in a post-commit effect). The screen
    // must defensively gate rows on `uid === selectedMember.uid`, so childA's
    // earnings never render under childB.
    renderScreen({
      viewer: PARENT_VIEWER,
      members: [
        mkMember({ id: 'uid-child-a', name: 'Maya Rivera', role: 'member', allowanceBalance: 3850 }),
        mkMember({ id: 'uid-child-b', name: 'Ben Rivera', role: 'member', allowanceBalance: 1200 }),
      ],
      selectedMember: { uid: 'uid-child-b', name: 'Ben Rivera', balanceCents: 1200 },
      feed: {
        transactions: [
          // These belong to childA (uid-child-a), NOT the selected childB.
          mkTxn({
            id: 't-a1',
            uid: 'uid-child-a',
            choreTitle: 'Maya secret chore',
            amount: 777,
            createdAt: DAY_TODAY,
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // childA's row content must NOT leak under childB's name.
    expect(
      screen.queryByText('Maya secret chore'),
      'a mismatched-uid row must NEVER render under the newly-selected member (cross-child leak, F2)',
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\$7\.77/)).not.toBeInTheDocument();
    // With no rows for childB, the screen shows the empty state, not childA data.
    expect(
      screen.getByText(/no allowance yet|nothing here yet|no earnings yet/i),
    ).toBeInTheDocument();
  });

  it('DOES render rows whose uid === selectedMember.uid (the gate does not over-block the right child)', () => {
    renderScreen({
      viewer: PARENT_VIEWER,
      members: [
        mkMember({ id: 'uid-child-b', name: 'Ben Rivera', role: 'member', allowanceBalance: 1200 }),
      ],
      selectedMember: { uid: 'uid-child-b', name: 'Ben Rivera', balanceCents: 1200 },
      feed: {
        transactions: [
          mkTxn({
            id: 't-b1',
            uid: 'uid-child-b',
            choreTitle: 'Ben mows lawn',
            amount: 425,
            createdAt: DAY_TODAY,
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByText('Ben mows lawn')).toBeInTheDocument();
    expect(screen.getByText(/\$4\.25/)).toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — F3 (screen layer): a uid that matches no row shows no stale rows / no nameless header over a ledger', () => {
  it('a selectedMember whose uid matches none of the feed rows renders the empty state, never another member’s rows', () => {
    // Combined with F2's uid-gate: if the route falls back to a member whose uid
    // matches no row in the (stale) feed, the screen must show the empty state —
    // it must NOT render the stale rows beneath a fallback/blank header.
    renderScreen({
      viewer: PARENT_VIEWER,
      members: [
        mkMember({ id: 'uid-child-a', name: 'Maya Rivera', role: 'member', allowanceBalance: 3850 }),
      ],
      // Fallback resolved to childA, but the feed still holds a deactivated
      // child's (uid-gone) rows.
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
      feed: {
        transactions: [
          mkTxn({
            id: 't-gone',
            uid: 'uid-deactivated',
            choreTitle: 'Deactivated kid chore',
            amount: 600,
            createdAt: DAY_TODAY,
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(
      screen.queryByText('Deactivated kid chore'),
      'a deactivated/removed member’s ledger must not show beneath a fallback member (F3)',
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/no allowance yet|nothing here yet|no earnings yet/i),
    ).toBeInTheDocument();
  });
});

describe('AllowanceHistoryScreen — F4: day grouping uses the viewer’s LOCAL day, not UTC', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    // America/Los_Angeles: UTC-7 in late May (PDT). Restored in afterEach so we
    // never poison other suites.
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  // 2026-05-27 05:00 UTC === 2026-05-26 22:00 PDT (the prior LOCAL calendar day).
  const LATE_EVENING_LOCAL = Date.UTC(2026, 4, 27, 5, 0, 0);
  // 2026-05-27 04:30 UTC === 2026-05-26 21:30 PDT — SAME local evening as above,
  // DIFFERENT UTC clock minute, but still 2026-05-26 locally.
  const SAME_LOCAL_EVENING = Date.UTC(2026, 4, 27, 4, 30, 0);

  it('labels an evening earning under its LOCAL day (May 26), not the UTC day (May 27)', () => {
    renderScreen({
      feed: {
        transactions: [
          mkTxn({
            id: 't-evening',
            choreTitle: 'Evening dishes',
            amount: 300,
            createdAt: LATE_EVENING_LOCAL,
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const headings = screen.getAllByRole('heading').map((h) => h.textContent ?? '');
    expect(
      headings.some((h) => /\b26\b/.test(h) && /May/i.test(h)),
      'the evening earning must be grouped under the LOCAL day (May 26), not UTC May 27',
    ).toBe(true);
    expect(
      headings.some((h) => /May 27|27,/i.test(h)),
      'the earning must NOT be labelled under UTC May 27',
    ).toBe(false);
  });

  it('two earnings on the same LOCAL evening land in ONE day group (not split across two UTC days)', () => {
    renderScreen({
      feed: {
        transactions: [
          mkTxn({
            id: 't-e1',
            choreTitle: 'Evening dishes',
            amount: 300,
            createdAt: LATE_EVENING_LOCAL,
          }),
          mkTxn({
            id: 't-e2',
            choreTitle: 'Evening trash',
            amount: 200,
            createdAt: SAME_LOCAL_EVENING,
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // Day-group headings: exactly one (both are May 26 locally). The list <ul>s
    // are aria-labelled by the day; there must be a single day group.
    const dayHeadings = screen
      .getAllByRole('heading')
      .filter((h) => /May/i.test(h.textContent ?? ''));
    expect(
      dayHeadings,
      'two earnings on the same LOCAL day must share ONE day group',
    ).toHaveLength(1);
    // Both rows present under that single group.
    expect(screen.getByText('Evening dishes')).toBeInTheDocument();
    expect(screen.getByText('Evening trash')).toBeInTheDocument();
  });

  it('the <time dateTime> reflects the LOCAL day (ends with -26, not -27)', () => {
    renderScreen({
      feed: {
        transactions: [
          mkTxn({
            id: 't-evening',
            choreTitle: 'Evening dishes',
            amount: 300,
            createdAt: LATE_EVENING_LOCAL,
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const time = document.querySelector('time[datetime]');
    expect(time, 'the row must carry a <time dateTime>').not.toBeNull();
    expect(
      time?.getAttribute('datetime'),
      'the machine-readable date must be the LOCAL day 2026-05-26, not UTC 2026-05-27',
    ).toBe('2026-05-26');
  });
});

describe('AllowanceHistoryScreen — F5: row amount goes through the same validity gate as the balance', () => {
  function renderWithAmount(amount: number, id = 't-amt') {
    return renderScreen({
      feed: {
        transactions: [
          mkTxn({ id, choreTitle: 'Gate me', amount, createdAt: DAY_TODAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
  }

  it('a NON-FINITE row amount renders the invalid indicator, never "$NaN"', () => {
    renderWithAmount(Number.NaN);
    const row = screen.getByText('Gate me').closest('li') as HTMLElement;
    expect(within(row).queryByText(/\$NaN/i)).not.toBeInTheDocument();
    expect(within(row).getAllByText(MONEY_INVALID_INDICATOR).length).toBeGreaterThan(0);
  });

  it('a NEGATIVE row amount renders the invalid indicator, never "-$x"', () => {
    renderWithAmount(-500);
    const row = screen.getByText('Gate me').closest('li') as HTMLElement;
    expect(within(row).queryByText(/-\s*\$/)).not.toBeInTheDocument();
    expect(within(row).getAllByText(MONEY_INVALID_INDICATOR).length).toBeGreaterThan(0);
  });

  it('an OVER-MAX row amount renders the invalid indicator, never a giant dollar value', () => {
    // MONEY_MAX_CENTS is 100_000_000 ($1,000,000). One cent over is invalid.
    renderWithAmount(100000001);
    const row = screen.getByText('Gate me').closest('li') as HTMLElement;
    expect(within(row).queryByText(/\$1,000,000\.01/)).not.toBeInTheDocument();
    expect(within(row).getAllByText(MONEY_INVALID_INDICATOR).length).toBeGreaterThan(0);
  });

  it('a WELL-FORMED row amount still renders via formatMoney (gate does not break valid rows)', () => {
    renderWithAmount(425);
    const row = screen.getByText('Gate me').closest('li') as HTMLElement;
    expect(within(row).getByText(/\$4\.25/)).toBeInTheDocument();
  });

  it('the accessible row sentence degrades for an invalid amount (never reads "Earned $NaN")', () => {
    renderWithAmount(Number.NaN);
    const row = screen.getByText('Gate me').closest('li') as HTMLElement;
    const name = (row.getAttribute('aria-label') ?? '') + ' ' + (row.textContent ?? '');
    expect(
      /\$NaN/i.test(name),
      'an invalid amount must not read "$NaN" in the accessible sentence (F5/A2)',
    ).toBe(false);
  });
});

describe('AllowanceHistoryScreen — A2: row exposes a robust accessible name (not an aria-label on a bare div)', () => {
  it('the row’s coherent sentence ("Earned $X for <chore> on <date>") is exposed as real text, not only a div aria-label', () => {
    renderScreen({
      feed: {
        transactions: [
          mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const li = screen.getByText('Mow the lawn').closest('li') as HTMLElement;
    expect(li).not.toBeNull();
    // Robust mechanism: the coherent sentence must exist as readable TEXT inside
    // the listitem (e.g. an sr-only <span>), OR as the accessible name on a
    // semantic element — not solely an aria-label on a non-semantic <div>.
    const sentenceNode = within(li).queryByText(
      (content) =>
        /earn(ed)?/i.test(content) && /\$5\.00/.test(content) && /Mow the lawn/i.test(content),
    );
    // The decorative div MUST NOT be the only carrier: assert a same-element
    // text node carries the full sentence.
    expect(
      sentenceNode,
      'the row must expose its full sentence as real text (sr-only span), not only via a div aria-label (A2)',
    ).not.toBeNull();
  });

  it('the row sentence is NOT carried by an aria-label on a non-semantic <div>', () => {
    renderScreen({
      feed: {
        transactions: [
          mkTxn({ id: 't1', choreTitle: 'Mow the lawn', amount: 500, createdAt: DAY_TODAY }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const li = screen.getByText('Mow the lawn').closest('li') as HTMLElement;
    const bareDivWithLabel = Array.from(li.querySelectorAll('div[aria-label]')).find((d) =>
      /earn(ed)?/i.test(d.getAttribute('aria-label') ?? ''),
    );
    expect(
      bareDivWithLabel,
      'the accessible sentence must not live on an aria-label of a non-semantic <div> (dropped by some AT) — A2',
    ).toBeUndefined();
  });
});

describe('AllowanceHistoryScreen — A3: picker wrapper is a labelled group', () => {
  it('the picker wrapper exposes a labelled group role (role="group" or fieldset), not a roleless div', () => {
    renderScreen({
      viewer: PARENT_VIEWER,
      members: [
        mkMember({ id: 'uid-child-a', name: 'Maya Rivera', role: 'member', allowanceBalance: 3850 }),
        mkMember({ id: 'uid-child-b', name: 'Ben Rivera', role: 'member', allowanceBalance: 1200 }),
      ],
      selectedMember: { uid: 'uid-child-a', name: 'Maya Rivera', balanceCents: 3850 },
    });
    // The label "Choose a family member" must be exposed via a group/fieldset, so
    // assistive tech announces the picker as a labelled group.
    const group = screen.getByRole('group', { name: /choose a family member/i });
    expect(group).toBeInTheDocument();
    // The child toggles live inside the labelled group.
    expect(within(group as HTMLElement).getByRole('button', { name: /maya rivera/i })).toBeInTheDocument();
  });
});
