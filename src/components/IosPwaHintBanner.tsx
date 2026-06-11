import { useCallback, useEffect, useId, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// TypeScript: `navigator.standalone` is iOS-Safari-only and is not part of the
// DOM lib's Navigator type. Declared inline here so the component can read it
// without touching a global ambient .d.ts.
// ---------------------------------------------------------------------------
declare global {
  interface Navigator {
    readonly standalone?: boolean;
  }
}

const STORAGE_KEY = 'iosPwaHintDismissedAt';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface HintEnv {
  userAgent: string;
  standalone: boolean | undefined;
  maxTouchPoints: number;
  notificationPermission: NotificationPermission | undefined;
  dismissedAt: number | null;
  now: number;
}

/**
 * Pure, dependency-injected decision helper for whether the iOS-PWA hint banner
 * should be visible right now.
 *
 *  - Non-iOS UA -> hide (E-T4).
 *  - iOS UA + navigator.standalone === true (already installed) -> hide (E-T5).
 *  - Notification.permission === 'denied' -> hide.
 *  - Dismissed within the last 30 days -> hide (F15).
 *  - Otherwise -> show (E-T3).
 *
 * iPadOS detection: modern iPad Safari sends a Mac UA but exposes
 * `maxTouchPoints > 1`. Treat that combo as iOS too.
 */
function shouldShowIosPwaHint(env: HintEnv): boolean {
  const ua = env.userAgent;
  const looksLikeIPhoneFamily = /iPhone|iPad|iPod/.test(ua);
  const looksLikeIpadOSAsMac = /Macintosh/.test(ua) && env.maxTouchPoints > 1;
  const isIos = looksLikeIPhoneFamily || looksLikeIpadOSAsMac;
  if (!isIos) return false;

  // Already a home-screen PWA — banner would be misleading.
  if (env.standalone === true) return false;

  // The user actively said no. Don't pester.
  if (env.notificationPermission === 'denied') return false;

  // Dismissal still within the 30-day quiet window.
  if (env.dismissedAt !== null && Number.isFinite(env.dismissedAt)) {
    if (env.now - env.dismissedAt <= THIRTY_DAYS_MS) {
      return false;
    }
  }

  return true;
}

/** Parse the persisted dismissal timestamp. Corrupted values become null. */
function readDismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Safari Private mode etc. — treat as "never dismissed".
    return null;
  }
}

/** Snapshot the env once per render-evaluation. Pure of React state. */
function snapshotEnv(): HintEnv {
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
  const notif =
    typeof Notification === 'undefined'
      ? undefined
      : (Notification.permission as NotificationPermission | undefined);
  return {
    userAgent: nav?.userAgent ?? '',
    standalone: nav?.standalone,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    notificationPermission: notif,
    dismissedAt: readDismissedAt(),
    now: Date.now(),
  };
}

/** Match `prefers-reduced-motion: reduce` once, safely on SSR/test envs. */
function prefersReducedMotion(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * F15: iOS-PWA hint banner. Self-contained — reads environment via the helper
 * above and renders nothing unless the user is on iOS Safari, the app is NOT
 * already installed to the home screen, notification permission has not been
 * denied, and the user has not dismissed within the last 30 days.
 *
 * Mounted by AppShell above the routed content. The banner is sticky at the
 * top of the scroll region (below the TopBar) so a long scroll never hides it.
 */
export function IosPwaHintBanner(): ReactElement | null {
  const { t } = useTranslation();
  const titleId = useId();

  // `sessionDismissed` is the in-memory flag: once the user clicks Dismiss we
  // hide the banner for this mount regardless of whether the localStorage
  // write succeeded (Safari Private mode throws — see F15 acceptance).
  const [sessionDismissed, setSessionDismissed] = useState(false);

  // Re-evaluate the env on every render. There is no subscription needed —
  // the env values we read (UA, standalone, permission, dismissedAt) change
  // only on full page reload OR via the Dismiss handler, which calls
  // setSessionDismissed to trigger a re-render.
  const env = snapshotEnv();
  const visible = !sessionDismissed && shouldShowIosPwaHint(env);

  const handleDismiss = useCallback((): void => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // Private mode / quota error — never surface to user; the session
      // flag below still hides the banner for the current view.
    }
    setSessionDismissed(true);
  }, []);

  // WCAG 2.1.2: any element that can hold focus or attention must be
  // dismissible with Escape. Document-level so a screen-reader user pressing
  // Escape from anywhere closes it.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return (): void => {
      document.removeEventListener('keydown', onKey);
    };
  }, [visible, handleDismiss]);

  if (!visible) return null;

  // Motion: omit `transition-*` / `animate-*` classes entirely when the OS
  // asks for reduced motion. The banner is informational, so no motion is the
  // honest default — see WCAG 2.3.3.
  const reduceMotion = prefersReducedMotion();
  const motionClass = reduceMotion ? '' : 'transition-opacity duration-toast ease-out';

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className={`sticky top-0 z-topBar flex w-full flex-col gap-8 border-b border-surface-line bg-brand-light px-16 py-12 text-ink ${motionClass}`.trim()}
    >
      <div className="flex items-start justify-between gap-12">
        <div className="flex-1">
          <p id={titleId} className="text-bodyBold font-bold text-ink">
            {t('notifications.iosPwaHint.title')}
          </p>
          <p className="mt-4 text-meta text-ink2">{t('notifications.iosPwaHint.body')}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-control bg-surface-card px-12 text-label font-semibold text-brand hover:bg-surface-line2 active:bg-surface-line focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('common.dismiss')}
        </button>
      </div>
    </section>
  );
}

export default IosPwaHintBanner;
