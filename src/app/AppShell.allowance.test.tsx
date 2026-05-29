/**
 * AppShell — Allowance route wiring contract (Allowance History fix wave;
 * adversarial findings F1/F3).
 *
 * Level: integration (renders AppShell + the real in-memory router at the
 * allowance route). useFamily / useAuth are mocked so the shell renders
 * deterministically without Firebase; the live ledger feed (useAllowanceHistory)
 * is mocked to a settled, empty feed so no Firestore is touched and the screen's
 * row gate (covered in AllowanceHistoryScreen.test.tsx) is not re-exercised here.
 *
 * Pins:
 *  - F1(b/c): the PARENT route default-selects a CHILD (role === 'member'),
 *    never a parent, even when the parent sorts first in the members list — so
 *    the default identity + top balance are a child's, not a parent's.
 *  - F3: when the selected/default member cannot resolve to a valid CHILD (e.g.
 *    the only members are parents, or the selected child was removed), the route
 *    must NOT render a NAMELESS header over a (NaN/garbage) balance — it falls
 *    back to a valid child or an empty/safe state.
 *
 * FAILS today: ParentAllowanceRoute defaults to `members[0]` (any role) and
 * renders `selected?.name ?? ''` with `allowanceBalance ?? NaN`, so a parent can
 * be the default identity and a missing selection yields a nameless NaN header.
 *
 * Isolation: each test sets the mutable family fixture before render; in-memory
 * router seeded at the route under test; no clock/network/RNG; mocks cleared
 * afterEach (order-independent).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../lib/types';

const parentUser: UserWithId = {
  id: 'uid-parent-a',
  name: 'Dana Rivera',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 999999, // a parent's balance must never become the header
  theme: 'light',
};
const childA: UserWithId = {
  id: 'uid-child-a',
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

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
};

vi.mock('../hooks/useFamily', () => ({
  useFamily: () => familyState,
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    authUser: { uid: familyState.currentUser?.id ?? 'anon' },
    loading: false,
    signOut: vi.fn(),
  }),
}));

// The allowance route subscribes to the per-member ledger; mock it to an empty,
// settled feed so no Firestore is touched (the per-member query scoping is
// covered by useAllowanceHistory.test.tsx and is NOT regressed here).
vi.mock('../features/allowance/useAllowanceHistory', () => ({
  useAllowanceHistory: () => ({ transactions: [], loading: false, error: null, refresh: vi.fn() }),
}));

import { ToastProvider } from '../hooks/useToast';
import { AppShell } from './AppShell';
import { ROUTES } from './routes';

async function renderAt(path: string) {
  const r = render(
    <ToastProvider>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>
    </ToastProvider>,
  );
  // Wait for the React.lazy route chunk to resolve — the RouteFallback
  // renders a Skeleton labelled "Loading…". See AppShell.dashboard.test.tsx
  // for the rationale; per-feature lazy splits landed in feature/per-route-splits.
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading…')).not.toBeInTheDocument();
  });
  return r;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell — ParentAllowanceRoute default selection (F1: default-select a CHILD, never a parent)', () => {
  it('default-selects a CHILD even when a parent sorts first in the members list', async () => {
    // Parent is first; the route must still default the picker to a child.
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser, childA, childB],
      loading: false,
    };
    await renderAt(ROUTES.allowance.path);

    // The selected toggle (aria-pressed=true) must be a CHILD, not the parent.
    const pressed = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length, 'exactly one member should be selected by default').toBe(1);
    expect(
      /maya rivera|ben rivera/i.test(pressed[0]?.textContent ?? ''),
      'the default-selected member must be a CHILD, never the parent (F1)',
    ).toBe(true);
    expect(/dana rivera/i.test(pressed[0]?.textContent ?? '')).toBe(false);
  });

  it('shows the default CHILD’s balance at the top, never the parent’s balance', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser, childA, childB],
      loading: false,
    };
    await renderAt(ROUTES.allowance.path);

    // A child's balance ($38.50 or $12.00) — not the parent's $9,999.99.
    expect(
      screen.queryByText(/\$9,?999\.99/),
      'the top balance must never be the parent’s balance (F1 wrong-identity / NaN)',
    ).not.toBeInTheDocument();
    const childBalanceShown =
      screen.queryByText(/\$38\.50/) !== null || screen.queryByText(/\$12\.00/) !== null;
    expect(childBalanceShown, 'the top balance must be the default child’s balance').toBe(true);
  });

  it('does not render a parent as a selectable picker toggle', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser, childA, childB],
      loading: false,
    };
    await renderAt(ROUTES.allowance.path);
    expect(screen.queryByRole('button', { name: /dana rivera/i })).not.toBeInTheDocument();
  });
});

describe('AppShell — ParentAllowanceRoute fallback (F3: no nameless header over a NaN balance)', () => {
  it('when NO child can be resolved (only parents in the family), the header is not a nameless NaN header', async () => {
    // The active-members list resolves to no child. The route must not render a
    // blank-name header over a NaN/garbage balance with a ledger beneath it.
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser], // no child members
      loading: false,
    };
    await renderAt(ROUTES.allowance.path);

    // A nameless header over the invalid-money indicator (NaN balance -> "—") is
    // the F3 failure shape. There must be no "$NaN" anywhere, and the parent's
    // own balance must not be surfaced as a selectable child's ledger.
    expect(screen.queryByText(/\$NaN/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/\$9,?999\.99/),
      'a parent must not become the resolved member when no child exists (F3)',
    ).not.toBeInTheDocument();
    // No parent toggle is offered as the selectable child.
    expect(screen.queryByRole('button', { name: /dana rivera/i })).not.toBeInTheDocument();
  });

  it('resolves the default to a CHILD when both a parent and children are present (resolvable fallback)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser, childB], // parent first, one child
      loading: false,
    };
    await renderAt(ROUTES.allowance.path);

    // The resolvable fallback must pick the child (Ben), not the parent.
    const pressed = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBe(1);
    expect(/ben rivera/i.test(pressed[0]?.textContent ?? '')).toBe(true);
    expect(screen.getByText(/\$12\.00/)).toBeInTheDocument();
  });
});
