/**
 * NotificationsRoute — live container that wires NotificationsPreferencesScreen
 * to the real notificationsService + a live `userPrivate/{uid}` subscription
 * for the preferences doc and a live `fcmTokens` subcollection subscription
 * for the device list.
 *
 * Before PR G this file shipped four no-op `() => {}` callbacks and a
 * hardcoded `devices: []` / `isIosWithoutPwa: false`. The screen rendered,
 * the master toggle clicked, and nothing on the client ever called
 * `getToken` — so PR D/E/F's backend callables had zero registered tokens
 * to send to. PR G plugs the four real call paths and the two live
 * subscriptions.
 *
 * Adversarial-review hardening (PR G):
 *   - Writes are FIELD-MERGE, never object-spread. Every setDoc only
 *     touches the leaf it's changing (pushEnabled, categories.<key>,
 *     etc.) so a concurrent write from another device/tab cannot be
 *     clobbered by a stale in-memory copy. (Finding 1 / Finding 7)
 *   - Every async handler captures uid at entry and re-checks it after
 *     each await; mid-flight account/family switch aborts before any
 *     write reaches the wrong subject. (Finding 2)
 *   - Empty/missing `VITE_FCM_VAPID_KEY` renders a clear placeholder
 *     rather than letting the master toggle silently no-op. (Finding 4)
 *   - `handleSignOutDevice` detects when the row being signed out is
 *     THIS device's current FCM token and routes through
 *     `unregisterToken` (which calls `deleteToken` on the SDK side),
 *     so the row does not silently reappear on the next refresh.
 *     (Finding 10)
 *   - `isSupported()` is matched with strict `=== true`; shim returns
 *     of `undefined` no longer pass through. (Finding 3)
 *   - `onSnapshot` calls pass an explicit onError so a denied/listener-
 *     dropped event does not crash the route. (Finding 5)
 *
 * The whole route is gated by `isPushNotificationsEnabled()` — when FCM
 * is flag-OFF the route renders a placeholder (the route exists so the
 * Account menu link doesn't 404 even on Spark-tier deploys).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  type FirestoreError,
} from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { useToast } from '../../hooks/useToast';
import { app, auth, db } from '../../firebase/config';
import type { NotificationCategoryKey, NotificationPreferences } from '../../lib/types';
import { isPushNotificationsEnabled } from './featureFlag';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORY_KEYS,
} from './notificationsPreferences';
import { NotificationsPreferencesScreen } from './NotificationsPreferencesScreen';
import type { DeviceListItem } from './NotificationsPreferencesScreen';
import {
  hashToken,
  registerToken as registerTokenService,
  unregisterToken as unregisterTokenService,
} from './notificationsService';

const FCM_TOKENS_SUBCOLLECTION = 'fcmTokens';
const USER_PRIVATE_COLLECTION = 'userPrivate';

interface RawFcmTokenDoc {
  userAgent?: unknown;
  lastSeenAt?: unknown;
}

interface RawUserPrivateDoc {
  notificationPreferences?: Partial<NotificationPreferences>;
}

function projectDeviceRow(id: string, raw: RawFcmTokenDoc): DeviceListItem {
  const ua = typeof raw.userAgent === 'string' ? raw.userAgent : '';
  const lastSeenAt = typeof raw.lastSeenAt === 'number' ? raw.lastSeenAt : 0;
  return { tokenHash: id, userAgent: ua, lastSeenAt };
}

/**
 * Coerce a partial/absent `notificationPreferences` field into the strict
 * shape the screen needs. Existing users created before push landed have
 * no field at all — we read them as fully default (master off, all
 * categories off) to mirror the safe-by-default contract.
 *
 * NOTE: this coercion is for the READ side only. Writes never spread this
 * normalized object back into Firestore — writes target the specific leaf
 * being changed so unknown server-side keys are preserved.
 */
function readPreferences(raw: RawUserPrivateDoc | null): NotificationPreferences {
  const candidate = raw?.notificationPreferences;
  if (!candidate) return DEFAULT_NOTIFICATION_PREFERENCES;
  const categories: Record<NotificationCategoryKey, boolean> = {
    choreApprovalsNeeded: false,
    wishlistApprovalsNeeded: false,
    myChoreResolved: false,
    myWishlistResolved: false,
    familyBoardPosts: false,
    familyTodos: false,
    eventReminders: false,
    birthdays: false,
  };
  const rawCats = candidate.categories;
  if (rawCats && typeof rawCats === 'object') {
    for (const key of NOTIFICATION_CATEGORY_KEYS) {
      if ((rawCats as Record<string, unknown>)[key] === true) categories[key] = true;
    }
  }
  return {
    pushEnabled: candidate.pushEnabled === true,
    showDetails: false, // v1 invariant — UI never flips this, never writes it.
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
    categories,
  };
}

/**
 * Mirror of the IosPwaHintBanner heuristic: returns true ONLY when the
 * device is iOS Safari AND the app is not yet a home-screen PWA. In that
 * state the iOS browser does not expose the Web Push API even on iOS
 * 16.4+, so the screen flips to a hint-copy variant instead of arming
 * a permission prompt that would never fire.
 */
