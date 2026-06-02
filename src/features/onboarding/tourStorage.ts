/**
 * Onboarding tour storage + step config.
 *
 * Kept separate from OnboardingTour.tsx so the component file only exports
 * components (Fast Refresh / react-refresh requirement). The helpers here
 * are pure data + localStorage shims — they have no React dependency.
 */

// v2 (was v1): the parent-only `family` step was rewritten to focus on
// inviting (link-based redeem, 14-day TTL — see inviteService.INVITE_TTL_MS).
// Bumping the version re-shows the tour for users who already dismissed v1
// so they actually see the updated nudge; v1 content was less actionable.
// Future material changes (added/removed/reordered step OR substantive copy
// changes on an existing step) should bump this again.
export const TOUR_STORAGE_KEY = 'familyhq.onboarding.v2';

export interface TourStep {
  id: string;
  titleKey: string;
  bodyKey: string;
  /** Step is only added to the tour when this predicate matches the role. */
  rolesShown: ReadonlyArray<'parent' | 'member'>;
}

// Step content keys map to onboarding.steps.<id>.{title,body} in en/fr.json.
// The role gate is in code (not the locale file) so the per-role tour is
// always consistent — no translator can accidentally drop a role-scoped step.
export const TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: 'welcome',
    titleKey: 'onboarding.steps.welcome.title',
    bodyKey: 'onboarding.steps.welcome.body',
    rolesShown: ['parent', 'member'],
  },
  {
    id: 'calendar',
    titleKey: 'onboarding.steps.calendar.title',
    bodyKey: 'onboarding.steps.calendar.body',
    rolesShown: ['parent', 'member'],
  },
  {
    id: 'board',
    titleKey: 'onboarding.steps.board.title',
    bodyKey: 'onboarding.steps.board.body',
    rolesShown: ['parent', 'member'],
  },
  {
    id: 'chores',
    titleKey: 'onboarding.steps.chores.title',
    bodyKey: 'onboarding.steps.chores.body',
    rolesShown: ['parent', 'member'],
  },
  {
    id: 'allowance',
    titleKey: 'onboarding.steps.allowance.title',
    bodyKey: 'onboarding.steps.allowance.body',
    rolesShown: ['parent', 'member'],
  },
  // Parent-only: explains the family management screen that members can't reach.
  {
    id: 'family',
    titleKey: 'onboarding.steps.family.title',
    bodyKey: 'onboarding.steps.family.body',
    rolesShown: ['parent'],
  },
];

export function stepsForRole(role: 'parent' | 'member'): ReadonlyArray<TourStep> {
  return TOUR_STEPS.filter((s) => s.rolesShown.includes(role));
}

/**
 * True if the user has already completed (or skipped) the tour at the
 * current version. Defensive: localStorage can throw in private mode or
 * when storage is full; in either case we return true so the tour does
 * NOT re-appear on every page load.
 */
export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === 'done';
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, 'done');
  } catch {
    // Best-effort; if the write fails the tour will re-show next session
    // and the user can skip it. Worse than silent success, better than a
    // crash on first sign-in.
  }
}

/** Used by the "Replay tour" affordance in Account. */
export function resetTour(): void {
  try {
    localStorage.removeItem(TOUR_STORAGE_KEY);
  } catch {
    // ignore
  }
}
