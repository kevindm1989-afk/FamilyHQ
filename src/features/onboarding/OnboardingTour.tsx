/**
 * First-run onboarding tour.
 *
 * A modal overlay that introduces the four primary surfaces (Calendar,
 * Board, Chores, Allowance) plus a parent-only Family-management step.
 * Shown the FIRST time a signed-in user lands on the dashboard, then
 * stored as seen in localStorage so it never re-fires on its own. Users
 * can replay it from the Account screen.
 *
 * Why a modal (not a coach-mark tooltip tour):
 *   Coach-mark tours need precise positioning relative to each target
 *   element, which is fragile across breakpoints, locale lengths, and
 *   reduced-motion preferences. A modal tour is honest about its
 *   takeover, supports focus trapping cleanly, and is the same shape on
 *   every device.
 *
 * Storage versioning:
 *   The key is `familyhq.onboarding.v1`. If the tour content materially
 *   changes (extra step, reordered, removed step), bump the version so
 *   the new tour fires once per returning user.
 *
 * A11y:
 *   - role="dialog" aria-modal aria-labelledby pinned to the step heading
 *   - Focus moves to the dialog on open; restored to whoever invoked it
 *     on close (DashboardRoute owns the trigger, so focus restoration is
 *     a no-op there — the dashboard's main h1 picks up focus).
 *   - Esc closes (counts as "skip").
 *   - Buttons: Back / Skip / Next / Done. All keyboard-operable.
 *
 * Storage helpers + step config live in ./tourStorage.ts so this file
 * only exports components (Fast Refresh requirement).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { stepsForRole } from './tourStorage';

interface Props {
  role: 'parent' | 'member';
  onClose: () => void;
}

export function OnboardingTour({ role, onClose }: Props): ReactElement {
  const { t } = useTranslation();
  const steps = stepsForRole(role);
  const [stepIndex, setStepIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = 'onboarding-step-heading';

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const step = steps[stepIndex]!;

  // Move focus into the dialog when it mounts, and on every step change so
  // a screen reader hears the new step's heading. Esc closes.
  useEffect(() => {
    dialogRef.current?.focus();
  }, [stepIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const next = (): void => {
    if (isLast) {
      onClose();
    } else {
      setStepIndex((i) => i + 1);
    }
  };
  const back = (): void => {
    if (!isFirst) setStepIndex((i) => i - 1);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      ref={dialogRef}
      tabIndex={-1}
      // Full-viewport overlay so the user knows this is a takeover, not a
      // toast. Scrim is the same surface-scrim token the BottomSheet uses.
      className="fixed inset-0 z-modal flex items-center justify-center bg-surface-scrim px-16 focus:outline-none"
    >
      <div className="mx-auto flex w-full max-w-app flex-col gap-16 rounded-card bg-surface-card p-24 shadow-card">
        <p className="text-meta text-ink-mute" aria-live="polite">
          {t('onboarding.stepCounter', { current: stepIndex + 1, total: steps.length })}
        </p>
        <h1 id={headingId} className="text-display font-display font-extrabold text-ink">
          {t(step.titleKey)}
        </h1>
        <p className="text-body text-ink">{t(step.bodyKey)}</p>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-12">
          <button
            type="button"
            onClick={onClose}
            className="text-meta text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {t('onboarding.skip')}
          </button>
          <div className="flex gap-8">
            <button
              type="button"
              onClick={back}
              disabled={isFirst}
              className="inline-flex min-h-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-16 py-8 text-body font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            >
              {t('onboarding.back')}
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex min-h-tap items-center justify-center rounded-control bg-brand px-16 py-8 text-body font-semibold text-brand-on focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            >
              {isLast ? t('onboarding.done') : t('onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
