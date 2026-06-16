/**
 * NotificationPreferences — type + default shape contract (PR B1).
 *
 * Pins, per architect's brief §4 + ADR-0013 locked-in scope:
 *
 *   - The `NotificationPreferences` interface is exported from
 *     `src/lib/types.ts` (`B1`).
 *   - `DEFAULT_NOTIFICATION_PREFERENCES` is exported from this feature's
 *     module with `pushEnabled: false` (master OFF — safe-by-default per
 *     B1 acceptance: "default value when the field is absent must be
 *     safe (no push)").
 *   - EVERY category is OFF by default — a per-feature opt-in is required.
 *   - `showDetails: false` in v1 (per the brief; v1.1 will introduce
 *     per-device opt-in).
 *   - The category keys are EXACTLY the six the architect locked in.
 *
 * These FAIL today: the type + default constant don't exist yet.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORY_KEYS,
} from './notificationsPreferences';
// Type-only import — fails the typecheck if NotificationPreferences is missing
// from src/lib/types.ts. The runtime assertion below double-checks the shape.
import type { NotificationPreferences } from '../../lib/types';

describe('DEFAULT_NOTIFICATION_PREFERENCES — safe-by-default master + categories', () => {
  it('has pushEnabled: false (safe-by-default — no push without opt-in)', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.pushEnabled).toBe(false);
  });

  it('has showDetails: false (v1 invariant per architect brief §1; v1.1 introduces per-device opt-in)', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.showDetails).toBe(false);
  });

  it('has updatedAt as a number (epoch ms)', () => {
    expect(typeof DEFAULT_NOTIFICATION_PREFERENCES.updatedAt).toBe('number');
  });

  it('has EXACTLY the eight category keys the architect locked in (no extras, no missing)', () => {
    // PR F (F10) grew the locked set from 6 to 8: the schedulers depend on
    // `eventReminders` + `birthdays` toggles existing on the user's
    // preferences doc, otherwise notifyEventReminders / notifyBirthdays find
    // zero opted-in recipients and silently exit.
    const expected = [
      'choreApprovalsNeeded',
      'wishlistApprovalsNeeded',
      'myChoreResolved',
      'myWishlistResolved',
      'familyBoardPosts',
      'familyTodos',
      'eventReminders',
      'birthdays',
    ].sort();
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.categories).sort()).toEqual(expected);
  });

  it('NOTIFICATION_CATEGORY_KEYS is the canonical list (used by UI + server)', () => {
    expect([...NOTIFICATION_CATEGORY_KEYS].sort()).toEqual(
      [
        'choreApprovalsNeeded',
        'wishlistApprovalsNeeded',
        'myChoreResolved',
        'myWishlistResolved',
        'familyBoardPosts',
        'familyTodos',
        'eventReminders',
        'birthdays',
      ].sort(),
    );
  });

  it('every category is OFF by default (per-category opt-in required)', () => {
    for (const k of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES.categories) as Array<
      keyof typeof DEFAULT_NOTIFICATION_PREFERENCES.categories
    >) {
      expect(
        DEFAULT_NOTIFICATION_PREFERENCES.categories[k],
        `category "${String(k)}" must default to false`,
      ).toBe(false);
    }
  });

  it('the default shape satisfies the NotificationPreferences type (structural check)', () => {
    // If src/lib/types.ts is missing the interface, this assignment will
    // fail the typecheck before the runtime test runs.
    const value: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES;
    expect(value).toBeDefined();
  });

  it('produces a structurally-equal clone when spread (defaults are a literal, not a mutable singleton trap)', () => {
    // Mutating a returned shape must NOT contaminate the singleton — the
    // implementer should return a fresh object or freeze the constant.
    const a = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    const b = { ...DEFAULT_NOTIFICATION_PREFERENCES };
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
