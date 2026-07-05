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
