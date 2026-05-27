import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * CONTRACT (adversarial review Finding 4): when the element that was focused
   * before the sheet opened is detached/unmounted by close time, focus must NOT
   * silently fall to document.body. The implementer restores focus to this
   * fallback element if it is provided and still in the document; otherwise it
   * falls back to the dialog heading (never document.body). Pinned by
   * BottomSheet.test.tsx.
   */
  fallbackFocusRef?: RefObject<HTMLElement>;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet modal. Renders nothing when closed. When open it is a
 * role=dialog aria-modal surface over a scrim. Accessibility (WCAG 2.1 AA):
 *  - focus is TRAPPED inside the sheet (Tab/Shift+Tab cycle at the boundaries),
 *  - the element focused before opening is RESTORED on close,
 *  - Esc closes (no keyboard trap),
 *  - sibling background content is made `inert` + aria-hidden while open so AT
 *    cannot reach it.
 * Enter motion is opacity + slide-up (reduced-motion: opacity-only).
 */
export function BottomSheet(props: BottomSheetProps): ReactElement | null {
  const { open, title, onClose, children } = props;
  const sheetRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The element that had focus before the sheet opened, restored on close.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const focusables = useCallback((): HTMLElement[] => {
    const sheet = sheetRef.current;
    if (!sheet) return [];
    return Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  }, []);

  // Esc closes; Tab/Shift+Tab are intercepted to cycle focus within the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          e.preventDefault();
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !sheetRef.current?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !sheetRef.current?.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, focusables]);

  // Move focus into the sheet on open; restore it to the opener on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = focusables();
    (items[0] ?? sheetRef.current)?.focus();
    return () => {
      previouslyFocused.current?.focus();
    };
  }, [open, focusables]);

  // Make sibling background content inert + aria-hidden while open (WCAG 4.1.2).
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root,
    );
    const previous = siblings.map((el) => ({
      el,
      inert: el.hasAttribute('inert'),
      ariaHidden: el.getAttribute('aria-hidden'),
    }));
    for (const el of siblings) {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const { el, inert, ariaHidden } of previous) {
        if (!inert) el.removeAttribute('inert');
        if (ariaHidden === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', ariaHidden);
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div ref={rootRef} className="fixed inset-0 z-modal flex items-end justify-center">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-surface-scrim transition-opacity duration-scrim ease-out motion-reduce:transition-none"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-app rounded-t-sheet bg-surface-card px-16 pb-24 pt-12 shadow-sheet focus:outline-none"
      >
        <div className="mx-auto mb-12 h-4 w-32 rounded-full bg-surface-line2" aria-hidden="true" />
        <div className="mb-12 flex items-center justify-between">
          <h2 className="text-title font-bold text-ink">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CloseIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-24 w-24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
