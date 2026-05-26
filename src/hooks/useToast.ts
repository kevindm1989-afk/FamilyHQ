/**
 * Toast queue (Task 7, style-guide §Toast).
 *
 * Every user action (success AND error) routes through the toast. A toast
 * auto-dismisses after `TOAST_DURATION_MS` (1.8s). Errors passed to `showToast`
 * must already be user-safe (no raw Firebase/PII) — mapping happens at the
 * feature-service boundary, not here.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export const TOAST_DURATION_MS = 1800;

export interface ToastApi {
  message: string | null;
  showToast: (message: string) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

export function ToastProvider(props: { children: ReactNode }): ReactElement {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setMessage(null);
  }, [clearTimer]);

  const showToast = useCallback(
    (next: string) => {
      clearTimer();
      setMessage(next);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setMessage(null);
      }, TOAST_DURATION_MS);
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo<ToastApi>(
    () => ({ message, showToast, dismiss }),
    [message, showToast, dismiss],
  );

  return createElement(ToastContext.Provider, { value }, props.children);
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
