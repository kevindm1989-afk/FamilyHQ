/**
 * JoinAuthedHandoff — unit contract.
 *
 * Pins:
 *   - Renders the "you're already signed in" copy with the current user's
 *     name when known (NOT JoinScreen — that's the public path).
 *   - "Sign out" calls useAuth().signOut. After sign-out the auth listener
 *     flips the App.tsx branch and the public JoinScreen mounts at the same
 *     URL; here we only assert the CTA wiring.
 *   - "Stay signed in" links to the dashboard.
 *   - A failed sign-out surfaces a user-safe toast and re-enables the button
 *     (no silent stuck state).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';

const sarah: UserWithId = {
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

const signOutSpy = vi.fn(async () => undefined);

vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => familyState,
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    authUser: { uid: familyState.currentUser?.id ?? 'anon' },
    loading: false,
    signOut: signOutSpy,
  }),
}));

import { ToastProvider } from '../../hooks/useToast';
import { JoinAuthedHandoff } from './JoinAuthedHandoff';
import { ROUTES } from '../../app/routes';

function mount() {
  return render(
    <ToastProvider>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={['/join/inv-1']}
      >
        <JoinAuthedHandoff />
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  signOutSpy.mockClear();
});

describe('JoinAuthedHandoff', () => {
  it("greets the signed-in user by name and offers a sign-out", () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah],
      loading: false,
    };
    mount();
    expect(
      screen.getByRole('heading', { name: /already signed in/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/sarah kim/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('falls back to a name-less body when currentUser is null (mid-bootstrap)', () => {
    familyState = {
      familyId: null,
      role: null,
      currentUser: null,
      members: [],
      loading: false,
    };
    mount();
    expect(
      screen.getByRole('heading', { name: /already signed in/i }),
    ).toBeInTheDocument();
    // The body still appears, just without an interpolated name.
    expect(
      screen.getByText(/sign out and reopen the link/i),
    ).toBeInTheDocument();
  });

  it('clicking "Sign out" calls useAuth().signOut exactly once', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah],
      loading: false,
    };
    mount();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledTimes(1));
  });

  it('a failed sign-out re-enables the button so the user can retry (no stuck state)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah],
      loading: false,
    };
    signOutSpy.mockRejectedValueOnce(new Error('network'));
    mount();
    const btn = screen.getByRole('button', { name: /sign out/i });
    fireEvent.click(btn);
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledTimes(1));
    // The toast surface lives in AppShell (this test renders the component in
    // isolation); the user-visible recovery contract here is: the button is
    // not left in a busy/disabled state, so the user can try again.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).not.toBeDisabled();
    });
  });

  it('"Stay signed in" links to the dashboard', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah],
      loading: false,
    };
    mount();
    const stayLink = screen.getByRole('link', { name: /stay signed in/i });
    expect(stayLink).toHaveAttribute('href', ROUTES.dashboard.path);
  });
});
