import type { ReactElement, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'amber' | 'soft' | 'ghost' | 'success' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  children: ReactNode;
}

// a11y override (style-guide §2): amber + success use DARK INK text, never
// white (white-on-amber 2.1:1 / white-on-green 1.9:1 fail AA).
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-on active:bg-brand-dark hover:bg-brand-dark',
  amber: 'bg-accent text-onAccent active:bg-accent-dark hover:bg-accent-dark',
  soft: 'bg-brand-light text-brand hover:bg-surface-line2',
  ghost: 'bg-transparent border border-surface-line text-brand hover:bg-surface-line2',
  success: 'bg-status-ok text-onAccent hover:opacity-90',
  danger: 'bg-status-danger-light text-status-danger-text hover:opacity-90',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-btn-sm px-14 text-label',
  md: 'h-btn-md px-20 text-body',
  lg: 'h-btn-lg px-24 text-bodyLg',
};

/**
 * Button primitive. Disabled stays in the tab order with aria-disabled (so SR
 * users can discover it, WCAG 1.4.11) rather than using the native `disabled`
 * attribute which removes it from the tree. Loading sets aria-busy and keeps
 * the same footprint.
 */
export function Button(props: ButtonProps): ReactElement {
  const {
    variant = 'primary',
    size = 'md',
    disabled = false,
    loading = false,
    onClick,
    type = 'button',
    children,
  } = props;

  const inactive = disabled || loading;

  return (
    <button
      type={type}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      onClick={inactive ? undefined : onClick}
      className={`inline-flex min-h-tap items-center justify-center gap-8 rounded-control font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

function Spinner(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-16 w-16 animate-spin motion-reduce:animate-none"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
