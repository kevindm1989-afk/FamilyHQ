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

interface SkeletonBlockProps {
  /** Tailwind height class (e.g. 'h-16', 'h-24'). */
  h?: string;
  /** Tailwind width class (e.g. 'w-full', 'w-2/3'). Defaults to 'w-full'. */
  w?: string;
  /** Tailwind radius class. Defaults to 'rounded-control'. */
  rounded?: string;
  className?: string;
}

/**
 * A single token-coloured placeholder rectangle. The shape-layout primitive
 * for per-route Suspense fallbacks — composed into route-specific skeletons
 * (DashboardRouteSkeleton, CalendarRouteSkeleton, etc.) that approximate the
 * destination layout so the chunk swap is perceptually invisible. Pure
 * decoration: aria-hidden so AT only hears the parent skeleton's aria-live
 * announcement once.
 */
export function SkeletonBlock(props: SkeletonBlockProps): ReactElement {
  const { h = 'h-16', w = 'w-full', rounded = 'rounded-control', className = '' } = props;
  return (
    <span
      aria-hidden="true"
      className={`block bg-surface-line2 ${h} ${w} ${rounded} ${className}`.trim()}
    />
  );
}
