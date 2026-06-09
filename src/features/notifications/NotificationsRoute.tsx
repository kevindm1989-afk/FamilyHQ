/**
 * NotificationsRoute — thin container that wires NotificationsPreferencesScreen
 * to the live viewer + a no-op-by-default action surface. The full FCM
 * register / unregister / category-write wiring lands in PR C/D when the
 * Cloud Functions are deployable; for PR B the route exists so the screen
 * is reachable from Account → "Notifications" and the preferences UI can
 * be developed against real auth state.
 *
 * Default-exported for React.lazy in AppShell.
 */
import type { ReactElement } from 'react';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { useTranslation } from 'react-i18next';
import { NotificationsPreferencesScreen } from './NotificationsPreferencesScreen';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notificationsPreferences';

export default function NotificationsRoute(): ReactElement {
  const { t } = useTranslation();
  const { currentUser } = useFamily();

  if (!currentUser) {
    return <Placeholder title={t('notifications.title')} />;
  }

  // PR B ships the preferences UI surface only; the live preferences
  // doc + device list land in PR C wiring when registerToken is callable
  // (the App Check token, the VAPID key, and the server-side functions
  // all arrive together). Defaulting to the safe-by-default shape here
  // mirrors what an existing-user backfill would read.
  return (
    <NotificationsPreferencesScreen
      viewer={{ uid: currentUser.id, role: currentUser.role }}
      preferences={DEFAULT_NOTIFICATION_PREFERENCES}
      devices={[]}
      isIosWithoutPwa={false}
      onTogglePush={(): void => {
        // PR C wiring: call notificationsService.registerToken / unregisterToken.
      }}
      onToggleCategory={(): void => {
        // PR C wiring: write userPrivate.notificationPreferences.categories.
      }}
      onSignOutDevice={(): void => {
        // PR C wiring: delete the matching fcmTokens/{tokenHash} doc.
      }}
      onRequestPermission={(): void => {
        // PR C wiring: Notification.requestPermission() + registerToken.
      }}
    />
  );
}
