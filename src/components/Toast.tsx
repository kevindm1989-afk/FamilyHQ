import type { ReactElement } from 'react';

export interface ToastProps {
  message: string;
}

/**
 * Toast pill. role=status + aria-live=polite so the message is announced, not
 * only shown. Motion is opacity-only (already reduced-motion safe); the 1.8s
 * auto-dismiss timer lives in the ToastProvider.
 */
export function Toast(props: ToastProps): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center rounded-full bg-ink px-16 py-10 text-label font-semibold text-ink-on-dark shadow-toast"
    >
      {props.message}
    </div>
  );
}
