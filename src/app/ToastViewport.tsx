import { useEffect, useState, useSyncExternalStore, type ReactElement } from 'react';
import { Toast } from '../components';
import { useToast } from '../hooks/useToast';

/**
 * Renders the currently-visible toast (if any) in a fixed bottom viewport. The
 * Toast itself is the polite live region; this only positions it above the nav.
 *
 * SINGLE LIVE REGION (Finding F, a11y serious): there must be EXACTLY ONE toast
 * live region on screen at a time. Multiple `<ToastViewport/>` instances may be
 * mounted (the app shell, a feature screen, and an open ComposePost can all
 * declare one), but only the EARLIEST-mounted instance renders the live region;
 * every other instance renders nothing. This stops a toast from being announced
 * twice by duplicate `role="status"` regions, while letting components declare
 * the viewport locally without coordinating who "owns" it. When the primary
 * unmounts, the next-earliest instance is re-elected and the others re-render.
 */

// Module-level registry of mounted viewport ids, in mount order. The primary is
// always the first id. Subscribers are notified on every mount/unmount so the
// newly-elected primary (and demoted ones) re-render.
let nextId = 0;
const mounted: number[] = [];
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}

function registerViewport(id: number): () => void {
  mounted.push(id);
  notify();
  return () => {
    const idx = mounted.indexOf(id);
    if (idx !== -1) mounted.splice(idx, 1);
    notify();
  };
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function ToastViewport(): ReactElement | null {
  const { message } = useToast();
  const [id] = useState(() => nextId++);

  useEffect(() => registerViewport(id), [id]);

  const primaryId = useSyncExternalStore(
    subscribe,
    () => (mounted.length > 0 ? mounted[0] : undefined),
    () => undefined,
  );

  // Only the elected primary live instance renders; duplicates are inert.
  if (primaryId !== id) return null;
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-toast-from-nav z-toast flex justify-center px-16">
      <Toast message={message} />
    </div>
  );
}
