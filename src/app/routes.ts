/**
 * Route table + guard predicates (Task 7, handoff §Navigation).
 *
 * Pure data/functions so the guard + nav-hiding logic is unit-testable without
 * rendering the router. add_chore/add_event/compose are MODAL routes that hide
 * the BottomNav. add_chore, add_event, and family management are parent-only (a member is
 * bounced to the dashboard). UI gating is cosmetic — firestore.rules is the
 * real authority boundary.
 */
import type { Role } from '../lib/types';

export type ScreenId =
  | 'dashboard'
  | 'calendar'
  | 'board'
  | 'chores'
  | 'allowance'
  | 'family'
  | 'accessibility'
  | 'add_chore'
  | 'add_event'
  | 'compose'
  | 'account_switcher';

export interface RouteMeta {
  id: ScreenId;
  path: string;
  isModal: boolean;
  parentOnly: boolean;
}

export const ROUTES: Record<ScreenId, RouteMeta> = {
  dashboard: { id: 'dashboard', path: '/', isModal: false, parentOnly: false },
  calendar: {
    id: 'calendar',
    path: '/calendar',
    isModal: false,
    parentOnly: false,
  },
  board: { id: 'board', path: '/board', isModal: false, parentOnly: false },
  chores: { id: 'chores', path: '/chores', isModal: false, parentOnly: false },
  // Allowance History — a read-only ledger view. Non-modal (shows the nav) and
  // NOT parent-only (a member sees their own ledger; a parent picks a child).
  allowance: {
    id: 'allowance',
    path: '/allowance',
    isModal: false,
    parentOnly: false,
  },
  family: { id: 'family', path: '/family', isModal: false, parentOnly: true },
  // Accessibility statement (AODA launch-gate item). Reachable from both
  // signed-out (login footer) and signed-in (Account screen) — see
  // App.tsx + AppShell.tsx. NOT parent-only and NOT modal.
  accessibility: {
    id: 'accessibility',
    path: '/accessibility',
    isModal: false,
    parentOnly: false,
  },
  add_chore: {
    id: 'add_chore',
    path: '/chores/new',
    isModal: true,
    parentOnly: true,
  },
  add_event: {
    id: 'add_event',
    path: '/calendar/new',
    isModal: true,
    parentOnly: true,
  },
  compose: {
    id: 'compose',
    path: '/board/new',
    isModal: true,
    parentOnly: false,
  },
  account_switcher: {
    id: 'account_switcher',
    path: '/switch-account',
    isModal: true,
    parentOnly: false,
  },
};

export function hidesBottomNav(screen: ScreenId): boolean {
  return ROUTES[screen].isModal;
}

export function canAccess(screen: ScreenId, role: Role): boolean {
  const meta = ROUTES[screen];
  if (meta.parentOnly) {
    return role === 'parent';
  }
  return true;
}
