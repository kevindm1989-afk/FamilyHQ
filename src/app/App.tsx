/**
 * App shell + providers (Task 7).
 *
 * Wires the auth/family/toast providers, the router, and the auth gate:
 * logged-out → Login; logged-in → the authed AppShell. Feature screens are
 * Phase-3 placeholders. The "Family HQ" brand mark renders in the loading and
 * logged-out states so the shell always shows something real.
 */
import { Suspense, lazy, useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoginScreen } from '../features/auth/LoginScreen';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { ToastProvider } from '../hooks/useToast';
import { ErrorBoundary } from './ErrorBoundary';
import { reportClientError } from '../lib/telemetry';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';
import { ROUTES } from './routes';
import { ToastViewport } from './ToastViewport';

// AuthedApp wraps FamilyProvider + AppShell + every feature screen + every
// Firestore-backed hook + the full feature service surface. Loaded eagerly,
// it would force a signed-out visitor to download the entire authed app
// (~700 KB of Firebase + features) just to render the login form. The lazy
// boundary lives at AuthedApp rather than AppShell so FamilyProvider's
// static `firebase/firestore` import also stays out of the main bundle.
// Fetched once auth succeeds; Suspense renders BrandSplash in between, which
// already matches the auth-loading state visually.
const AuthedApp = lazy(() => import('./AuthedApp'));

// Static info pages — no reason to ship in the main bundle when most users
// never visit them. The legal pages share one component (LegalScreen) that
// takes a variant prop, so they share a single lazy chunk too.
const AccessibilityStatementScreen = lazy(() =>
  import('../features/accessibility/AccessibilityStatementScreen').then((m) => ({
    default: m.AccessibilityStatementScreen,
  })),
);
const LegalScreen = lazy(() =>
  import('../features/legal/LegalScreen').then((m) => ({ default: m.LegalScreen })),
);
// Public invite-redeem page — only reachable while signed out (the unauthed
// Gate routes it). Walks an invitee through signup against an existing family.
const JoinScreen = lazy(() =>
  import('../features/family/JoinScreen').then((m) => ({ default: m.JoinScreen })),
);

function BrandSplash(): ReactElement {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-bg px-24">
      <h1 className="text-display font-display font-extrabold text-brand">{t('common.appName')}</h1>
      <p className="mt-12 text-body text-ink-mute" aria-busy="true">
        {t('common.loading')}
      </p>
    </main>
  );
}

/**
 * Sync `<html lang>` with the active i18n language. Critical for assistive
 * tech — a screen reader uses the lang attribute to pick the correct
 * pronunciation voice. Browsers also use it for hyphenation, spell-check,
 * etc. Listens on i18n's language-change event so a toggle anywhere in the
 * tree updates the root element.
 */
function useLangAttributeSync(): void {
  const { i18n } = useTranslation();
  useEffect(() => {
    const apply = (lng: string): void => {
      document.documentElement.lang = lng;
    };
    apply(i18n.resolvedLanguage ?? i18n.language ?? 'en');
    i18n.on('languageChanged', apply);
    return () => i18n.off('languageChanged', apply);
  }, [i18n]);
}

function Gate(): ReactElement {
  const { t } = useTranslation();
  const { authUser, loading } = useAuth();
  useLangAttributeSync();
  if (loading) return <BrandSplash />;
  // Signed-out flow has its own tiny route table because /accessibility is an
  // AODA launch-gate requirement that MUST work for a user who can't get past
  // the sign-in screen (per accessibility-specialist agent + style-guide §11).
  // The authed flow keeps a single <AppShell /> because AppShell owns its own
  // internal <Routes>.
  //
  // Skip link (WCAG 2.4.1) — sits ABOVE the Routes so it is the first
  // focusable on the public surface. Both LoginScreen and the public-mode
  // AccessibilityStatementScreen expose a <main id="main-content"
  // tabIndex={-1}> that this link targets. AppShell carries its own copy of
  // the same link for the authed surface (different chrome — TopBar +
  // BottomNav — needs the link positioned inside its layout).
  if (!authUser) {
    return (
      <>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-16 focus:top-12 focus:z-modal focus:rounded-control focus:bg-brand focus:px-16 focus:py-8 focus:text-brand-on focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('common.skipToMain')}
        </a>
        <Suspense fallback={<BrandSplash />}>
          <Routes>
            <Route
              path={ROUTES.accessibility.path}
              element={<AccessibilityStatementScreen mode="public" />}
            />
            <Route
              path={ROUTES.privacy.path}
              element={<LegalScreen variant="privacy" mode="public" />}
            />
            <Route
              path={ROUTES.terms.path}
              element={<LegalScreen variant="terms" mode="public" />}
            />
            <Route path={ROUTES.join.path} element={<JoinScreen />} />
            <Route path="*" element={<LoginScreen />} />
          </Routes>
        </Suspense>
      </>
    );
  }
  return (
    <Suspense fallback={<BrandSplash />}>
      <AuthedApp />
    </Suspense>
  );
}

// React Router v7 future-flag opt-in. Both flags surface deprecation
// warnings on every test run AND pin the migration's behaviour change
// into the codebase now — v7 will turn these on by default, so opting
// in early means the upgrade is a no-op (instead of a sudden behaviour
// shift). Same future prop is mirrored on the MemoryRouter wrappers in
// the test suites below; ROUTER_FUTURE_FLAGS would be the natural
// constant to extract, but every consumer is in this directory's tests
// and React Router doesn't export the type publicly enough to make
// extraction tidier than copy-paste.
const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export default function App(): ReactElement {
  return (
    <BrowserRouter future={ROUTER_FUTURE}>
      {/* App-level ErrorBoundary: catches any render error in Gate, the auth
          flow, or the lazy AuthedApp chunk so the user gets a friendly
          fallback instead of a white screen. Sentry's captureException
          would wire to the reportError prop here when error tracking
          lands; today the default reporter logs to console.error. The
          boundary sits INSIDE BrowserRouter so the fallback can still use
          react-router hooks if needed, and INSIDE ToastProvider/AuthProvider
          would be wrong because an error in those providers themselves
          must still be caught. So: Router > Boundary > Providers > Gate. */}
      <ErrorBoundary
        // First-party, PI-scrubbed error reporting (telemetry.ts) — the
        // "Sentry-ready seam" is now load-bearing without any third-party
        // SDK (constraints.md: third-party error tracking is review-gated;
        // this stays on our own Firestore, scrubbed + capped).
        reportError={({ error, componentStack }) =>
          reportClientError({ error, componentStack, pathname: window.location.pathname })
        }
      >
        <ToastProvider>
          <AuthProvider>
            <Gate />
            <ToastViewport />
            {/* Mounted at the app root (not inside Gate) so a SW update prompt
                surfaces on the login screen too — the new code is what serves
                that screen on the next reload. */}
            <PwaUpdatePrompt />
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
