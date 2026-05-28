/**
 * Lazy entry point for the entire authenticated app.
 *
 * Exists only to keep the main bundle Firebase-free. FamilyProvider statically
 * imports `firebase/firestore` for its real-time member subscription; importing
 * the provider at App.tsx level would drag the Firestore SDK into the chunk a
 * signed-out visitor downloads. This wrapper is reached via React.lazy in
 * App.tsx so the provider + AppShell + every feature route ship as a single
 * post-auth chunk.
 *
 * Default-exported because React.lazy requires it.
 */
import type { ReactElement } from 'react';
import { FamilyProvider } from '../hooks/useFamily';
import { AppShell } from './AppShell';

export default function AuthedApp(): ReactElement {
  return (
    <FamilyProvider>
      <AppShell />
    </FamilyProvider>
  );
}
