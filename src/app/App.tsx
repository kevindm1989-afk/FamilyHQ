/**
 * App shell + providers (Task 7).
 *
 * Wires the auth/family/toast providers, the router, and the auth gate:
 * logged-out → Login; logged-in → the authed AppShell. Feature screens are
 * Phase-3 placeholders. The "Family HQ" brand mark renders in the loading and
 * logged-out states so the shell always shows something real.
 */
import type { ReactElement } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { LoginScreen } from '../features/auth/LoginScreen';
import { AuthProvider, useAuth } from '../hooks/useAuth';
import { FamilyProvider } from '../hooks/useFamily';
import { ToastProvider } from '../hooks/useToast';
import { AppShell } from './AppShell';
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
  if (!authUser) return <LoginScreen />;
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
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
