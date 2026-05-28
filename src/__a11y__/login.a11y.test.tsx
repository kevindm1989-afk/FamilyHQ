/**
 * A11y gate — LoginScreen (Phase 4 / Task 17).
 *
 * Login is the first surface a new family parent meets — labels, error
 * association, focus order matter here. The screen has three modes
 * (signin / signup / forgot); each renders different fields. All three are
 * exercised.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoginScreen } from '../features/auth/LoginScreen';
import { ToastProvider } from '../hooks/useToast';
import { axeA11y } from './fixtures';

describe('a11y — LoginScreen', () => {
  it('sign-in mode has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <LoginScreen />
      </ToastProvider>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('sign-up mode (founding parent) has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <LoginScreen />
      </ToastProvider>,
    );
    // Switch to sign-up — the screen exposes its mode toggle as a button.
    const signupToggle = screen.getByRole('button', { name: /create.*family/i });
    fireEvent.click(signupToggle);
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('forgot-password mode has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <LoginScreen />
      </ToastProvider>,
    );
    const forgotToggle = screen.getByRole('button', { name: /forgot password/i });
    fireEvent.click(forgotToggle);
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
