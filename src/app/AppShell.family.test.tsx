/**
 * AppShell — Family Management route wiring contract (Phase 4 — Family
 * Management feature, parent-only at `/family`).
 *
 * Level: integration (renders AppShell + the real in-memory router at
 * `/family`). useFamily / useAuth are mocked so the shell renders
 * deterministically without Firebase; useAllFamilyMembers + the
 * familyManagementService boundary are mocked + spied so we can assert the
 * exact arguments AppShell passes through to the service.
 *
 * Pins:
 *  - The `/family` route renders the real FamilyManagementScreen, NOT the
 *    existing <Placeholder title="Family" />.
 *  - guard('family', …): a MEMBER viewer is BOUNCED off `/family` (the route
 *    is parent-only); a PARENT viewer sees the screen.
 *  - The screen receives `viewer = currentUser` and `members = allMembers`
 *    from the new all-members hook.
 *  - Action wiring at the SERVICE boundary: a Rename action invokes
 *    familyManagementService.renameMember(uid, newName); a (de)activate
 *    invokes familyManagementService.setMemberActive(uid, isActive).
 *  - onRefresh triggers the all-members hook's refresh().
 *  - Self-deactivation: even at the wiring level, no Deactivate control
 *    exists on the viewer's own row.
 *
 * FAILS today: AppShell.tsx renders `<Placeholder title="Family"/>` for the
 * `/family` route; the screen + hook + service stubs throw 'not implemented'.
 *
 * Isolation: each test sets the mutable family fixture + clears spies
 * before render; in-memory router seeded at the route under test; no clock /
 * network / RNG.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../lib/types';

const parentViewer: UserWithId = {
  id: 'uid-parent-viewer',
  name: 'Sarah Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const coParent: UserWithId = {
  id: 'uid-parent-co',
  name: 'Alex Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const activeChild: UserWithId = {
  id: 'uid-child-active',
  name: 'Maya Kim',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 3850,
  theme: 'light',
};
const inactiveChild: UserWithId = {
  id: 'uid-child-inactive',
  name: 'Ben Kim',
  role: 'member',
  familyId: 'fam-A',
  isActive: false,
  allowanceBalance: 1275,
  theme: 'light',
};
const memberViewer: UserWithId = {
  id: 'uid-member-viewer',
  name: 'Maya Rivera',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

// --- Mutable family-state fixture each test sets before render ---
let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
};

// Mock the lazy firebase/config import so FamilyManagementRoute's resolveDb()
// returns a non-null db shim. Without this the Sec1 null-short-circuit fires
// before the service spies are reached. Sibling Sec1 test pins the opposite
// (factory throws -> resolveDb returns null -> spies NOT called).
vi.mock('../firebase/config', () => ({ db: { __db: true } }));

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

// The other route feeds — empty, settled so unrelated routes do not touch Firebase.
vi.mock('../features/chores/useMyChores', () => ({
  useMyChores: () => ({ chores: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../features/chores/useFamilyChores', () => ({
  useFamilyChores: () => ({ chores: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../features/calendar/useFamilyEvents', () => ({
  useFamilyEvents: () => ({ events: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../features/board/useFamilyPosts', () => ({
  useFamilyPosts: () => ({ posts: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../features/allowance/useAllowanceHistory', () => ({
  useAllowanceHistory: () => ({
    transactions: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// --- The all-family-members hook + the service boundary (spies for wiring) ---
const refreshAllMembers = vi.fn();
const useAllFamilyMembersMock = vi.fn(
  (_familyId: string | null): {
    members: UserWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  } => ({
    members: familyState.role === 'parent' ? [parentViewer, coParent, activeChild, inactiveChild] : [],
    loading: false,
    error: null,
    refresh: refreshAllMembers,
  }),
);
vi.mock('../features/family/useAllFamilyMembers', () => ({
  useAllFamilyMembers: (familyId: string | null) => useAllFamilyMembersMock(familyId),
}));

const renameMemberSpy = vi.fn(async (_deps: unknown, _uid: string, _name: string) => undefined);
const setMemberActiveSpy = vi.fn(
  async (_deps: unknown, _uid: string, _isActive: boolean) => undefined,
);
vi.mock('../features/family/familyManagementService', async () => {
  // Preserve the real exports for constants (success copy, error class, name cap)
  // so the screen's success-toast / validation assertions work end-to-end while
  // the two action functions are spied at the wiring seam.
  const actual = await vi.importActual<
    typeof import('../features/family/familyManagementService')
  >('../features/family/familyManagementService');
  return {
    ...actual,
    renameMember: (deps: unknown, uid: string, name: string) => renameMemberSpy(deps, uid, name),
    setMemberActive: (deps: unknown, uid: string, isActive: boolean) =>
      setMemberActiveSpy(deps, uid, isActive),
  };
});

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
  // Wait for the React.lazy route chunk to resolve — RouteFallback Skeleton
  // label is "Loading…". See AppShell.dashboard.test.tsx for rationale.
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading…')).not.toBeInTheDocument();
  });
  return r;
}

function rowFor(name: string): HTMLElement {
  const nameNode = screen.getByText(name);
  const li = nameNode.closest('li');
  if (!li) throw new Error(`no <li> ancestor for "${name}"`);
  return li;
}

beforeEach(() => {
  refreshAllMembers.mockClear();
  useAllFamilyMembersMock.mockClear();
  renameMemberSpy.mockClear();
  setMemberActiveSpy.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
});

// =====================================================================
// `/family` renders the REAL screen, not the existing Placeholder
// =====================================================================
describe('AppShell — `/family` renders the real FamilyManagementScreen, not the Placeholder', () => {
  it('a PARENT at `/family` sees the real screen (the active + inactive sections)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, coParent, activeChild],
      loading: false,
    };
    await renderAt(ROUTES.family.path);
    // The placeholder renders "Coming soon — this section lands in the next phase."
    // — the real screen renders the active + inactive section headings.
    expect(
      screen.queryByText(/coming soon/i),
      'the Placeholder must be replaced by the real FamilyManagementScreen',
    ).not.toBeInTheDocument();
    const h2s = screen.getAllByRole('heading', { level: 2 });
    const labels = h2s.map((h) => h.textContent ?? '');
    expect(
      labels.some((l) => /active/i.test(l) && !/inactive/i.test(l)),
      'the real screen must render an Active <h2>',
    ).toBe(true);
    expect(
      labels.some((l) => /inactive/i.test(l)),
      'the real screen must render an Inactive <h2>',
    ).toBe(true);
  });
});

// =====================================================================
// guard('family') — member-viewer redirect
// =====================================================================
describe('AppShell — guard("family"): member viewers are bounced to the dashboard', () => {
  it('a MEMBER at `/family` is REDIRECTED to the dashboard (parent-only route)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: memberViewer,
      members: [memberViewer],
      loading: false,
    };
    await renderAt(ROUTES.family.path);
    // Family Management screen content must not render at all for a member.
    expect(screen.queryByText(/active members|inactive members/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull();
  });

  it('a PARENT is NOT redirected away from `/family` (guard does not over-block)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, activeChild],
      loading: false,
    };
    await renderAt(ROUTES.family.path);
    // A parent sees the screen affordances.
    expect(
      screen.getByRole('button', { name: /rename\s+maya/i }),
      'a parent must reach the real screen',
    ).toBeInTheDocument();
  });
});

// =====================================================================
// The screen is fed by the all-members hook (active + inactive)
// =====================================================================
describe('AppShell — Family route is wired to useAllFamilyMembers (active + inactive)', () => {
  beforeEach(() => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, coParent, activeChild, inactiveChild],
      loading: false,
    };
  });

  it('calls useAllFamilyMembers with the caller\'s familyId (not cross-family)', async () => {
    await renderAt(ROUTES.family.path);
    expect(useAllFamilyMembersMock).toHaveBeenCalled();
    const calls = useAllFamilyMembersMock.mock.calls;
    expect(calls.some((c) => c[0] === 'fam-A')).toBe(true);
  });

  it('renders both active and inactive members surfaced by the hook', async () => {
    await renderAt(ROUTES.family.path);
    expect(screen.getByText('Maya Kim')).toBeInTheDocument();
    expect(screen.getByText('Ben Kim')).toBeInTheDocument();
    expect(screen.getByText('Sarah Kim')).toBeInTheDocument();
  });
});

// =====================================================================
// Service wiring — Rename
// =====================================================================
describe('AppShell — Rename action wired to familyManagementService.renameMember', () => {
  beforeEach(() => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, coParent, activeChild, inactiveChild],
      loading: false,
    };
  });

  it('clicking Rename + Save calls renameMember(uid, trimmedName) at the service boundary', async () => {
    await renderAt(ROUTES.family.path);
    fireEvent.click(screen.getByRole('button', { name: /rename\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Maya R.  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(renameMemberSpy).toHaveBeenCalledTimes(1);
      const [, uidArg, nameArg] = renameMemberSpy.mock.calls[0]!;
      expect(uidArg).toBe('uid-child-active');
      expect(nameArg).toBe('Maya R.');
    });
  });
});

// =====================================================================
// Service wiring — Deactivate + Reactivate
// =====================================================================
describe('AppShell — (de)activate actions wired to familyManagementService.setMemberActive', () => {
  beforeEach(() => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, coParent, activeChild, inactiveChild],
      loading: false,
    };
  });

  it('confirming Deactivate on an active member row calls setMemberActive(uid, false)', async () => {
    await renderAt(ROUTES.family.path);
    fireEvent.click(within(rowFor('Maya Kim')).getByRole('button', { name: /deactivate\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /deactivate|confirm|yes/i }));
    await waitFor(() => {
      expect(setMemberActiveSpy).toHaveBeenCalledTimes(1);
      const [, uidArg, activeArg] = setMemberActiveSpy.mock.calls[0]!;
      expect(uidArg).toBe('uid-child-active');
      expect(activeArg).toBe(false);
    });
  });

  it('Reactivate on an inactive row calls setMemberActive(uid, true) — NO confirm sheet required', async () => {
    await renderAt(ROUTES.family.path);
    fireEvent.click(
      within(rowFor('Ben Kim')).getByRole('button', { name: /reactivate\s+ben/i }),
    );
    await waitFor(() => {
      expect(setMemberActiveSpy).toHaveBeenCalledTimes(1);
      const [, uidArg, activeArg] = setMemberActiveSpy.mock.calls[0]!;
      expect(uidArg).toBe('uid-child-inactive');
      expect(activeArg).toBe(true);
    });
  });
});

// =====================================================================
// Self-deactivation NEVER offered at the wiring level either
// =====================================================================
describe('AppShell — self-deactivation never offered on the viewer parent row (defense-in-depth)', () => {
  it('the viewer parent row has NO Deactivate control (rules deny self anyway; UI must not even show it)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, coParent, activeChild, inactiveChild],
      loading: false,
    };
    await renderAt(ROUTES.family.path);
    expect(
      within(rowFor('Sarah Kim')).queryByRole('button', { name: /deactivate/i }),
      "the viewer's own row must never offer Deactivate",
    ).toBeNull();
  });

  it('the co-parent row has NO Deactivate control either (v1: parent-on-parent NOT offered; M31 deferred)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, coParent, activeChild, inactiveChild],
      loading: false,
    };
    await renderAt(ROUTES.family.path);
    expect(
      within(rowFor('Alex Kim')).queryByRole('button', { name: /deactivate/i }),
    ).toBeNull();
  });

  it('the ONLY Deactivate button on the page targets the active MEMBER-role child', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentViewer,
      members: [parentViewer, coParent, activeChild, inactiveChild],
      loading: false,
    };
    await renderAt(ROUTES.family.path);
    const deactivates = screen.queryAllByRole('button', { name: /deactivate/i });
    expect(deactivates).toHaveLength(1);
    const label = (deactivates[0]?.getAttribute('aria-label') ?? deactivates[0]?.textContent ?? '').toLowerCase();
    expect(label).toMatch(/maya/);
  });
});
