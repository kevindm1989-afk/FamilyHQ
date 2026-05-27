import type { ReactElement } from 'react';
import { Toast } from '../components';
import { useToast } from '../hooks/useToast';

/**
 * Renders the currently-visible toast (if any) in a fixed bottom viewport. The
 * Toast itself is the polite live region; this only positions it above the nav.
 */
export function ToastViewport(): ReactElement | null {
  const { message } = useToast();
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-toast-from-nav z-toast flex justify-center px-16">
      <Toast message={message} />
    </div>
  );
}
