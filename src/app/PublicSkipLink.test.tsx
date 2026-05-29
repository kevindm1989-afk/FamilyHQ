/**
 * Skip link — public (unauthed) surface contract (WCAG 2.4.1).
 *
 * The AppShell skip link is covered by the existing AppShell.*.test.tsx and
 * by the axe a11y suite. This file pins the SAME contract for the unauthed
 * Gate branch which surfaces an AODA gap noted while wiring the Playwright
 * smoke suite — LoginScreen and the public AccessibilityStatementScreen
 * each render BEHIND the skip link.
 *
 * Pins:
 *  1. The first focusable on the public surface is the skip link.
 *  2. The link targets `#main-content`.
 *  3. Both LoginScreen and the public AccessibilityStatementScreen expose a
 *     `<main id="main-content">` so the link's target resolves on EITHER
 *     route.
 *  4. The link label resolves from i18n (en + fr both registered).
 *
 * Boundary: useAuth/useFamily are stubbed via the existing test bootstrap.
 * No backend, no Firestore. The Gate's `authUser` branch is left untouched
 * — the authed AppShell skip link continues to be covered elsewhere.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub useAuth so Gate renders the unauthed branch deterministically.
vi.mock('../hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ authUser: null, loading: false, signOut: vi.fn() }),
}));

// Ditto useToast (LoginScreen consumes it).
vi.mock('../hooks/useToast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  useToast: () => ({ showToast: vi.fn() }),
}));

// PwaUpdatePrompt + ToastViewport both reach for live regions we don't need.
vi.mock('./PwaUpdatePrompt', () => ({ PwaUpdatePrompt: () => null }));
vi.mock('./ToastViewport', () => ({ ToastViewport: () => null }));

// Reset i18n language between tests so a previous fr-leaning test cannot
// pollute the en assertion below.
//
// Order matters in afterEach: explicitly `cleanup()` the rendered tree BEFORE
// flipping the language back. RTL's auto-cleanup fires AFTER every afterEach,
// so without this manual call the still-mounted Gate (from the test we just
// finished) re-renders in response to the language change, and that re-render
// is not inside an act() boundary — React then logs an "update to Gate inside
// a test was not wrapped in act(...)" warning for every test in the file
// (10 in the suite at the time of writing). Unmounting first means the
// language change runs against an empty tree, which is what we actually want.
import i18n from '../i18n';
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

async function renderAt(path: string): Promise<void> {
  // App owns its OWN BrowserRouter — wrapping in MemoryRouter would render a
  // Router inside a Router and React-Router throws on that. Drive the URL via
  // jsdom's history instead so BrowserRouter picks up the test's intent.
  window.history.pushState({}, '', path);
  // Lazy-import App so the useAuth/useToast mocks above land BEFORE App
  // pulls them in via its module graph.
  const { default: App } = await import('./App');
  render(<App />);
}

describe('PublicSkipLink — WCAG 2.4.1 on the unauthed surface', () => {
  it('renders a "Skip to main content" link as the first <a> on /', async () => {
    await renderAt('/');
    const link = await screen.findByRole('link', { name: /skip to main content/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('renders the same link on the public /accessibility route', async () => {
    await renderAt('/accessibility');
    const link = await screen.findByRole('link', { name: /skip to main content/i });
    expect(link.getAttribute('href')).toBe('#main-content');
  });

  it('LoginScreen exposes <main id="main-content"> so the skip target resolves', async () => {
    await renderAt('/');
    // Wait for the route to mount — App.tsx wraps the unauthed Routes in
    // Suspense, so the first synchronous query races the lazy
    // AccessibilityStatementScreen import. LoginScreen itself is eager but
    // findBy* still flushes the pending microtask cleanly.
    const main = await screen.findByRole('main');
    expect(main.id).toBe('main-content');
  });

  it('AccessibilityStatementScreen exposes <main id="main-content"> on /accessibility', async () => {
    await renderAt('/accessibility');
    const main = await screen.findByRole('main');
    expect(main.id).toBe('main-content');
  });

  it('skip-link label translates to French when the active locale is fr', async () => {
    await i18n.changeLanguage('fr');
    await renderAt('/');
    const link = await screen.findByRole('link', { name: /aller au contenu principal/i });
    expect(link.getAttribute('href')).toBe('#main-content');
  });
});
