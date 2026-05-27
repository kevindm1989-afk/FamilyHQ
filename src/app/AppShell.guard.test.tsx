/**
 * AppShell route-guard integration contract (Finding D — defense-in-depth).
 *
 * Level: integration (renders AppShell + the real router at a route path). The
 * route table marks `add_event` as `parentOnly:true`, but unless the routed
 * ELEMENT is wrapped in `guard('add_event', …)` a MEMBER who lands on
 * `/calendar/new` is NOT bounced — the parent-only Add Event affordance becomes
 * reachable by URL. UI gating is cosmetic (firestore.rules is authoritative),
 * but the guard must still be wired so a member is redirected, mirroring how the
 * already-guarded `add_chore` route behaves.
 *
 * This is a DOM/behaviour assertion at the route, NOT a re-test of routes.ts'
 * pure `canAccess` (that lives in routes.test.ts). It catches the wiring gap:
 * `canAccess('add_event','member') === false` yet the route renders anyway.
 *
 * FAILS today: AppShell renders `<Route path={add_event} element={<CalendarRoute/>}/>`
 * WITHOUT the guard wrapper, so a member is not redirected.
 *
 * Isolation: useAuth/useFamily/useToast and the live event feed are mocked so the
 * shell renders deterministically without Firebase. Router is an in-memory router
 * seeded at the route under test (no real navigation/history). Each test owns its
 * mocks; no shared mutable state.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../lib/types';

const memberUser: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya Rivera',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
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

// Mutable family-state fixture each test sets before render.
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
  useAuth: () => ({ authUser: { uid: familyState.currentUser?.id ?? 'anon' }, loading: false, signOut: vi.fn() }),
}));

// The calendar route subscribes to a live event feed; mock it to an empty,
// settled feed so no Firestore is touched.
vi.mock('../features/calendar/useFamilyEvents', () => ({
  useFamilyEvents: () => ({ events: [], loading: false, error: null, refresh: vi.fn() }),
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

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell — add_event route guard (Finding D, defense-in-depth)', () => {
  it('a MEMBER at the add_event route is BOUNCED off the calendar route entirely (guard, not just role-gated chrome)', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
    renderAt(ROUTES.add_event.path);

    // Guard-specific: without the route guard the member RENDERS the CalendarRoute
    // (its day cells / Calendar heading) at /calendar/new. The FAB alone is also
    // role-gated, so we assert the ROUTE did not render — only the guard fixes this.
    expect(
      screen.queryAllByTestId('calendar-day'),
      'a member must be redirected away from the calendar route, not render it',
    ).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: /add event|new event/i }),
      'a member must not reach the parent-only Add Event affordance by URL',
    ).not.toBeInTheDocument();
  });

  it('the redirected MEMBER lands on the dashboard (welcome), not the calendar route', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
    renderAt(ROUTES.add_event.path);
    expect(
      screen.getByRole('heading', { name: /welcome/i }),
      'the guard must redirect a member to the dashboard, mirroring add_chore',
    ).toBeInTheDocument();
  });

  it('a PARENT at the add_event route IS allowed through (guard does not over-block)', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: parentUser,
      members: [parentUser],
      loading: false,
    };
    renderAt(ROUTES.add_event.path);
    // A parent reaches the calendar + its Add Event FAB.
    expect(screen.getByRole('button', { name: /add event|new event/i })).toBeInTheDocument();
  });
});
