/**
 * App shell placeholder (Phase 0).
 *
 * This is a blank, runnable shell only. Routing, providers (auth/family/toast),
 * the nav chrome, and all feature screens are Phase 1-2 work owned by other
 * agents — do not implement them here.
 *
 * It renders "Family HQ" using design-token-driven Tailwind classes (brand
 * indigo, surfaces, type scale) so `npm run dev` serves something real and
 * scripts/token-audit.sh has token usage to verify (no raw hex literals).
 */
import type { ReactElement } from 'react';

export default function App(): ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-bg px-16">
      <div className="w-full max-w-sm rounded-card bg-surface-card p-16 shadow-card">
        <h1 className="text-display font-display text-brand">Family HQ</h1>
        <p className="mt-12 text-body text-ink-mute">
          Project shell is running. Features arrive in the next phases.
        </p>
      </div>
    </main>
  );
}
