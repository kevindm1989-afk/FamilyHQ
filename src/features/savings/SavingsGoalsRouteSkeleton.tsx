/**
 * Suspense fallback for the lazy-loaded SavingsGoalsRoute chunk.
 * Mirrors the goal-card stack of the live screen.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { SkeletonBlock } from '../../components';

export function SavingsGoalsRouteSkeleton(): ReactElement {
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
        <SkeletonBlock key={i} h="h-80" w="w-full" />
      ))}
    </section>
  );
}
