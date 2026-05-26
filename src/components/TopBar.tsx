import type { ReactElement, ReactNode } from 'react';

export interface TopBarProps {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
}

/**
 * App top bar: 56px tall, no border, absolutely-centered title with fixed-width
 * back/right slots. The Back button only appears when onBack is provided (a
 * top-level screen omits it).
 */
export function TopBar(props: TopBarProps): ReactElement {
  const { title, onBack, right } = props;

  return (
    <header className="relative flex h-topbar items-center bg-surface-bg px-16">
      <div className="flex w-backslot items-center justify-start">
        {onBack && (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <ChevronLeft />
          </button>
        )}
      </div>

      {title && (
        <h1 className="pointer-events-none absolute inset-x-0 text-center text-topbar font-bold text-ink">
          {title}
        </h1>
      )}

      <div className="ml-auto flex w-backslot items-center justify-end">{right}</div>
    </header>
  );
}

function ChevronLeft(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-24 w-24" fill="none" aria-hidden="true">
      <path
        d="M15 18l-6-6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
