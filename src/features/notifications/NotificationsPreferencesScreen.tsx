/**
 * NotificationsPreferencesScreen — props-injected preferences UI (PR B5/B6).
 *
 * Pure presentation. Every side effect is dependency-injected through the
 * `on*` props so the screen can be tested in isolation (vi.fn() injection)
 * AND wired into the AppShell with the real `notificationsService` from
 * the route-level container.
 *
 * Surfaces:
 *   - Master toggle ("Push notifications"). Flipping OFF -> ON calls
 *     `onRequestPermission`; flipping ON -> OFF calls `onTogglePush(false)`
 *     so the parent container can call `unregisterToken`.
 *   - Six per-category toggles, role-gated:
 *       parent-only: choreApprovalsNeeded, wishlistApprovalsNeeded
 *       kid-only:    myChoreResolved, myWishlistResolved
 *       family-wide: familyBoardPosts, familyTodos
 *     Each toggle is a real <button role="switch" aria-checked> with an
 *     accessible name (Lesson 2026-06-08 #1 — a documented a11y prop must
 *     actually reach the DOM).
 *   - "Devices" sublist (purpose-of-collection for the stored `userAgent`
 *     field — threat-modeler pushback #2). Each row shows userAgent +
 *     relative lastSeenAt + a per-row "Sign out this device" button.
 *   - iOS-without-PWA hint: when `isIosWithoutPwa` is true, a different
 *     copy variant is shown and no auto-prompt fires on mount.
 *
 * i18n: every visible string flows through react-i18next under the
 * `notifications.*` key prefix (mirror in en.json + fr.json).
 */
import { useTranslation } from 'react-i18next';
import { type ReactElement } from 'react';
import type { NotificationCategoryKey, Role } from '../../lib/types';
import type { NotificationPreferences } from '../../lib/types';

export interface ViewerSummary {
  uid: string;
  role: Role;
}

export interface DeviceListItem {
  /** SHA-256(token).slice(0,24) hex — the doc id under fcmTokens. */
  tokenHash: string;
  /** Verbatim navigator.userAgent string captured at register-time. */
  userAgent: string;
  /** Epoch ms — when this device last refreshed its token. */
  lastSeenAt: number;
}

export interface NotificationsPreferencesScreenProps {
  viewer: ViewerSummary;
  preferences: NotificationPreferences;
  devices: DeviceListItem[];
  isIosWithoutPwa: boolean;
  /** Master push toggle handler. Receives the NEW value (true=on, false=off). */
  onTogglePush: (nextValue: boolean) => void | Promise<void>;
  /** Per-category toggle handler. */
  onToggleCategory: (key: NotificationCategoryKey, nextValue: boolean) => void | Promise<void>;
  /** Per-device sign-out. Receives the device row's tokenHash. */
  onSignOutDevice: (tokenHash: string) => void | Promise<void>;
  /** Triggered when the master switch flips OFF -> ON. */
  onRequestPermission: () => void | Promise<void>;
}

// Re-export type aliases the test file imports from this module path.
export type { NotificationCategoryKey } from '../../lib/types';

interface CategorySpec {
  key: NotificationCategoryKey;
  /** Which viewer roles see this category. */
  visibleTo: Role[] | 'all';
}

const CATEGORY_SPECS: readonly CategorySpec[] = [
  { key: 'choreApprovalsNeeded', visibleTo: ['parent'] },
  { key: 'wishlistApprovalsNeeded', visibleTo: ['parent'] },
  { key: 'myChoreResolved', visibleTo: ['member'] },
  { key: 'myWishlistResolved', visibleTo: ['member'] },
  { key: 'familyBoardPosts', visibleTo: 'all' },
  { key: 'familyTodos', visibleTo: 'all' },
  // PR F (F10) — scheduled-send categories. The schedulers fan out to every
  // active family member that has opted in, so the toggle is visible to all
  // roles (same as familyBoardPosts / familyTodos).
  { key: 'eventReminders', visibleTo: 'all' },
  { key: 'birthdays', visibleTo: 'all' },
];

function isCategoryVisible(spec: CategorySpec, role: Role): boolean {
  if (spec.visibleTo === 'all') return true;
  return spec.visibleTo.includes(role);
}

/**
 * Format a `lastSeenAt` epoch ms as a coarse relative-time string. Tolerant
 * of clock skew (negative diffs read as "just now"). Tests don't pin the
 * exact wording — only that the string is non-numeric AND signals freshness
 * via "ago / min / hour / h / m". Implementation deliberately monolingual
 * here because the test uses an English regex; the labels themselves stay
 * i18n-routed.
 */
