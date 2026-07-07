/**
 * AppShell — Account screen theme-toggle wiring contract (ADR-0007 dark mode).
 *
 * Level: integration (renders AppShell + the real in-memory router at the
 * account route). useFamily / useAuth are mocked so the shell renders
 * deterministically without Firebase; the themeService boundary is mocked +
 * spied so we assert the exact args AppShell hands the persistence layer and
 * can force a rejection to exercise the optimistic-revert path.
 *
 * Pins the glue the unit tests (applyTheme.test, themeService.test) do NOT
 * cover — the toggle → optimistic apply → persist → revert-on-failure flow:
 *  - The toggle reflects User.theme via aria-pressed and shows the current
 *    value (Light/Dark).
 *  - The AppShell mount effect stamps <html data-theme> from the snapshot.
 *  - Clicking flips <html data-theme> OPTIMISTICALLY and calls
 *    setUserTheme(deps, uid, <flipped>) exactly once with the user's own uid.
 *  - A persist FAILURE reverts <html data-theme> to the prior value and toasts
 *    the generic, user-safe error copy.
 *
 * Isolation: each test resets the mutable family fixture, clears spies, and
 * strips any data-theme left on <html> so applyTheme() cannot leak across
 * tests. In-memory router seeded at the account route; no clock / network / RNG.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserWithId } from '../lib/types';

const lightUser: UserWithId = {
  id: 'uid-parent',
  name: 'Sarah Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

// --- Mutable family-state fixture each test sets before render ---
let familyState: {
  familyId: string | null;
  role: 'parent' | 'member' | null;
  currentUser: UserWithId | null;
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

// The toggle dynamically imports firebase/config for the db handle — return a
// non-null shim so resolveDb() reaches the service spy (never real Firebase).
vi.mock('../firebase/config', () => ({ db: { __db: true } }));

// themeService boundary — spy setUserTheme so we can assert the exact args and
// force a rejection for the revert path. ThemeActionError is preserved real.
const setUserThemeSpy = vi.fn(
  async (_deps: unknown, _uid: string, _theme: 'light' | 'dark') => undefined,
);
vi.mock('../features/settings/themeService', async () => {
  const actual =
    await vi.importActual<typeof import('../features/settings/themeService')>(
      '../features/settings/themeService',
    );
  return {
    ...actual,
    setUserTheme: (deps: unknown, uid: string, theme: 'light' | 'dark') =>
      setUserThemeSpy(deps, uid, theme),
  };
});

import { ToastProvider } from '../hooks/useToast';
import { AppShell } from './AppShell';
import { ToastViewport } from './ToastViewport';
import { ROUTES } from './routes';

function renderAccount() {
  // ToastViewport is the surface that actually renders showToast() copy (App.tsx
  // mounts it in production, next to AppShell). Include it so the revert-path
  // error toast is queryable — the ToastProvider alone only holds the message.
  return render(
    <ToastProvider>
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        initialEntries={[ROUTES.account_switcher.path]}
      >
        <AppShell />
      </MemoryRouter>
      <ToastViewport />
    </ToastProvider>,
  );
}

function themeToggle(): HTMLButtonElement {
  // The Appearance toggle is the button whose accessible label starts with the
  // "Appearance" text and carries aria-pressed.
  return screen.getByRole('button', { name: /appearance/i }) as HTMLButtonElement;
}

beforeEach(() => {
  setUserThemeSpy.mockClear();
  setUserThemeSpy.mockResolvedValue(undefined);
  familyState = {
    familyId: 'fam-A',
    role: 'parent',
    currentUser: lightUser,
    loading: false,
  };
  // No theme leaked from a prior test.
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  vi.clearAllMocks();
  document.documentElement.removeAttribute('data-theme');
});

describe('AppShell — Account theme toggle', () => {
  it('reflects User.theme (light) via aria-pressed and stamps <html data-theme> on mount', () => {
    renderAccount();
    const toggle = themeToggle();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Shows the current value.
    expect(toggle).toHaveTextContent(/light/i);
    // Mount effect stamped the snapshot theme onto <html>.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('reflects User.theme (dark) via aria-pressed and shows the Dark value', () => {
    familyState.currentUser = { ...lightUser, theme: 'dark' };
    renderAccount();
    const toggle = themeToggle();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveTextContent(/dark/i);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('clicking flips <html data-theme> optimistically and persists the flipped value for the user', async () => {
    renderAccount();
    fireEvent.click(themeToggle());

    // Optimistic apply happens after the dynamic import resolves.
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    await waitFor(() => {
      expect(setUserThemeSpy).toHaveBeenCalledTimes(1);
    });
    const [, uid, theme] = setUserThemeSpy.mock.calls[0] as unknown as [
      unknown,
      string,
      'light' | 'dark',
    ];
    expect(uid).toBe('uid-parent');
    expect(theme).toBe('dark');
  });

  it('reverts <html data-theme> and toasts a user-safe error when the persist fails', async () => {
    setUserThemeSpy.mockRejectedValueOnce(new Error('permission-denied'));
    renderAccount();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(themeToggle());

    // The generic, user-safe copy surfaces (never a raw Firebase code)...
    expect(await screen.findByText(/could not update your theme/i)).toBeInTheDocument();
    // ...and the DOM is reverted to the last-known theme.
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });
});
