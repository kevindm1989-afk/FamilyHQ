/**
 * NotificationPreferences — default-value contract (PR B1).
 *
 * The `NotificationPreferences` TYPE is exported from `src/lib/types.ts`
 * (so the rest of the app can import it from the canonical type module).
 * This feature-local module owns the DEFAULT VALUE + the canonical key
 * list — the runtime constants the UI and any future server-side code use
 * to render category toggles in a stable order.
 *
 * Safe-by-default contract (architect's brief §1 + B1 acceptance):
 *   - `pushEnabled: false` — no push without explicit opt-in.
 *   - Every category is `false` — per-feature opt-in is required.
 *   - `showDetails: false` — v1 invariant (no PI on the lock screen).
 *   - `updatedAt: 0` — sentinel; mutators stamp `Date.now()` on real writes.
 *
 * Defaults are exposed as a frozen literal so a caller that spreads them
 * gets a fresh object (no mutable-singleton trap) and a caller that
 * accidentally tries to mutate the constant fails loudly in dev.
 */
import type { NotificationCategoryKey, NotificationPreferences } from '../../lib/types';

/**
 * Canonical, ORDERED list of category keys. The UI uses this list to render
 * toggles in a stable order; server-side code can iterate the same way.
 */
export const NOTIFICATION_CATEGORY_KEYS: readonly NotificationCategoryKey[] = Object.freeze([
  'choreApprovalsNeeded',
  'wishlistApprovalsNeeded',
  'myChoreResolved',
  'myWishlistResolved',
  'familyBoardPosts',
  'familyTodos',
] as const);

/**
 * Safe-by-default preferences shape — master OFF, every category OFF,
 * `showDetails` OFF, `updatedAt` = 0 (sentinel — mutators stamp `Date.now()`).
 *
 * The frozen literal is structurally-equal across spreads but a fresh
 * object on every spread (Object.freeze does not deep-freeze, but `{...x}`
 * always produces a new top-level object).
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.freeze({
  pushEnabled: false,
  showDetails: false,
  updatedAt: 0,
  categories: Object.freeze({
    choreApprovalsNeeded: false,
    wishlistApprovalsNeeded: false,
    myChoreResolved: false,
    myWishlistResolved: false,
    familyBoardPosts: false,
    familyTodos: false,
  }) as Record<NotificationCategoryKey, boolean>,
});
