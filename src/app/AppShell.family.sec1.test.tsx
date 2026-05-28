/**
 * AppShell — Family Management route, Sec1 hardening: when `resolveDb()`
 * returns null (lazy `firebase/config` import fails / harness has no Firebase
 * config), the route must NOT cast `db as Firestore` and call the service —
 * it must raise the user-safe generic-error toast WITHOUT invoking the
 * service.
 *
 * SECURITY-CRITICAL: the current AppShell code casts a possibly-null `db`
 * to `Firestore` and relies on the service's `try` block to swallow the
 * resulting TypeError. That lie obscures the failure mode (a non-Firestore
 * environment looks identical to a permission-denied write). The fix is to
 * short-circuit at the route layer: if `db === null`, surface the generic
 * error toast and do NOT call renameMember / setMemberActive.
 *
 * MECHANISM: this file mocks `../firebase/config` to throw on import (the
 * harness simulating a missing config). Because vi.mock is hoisted module-
 * level, this test file's mock is isolated from the main AppShell.family
 * suite. The renameMember / setMemberActive functions are spied so we can
 * assert they were NEVER called.
 *
 * FAILS today: AppShell's handleRename / handleSetActive currently call
 * `renameMember({db: db as Firestore}, …)` even when `db` is null —
 * the spy WILL have been called, contradicting the Sec1 contract.
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

// --- Mutable family-state fixture each test sets before render ---
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

// Sec1 — the LAZY import inside `resolveDb()` THROWS, simulating a missing
// `firebase/config` in the test harness. The route must short-circuit on
// `db === null` and never call the service with a null cast.
vi.mock('../firebase/config', () => {
  throw new Error('firebase/config not available in this harness (Sec1 simulation)');
});

// The other route feeds — settled-empty so unrelated routes do not touch Firebase.
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

vi.mock('../features/family/useAllFamilyMembers', () => ({
  useAllFamilyMembers: (_familyId: string | null) => ({
    members: [parentViewer, coParent, activeChild, inactiveChild],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// Spies on the service — the Sec1 contract is that NEITHER is called when
// the dynamic config import fails.
const renameMemberSpy = vi.fn(async (_deps: unknown, _uid: string, _name: string) => undefined);
const setMemberActiveSpy = vi.fn(
  async (_deps: unknown, _uid: string, _isActive: boolean) => undefined,
);
vi.mock('../features/family/familyManagementService', async () => {
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
      <MemoryRouter initialEntries={[path]}>
        <AppShell />
      </MemoryRouter>
    </ToastProvider>,
  );
  // Wait for the React.lazy route chunk to resolve — RouteFallback Skeleton
  // label is "Loading…". See AppShell.dashboard.test.tsx for rationale.
  await waitFor(() => {
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
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
  renameMemberSpy.mockClear();
  setMemberActiveSpy.mockClear();
  familyState = {
    familyId: 'fam-A',
    role: 'parent',
    currentUser: parentViewer,
    members: [parentViewer, coParent, activeChild, inactiveChild],
    loading: false,
  };
});
afterEach(() => {
  vi.clearAllMocks();
});

// =====================================================================
// Sec1 — null db must short-circuit (no service call, no `db as Firestore` lie)
// =====================================================================
describe('AppShell Family route — Sec1: null db must short-circuit (no service call, no cast lie)', () => {
  it('Rename Save with a failed firebase/config import does NOT call renameMember; the generic toast appears', async () => {
    await renderAt(ROUTES.family.path);
    fireEvent.click(screen.getByRole('button', { name: /rename\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Maya R.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    // The generic toast surfaces.
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    // SECURITY-CRITICAL — renameMember must NOT have been called with a null cast.
    expect(
      renameMemberSpy,
      'Sec1 — handleRename must NOT invoke renameMember when resolveDb() returns null (no `db as Firestore` lie)',
    ).not.toHaveBeenCalled();
  });

  it('Reactivate with a failed firebase/config import does NOT call setMemberActive; the generic toast appears', async () => {
    await renderAt(ROUTES.family.path);
    fireEvent.click(within(rowFor('Ben Kim')).getByRole('button', { name: /reactivate\s+ben/i }));
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(
      setMemberActiveSpy,
      'Sec1 — handleSetActive must NOT invoke setMemberActive when resolveDb() returns null',
    ).not.toHaveBeenCalled();
  });

  it('Confirm Deactivate with a failed firebase/config import does NOT call setMemberActive; the generic toast appears', async () => {
    await renderAt(ROUTES.family.path);
    fireEvent.click(
      within(rowFor('Maya Kim')).getByRole('button', { name: /deactivate\s+maya/i }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /deactivate|confirm|yes/i }));
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(
      setMemberActiveSpy,
      'Sec1 — handleSetActive must NOT invoke setMemberActive when resolveDb() returns null',
    ).not.toHaveBeenCalled();
  });
});
