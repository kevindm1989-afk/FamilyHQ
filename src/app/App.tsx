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

// Static info page — no reason to ship in the main bundle when most users
// never visit it. Reachable from both the login footer and the AccountScreen.
const AccessibilityStatementScreen = lazy(() =>
  import('../features/accessibility/AccessibilityStatementScreen').then((m) => ({
    default: m.AccessibilityStatementScreen,
  })),
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
  const { authUser, loading } = useAuth();
  useLangAttributeSync();
  if (loading) return <BrandSplash />;
  // Signed-out flow has its own tiny route table because /accessibility is an
  // AODA launch-gate requirement that MUST work for a user who can't get past
  // the sign-in screen (per accessibility-specialist agent + style-guide §11).
  // The authed flow keeps a single <AppShell /> because AppShell owns its own
  // internal <Routes>.
  if (!authUser) {
    return (
      <Suspense fallback={<BrandSplash />}>
        <Routes>
          <Route
            path={ROUTES.accessibility.path}
            element={<AccessibilityStatementScreen mode="public" />}
          />
          <Route path="*" element={<LoginScreen />} />
        </Routes>
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<BrandSplash />}>
      <AuthedApp />
    </Suspense>
  );
}

export default function App(): ReactElement {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}
