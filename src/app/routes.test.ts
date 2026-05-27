/**
 * App routing + guards — unit contract (Task 7).
 *
 * Level: unit (pure functions, no router render). Asserts the AC:
 *  - member is bounced off parent-only routes (add_chore, family management)
 *  - modal routes (add_chore/add_event/compose) hide the BottomNav
 *  - non-modal app routes show the nav
 *
 * FAILS today: src/app/routes.ts is a contract stub (declare-only).
 */
import { describe, expect, it } from 'vitest';
import { ROUTES, canAccess, hidesBottomNav, type ScreenId } from './routes';

const MODAL_SCREENS: ScreenId[] = ['add_chore', 'add_event', 'compose'];
const NAV_SCREENS: ScreenId[] = ['dashboard', 'calendar', 'board', 'chores'];
const PARENT_ONLY: ScreenId[] = ['add_chore', 'family'];

describe('route metadata', () => {
  it('defines a route for every screen id', () => {
    const ids: ScreenId[] = [
      'dashboard',
      'calendar',
      'board',
      'chores',
      'family',
      'add_chore',
      'add_event',
      'compose',
      'account_switcher',
    ];
    for (const id of ids) {
      expect(ROUTES[id], `ROUTES is missing ${id}`).toBeDefined();
      expect(ROUTES[id].id).toBe(id);
    }
  });
});

describe('modal routes hide the BottomNav', () => {
  for (const screen of MODAL_SCREENS) {
    it(`hides BottomNav on ${screen}`, () => {
      expect(hidesBottomNav(screen)).toBe(true);
      expect(ROUTES[screen].isModal).toBe(true);
    });
  }

  for (const screen of NAV_SCREENS) {
    it(`shows BottomNav on ${screen}`, () => {
      expect(hidesBottomNav(screen)).toBe(false);
      expect(ROUTES[screen].isModal).toBe(false);
    });
  }
});

describe('parent-only route guards (member is bounced)', () => {
  for (const screen of PARENT_ONLY) {
    it(`marks ${screen} parent-only`, () => {
      expect(ROUTES[screen].parentOnly).toBe(true);
    });

    it(`DENIES a member access to ${screen}`, () => {
      expect(canAccess(screen, 'member')).toBe(false);
    });

    it(`ALLOWS a parent access to ${screen}`, () => {
      expect(canAccess(screen, 'parent')).toBe(true);
    });
  }

  it('allows a member onto the shared chores screen (member view exists)', () => {
    expect(canAccess('chores', 'member')).toBe(true);
  });

  it('allows a member onto the dashboard', () => {
    expect(canAccess('dashboard', 'member')).toBe(true);
  });

  it('allows a member onto add_event and compose (not parent-only)', () => {
    expect(canAccess('add_event', 'member')).toBe(true);
    expect(canAccess('compose', 'member')).toBe(true);
  });
});
