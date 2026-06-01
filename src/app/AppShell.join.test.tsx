/**
 * AppShell — `/join/:inviteId` integration contract.
 *
 * Background: the public JoinScreen at `/join/:inviteId` only renders for
 * UNAUTHENTICATED visitors (App.tsx). Before this contract, an already-
 * signed-in user who clicked an invite link fell through AppShell's
 * catch-all `*` route and silently landed on the dashboard — no signal
 * that they were on a join URL, no path forward to redeem.
 *
 * Contract: the authed shell MUST surface a dedicated handoff at the same
 * path so the visitor knows what's going on and can sign out to redeem.
 *
 * Level: integration. Renders AppShell at `/join/<id>` with a signed-in
 * fixture; asserts the handoff heading rendered (NOT the dashboard
 * heading via the catch-all redirect).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../lib/types';

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

vi.mock('../hooks/useFamily', () => ({
  useFamily: () => familyState,
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    authUser: { uid: familyState.currentUser?.id ?? 'anon' },
    loading: false,
    signOut: vi.fn(async () => undefined),
  }),
}));

import { ToastProvider } from '../hooks/useToast';
import { AppShell } from './AppShell';

async function renderAt(path: string) {
  const r = render(
    <ToastProvider>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={[path]}
      >
        <AppShell />
      </MemoryRouter>
    </ToastProvider>,
  );
  // Wait for any React.lazy chunks (none on this route, but the helper is
  // copied from sibling AppShell.* tests so the contract stays consistent).
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading…')).not.toBeInTheDocument();
  });
  return r;
}

import { markTourSeen } from '../features/onboarding/tourStorage';
beforeEach(() => {
  markTourSeen();
  familyState = {
    familyId: 'fam-A',
    role: 'parent',
    currentUser: parentUser,
    members: [parentUser],
    loading: false,
  };
});
afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('AppShell — `/join/:inviteId` while signed in', () => {
  it('a signed-in visitor at /join/<id> sees the handoff, NOT the dashboard catch-all', async () => {
    await renderAt('/join/inv-123');
    // The handoff renders its own heading. Before the fix, the catch-all
    // `*` route would Navigate the visitor to /, surfacing the dashboard
    // "Welcome <name>" heading instead.
    expect(
      screen.getByRole('heading', { name: /already signed in/i }),
      'AppShell must route /join/:inviteId to the handoff, not fall through to the dashboard',
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /welcome/i }),
      'the dashboard greeting must not render — the visitor is on the join URL',
    ).not.toBeInTheDocument();
  });
});
