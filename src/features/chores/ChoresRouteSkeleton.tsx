/**
 * Suspense fallback for the lazy-loaded ChoresRoute chunk.
 * Mirrors the chore-list layout (header + 4 row entries).
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonBlock } from '../../components';

export function ChoresRouteSkeleton(): ReactElement {
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
      <SkeletonBlock h="h-16" w="w-1/3" />
      <div className="flex flex-col gap-12 rounded-card bg-surface-card p-16 shadow-card">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-12">
            <SkeletonBlock h="h-32" w="w-32" rounded="rounded-pill" />
            <div className="flex flex-1 flex-col gap-4">
              <SkeletonBlock h="h-16" />
              <SkeletonBlock h="h-12" w="w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