function detectIosWithoutPwa(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  const isIphoneFamily = /iPhone|iPad|iPod/.test(ua);
  const isIpadOsAsMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  const isIos = isIphoneFamily || isIpadOsAsMac;
  if (!isIos) return false;
  return navigator.standalone !== true;
}

/**
 * Read THIS browser's current FCM token (via getToken) and return its
 * doc-id hash, or null when the SDK has no token (permission denied,
 * unsupported, etc.). Used by `handleSignOutDevice` to decide whether the
 * row being signed out is the local device's row — in which case we MUST
 * also call the SDK's deleteToken to invalidate the credential. Without
 * that, the deleted Firestore row reappears on the next foreground
 * refresh because getToken happily returns the SDK-cached token and the
 * client cap-eviction loop re-creates the doc.
 */
async function readCurrentDeviceHash(vapidKey: string): Promise<string | null> {
  try {
    if ((await isSupported()) !== true) return null;
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey });
    if (!token) return null;
    return await hashToken(token);
  } catch {
    return null;
  }
}

export default function NotificationsRoute(): ReactElement {
  const { t } = useTranslation();
  const { currentUser, familyId } = useFamily();
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [devices, setDevices] = useState<DeviceListItem[]>([]);
  const uid = currentUser?.id ?? null;
  const flagOn = isPushNotificationsEnabled();
  const vapidKey = (import.meta.env.VITE_FCM_VAPID_KEY ?? '') as string;
  const vapidKeyMissing = vapidKey.length === 0;
  const isIosWithoutPwa = useMemo(() => detectIosWithoutPwa(), []);

  // Mid-flight cancellation guard: re-check `uidRef.current === capturedUid`
  // after every async hop so an account switch or sign-out during the
  // ~1–5s permission/getToken window cannot land a write under the wrong
  // subject. Updated synchronously on every render so handler closures
  // see the latest uid without having to be re-bound.
  const uidRef = useRef<string | null>(uid);
  uidRef.current = uid;

  // Whether the subject's userPrivate/{uid} doc actually exists. Founding
  // parents get one at signup; invited members created BEFORE the
  // inviteService bootstrap fix have none, which makes a preferences
  // setDoc-merge a CREATE that the rules reject (create-shape is exactly
  // {email, familyId}). When the doc is missing we self-heal: bootstrap
  // {email, familyId} first, then write preferences as an UPDATE. Starts
  // null (unknown) until the first snapshot resolves.
  const docExistsRef = useRef<boolean | null>(null);

  useEffect((): (() => void) | undefined => {
    if (!uid) return undefined;
    const unsub = onSnapshot(
      doc(db, USER_PRIVATE_COLLECTION, uid),
      (snap) => {
        docExistsRef.current = snap.exists();
        const data = snap.exists() ? (snap.data() as RawUserPrivateDoc) : null;
        setPreferences(readPreferences(data));
      },
      (_err: FirestoreError): void => {
        // Listener errors (transient network, permission flap after token
        // refresh) — keep the last-known preferences in state rather than
        // crashing the route. The next reconnect re-fires the success
        // callback. No PI in the error object goes into any log sink.
      },
    );
    return unsub;
  }, [uid]);

  useEffect((): (() => void) | undefined => {
    if (!uid) return undefined;
    const unsub = onSnapshot(
      collection(db, USER_PRIVATE_COLLECTION, uid, FCM_TOKENS_SUBCOLLECTION),
      (snap) => {
        const rows: DeviceListItem[] = [];
        snap.forEach((d) => {
          rows.push(projectDeviceRow(d.id, d.data() as RawFcmTokenDoc));
        });
        rows.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
        setDevices(rows);
      },
      (_err: FirestoreError): void => {
        // See comment on the preferences listener — same posture.
      },
    );
    return unsub;
  }, [uid]);

  /**
   * Construct the SDK Messaging instance only after `isSupported()` returns
   * strict `true`. Older shim returns of `undefined` no longer pass
   * through. Returns null on unsupported browsers (Safari < 16.4, in-app
   * webviews, …) — callers route to a no-op without a user-visible error.
   */
  const loadMessaging = useCallback(async () => {
    const supported = await isSupported();
    if (supported !== true) return null;
    return getMessaging(app);
  }, []);

  /**
   * Field-merge write. Every async handler calls this with the SPECIFIC
   * leaf it is changing — never the full preferences object — so that a
   * concurrent write from another device/tab cannot be clobbered. The
   * `updatedAt` stamp is added at write time, not captured in a closure.
   *
   * `capturedUid` is the uid at handler entry; if the live uid has flipped
   * mid-flight (user signed out, switched account) we abort silently.
   */
  const writePreferencesPatch = useCallback(
    async (capturedUid: string, patch: Record<string, unknown>): Promise<void> => {
      if (uidRef.current !== capturedUid) return;
      if (!familyId) return;
      try {
        // Self-heal the legacy invited-member gap. A preferences write is a
        // setDoc-merge; when the userPrivate/{uid} doc does NOT exist that
        // merge is a CREATE, and the create rule permits ONLY the exact
        // shape {email, familyId} — so a notificationPreferences write can
        // never land on a missing doc (confirmed by the rules test
        // userprivate-notification-prefs.test.ts case C). Invited members
        // accepted before the inviteService bootstrap fix have no doc, so
        // here we first create it with exactly {email, familyId} (which the
        // create rule allows for an established active member claiming their
        // own family), then fall through to the preferences UPDATE.
        if (docExistsRef.current === false) {
          const email = auth.currentUser?.email;
          if (email) {
            await setDoc(doc(db, USER_PRIVATE_COLLECTION, capturedUid), {
              email,
              familyId,
            });
            docExistsRef.current = true;
            if (uidRef.current !== capturedUid) return;
          }
        }
        await setDoc(
          doc(db, USER_PRIVATE_COLLECTION, capturedUid),
          { notificationPreferences: { ...patch, updatedAt: Date.now() } },
          { merge: true },
        );
      } catch {
        // Surface a toast so the user knows the toggle did not persist; the
        // error object is NOT logged (it can carry path fragments that are
        // PI-adjacent under the threat model).
        showToast(t('notifications.writeFailed'));
      }
    },
    [familyId, showToast, t],
  );

  const handleRequestPermission = useCallback(async (): Promise<void> => {
    const capturedUid = uidRef.current;
    if (!capturedUid) return;
    if (vapidKeyMissing) return;
    if (typeof Notification === 'undefined') return;
    let permission: NotificationPermission;
    try {
      permission = await Notification.requestPermission();
    } catch {
      return;
    }
    if (uidRef.current !== capturedUid) return;
    if (permission !== 'granted') return;
    const messaging = await loadMessaging();
    if (uidRef.current !== capturedUid) return;
    if (!messaging) return;
    const token = await registerTokenService({
      db,
      messaging,
      uid: capturedUid,
      vapidKey,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
    if (uidRef.current !== capturedUid) return;
    if (token === null) return;
    await writePreferencesPatch(capturedUid, { pushEnabled: true });
  }, [vapidKey, vapidKeyMissing, loadMessaging, writePreferencesPatch]);

  const handleTogglePush = useCallback(
    async (nextValue: boolean): Promise<void> => {
      const capturedUid = uidRef.current;
      if (!capturedUid) return;
      if (nextValue) {
        // The screen routes OFF -> ON through onRequestPermission, so this
        // branch is normally unreachable. Forward to the permission flow
        // so the surface is still correct if a future caller invokes
        // onTogglePush(true) directly.
        await handleRequestPermission();
        return;
      }
      const messaging = await loadMessaging();
      if (uidRef.current !== capturedUid) return;
      if (messaging) {
        await unregisterTokenService({ db, messaging, uid: capturedUid, vapidKey });
        if (uidRef.current !== capturedUid) return;
      }
      await writePreferencesPatch(capturedUid, { pushEnabled: false });
    },
    [vapidKey, loadMessaging, writePreferencesPatch, handleRequestPermission],
  );

  const handleToggleCategory = useCallback(
    async (key: NotificationCategoryKey, nextValue: boolean): Promise<void> => {
      const capturedUid = uidRef.current;
      if (!capturedUid) return;
      await writePreferencesPatch(capturedUid, { categories: { [key]: nextValue } });
    },
    [writePreferencesPatch],
  );

  const handleSignOutDevice = useCallback(
    async (tokenHash: string): Promise<void> => {
      const capturedUid = uidRef.current;
      if (!capturedUid) return;
      const localHash = await readCurrentDeviceHash(vapidKey);
      if (uidRef.current !== capturedUid) return;
      if (localHash === tokenHash) {
        // Signing out THIS device: also invalidate the SDK-side token so
        // the row does not silently reappear on the next foreground tick.
        const messaging = await loadMessaging();
        if (uidRef.current !== capturedUid) return;
        if (messaging) {
          await unregisterTokenService({ db, messaging, uid: capturedUid, vapidKey });
          return;
        }
        // Fall through to plain delete if messaging is unsupported.
      }
      await deleteDoc(
        doc(db, USER_PRIVATE_COLLECTION, capturedUid, FCM_TOKENS_SUBCOLLECTION, tokenHash),
      );
    },
    [vapidKey, loadMessaging],
  );

  if (!currentUser) {
    return <Placeholder title={t('notifications.title')} />;
  }

  if (!flagOn) {
    return <Placeholder title={t('notifications.title')} />;
  }

  if (vapidKeyMissing) {
    // No VAPID key in the build -> getToken would fail silently. Surface a
    // clear, operator-visible message instead of letting the master toggle
    // appear to work and then do nothing.
    return <Placeholder title={t('notifications.title')} note={t('notifications.notConfigured')} />;
  }

  return (
    <NotificationsPreferencesScreen
      viewer={{ uid: currentUser.id, role: currentUser.role }}
      preferences={preferences}
      devices={devices}
      isIosWithoutPwa={isIosWithoutPwa}
      onTogglePush={handleTogglePush}
      onToggleCategory={handleToggleCategory}
      onSignOutDevice={handleSignOutDevice}
      onRequestPermission={handleRequestPermission}
    />
  );
}
