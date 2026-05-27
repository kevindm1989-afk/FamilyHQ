import type { ReactElement, ReactNode } from 'react';

export interface CardProps {
  onClick?: () => void;
  children: ReactNode;
}

const BASE = 'block w-full rounded-card bg-surface-card p-16 text-left shadow-card';

/**
 * Card surface. Non-interactive by default (a plain container). When `onClick`
 * is provided it becomes a real <button> — one tap target with a focus ring and
 * a subtle press transition (reduced-motion drops the transition).
 */
export function Card(props: CardProps): ReactElement {
  const { onClick, children } = props;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${BASE} transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus active:bg-surface-line2 motion-reduce:transition-none`}
      >
        {children}
      </button>
    );
  }

  return <div className={BASE}>{children}</div>;
}
