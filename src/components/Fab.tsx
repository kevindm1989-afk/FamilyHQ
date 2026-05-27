import type { ReactElement } from 'react';

export interface FabProps {
  label: string; // accessible label (aria-label)
  onClick: () => void;
}

/**
 * Floating action button: a 56px indigo circle with the brand-elevated shadow.
 * The accessible label is required (icon-only control).
 */
export function Fab(props: FabProps): ReactElement {
  const { label, onClick } = props;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-fab w-fab items-center justify-center rounded-full bg-brand text-brand-on shadow-brand-rest transition-shadow duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus active:shadow-brand-active motion-reduce:transition-none"
    >
      <PlusIcon />
    </button>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-24 w-24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
