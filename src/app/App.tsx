/**
 * App shell + providers (Task 7).
 *
 * Wires the auth/family/toast providers, the router, and the auth gate:
 * logged-out → Login; logged-in → the authed AppShell. Feature screens are
 * Phase-3 placeholders. The "Family HQ" brand mark renders in the loading and
 * logged-out states so the shell always shows something real.
 */
import type { ReactElement } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AccessibilityStatementScreen } from '../features/accessibility/AccessibilityStatementScreen';
import { LoginScreen } from '../features/auth/LoginScreen';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { FamilyProvider } from '../hooks/useFamily';
import { ToastProvider } from '../hooks/useToast';
import { AppShell } from './AppShell';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';
import { ROUTES } from './routes';
import { ToastViewport } from './ToastViewport';

function BrandSplash(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-bg px-24">
      <h1 className="text-display font-display font-extrabold text-brand">Family HQ</h1>
      <p className="mt-12 text-body text-ink-mute" aria-busy="true">
        Loading…
      </p>
    </main>
  );
}

function Gate(): ReactElement {
  const { authUser, loading } = useAuth();
  if (loading) return <BrandSplash />;
  // Signed-out flow has its own tiny route table because /accessibility is an
  // AODA launch-gate requirement that MUST work for a user who can't get past
  // the sign-in screen (per accessibility-specialist agent + style-guide §11).
  // The authed flow keeps a single <AppShell /> because AppShell owns its own
  // internal <Routes>.
  if (!authUser) {
    return (
      <Routes>
        <Route
          path={ROUTES.accessibility.path}
          element={<AccessibilityStatementScreen mode="public" />}
        />
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    );
  }
  return (
    <FamilyProvider>
      <AppShell />
    </FamilyProvider>
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
