/**
 * PWA update prompt (Phase 4 / Task 16; ADR-0005).
 *
 * Service-worker updates run in `prompt` mode (vite.config.ts) — a new SW
 * installs in the background but does NOT activate until the user accepts
 * an explicit prompt here. The previous `autoUpdate` shape would have
 * silently reloaded a parent mid-approval or a child mid-chore-complete.
 *
 * Rendered as a top-of-viewport banner (NOT the toast system, which is
 * auto-dismiss + single-channel and would disappear before the user has
 * a chance to act). Stays visible until the user chooses Update or Dismiss.
 * `role="status"` + `aria-live="polite"` announces it without stealing focus.
 *
 * In dev (no SW) the `useRegisterSW` hook is a no-op shim; `needRefresh`
 * stays false and the banner never renders.
 */
import type { ReactElement } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '../components';

const HEADLINE = 'A new version of Family HQ is available.';
const BODY =
  'Updating reloads the app — any work in a sheet or form will be lost. Finish up first, then update.';

export function PwaUpdatePrompt(): ReactElement | null {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-0 right-0 top-0 z-50 mx-auto mt-12 max-w-md rounded-control border border-surface-line bg-surface-card p-16 shadow-toast"
      data-testid="pwa-update-prompt"
    >
      <p className="text-body font-semibold text-ink">{HEADLINE}</p>
      <p className="mt-4 text-meta text-ink-mute">{BODY}</p>
      <div className="mt-12 flex justify-end gap-8">
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            setNeedRefresh(false);
          }}
        >
          Dismiss
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={() => {
            void updateServiceWorker(true);
          }}
        >
          Update
        </Button>
      </div>
    </div>
  );
}
