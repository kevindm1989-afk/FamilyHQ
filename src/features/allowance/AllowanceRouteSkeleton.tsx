/**
 * Suspense fallback for the lazy-loaded AllowanceRoute chunk.
 * Mirrors the balance hero + ledger-row layout.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonBlock } from '../../components';

export function AllowanceRouteSkeleton(): ReactElement {
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
      <div className="flex flex-col items-center gap-8 rounded-card bg-surface-card p-24 shadow-card">
        <SkeletonBlock h="h-12" w="w-1/3" />
        <SkeletonBlock h="h-32" w="w-1/2" />
      </div>
      <div className="flex flex-col gap-12 rounded-card bg-surface-card p-16 shadow-card">
        <SkeletonBlock h="h-20" w="w-1/3" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-12">
            <SkeletonBlock h="h-16" w="w-2/3" />
            <SkeletonBlock h="h-16" w="w-16" />
          </div>
        ))}
      </div>
    </section>
  );
}
