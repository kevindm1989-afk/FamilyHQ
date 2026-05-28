/**
 * AppShell — Dashboard route wiring contract (Phase 4, Dashboard feature).
 *
 * Level: integration (renders AppShell + the real in-memory router at `/`).
 * useFamily / useAuth are mocked so the shell renders deterministically without
 * Firebase; every live feed hook is mocked to a settled feed and SPIED so we can
 * assert the exact scoping arguments AppShell passes.
 *
 * Pins:
 *  - The `/` route renders the real DashboardScreen, NOT the Placeholder
 *    ("Coming soon" / "Welcome, …" note).
 *  - Role gating (ADR-0002, cosmetic): a member viewer renders member sections
 *    (balance + own chores); a parent viewer renders Approvals and NOT a
 *    balance/own-chores section.
 *  - SCOPING (the privacy pin): the member wiring calls the per-uid scoped hooks
 *    with the member's OWN uid (no peer/family-wide leak of a member's personal
 *    chores/ledger): useMyChores(ownUid, familyId) and
 *    useAllowanceHistory(ownUid, familyId). Parent approvals come from
 *    useFamilyChores(familyId).
 *  - onRefresh triggers every feed's refresh().
 *
 * FAILS today: the `/` route renders <Placeholder> (AppShell.tsx), so the
 * DashboardScreen is never mounted and the scoped hooks are never wired.
 *
 * Isolation: each test sets the mutable family fixture + clears spies before
 * render; in-memory router seeded at `/`; no clock/network/RNG.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../lib/types';

const memberUser: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya Rivera',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 3850, // $38.50 — distinct money surface
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

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
};

// Spies that record the args each feed hook is called with (scoping assertions).
const refreshMyChores = vi.fn();
const refreshFamilyChores = vi.fn();
const refreshEvents = vi.fn();
const refreshPosts = vi.fn();
const refreshAllowance = vi.fn();

const useMyChores = vi.fn((_uid: string | null, _familyId: string | null) => ({
  chores: [],
  loading: false,
  error: null,
  refresh: refreshMyChores,
}));
const useFamilyChores = vi.fn((_familyId: string | null) => ({
  chores: [],
  loading: false,
  error: null,
  refresh: refreshFamilyChores,
}));
const useFamilyEvents = vi.fn((_familyId: string | null) => ({
  events: [],
  loading: false,
  error: null,
  refresh: refreshEvents,
}));
const useFamilyPosts = vi.fn((_familyId: string | null) => ({
  posts: [],
  loading: false,
  error: null,
  refresh: refreshPosts,
}));
const useAllowanceHistory = vi.fn((_uid: string | null, _familyId: string | null) => ({
  transactions: [],
  loading: false,
  error: null,
  refresh: refreshAllowance,
}));

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
vi.mock('../features/chores/useMyChores', () => ({ useMyChores: (...a: [string | null, string | null]) => useMyChores(...a) }));
vi.mock('../features/chores/useFamilyChores', () => ({ useFamilyChores: (...a: [string | null]) => useFamilyChores(...a) }));
vi.mock('../features/calendar/useFamilyEvents', () => ({ useFamilyEvents: (...a: [string | null]) => useFamilyEvents(...a) }));
vi.mock('../features/board/useFamilyPosts', () => ({ useFamilyPosts: (...a: [string | null]) => useFamilyPosts(...a) }));
vi.mock('../features/allowance/useAllowanceHistory', () => ({
  useAllowanceHistory: (...a: [string | null, string | null]) => useAllowanceHistory(...a),
}));

import { ToastProvider } from '../hooks/useToast';
import { AppShell } from './AppShell';
import { ROUTES } from './routes';

function renderAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  refreshMyChores.mockClear();
  refreshFamilyChores.mockClear();
  refreshEvents.mockClear();
  refreshPosts.mockClear();
  refreshAllowance.mockClear();
  useMyChores.mockClear();
  useFamilyChores.mockClear();
  useFamilyEvents.mockClear();
  useFamilyPosts.mockClear();
  useAllowanceHistory.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell — `/` renders the real DashboardScreen, not the Placeholder', () => {
  it('renders the real DashboardScreen (sections + refresh) at `/`, not the Placeholder note', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
    renderAt(ROUTES.dashboard.path);
    // The Placeholder renders an <h1> + a bare "N members in your family." note
    // and NO section regions / refresh control. The real DashboardScreen renders
    // section landmarks and a single refresh control — assert on what ONLY the
    // real screen produces, so a lingering Placeholder fails this test.
    expect(screen.queryByText(/members? in your family/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getAllByRole('region').length).toBeGreaterThanOrEqual(3);
  });
});

describe('AppShell — Dashboard role gating (cosmetic per ADR-0002)', () => {
  it('a MEMBER viewer renders the balance + own-chores member sections', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
    renderAt(ROUTES.dashboard.path);
    expect(screen.getByText(/current balance/i)).toHaveTextContent(/\$38\.50/);
    expect(screen.getByRole('region', { name: /my chores/i })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /approval/i })).not.toBeInTheDocument();
  });

  it('a PARENT viewer renders Approvals and NOT a balance/own-chores section', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser, memberUser],
      loading: false,
    };
    renderAt(ROUTES.dashboard.path);
    expect(screen.getByRole('region', { name: /approval/i })).toBeInTheDocument();
    expect(screen.queryByText(/current balance/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /my chores/i })).not.toBeInTheDocument();
  });
});

describe('AppShell — Dashboard hook scoping (privacy: own-uid, never family-wide for a member)', () => {
  it('a MEMBER wires the per-uid scoped hooks with the member’s OWN uid + familyId', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
    renderAt(ROUTES.dashboard.path);

    // Own chores: scoped to (ownUid, familyId) — never a family-wide query.
    expect(useMyChores).toHaveBeenCalledWith('uid-member-a', 'fam-A');
    // Own ledger: scoped to (ownUid, familyId) — never a peer's uid.
    expect(useAllowanceHistory).toHaveBeenCalledWith('uid-member-a', 'fam-A');
    // A member must NOT subscribe to the family-wide chore feed (parent-only).
    expect(useFamilyChores).not.toHaveBeenCalled();
  });

  it('a PARENT sources approvals from the family-wide chore feed, not a member ledger', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser, memberUser],
      loading: false,
    };
    renderAt(ROUTES.dashboard.path);

    expect(useFamilyChores).toHaveBeenCalledWith('fam-A');
    // The parent dashboard has no own-balance section, so no per-member ledger.
    expect(useAllowanceHistory).not.toHaveBeenCalled();
  });
});

describe('AppShell — Dashboard refresh fans out to every feed', () => {
  it('clicking refresh triggers each wired member feed’s refresh()', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
    renderAt(ROUTES.dashboard.path);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refreshMyChores).toHaveBeenCalled();
    expect(refreshAllowance).toHaveBeenCalled();
    expect(refreshEvents).toHaveBeenCalled();
    expect(refreshPosts).toHaveBeenCalled();
  });
});
