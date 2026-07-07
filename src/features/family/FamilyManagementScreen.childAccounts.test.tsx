/**
 * Family Management — managed (email-less) child creation
 * (docs/specs/managed-child-accounts.md §7).
 *
 * Component contract for the "Add a child" affordance: presence-gated on the
 * onCreateChild handler (the route wires it only when the flag is on), the
 * inline form, the success hand-off card (family code + username the parent
 * relays — never the password), and the error path. Handlers injected; no
 * network / Firestore / clock.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import {
  FamilyManagementScreen,
  type FamilyManagementScreenProps,
} from './FamilyManagementScreen';
import type { UserWithId } from '../../lib/types';

const PARENT: UserWithId = {
  id: 'uid-parent',
  name: 'Sarah Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
// A MANAGED child (created by the createManagedChild callable) and a STANDARD
// member — distinct balances per the fixture-collision lesson (2026-05-27).
const MANAGED_CHILD: UserWithId = {
  id: 'uid-managed-child',
  name: 'Maya Kim',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 3850,
  theme: 'light',
  accountType: 'managed',
  loginHandle: 'maya',
};
const STANDARD_MEMBER: UserWithId = {
  id: 'uid-standard-member',
  name: 'Ben Kim',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 1275,
  theme: 'light',
};

function renderScreen(overrides: Partial<FamilyManagementScreenProps> = {}): void {
  const props: FamilyManagementScreenProps = {
    viewer: PARENT,
    members: [PARENT],
    loading: false,
    error: null,
    onRename: vi.fn().mockResolvedValue(undefined),
    onSetActive: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(
    <ToastProvider>
      <FamilyManagementScreen {...props} />
    </ToastProvider>,
  );
}

describe('FamilyManagementScreen — add a child (managed account)', () => {
  it('does NOT render the "Add a child" affordance when onCreateChild is absent', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: /add a child/i })).not.toBeInTheDocument();
  });

  it('creates a child and shows the hand-off card with the family code + username', async () => {
    const onCreateChild = vi
      .fn()
      .mockResolvedValue({ childUid: 'uid-child', loginCode: 'otter4', handle: 'maya' });
    renderScreen({ onCreateChild });

    fireEvent.click(screen.getByRole('button', { name: /add a child/i }));

    fireEvent.change(screen.getByLabelText(/child's name/i), { target: { value: 'Maya' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'maya' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-good-password' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    // Handler called with the raw form input (the service normalises + validates).
    await waitFor(() => expect(onCreateChild).toHaveBeenCalledTimes(1));
    expect(onCreateChild).toHaveBeenCalledWith({
      displayName: 'Maya',
      handle: 'maya',
      password: 'a-good-password',
    });

    // Hand-off card shows the sign-in coordinates the parent relays.
    await waitFor(() => expect(screen.getByText(/account created/i)).toBeInTheDocument());
    expect(screen.getByText('otter4')).toBeInTheDocument();
    expect(screen.getByText('maya')).toBeInTheDocument();
    // The password is NEVER echoed back.
    expect(screen.queryByText('a-good-password')).not.toBeInTheDocument();
  });

  it('keeps the form open and surfaces the error message when creation fails', async () => {
    const onCreateChild = vi
      .fn()
      .mockRejectedValue(new Error('That username is already taken in your family.'));
    renderScreen({ onCreateChild });

    fireEvent.click(screen.getByRole('button', { name: /add a child/i }));
    fireEvent.change(screen.getByLabelText(/child's name/i), { target: { value: 'Maya' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'maya' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-good-password' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(screen.getByText(/username is already taken/i)).toBeInTheDocument(),
    );
    // Form stays open (Create account CTA still present); no hand-off card.
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.queryByText(/account created/i)).not.toBeInTheDocument();
  });
});

describe('FamilyManagementScreen — reset a managed child password', () => {
  const FAMILY = [PARENT, MANAGED_CHILD, STANDARD_MEMBER];

  it('shows NO reset action anywhere when onResetChildPassword is absent', () => {
    renderScreen({ members: FAMILY });
    expect(screen.queryByRole('button', { name: /reset password/i })).not.toBeInTheDocument();
  });

  it('offers the reset action ONLY on the managed-child row when the handler is wired', () => {
    renderScreen({ members: FAMILY, onResetChildPassword: vi.fn().mockResolvedValue(undefined) });
    const resetButtons = screen.getAllByRole('button', { name: /reset password/i });
    // Exactly one: Maya (managed). Ben (standard member) and the parent get none.
    expect(resetButtons).toHaveLength(1);
    expect(resetButtons[0]).toHaveAccessibleName('Reset password for Maya Kim');
  });

  it('validates the minimum length, then submits and toasts on success (password never echoed)', async () => {
    const onResetChildPassword = vi.fn().mockResolvedValue(undefined);
    renderScreen({ members: FAMILY, onResetChildPassword });

    fireEvent.click(screen.getByRole('button', { name: /reset password for maya/i }));

    // Too-short password → inline alert; the handler is NOT called.
    const input = screen.getByLabelText(/new password/i);
    fireEvent.change(input, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    expect(onResetChildPassword).not.toHaveBeenCalled();

    // Valid password → handler called with (uid, password); success toast.
    fireEvent.change(input, { target: { value: 'a-new-good-password' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => expect(onResetChildPassword).toHaveBeenCalledTimes(1));
    expect(onResetChildPassword).toHaveBeenCalledWith('uid-managed-child', 'a-new-good-password');
    await waitFor(() => expect(screen.getByText(/password updated/i)).toBeInTheDocument());
    // Sheet closed; the password value appears nowhere in the document.
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    expect(screen.queryByText('a-new-good-password')).not.toBeInTheDocument();
  });

  it('surfaces the service message and closes the sheet when the reset rejects', async () => {
    const onResetChildPassword = vi
      .fn()
      .mockRejectedValue(new Error('Too many attempts. Please wait a minute and try again.'));
    renderScreen({ members: FAMILY, onResetChildPassword });

    fireEvent.click(screen.getByRole('button', { name: /reset password for maya/i }));
    fireEvent.change(screen.getByLabelText(/new password/i), {
      target: { value: 'a-new-good-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => expect(screen.getByText(/too many attempts/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});
