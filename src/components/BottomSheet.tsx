import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet modal. Renders nothing when closed. When open it is a
 * role=dialog aria-modal surface over a scrim; Esc or the scrim/close control
 * closes it and focus moves into the sheet. Enter motion is opacity + slide-up
 * (reduced-motion: opacity-only, no translate).
 */
export function BottomSheet(props: BottomSheetProps): ReactElement | null {
  const { open, title, onClose, children } = props;
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    sheetRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center">
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
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
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
