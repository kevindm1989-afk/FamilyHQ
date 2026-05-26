/**
 * CONTRACT — route table + guard predicates (Task 7, handoff §Navigation).
 *
 * Signatures + the static route metadata only; the implementer wires these into
 * the React Router tree. Kept as pure data/functions so the guard + nav-hiding
 * logic is unit-testable without rendering the whole router.
 *
 * Screen ids (handoff): dashboard | calendar | board | chores | add_chore |
 * add_event | compose | account_switcher. add_chore/add_event/compose are
 * MODAL routes that hide the BottomNav. add_chore is parent-only (a member is
 * bounced). family management is parent-only.
 */
import type { Role } from '../lib/types';

export type ScreenId =
  | 'dashboard'
  | 'calendar'
  | 'board'
  | 'chores'
  | 'family'
  | 'add_chore'
  | 'add_event'
  | 'compose'
  | 'account_switcher';

export interface RouteMeta {
  id: ScreenId;
  path: string;
  /** Modal routes hide the BottomNav and show a Back button. */
  isModal: boolean;
  /** Parent-only routes bounce a member to the dashboard. */
  parentOnly: boolean;
}

export declare const ROUTES: Record<ScreenId, RouteMeta>;

/** True when the BottomNav should be HIDDEN for this screen (modal routes). */
export declare function hidesBottomNav(screen: ScreenId): boolean;

/** True when a user with `role` may view `screen` (false => bounce). */
export declare function canAccess(screen: ScreenId, role: Role): boolean;
