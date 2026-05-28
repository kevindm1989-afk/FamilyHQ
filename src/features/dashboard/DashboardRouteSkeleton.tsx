/**
 * Suspense fallback for the lazy-loaded DashboardRoute chunk.
 *
 * Mirrors the destination layout (greeting hero + 5 list cards: earnings,
 * chores, approvals, events, posts) so the chunk swap is perceptually
 * invisible on a slow connection. Eagerly importable — the whole file is
 * <1 KB, no feature deps, so it ships in AuthedApp's main chunk and renders
 * instantly the moment the user lands on `/`.
 *
 * Accessibility: a single role="status" + aria-live announces "Loading dashboard"
 * to assistive tech; the placeholder rectangles are aria-hidden so AT
 * doesn't hear them.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonBlock } from '../../components';

export function DashboardRouteSkeleton(): ReactElement {
  const { t } = useTranslation();
  return (
    <section
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={t('common.loading')}
      className="flex flex-col gap-16 px-16 pt-16"
    >
      <SkeletonBlock h="h-32" w="w-2/3" />
      <SkeletonBlock h="h-16" w="w-1/3" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-12 rounded-card bg-surface-card p-16 shadow-card">
          <SkeletonBlock h="h-20" w="w-1/2" />
          <SkeletonBlock h="h-16" />
          <SkeletonBlock h="h-16" w="w-5/6" />
          <SkeletonBlock h="h-16" w="w-3/4" />
        </div>
      ))}
    </section>
  );
}
