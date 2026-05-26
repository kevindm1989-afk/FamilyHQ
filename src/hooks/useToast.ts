/**
 * CONTRACT — toast queue (Task 7, style-guide §Toast).
 *
 * Signatures only; implementer writes the provider + hook bodies. Every user
 * action (success AND error) routes through the toast. A toast auto-dismisses
 * after `TOAST_DURATION_MS` (1.8s, design-tokens components.toast.autoDismiss);
 * the visible toast is announced (role=status / aria-live=polite — the
 * component, not this hook, owns the DOM).
 *
 * Errors passed to `showToast` must already be user-safe (no raw Firebase/PII).
 */
import type { ReactElement, ReactNode } from 'react';

export const TOAST_DURATION_MS = 1800;

export interface ToastApi {
  /** The currently-visible toast message, or null when none. */
  message: string | null;
  /** Queue a toast; it becomes visible and auto-dismisses after the duration. */
  showToast: (message: string) => void;
  /** Dismiss the current toast immediately. */
  dismiss: () => void;
}

export declare function ToastProvider(props: { children: ReactNode }): ReactElement;

export declare function useToast(): ToastApi;
