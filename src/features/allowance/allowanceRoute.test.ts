/**
 * Allowance History route wiring — unit contract (Allowance History feature).
 *
 * Level: unit (pure route metadata, no router render). Pins the new
 * ScreenId 'allowance' + its route: it must be NON-MODAL (shows the BottomNav)
 * and NOT parent-only (a member sees their own ledger; a parent picks a child).
 *
 * FAILS today: the 'allowance' route is a freshly-added contract entry — these
 * assertions go red until the route is wired AND a member is allowed onto it.
 */
import { describe, expect, it } from 'vitest';
import { ROUTES, canAccess, hidesBottomNav } from '../../app/routes';

describe('allowance route metadata', () => {
  it('defines an "allowance" route whose id matches', () => {
    expect(ROUTES.allowance, 'ROUTES is missing the allowance screen').toBeDefined();
    expect(ROUTES.allowance.id).toBe('allowance');
  });

  it('has a concrete, non-empty path', () => {
    expect(ROUTES.allowance.path.length).toBeGreaterThan(0);
    expect(ROUTES.allowance.path.startsWith('/')).toBe(true);
  });

  it('is NON-modal (the BottomNav stays visible)', () => {
    expect(ROUTES.allowance.isModal).toBe(false);
    expect(hidesBottomNav('allowance')).toBe(false);
  });

  it('is NOT parent-only (a member can reach their own allowance history)', () => {
    expect(ROUTES.allowance.parentOnly).toBe(false);
    expect(canAccess('allowance', 'member')).toBe(true);
  });

  it('also allows a parent (parent picks a child to view)', () => {
    expect(canAccess('allowance', 'parent')).toBe(true);
  });
});
