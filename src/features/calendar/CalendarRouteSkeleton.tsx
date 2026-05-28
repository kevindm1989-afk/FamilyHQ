/**
 * Suspense fallback for the lazy-loaded CalendarRoute chunk.
 * Mirrors the month-grid + upcoming-events layout.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonBlock } from '../../components';

export function CalendarRouteSkeleton(): ReactElement {
  const { t } = useTranslation();
  return (
    <section
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={t('common.loading')}
      className="flex flex-col gap-16 px-16 pt-16"
    >
      <SkeletonBlock h="h-32" w="w-1/2" />
      <SkeletonBlock h="h-16" w="w-1/4" />
      <div className="grid grid-cols-7 gap-4 rounded-card bg-surface-card p-16 shadow-card">
        {Array.from({ length: 35 }).map((_, i) => (
          <SkeletonBlock key={i} h="h-32" rounded="rounded-control" />
        ))}
      </div>
      <div className="flex flex-col gap-8 rounded-card bg-surface-card p-16 shadow-card">
        <SkeletonBlock h="h-20" w="w-1/3" />
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} h="h-16" />
        ))}
      </div>
    </section>
  );
}