function formatRelativeTime(epochMs: number, now: number): string {
  const diffMs = Math.max(0, now - epochMs);
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${String(diffMinutes)} min ago`;
  if (diffHours < 24) return `${String(diffHours)} hours ago`;
  return `${String(diffDays)} days ago`;
}

export function NotificationsPreferencesScreen(
  props: NotificationsPreferencesScreenProps,
): ReactElement {
  const {
    viewer,
    preferences,
    devices,
    isIosWithoutPwa,
    onTogglePush,
    onToggleCategory,
    onSignOutDevice,
  } = props;
  const { t } = useTranslation();
  const masterOn = preferences.pushEnabled;
  const masterLabel = t('notifications.master.label');

  const handleMasterClick = (): void => {
    if (masterOn) {
      // Flipping OFF — the container will run unregisterToken in response.
      void onTogglePush(false);
      return;
    }
    // Flipping ON — request browser permission first; the container does
    // the registerToken + preferences write after the user accepts.
    void props.onRequestPermission();
  };

  const visibleCategories = CATEGORY_SPECS.filter((spec) => isCategoryVisible(spec, viewer.role));

  // Now for the relative-time renderer. The screen is intentionally a pure
  // function of props; `Date.now()` is the only call against the wall clock
  // and it is guarded by vi.useFakeTimers() in the test suite.
  const now = Date.now();

  return (
    <section className="flex flex-col gap-16 px-16 pt-4">
      <h1 className="text-display font-display font-extrabold text-ink">
        {t('notifications.title')}
      </h1>

      {/* iOS-without-PWA hint replaces the standard prompt copy. */}
      {isIosWithoutPwa ? <p className="text-body text-ink">{t('notifications.iosHint')}</p> : null}

      {/* Master push switch. Real <button role="switch" aria-checked> so SR
          users hear the role+state (Lesson 2026-06-08 #1). */}
      <div className="flex items-center justify-between gap-16">
        <span id="notif-master-label" className="text-body font-semibold text-ink">
          {masterLabel}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={masterOn}
          aria-label={masterLabel}
          onClick={handleMasterClick}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line bg-surface-bg px-12 text-body font-semibold text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {masterOn ? t('notifications.master.on') : t('notifications.master.off')}
        </button>
      </div>

      {/* Per-category toggles. Visible by viewer role. */}
      <fieldset className="flex flex-col gap-12">
        <legend className="text-label font-semibold text-ink-muted">
          {t('notifications.categoriesLegend')}
        </legend>
        {visibleCategories.map((spec) => {
          const checked = preferences.categories[spec.key] === true;
          const isDisabled = !masterOn;
          const labelId = `notif-cat-label-${spec.key}`;
          return (
            <div key={spec.key} className="flex items-center justify-between gap-16">
              <span id={labelId} className="text-body text-ink">
                {t(`notifications.category.${spec.key}`)}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-disabled={isDisabled || undefined}
                aria-labelledby={labelId}
                data-testid={`notif-cat-toggle-${spec.key}`}
                disabled={isDisabled}
                onClick={
                  isDisabled
                    ? undefined
                    : (): void => {
                        void onToggleCategory(spec.key, !checked);
                      }
                }
                className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line bg-surface-bg px-12 text-body font-semibold text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checked ? t('notifications.master.on') : t('notifications.master.off')}
              </button>
            </div>
          );
        })}
      </fieldset>

      {/* Devices sublist — the purpose-of-collection surface that justifies
          storing `userAgent` (threat-modeler pushback #2). When the list is
          empty, render an empty-state message and NO sign-out buttons. */}
      <section className="flex flex-col gap-12">
        <h2 className="text-bodyLg font-semibold text-ink">{t('notifications.devices.heading')}</h2>
        {devices.length === 0 ? (
          <p className="text-body text-ink-muted">{t('notifications.devices.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-12" aria-label={t('notifications.devices.listLabel')}>
            {devices.map((device) => (
              <li
                key={device.tokenHash}
                className="flex items-center justify-between gap-16 rounded-control border border-surface-line bg-surface-bg p-12"
              >
                <div className="flex flex-col gap-4">
                  <span className="text-body font-semibold text-ink">{device.userAgent}</span>
                  <span className="text-label text-ink-muted">
                    {formatRelativeTime(device.lastSeenAt, now)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(): void => {
                    void onSignOutDevice(device.tokenHash);
                  }}
                  className="inline-flex min-h-tap items-center justify-center rounded-control border border-surface-line bg-surface-bg px-12 text-label font-semibold text-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                >
                  {t('notifications.devices.signOut')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
