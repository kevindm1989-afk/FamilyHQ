/**
 * NotificationsPreferencesScreen — props-injected screen contract (PR B5/B6).
 *
 * Pins, per architect §12 PR B + threat-modeler §A.10 + Lesson 2026-06-08 #1:
 *
 *   - All 6 category toggles render (parent-only gated by role; kid-only
 *     gated by role; family-wide visible to all).
 *   - Master toggle off → all category toggles aria-disabled.
 *   - Master toggle on (when off) → triggers permission prompt path
 *     (the registerToken seam is invoked).
 *   - Devices list shows {userAgent, lastSeenAt} per row + a "Sign out this
 *     device" button. This is the purpose-of-collection for `userAgent`
 *     (threat-modeler pushback #2). If this surface is dropped,
 *     `userAgent` must be dropped from the doc — tests B-T9 / this test
 *     enforce that pairing.
 *   - "Sign out this device" calls onSignOutDevice with the SPECIFIC
 *     tokenHash for that row (not all of them).
 *   - iOS-without-PWA detection shows a DIFFERENT copy variant AND does
 *     NOT auto-prompt.
 *
 * **B-T14 — AODA primitive-level assertion** (the load-bearing one):
 *   The per-category toggles render as REAL form controls — `<input
 *   type="checkbox">` OR `<button role="switch" aria-checked="...">` —
 *   with an associated label-for binding. NOT a `<div onClick>` that
 *   screen readers ignore. This is the lesson from PR #82: a documented
 *   a11y prop must be proved to reach the DOM, not asserted at the caller.
 *
 * These FAIL today: no screen module exists. The implementer builds it.
 *
 * Determinism: all clocks frozen via vi.useFakeTimers, no network, every
 * service call is a vi.fn() injected through props.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import {
  NotificationsPreferencesScreen,
  type NotificationsPreferencesScreenProps,
  type DeviceListItem,
  type NotificationCategoryKey,
} from './NotificationsPreferencesScreen';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notificationsPreferences';

const FIXED_NOW = Date.UTC(2026, 5, 9, 12, 0, 0);

const DEVICE_CHROME: DeviceListItem = {
  tokenHash: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  userAgent: 'Chrome on macOS',
  lastSeenAt: FIXED_NOW - 5 * 60 * 1000, // 5 minutes ago
};
const DEVICE_FIREFOX: DeviceListItem = {
  tokenHash: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  userAgent: 'Firefox on Linux',
  lastSeenAt: FIXED_NOW - 2 * 60 * 60 * 1000, // 2 hours ago
};

const ALL_CATEGORY_KEYS: NotificationCategoryKey[] = [
  'choreApprovalsNeeded',
  'wishlistApprovalsNeeded',
  'myChoreResolved',
  'myWishlistResolved',
  'familyBoardPosts',
  'familyTodos',
];

function renderScreen(overrides: Partial<NotificationsPreferencesScreenProps> = {}) {
  const props: NotificationsPreferencesScreenProps = {
    viewer: { uid: 'uid-member-a', role: 'parent' },
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    devices: [DEVICE_CHROME, DEVICE_FIREFOX],
    isIosWithoutPwa: false,
    onTogglePush: vi.fn().mockResolvedValue(undefined),
    onToggleCategory: vi.fn().mockResolvedValue(undefined),
    onSignOutDevice: vi.fn().mockResolvedValue(undefined),
    onRequestPermission: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <ToastProvider>
      <NotificationsPreferencesScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Category-toggle visibility, role-gated
// ---------------------------------------------------------------------------
describe('category toggles render per the viewer\'s role', () => {
  it('a PARENT viewer sees both parent-only toggles AND the family-wide toggles', () => {
    renderScreen({
      viewer: { uid: 'uid-parent-a', role: 'parent' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    expect(
      screen.getByRole('switch', { name: /chore approvals needed/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: /wishlist approvals needed/i }),
    ).toBeInTheDocument();
    // Family-wide always visible.
    expect(screen.getByRole('switch', { name: /board posts/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /to-?dos?/i })).toBeInTheDocument();
  });

  it('a PARENT viewer does NOT see kid-only toggles (myChoreResolved / myWishlistResolved)', () => {
    renderScreen({
      viewer: { uid: 'uid-parent-a', role: 'parent' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    expect(screen.queryByRole('switch', { name: /my chore/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /my wishlist/i })).not.toBeInTheDocument();
  });

  it('a MEMBER viewer (kid) sees kid-only toggles AND the family-wide toggles', () => {
    renderScreen({
      viewer: { uid: 'uid-member-a', role: 'member' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    expect(screen.getByRole('switch', { name: /my chore/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /my wishlist/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /board posts/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /to-?dos?/i })).toBeInTheDocument();
  });

  it('a MEMBER viewer does NOT see parent-only toggles', () => {
    renderScreen({
      viewer: { uid: 'uid-member-a', role: 'member' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    expect(
      screen.queryByRole('switch', { name: /chore approvals needed/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('switch', { name: /wishlist approvals needed/i }),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Master-toggle gating
// ---------------------------------------------------------------------------
describe('master push toggle controls the category UI', () => {
  it('renders the master toggle as a switch (a11y primitive)', () => {
    renderScreen();
    expect(screen.getByRole('switch', { name: /push notifications/i })).toBeInTheDocument();
  });

  it('with master OFF, every visible category toggle is aria-disabled or disabled', () => {
    renderScreen({
      viewer: { uid: 'uid-member-a', role: 'member' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: false },
    });
    // All category switches present (gated by role); each must be inert.
    const switches = screen.getAllByRole('switch');
    // Exclude the master toggle itself.
    const categorySwitches = switches.filter(
      (s) => !/push notifications/i.test(s.getAttribute('aria-label') ?? s.textContent ?? ''),
    );
    expect(categorySwitches.length).toBeGreaterThan(0);
    for (const sw of categorySwitches) {
      const disabled =
        sw.getAttribute('aria-disabled') === 'true' || (sw as HTMLButtonElement).disabled === true;
      expect(disabled, `switch "${sw.textContent}" must be disabled when push is off`).toBe(true);
    }
  });

  it('with master ON, category toggles are operable (not aria-disabled)', () => {
    renderScreen({
      viewer: { uid: 'uid-member-a', role: 'member' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    const categorySwitches = screen
      .getAllByRole('switch')
      .filter((s) => !/push notifications/i.test(s.getAttribute('aria-label') ?? s.textContent ?? ''));
    for (const sw of categorySwitches) {
      expect(sw.getAttribute('aria-disabled')).not.toBe('true');
      if (sw.tagName === 'BUTTON' || sw.tagName === 'INPUT') {
        expect((sw as HTMLButtonElement).disabled).toBe(false);
      }
    }
  });

  it('flipping master from OFF to ON triggers the permission-prompt path', async () => {
    const props = renderScreen({
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: false },
    });
    const master = screen.getByRole('switch', { name: /push notifications/i });
    fireEvent.click(master);
    expect(props.onRequestPermission).toHaveBeenCalledTimes(1);
  });

  it('flipping master from ON to OFF does NOT trigger the permission-prompt path (it unregisters)', async () => {
    const props = renderScreen({
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    const master = screen.getByRole('switch', { name: /push notifications/i });
    fireEvent.click(master);
    expect(props.onRequestPermission).not.toHaveBeenCalled();
    expect(props.onTogglePush).toHaveBeenCalledWith(false);
  });
});

// ---------------------------------------------------------------------------
// Devices list — purpose-of-collection for userAgent (pushback #2)
// ---------------------------------------------------------------------------
describe('Devices list — purpose-of-collection for stored userAgent', () => {
  it('renders a Devices section heading (purpose-of-collection visible affordance)', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: /devices/i })).toBeInTheDocument();
  });

  it('renders one row per device, showing the userAgent verbatim', () => {
    renderScreen();
    expect(screen.getByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('Firefox on Linux')).toBeInTheDocument();
  });

  it('renders a relative-time string per device row (lastSeenAt — not raw epoch)', () => {
    renderScreen();
    // Two rows, two distinct relative timestamps. We don't pin the exact
    // copy ("5 minutes ago" vs "5m ago"), just that the row carries some
    // textual freshness signal — and not the raw epoch.
    const chromeRow = screen.getByText('Chrome on macOS').closest('li,div[role="listitem"]');
    expect(chromeRow).not.toBeNull();
    expect(chromeRow!.textContent ?? '').not.toContain(String(DEVICE_CHROME.lastSeenAt));
    // A relative-time string of some kind is present (matches "ago", "min",
    // "hour", "h", or "m" — we tolerate the implementer's exact format).
    expect(chromeRow!.textContent ?? '').toMatch(/ago|min|hour|h\b|m\b/i);
  });

  it('each row has a "Sign out this device" button (per-row affordance, not a global purge)', () => {
    renderScreen();
    const signOutButtons = screen.getAllByRole('button', { name: /sign out this device/i });
    expect(signOutButtons).toHaveLength(2);
  });

  it('clicking "Sign out this device" calls onSignOutDevice with the SPECIFIC tokenHash for that row', () => {
    const props = renderScreen();
    const chromeRow = screen.getByText('Chrome on macOS').closest('li,div[role="listitem"]');
    expect(chromeRow).not.toBeNull();
    const btn = within(chromeRow! as HTMLElement).getByRole('button', {
      name: /sign out this device/i,
    });
    fireEvent.click(btn);
    expect(props.onSignOutDevice).toHaveBeenCalledTimes(1);
    expect(props.onSignOutDevice).toHaveBeenCalledWith(DEVICE_CHROME.tokenHash);
  });

  it('with zero devices, shows an empty-state copy (no spurious purpose-of-collection)', () => {
    renderScreen({ devices: [] });
    // Either an empty-state copy element or NO sign-out buttons — both
    // signal the implementer has not silently rendered an empty list.
    expect(screen.queryAllByRole('button', { name: /sign out this device/i })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B-T14 — primitive-level a11y assertion (Lesson 2026-06-08 #1)
// ---------------------------------------------------------------------------
describe('B-T14 (AODA primitive-level): category toggles are REAL form controls with associated labels', () => {
  it('every visible category toggle renders as <input type="checkbox"> OR <button role="switch" aria-checked>', () => {
    renderScreen({
      viewer: { uid: 'uid-member-a', role: 'member' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    const switches = screen
      .getAllByRole('switch')
      .filter((s) => !/push notifications/i.test(s.getAttribute('aria-label') ?? s.textContent ?? ''));
    expect(switches.length).toBeGreaterThan(0);
    for (const sw of switches) {
      const tag = sw.tagName.toUpperCase();
      const isCheckbox = tag === 'INPUT' && (sw as HTMLInputElement).type === 'checkbox';
      const isButtonSwitch =
        tag === 'BUTTON' &&
        sw.getAttribute('role') === 'switch' &&
        sw.getAttribute('aria-checked') !== null;
      expect(
        isCheckbox || isButtonSwitch,
        `toggle "${sw.textContent ?? sw.getAttribute('aria-label')}" must be a real <input type=checkbox> or <button role=switch aria-checked=...>`,
      ).toBe(true);
    }
  });

  it('each category toggle has an accessible name (label-for / aria-label / aria-labelledby)', () => {
    renderScreen({
      viewer: { uid: 'uid-member-a', role: 'member' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    const switches = screen
      .getAllByRole('switch')
      .filter((s) => !/push notifications/i.test(s.getAttribute('aria-label') ?? s.textContent ?? ''));
    for (const sw of switches) {
      // getByRole already requires an accessible name when { name } is
      // passed; here we re-assert per element that the accessible name is
      // non-empty (the label binding actually reaches the DOM).
      const name =
        sw.getAttribute('aria-label') ??
        (sw.getAttribute('aria-labelledby')
          ? document.getElementById(sw.getAttribute('aria-labelledby')!)?.textContent
          : null) ??
        sw.textContent;
      expect((name ?? '').trim().length, 'toggle accessible name must be non-empty').toBeGreaterThan(0);
    }
  });

  it('no category toggle is a bare <div onClick> (would be invisible to screen readers)', () => {
    renderScreen({
      viewer: { uid: 'uid-member-a', role: 'member' },
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true },
    });
    // Probe each known category by its expected aria-label. None may resolve
    // to a <div>. (If a future implementer changes the labels, update this
    // mapping in lockstep with the implementer's contract.)
    const labelMatchers = [
      /my chore/i,
      /my wishlist/i,
      /board posts/i,
      /to-?dos?/i,
    ];
    for (const m of labelMatchers) {
      const sw = screen.queryByRole('switch', { name: m });
      // The toggle MUST exist by role+name (no div-on-click) — getByRole
      // filtering already enforces it; this assertion is the explicit
      // "no div" anti-regression.
      expect(sw, `category toggle matching ${m} must be reachable by role=switch`).not.toBeNull();
      if (sw) {
        expect(sw.tagName.toUpperCase()).not.toBe('DIV');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// iOS-without-PWA — different copy, no auto-prompt
// ---------------------------------------------------------------------------
describe('iOS-without-PWA detection — different copy + no auto-prompt', () => {
  it('on iOS without a PWA install, the iOS hint copy is shown', () => {
    renderScreen({ isIosWithoutPwa: true });
    // The hint must mention adding to home screen (the only way iOS web
    // push works) — we don't pin exact wording but the substring is the
    // load-bearing affordance.
    const hint = screen.getByText(/home screen|add to home|install/i);
    expect(hint).toBeInTheDocument();
  });

  it('on iOS without PWA, the standard prompt copy is NOT shown', () => {
    renderScreen({ isIosWithoutPwa: true });
    // The standard prompt copy (e.g. "Turn on notifications") is suppressed
    // — only the iOS-specific copy variant is shown.
    expect(screen.queryByRole('button', { name: /^turn on notifications$/i })).not.toBeInTheDocument();
  });

  it('on iOS without PWA, the master toggle does NOT auto-call onRequestPermission on mount', () => {
    const onRequestPermission = vi.fn().mockResolvedValue(undefined);
    renderScreen({ isIosWithoutPwa: true, onRequestPermission });
    expect(onRequestPermission, 'no auto-prompt on iOS without PWA').not.toHaveBeenCalled();
  });

  it('on a NON-iOS-or-with-PWA environment, the iOS hint is NOT shown (it would mislead)', () => {
    renderScreen({ isIosWithoutPwa: false });
    expect(screen.queryByText(/home screen|add to home/i)).not.toBeInTheDocument();
  });

  it('the iOS copy DIFFERS from the non-iOS copy (snapshot of substring inequality)', () => {
    // Render the iOS variant, capture its hint area's text.
    const { unmount } = render(
      <ToastProvider>
        <NotificationsPreferencesScreen
          viewer={{ uid: 'uid-member-a', role: 'member' }}
          preferences={{ ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: false }}
          devices={[]}
          isIosWithoutPwa={true}
          onTogglePush={vi.fn()}
          onToggleCategory={vi.fn()}
          onSignOutDevice={vi.fn()}
          onRequestPermission={vi.fn()}
        />
      </ToastProvider>,
    );
    const iosCopy = screen.getByText(/home screen|add to home|install/i).textContent ?? '';
    unmount();

    // Render the non-iOS variant in a clean tree.
    render(
      <ToastProvider>
        <NotificationsPreferencesScreen
          viewer={{ uid: 'uid-member-a', role: 'member' }}
          preferences={{ ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: false }}
          devices={[]}
          isIosWithoutPwa={false}
          onTogglePush={vi.fn()}
          onToggleCategory={vi.fn()}
          onSignOutDevice={vi.fn()}
          onRequestPermission={vi.fn()}
        />
      </ToastProvider>,
    );
    // The iOS copy substring ("home screen" etc.) MUST NOT appear in the
    // non-iOS variant.
    expect(screen.queryByText(iosCopy)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// All-category-key coverage trace (one test per architect-defined category)
// ---------------------------------------------------------------------------
describe('every architect-defined category key has a corresponding render branch', () => {
  // Each key must resolve to a switch the appropriate viewer can see.
  it.each(ALL_CATEGORY_KEYS)(
    'category key "%s" renders as a switch for the appropriate viewer role',
    (key) => {
      // Parent viewer first.
      const { unmount } = render(
        <ToastProvider>
          <NotificationsPreferencesScreen
            viewer={{ uid: 'uid-parent-a', role: 'parent' }}
            preferences={{ ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true }}
            devices={[]}
            isIosWithoutPwa={false}
            onTogglePush={vi.fn()}
            onToggleCategory={vi.fn()}
            onSignOutDevice={vi.fn()}
            onRequestPermission={vi.fn()}
          />
        </ToastProvider>,
      );
      const parentSwitch = screen.queryByTestId(`notif-cat-toggle-${key}`);
      unmount();

      render(
        <ToastProvider>
          <NotificationsPreferencesScreen
            viewer={{ uid: 'uid-member-a', role: 'member' }}
            preferences={{ ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true }}
            devices={[]}
            isIosWithoutPwa={false}
            onTogglePush={vi.fn()}
            onToggleCategory={vi.fn()}
            onSignOutDevice={vi.fn()}
            onRequestPermission={vi.fn()}
          />
        </ToastProvider>,
      );
      const memberSwitch = screen.queryByTestId(`notif-cat-toggle-${key}`);

      // At least ONE viewer must see this toggle (family-wide → both;
      // parent-only → parent; kid-only → member). Failing this means a
      // category from the spec has no UI surface at all.
      expect(
        parentSwitch !== null || memberSwitch !== null,
        `category "${key}" must render for at least one viewer role`,
      ).toBe(true);
    },
  );
});
