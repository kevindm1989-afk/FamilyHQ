import type { ReactElement } from 'react';

export interface SkeletonProps {
  label?: string;
}

/**
 * Loading affordance. The handoff uses no skeleton shimmer (local state is
 * fast) — this is a token-coloured placeholder block with aria-busy and a
 * visible label for assistive tech.
 */
export function Skeleton(props: SkeletonProps): ReactElement {
  const { label = 'Loading' } = props;
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex items-center justify-center px-16 py-24 text-meta text-ink-mute"
    >
      <span
        aria-hidden="true"
        className="mr-8 h-16 w-16 animate-spin rounded-full border-2 border-surface-line2 border-t-brand motion-reduce:animate-none"
      />
      {label}
    </div>
  );
}
