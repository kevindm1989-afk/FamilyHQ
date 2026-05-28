/**
 * Suspense fallback for the lazy-loaded BoardRoute chunk.
 * Mirrors the family bulletin board's post-card stack.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonBlock } from '../../components';

export function BoardRouteSkeleton(): ReactElement {
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
      {Array.from({ length: 3 }).map((_, i) => (
        <article
          key={i}
          className="flex flex-col gap-8 rounded-card bg-surface-card p-16 shadow-card"
        >
          <SkeletonBlock h="h-16" w="w-1/3" />
          <SkeletonBlock h="h-16" />
          <SkeletonBlock h="h-16" w="w-5/6" />
          <SkeletonBlock h="h-16" w="w-2/3" />
        </article>
      ))}
    </section>
  );
}
