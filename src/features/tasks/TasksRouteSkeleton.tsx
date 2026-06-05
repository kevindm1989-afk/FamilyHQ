/**
 * Suspense fallback for the lazy-loaded TasksRoute chunk. Mirrors the tabs
 * shell + a small stack of todo rows so the chunk swap is perceptually
 * invisible.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonBlock } from '../../components';

export function TasksRouteSkeleton(): ReactElement {
  const { t } = useTranslation();
  return (
    <section
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={t('common.loading')}
      className="flex flex-col gap-12 px-16 pt-16"
    >
      <SkeletonBlock h="h-32" w="w-1/2" />
      <SkeletonBlock h="h-44" w="w-full" rounded="rounded-control" />
      {Array.from({ length: 3 }).map((_, i) => (
        <SkeletonBlock key={i} h="h-72" w="w-full" />
      ))}
    </section>
  );
}
