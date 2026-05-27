import type { ReactElement, ReactNode } from 'react';

export type BadgeTone =
  | 'mute'
  | 'indigo'
  | 'amber'
  | 'ok'
  | 'info'
  | 'danger'
  | 'school'
  | 'sports'
  | 'family'
  | 'work';

export interface BadgeProps {
  tone: BadgeTone;
  size?: 'sm' | 'md';
  children: ReactNode;
}

// Every tone pairs a text/icon label — color is never the sole signal
// (color-blind safe, WCAG 1.4.1). The child content carries the meaning.
const TONE_CLASS: Record<BadgeTone, string> = {
  mute: 'bg-surface-line2 text-ink-2',
  indigo: 'bg-brand-light text-brand',
  amber: 'bg-accent-light text-accent-dark',
  ok: 'bg-status-ok-light text-status-ok-text',
  info: 'bg-status-info-light text-status-info-text',
  danger: 'bg-status-danger-light text-status-danger-text',
  school: 'bg-category-school-bg text-category-school-text',
  sports: 'bg-category-sports-bg text-category-sports-text',
  family: 'bg-category-family-bg text-category-family-text',
  work: 'bg-category-work-bg text-category-work-text',
};

export function Badge(props: BadgeProps): ReactElement {
  const { tone, size = 'md', children } = props;
  const heightClass = size === 'sm' ? 'h-badge-sm' : 'h-badge';
  return (
    <span
      className={`inline-flex ${heightClass} items-center rounded-full px-10 text-badge font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}
