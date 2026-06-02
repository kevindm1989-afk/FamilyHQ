/**
 * JoinScreen — focused contract for the email-already-in-use polish.
 *
 * The full happy path (createUserWithEmailAndPassword + writeBatch) is
 * exercised by the authed e2e suite; here we pin the one branch the unit
 * tier needs to own: when acceptInvite rejects with the specific
 * INVITE_EMAIL_IN_USE_ERROR message, the form surfaces a persistent inline
 * "Sign in instead" affordance. (The toast auto-dismisses in ~1.8 s, so we
 * cannot rely on it as the recovery path.)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../firebase/config', () => ({
  db: { __db: true },
  auth: { __auth: true },
}));

// Mock the service module. The screen does dynamic imports
// (`await import('./inviteService')`) so we need the named exports to be
// the spies we control per test.
const getInviteByIdMock = vi.fn();
const acceptInviteMock = vi.fn();

vi.mock('./inviteService', async () => {
  // Pull in the real constants (INVITE_*_ERROR / INVITE_ACCEPT_SUCCESS /
  // InviteActionError) so the JoinScreen's `err.message ===
  // INVITE_EMAIL_IN_USE_ERROR` branch compares against the canonical value.
  const actual =
    await vi.importActual<typeof import('./inviteService')>('./inviteService');
  return {
    ...actual,
    getInviteById: (...a: unknown[]) => getInviteByIdMock(...a),
    acceptInvite: (...a: unknown[]) => acceptInviteMock(...a),
  };
});

import { ToastProvider } from '../../hooks/useToast';
import { JoinScreen } from './JoinScreen';
import { InviteActionError, INVITE_EMAIL_IN_USE_ERROR } from './inviteService';

function mountAt(path: string) {
  return render(
    <ToastProvider>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={[path]}
      >
        <Routes>
          <Route path="/join/:inviteId" element={<JoinScreen />} />
          <Route path="/" element={<div data-testid="dashboard">dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  getInviteByIdMock.mockReset();
  acceptInviteMock.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('JoinScreen — email-already-in-use polish', () => {
  it('renders the invalid-link dead-end when the invite is missing', async () => {
    getInviteByIdMock.mockResolvedValue(null);
    mountAt('/join/gone');
    expect(
      await screen.findByRole('heading', { name: /no longer valid/i }),
    ).toBeInTheDocument();
  });

  it('renders the redeem form when the invite is pending', async () => {
    getInviteByIdMock.mockResolvedValue({
      id: 'inv-1',
      status: 'pending',
      email: 'invitee@example.test',
      role: 'member',
      familyId: 'fam-A',
      invitedBy: 'p1',
      createdAt: 1,
    });
    mountAt('/join/inv-1');
    expect(
      await screen.findByRole('heading', { name: /join the family/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/invitee@example.test/i)).toBeInTheDocument();
  });

  it('shows the inline "Sign in instead" affordance after an email-already-in-use rejection (persistent — outlives the toast)', async () => {
    getInviteByIdMock.mockResolvedValue({
      id: 'inv-1',
      status: 'pending',
      email: 'invitee@example.test',
      role: 'member',
      familyId: 'fam-A',
      invitedBy: 'p1',
      createdAt: 1,
    });
    acceptInviteMock.mockRejectedValue(new InviteActionError(INVITE_EMAIL_IN_USE_ERROR));
    mountAt('/join/inv-1');
    await screen.findByRole('heading', { name: /join the family/i });

    const passwordField = screen.getByLabelText(/choose a password/i);
    const nameField = screen.getByLabelText(/your name/i);
    fireEvent.change(nameField, { target: { value: 'Alice' } });
    fireEvent.change(passwordField, { target: { value: 'hunter22' } });
    fireEvent.click(screen.getByRole('button', { name: /join family/i }));

    // The CTA link, not just a toast — visible after acceptInvite rejects.
    const signInLink = await screen.findByRole('link', { name: /sign in instead/i });
    expect(signInLink).toHaveAttribute('href', '/');
    // The accompanying inline copy is visible too.
    expect(screen.getByRole('alert')).toHaveTextContent(/already have an account/i);
  });

  it('does NOT show the inline "Sign in instead" affordance after a generic InviteActionError (e.g. weak password)', async () => {
    getInviteByIdMock.mockResolvedValue({
      id: 'inv-1',
      status: 'pending',
      email: 'invitee@example.test',
      role: 'member',
      familyId: 'fam-A',
      invitedBy: 'p1',
      createdAt: 1,
    });
    acceptInviteMock.mockRejectedValue(new InviteActionError()); // generic
    mountAt('/join/inv-1');
    await screen.findByRole('heading', { name: /join the family/i });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByLabelText(/choose a password/i), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: /join family/i }));

    // Wait for the form to settle. acceptInvite was called.
    await waitFor(() => expect(acceptInviteMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole('link', { name: /sign in instead/i }),
      'the inline "Sign in instead" affordance is reserved for the email-in-use branch',
    ).not.toBeInTheDocument();
  });
});
