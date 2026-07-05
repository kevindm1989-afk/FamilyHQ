/**
 * LoginScreen — forgot-password post-success contract.
 *
 * Focused unit. Before this contract, the form stayed in `forgot` mode after
 * a successful reset send, leaving the user staring at the same "Send reset
 * link" CTA with no obvious next action (the toast auto-dismisses in ~1.8 s).
 * The screen now switches back to `signin` after the send so the next step
 * is obvious: sign in here once the reset link in the email has been
 * followed. Email is preserved; password is cleared.
 *
 * The full sign-in / sign-up happy paths run under the emulator-backed
 * e2e:authed suite. Mode-switch geometry (signup ↔ signin ↔ forgot) is
 * pinned by the public e2e (`e2e/login-public.spec.ts`). What only the
 * unit tier can pin is the *post-success* mode flip — without faking auth,
 * the e2e can't observe it.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sendPasswordResetMock = vi.fn();
const signInMock = vi.fn();

vi.mock('./authService', () => ({
  sendPasswordReset: (...a: unknown[]) => sendPasswordResetMock(...a),
  // Keep the other named exports present so the import in LoginScreen
  // doesn't blow up when `withApi` resolves the whole module.
  signIn: (...a: unknown[]) => signInMock(...a),
  signUpFoundingParent: vi.fn(),
}));
vi.mock('../../firebase/config', () => ({
  auth: { __auth: true },
  db: { __db: true },
}));

import { ToastProvider } from '../../hooks/useToast';
import { LoginScreen } from './LoginScreen';

function mount() {
  return render(
    <ToastProvider>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <LoginScreen />
      </MemoryRouter>
    </ToastProvider>,
  );
}

afterEach(() => {
  sendPasswordResetMock.mockReset();
  signInMock.mockReset();
  vi.unstubAllEnvs();
});

describe('LoginScreen — forgot password post-success flow', () => {
  it('switches back to sign-in mode after a successful reset send (password field reappears, email is preserved)', async () => {
    sendPasswordResetMock.mockResolvedValue(undefined);
    mount();

    // Enter the forgot-password mode via the "Forgot password?" switcher.
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));

    // Pre-condition: password field is HIDDEN in forgot mode (it would
    // otherwise be visible — see line 128 of LoginScreen).
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    // Fill the email + submit the reset.
    const emailField = screen.getByLabelText(/email/i) as HTMLInputElement;
    fireEvent.change(emailField, { target: { value: 'alice@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    // The service was called with the email.
    await waitFor(() => expect(sendPasswordResetMock).toHaveBeenCalledTimes(1));

    // Post-success: the form flips back to sign-in mode, so the password
    // field reappears and the sign-in CTA is visible.
    await waitFor(() => {
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();

    // Email is preserved — the user can sign in immediately after following
    // the reset link in their inbox, no retyping required.
    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe(
      'alice@example.test',
    );

    // Password is cleared (we never had one in forgot mode, but the field
    // should be empty in the freshly-rendered signin form — defends
    // against a future regression that wires the password into both modes).
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe('');
  });

  it('stays in forgot mode when the reset send rejects (so the user can correct + retry)', async () => {
    sendPasswordResetMock.mockRejectedValue(new Error('rate-limited'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'alice@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(sendPasswordResetMock).toHaveBeenCalledTimes(1));
    // Still in forgot mode: password field stays hidden, "Send reset link"
    // CTA stays visible. The user sees the error toast (in-app) and can
    // retry without losing context.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });
});

describe('LoginScreen — kid sign-in (managed child, flag-gated)', () => {
  it('hides the "Kid signing in?" affordance when the flag is off', () => {
    // Flag unset ⇒ isManagedChildEnabled() is false.
    mount();
    expect(screen.queryByRole('button', { name: /kid signing in/i })).not.toBeInTheDocument();
  });

  it('composes the synthetic .invalid address from family code + username and signs in', async () => {
    vi.stubEnv('VITE_MANAGED_CHILD_ENABLED', 'true');
    signInMock.mockResolvedValue({ user: { uid: 'uid-child' } });
    mount();

    // Enter kid mode.
    fireEvent.click(screen.getByRole('button', { name: /kid signing in/i }));

    // Kid mode swaps the email field for family code + username.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/family code/i), { target: { value: 'OTTER42' } });
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'Maya' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-good-password' } });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    // signIn is called with the normalised synthetic address (lower-cased,
    // .invalid) — NOT a real email — and the password.
    await waitFor(() => expect(signInMock).toHaveBeenCalledTimes(1));
    const [, emailArg, passwordArg] = signInMock.mock.calls[0] as [unknown, string, string];
    expect(emailArg).toBe('maya@otter42.familyhq.invalid');
    expect(passwordArg).toBe('a-good-password');
  });
});
