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
  | 'tasks'
  | 'allowance'
  | 'family'
  | 'goals'
  | 'accessibility'
  | 'privacy'
  | 'terms'
  | 'join'
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
  // Tasks — unified Task Management surface (To-Do List + Routine Checklists).
  // NOT parent-only and NOT modal: any active same-family caller has full CRUD
  // per the firestore.rules todos / checklistTemplates / checklistInstances
  // matches landed in PR A. Lives on the 5th BottomNav slot.
  tasks: { id: 'tasks', path: '/tasks', isModal: false, parentOnly: false },
  // Allowance History — a read-only ledger view. Non-modal (shows the nav) and
  // NOT parent-only (a member sees their own ledger; a parent picks a child).
  allowance: {
    id: 'allowance',
    path: '/allowance',
    isModal: false,
    parentOnly: false,
  },
  family: { id: 'family', path: '/family', isModal: false, parentOnly: true },
  // Savings Goals & Jars (Feature 1). NOT parent-only: members manage their
  // own goals; parents see the family roll-up. Non-modal — has its own
  // dedicated screen reached from the dashboard widgets.
  goals: { id: 'goals', path: '/goals', isModal: false, parentOnly: false },
  // Accessibility statement (AODA launch-gate item). Reachable from both
  // signed-out (login footer) and signed-in (Account screen) — see
  // App.tsx + AppShell.tsx. NOT parent-only and NOT modal.
  accessibility: {
    id: 'accessibility',
    path: '/accessibility',
    isModal: false,
    parentOnly: false,
  },
  // Privacy + Terms (launch-gate items). Both reachable WITHOUT auth — a
  // visitor MUST be able to read the privacy policy before deciding to sign
  // up. Both ship as drafts authored by the engineering team; the page itself
  // says so and links to the contact for substantive review.
  privacy: {
    id: 'privacy',
    path: '/privacy',
    isModal: false,
    parentOnly: false,
  },
  terms: {
    id: 'terms',
    path: '/terms',
    isModal: false,
    parentOnly: false,
  },
  // Public invite-redeem page. Path includes a :inviteId param — when a
  // parent shares the link `<origin>/join/<id>`, the JoinScreen at this
  // route loads the invite, shows the family details, and walks the
  // invitee through signup (which writes their users doc with familyId
  // from the invite). Never accessed while signed in.
  join: {
    id: 'join',
    path: '/join/:inviteId',
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
