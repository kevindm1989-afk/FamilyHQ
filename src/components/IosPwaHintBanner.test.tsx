/**
 * IosPwaHintBanner — component tests for the F15 iOS-PWA hint.
 *
 * Threat-model §A.10 PR E quotes (verbatim):
 *   - E-T3. iOS-PWA banner: iOS UA + permission granted +
 *           `navigator.standalone !== true` → banner shows once per session;
 *           dismiss persists 30 days via `iosPwaHintDismissedAt` (F15).
 *   - E-T4. iOS-PWA banner: non-iOS UA → banner NEVER shows.
 *   - E-T5. iOS-PWA banner: iOS UA + `navigator.standalone === true` →
 *           banner NEVER shows.
 *
 * Component under test: `<IosPwaHintBanner />` (to be created at
 * `/home/user/FamilyHQ/src/components/IosPwaHintBanner.tsx`). Props: none —
 * the component is self-contained and inspects:
 *   - `navigator.userAgent`,
 *   - `navigator.standalone` (Safari-only),
 *   - `navigator.maxTouchPoints` (iPadOS-as-Mac detection),
 *   - `Notification.permission`,
 *   - `localStorage.iosPwaHintDismissedAt` (millis epoch).
 *
 * Locale keys the component reads (the en + fr locales MUST have non-empty
 * values for each):
 *   - `notifications.iosPwaHint.title`
 *   - `notifications.iosPwaHint.body`
 *   - `common.dismiss`
 *
 * Determinism contract:
 *   - `vi.useFakeTimers()` + `vi.setSystemTime(FIXED_NOW)` for any test
 *     that touches the 30-day dismissal window so wall-clock skew never
 *     makes the test flake on a slow CI runner.
 *   - `beforeEach` restores any `Object.defineProperty(navigator, ...)`
 *     stubs the previous test installed, wipes `localStorage`, and
 *     re-stubs `window.Notification` via `vi.stubGlobal` so each test
 *     starts from a known state.
 *
 * MUST FAIL today: `IosPwaHintBanner.tsx` does not exist, so the dynamic
 * import in the harness fails with a useful module-not-found message. The
 * implementer creates the component and adds the three locale keys to
 * make these tests pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, act } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from '../i18n';

const COMPONENT_PATH = resolve(__dirname, './IosPwaHintBanner.tsx');
const EN_LOCALE_PATH = resolve(__dirname, '../locales/en.json');
const FR_LOCALE_PATH = resolve(__dirname, '../locales/fr.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * DAY_MS;
// Pinned, deterministic "now" — middle of a month, not near a DST boundary,
// not on the leap day. The dismissal-window math is in plain milliseconds
// so the specific wall time is unimportant; what matters is that every
// test in this file sees the same `Date.now()` value.
const FIXED_NOW = new Date('2026-06-11T12:00:00.000Z').getTime();

// User-agent fixtures — pulled verbatim from the brief so a UA-string drift
// here is a brief drift, not a test drift.
const UA_IOS_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const UA_IPADOS_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
const UA_ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP_CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Lazy dynamic import — keeps test-file load alive even when the component
// is absent today (the implementer creates it during PR E). When missing,
// each test that calls `loadBanner()` fails with a clear, single message
// rather than the whole file crashing on import-analysis.
// ---------------------------------------------------------------------------
async function loadBanner(): Promise<React.ComponentType> {
  if (!existsSync(COMPONENT_PATH)) {
    throw new Error(
      `IosPwaHintBanner.tsx is missing at ${COMPONENT_PATH} — implementer must create it (brief PR E).`,
    );
  }
  // Build the import specifier at runtime so Vite's static import-analysis
  // doesn't try to pre-resolve the path at test-load time. The same
  // pattern is used by test/functions/notification-bodies-no-pi.test.ts —
  // see its `loadBodies()` helper for the rationale (Vite would otherwise
  // fail the whole file at transform time when the module is absent,
  // collapsing every assertion into a single opaque load error).
  const url = `${COMPONENT_PATH.startsWith('/') ? 'file://' : 'file:///'}${COMPONENT_PATH}`;
  try {
    const mod = (await import(/* @vite-ignore */ url)) as {
      IosPwaHintBanner?: React.ComponentType;
      default?: React.ComponentType;
    };
    const Cmp = mod.IosPwaHintBanner ?? mod.default;
    if (!Cmp) {
      throw new Error(
        `IosPwaHintBanner.tsx exists at ${COMPONENT_PATH} but exports neither a named "IosPwaHintBanner" nor a default — implementer must export one.`,
      );
    }
    return Cmp;
  } catch (err) {
    throw new Error(
      `IosPwaHintBanner.tsx failed to load from ${COMPONENT_PATH}: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// navigator / Notification stubs. JSDOM's `navigator` is mostly read-only,
// but `Object.defineProperty` with `configurable: true` lets us swap and
// restore individual descriptors per test.
// ---------------------------------------------------------------------------
function stubNavigator(opts: {
  userAgent: string;
  standalone?: boolean | undefined;
  maxTouchPoints?: number;
}): void {
  Object.defineProperty(navigator, 'userAgent', {
    value: opts.userAgent,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'standalone', {
    value: opts.standalone,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: opts.maxTouchPoints ?? 0,
    configurable: true,
    writable: true,
  });
}

function stubNotification(permission: NotificationPermission | 'unsupported'): void {
  if (permission === 'unsupported') {
    // Some browsers (in-app web views) don't expose Notification at all.
    // The component must tolerate this — `typeof Notification === 'undefined'`.
    vi.stubGlobal('Notification', undefined);
    return;
  }
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: vi.fn().mockResolvedValue(permission),
  });
}

function stubMatchMedia(reducedMotion: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('prefers-reduced-motion') ? reducedMotion : false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  // Also patch on window so the component can call either form.
  Object.defineProperty(window, 'matchMedia', {
    value: window.matchMedia ?? (globalThis as { matchMedia?: unknown }).matchMedia,
    configurable: true,
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Per-test lifecycle.
// ---------------------------------------------------------------------------
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  // Default the language to English. Tests that need French re-call
  // changeLanguage('fr') inside the test body.
  await i18n.changeLanguage('en');
  localStorage.clear();
  stubMatchMedia(false);
  // Default to a non-iOS UA so a test that forgets to stub it never
  // accidentally renders the banner.
  stubNavigator({ userAgent: UA_DESKTOP_CHROME_MAC, standalone: undefined, maxTouchPoints: 0 });
  stubNotification('default');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  // Restore every spy installed during the test (Storage.prototype.setItem
  // spies, etc.). Without this, a test that throws before reaching its
  // own `mockRestore()` call would leak the spy into the next test's
  // beforeEach — which calls `i18n.changeLanguage` and uses localStorage.
  vi.restoreAllMocks();
  // Restore navigator: define benign defaults again so the next test's
  // beforeEach starts clean even if it forgot a stub.
  Object.defineProperty(navigator, 'userAgent', {
    value: UA_DESKTOP_CHROME_MAC,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'standalone', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value: 0,
    configurable: true,
    writable: true,
  });
  localStorage.clear();
});

// ===========================================================================
// E-T3 — happy path: iOS + standalone false + permission granted → banner shows.
// ===========================================================================
describe('E-T3: iOS UA + permission granted + not-standalone → banner renders', () => {
  it('renders the banner with an accessible name and a Dismiss button', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('granted');
    const Banner = await loadBanner();

    render(<Banner />);

    // The banner is a region so screen-reader users can land on it via
    // landmark navigation. The accessible name is required for AODA.
    const region = screen.queryByRole('region', { name: /home screen|écran d.accueil/i });
    expect(region, 'banner must render as a labelled region on iOS with granted permission').not.toBe(
      null,
    );

    // A dismiss control must be reachable by name (label association).
    const dismiss = screen.queryByRole('button', { name: /dismiss|fermer|rejeter/i });
    expect(dismiss, 'banner must expose a named Dismiss control').not.toBe(null);
  });

  it('still renders when permission is "default" (queryable — the user has not decided yet)', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must render when permission is queryable (default)',
    ).not.toBe(null);
  });

  it('does NOT render when the user has explicitly denied notifications', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('denied');
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must not appear after explicit notification denial',
    ).toBe(null);
  });

  it('detects iPadOS-as-Mac when maxTouchPoints > 1 and renders the banner', async () => {
    stubNavigator({ userAgent: UA_IPADOS_AS_MAC, standalone: false, maxTouchPoints: 5 });
    stubNotification('granted');
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'iPadOS Safari (reports Mac UA + touch) must be treated as iOS — banner renders',
    ).not.toBe(null);
  });
});

// ===========================================================================
// E-T4 — non-iOS UA: banner NEVER shows.
// ===========================================================================
describe('E-T4: non-iOS UA → banner never renders', () => {
  it('does not render on Android Chrome', async () => {
    stubNavigator({ userAgent: UA_ANDROID_CHROME, standalone: false, maxTouchPoints: 5 });
    stubNotification('granted');
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must NEVER render on Android Chrome (E-T4)',
    ).toBe(null);
  });

  it('does not render on Desktop Chrome (Mac UA without touch)', async () => {
    stubNavigator({
      userAgent: UA_DESKTOP_CHROME_MAC,
      standalone: false,
      maxTouchPoints: 0, // desktop has no touch
    });
    stubNotification('granted');
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must NEVER render on Desktop Chrome (E-T4)',
    ).toBe(null);
  });
});

// ===========================================================================
// E-T5 — iOS but already standalone: banner NEVER shows.
// ===========================================================================
describe('E-T5: iOS + navigator.standalone === true → banner never renders', () => {
  it('does not render when the app is already running as a home-screen PWA', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: true, maxTouchPoints: 5 });
    stubNotification('default');
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must NEVER render when navigator.standalone === true (E-T5)',
    ).toBe(null);
  });
});

// ===========================================================================
// F15 — 30-day dismissal persistence.
// ===========================================================================
describe('F15: dismiss persists 30 days via localStorage.iosPwaHintDismissedAt', () => {
  it('clicking Dismiss writes Date.now() to localStorage.iosPwaHintDismissedAt and hides the banner', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    const Banner = await loadBanner();

    render(<Banner />);
    const dismiss = screen.getByRole('button', { name: /dismiss|fermer|rejeter/i });
    act(() => {
      fireEvent.click(dismiss);
    });

    // localStorage write
    const persisted = localStorage.getItem('iosPwaHintDismissedAt');
    expect(persisted, 'iosPwaHintDismissedAt must be set on dismiss').not.toBe(null);
    expect(Number(persisted)).toBe(FIXED_NOW);

    // Banner unmounted from the visible tree immediately.
    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must unmount immediately after the dismiss click',
    ).toBe(null);
  });

  it('does not render again on remount within the 30-day window', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    // Pre-seed a recent dismissal — 1 day ago.
    localStorage.setItem('iosPwaHintDismissedAt', String(FIXED_NOW - DAY_MS));
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must stay hidden while the 30-day dismissal window is still open',
    ).toBe(null);
  });

  it('renders again after 30 days + 1 ms', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    localStorage.setItem(
      'iosPwaHintDismissedAt',
      String(FIXED_NOW - (THIRTY_DAYS_MS + 1)),
    );
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must render again once the 30-day window has elapsed',
    ).not.toBe(null);
  });

  it('treats a non-numeric / corrupted localStorage value as "no dismissal" (graceful)', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    localStorage.setItem('iosPwaHintDismissedAt', 'not-a-number');
    const Banner = await loadBanner();

    render(<Banner />);

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'a corrupted dismissal timestamp must NOT permanently hide the banner — fall back to "no dismissal"',
    ).not.toBe(null);
  });

  it('does not throw when localStorage.setItem throws (Safari Private Browsing)', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError: SecurityError in private mode');
    });
    const Banner = await loadBanner();

    render(<Banner />);
    const dismiss = screen.getByRole('button', { name: /dismiss|fermer|rejeter/i });

    // The click must NOT propagate an uncaught error to the caller.
    expect(() => {
      act(() => {
        fireEvent.click(dismiss);
      });
    }).not.toThrow();

    // The banner still hides for THIS session even though we couldn't
    // persist the dismissal — never pin the user to a permanent banner
    // because of a private-mode quirk.
    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must hide for the session even when localStorage write fails',
    ).toBe(null);

    setItemSpy.mockRestore();
  });
});

// ===========================================================================
// Accessibility — keyboard, focus, motion, ARIA.
// ===========================================================================
describe('a11y: keyboard + reduced motion + landmark', () => {
  it('Escape dismisses the banner from anywhere in the document', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    const Banner = await loadBanner();

    render(<Banner />);
    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'precondition: banner is open',
    ).not.toBe(null);

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'Escape key must dismiss the banner (no keyboard trap, WCAG 2.1.2)',
    ).toBe(null);
  });

  it('the dismiss button is keyboard-focusable', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    const Banner = await loadBanner();

    render(<Banner />);
    const dismiss = screen.getByRole('button', { name: /dismiss|fermer|rejeter/i });
    dismiss.focus();
    expect(document.activeElement, 'dismiss button must be focusable').toBe(dismiss);
  });

  it('omits motion / transition classes when prefers-reduced-motion is set', async () => {
    stubMatchMedia(true);
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    const Banner = await loadBanner();

    render(<Banner />);
    const region = screen.getByRole('region', { name: /home screen|écran d.accueil/i });

    // No raw `transition-*` or `animate-*` class on the banner root. The
    // banner may use `motion-reduce:` Tailwind variants — those are
    // legal — but it must NOT apply an unconditional transition class
    // when the OS asks for no motion.
    const cls = region.className;
    expect(cls, `banner root class list under reduced motion: ${cls}`).not.toMatch(/(^|\s)transition(\s|-|$)/);
    expect(cls, `banner root class list under reduced motion: ${cls}`).not.toMatch(/(^|\s)animate(\s|-|$)/);
  });
});

// ===========================================================================
// i18n — locale key coverage in BOTH en and fr.
// ===========================================================================
describe('i18n: notifications.iosPwaHint.* and common.dismiss exist in BOTH locales', () => {
  type LocaleFile = Record<string, unknown>;

  function readLocale(path: string): LocaleFile {
    return JSON.parse(readFileSync(path, 'utf8')) as LocaleFile;
  }

  function getDeep(obj: LocaleFile, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  const REQUIRED_KEYS = [
    'notifications.iosPwaHint.title',
    'notifications.iosPwaHint.body',
    'common.dismiss',
  ] as const;

  for (const localePath of [EN_LOCALE_PATH, FR_LOCALE_PATH]) {
    const localeName = localePath.endsWith('en.json') ? 'en' : 'fr';
    for (const key of REQUIRED_KEYS) {
      it(`${localeName}: ${key} is present and a non-empty string`, () => {
        const locale = readLocale(localePath);
        const value = getDeep(locale, key);
        expect(
          value,
          `${localeName}.json is missing required banner key "${key}" — implementer must add it`,
        ).toBeDefined();
        expect(typeof value, `${localeName}.json key "${key}" must be a string`).toBe('string');
        expect(
          (value as string).trim().length,
          `${localeName}.json key "${key}" must be non-empty`,
        ).toBeGreaterThan(0);
      });
    }
  }
});

// ===========================================================================
// Behavioural — second mount in the SAME session after Dismiss stays hidden.
// (The brief calls this "once per session" — once dismissed, no
// re-appearance until the persistence window elapses.)
// ===========================================================================
describe('once per session: a second mount after dismiss does not re-show the banner', () => {
  it('remount in-session after dismiss keeps the banner hidden', async () => {
    stubNavigator({ userAgent: UA_IOS_IPHONE_SAFARI, standalone: false, maxTouchPoints: 5 });
    stubNotification('default');
    const Banner = await loadBanner();

    const { unmount } = render(<Banner />);
    const dismiss = screen.getByRole('button', { name: /dismiss|fermer|rejeter/i });
    act(() => {
      fireEvent.click(dismiss);
    });
    unmount();

    // Remount fresh.
    render(<Banner />);
    expect(
      screen.queryByRole('region', { name: /home screen|écran d.accueil/i }),
      'banner must stay hidden after a dismiss + remount within the same session',
    ).toBe(null);
  });
});
