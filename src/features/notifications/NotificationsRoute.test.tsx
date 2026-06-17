/**
 * NotificationsRoute — container wiring contract (PR G).
 *
 * Pre-PR-G the route shipped four no-op `() => {}` callbacks plus a
 * hardcoded empty device list, so the screen rendered correctly but
 * nothing on the client ever registered a token. PRs C/D/E/F's backend
 * callables were operating on an empty `fcmTokens` collection.
 *
 * These tests pin the live wiring:
 *   - Master OFF -> ON routes through Notification.requestPermission and,
 *     on `granted`, calls `notificationsService.registerToken` AND
 *     persists `pushEnabled: true` via setDoc.
 *   - Master ON -> OFF calls `notificationsService.unregisterToken` AND
 *     persists `pushEnabled: false`.
 *   - Category toggle persists `categories[key] = next` via setDoc.
 *   - Sign-out-device deletes the matching `fcmTokens/{tokenHash}` doc.
 *   - The route subscribes to `userPrivate/{uid}` AND to
 *     `userPrivate/{uid}/fcmTokens` (so a fresh device login sees the
 *     existing list immediately).
 *   - Feature flag OFF -> placeholder; no FCM module is loaded.
 *
 * Mocks: firebase/firestore, firebase/messaging, notificationsService,
 * useFamily, featureFlag. The whole file runs under jsdom; no real
 * network call ever fires.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Role, UserWithId } from '../../lib/types';

// ---------------------------------------------------------------------------
// Mock state — exposed via let-bindings so each test resets the wiring.
// ---------------------------------------------------------------------------
type PreferencesSnapshotPayload = {
  exists: () => boolean;
  data: () => Record<string, unknown> | undefined;
};
type DevicesSnapshotEntry = {
  id: string;
  data: () => Record<string, unknown>;
};
type DevicesSnapshotPayload = {
  forEach: (cb: (d: DevicesSnapshotEntry) => void) => void;
};

let prefSubscriberFn: ((snap: PreferencesSnapshotPayload) => void) | null = null;
let devicesSubscriberFn: ((snap: DevicesSnapshotPayload) => void) | null = null;
const setDocMock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteDocMock = vi.fn(async (..._args: unknown[]) => undefined);
const unsubPref = vi.fn();
const unsubDevices = vi.fn();
const registerTokenMock = vi.fn();
const unregisterTokenMock = vi.fn();
const requestPermissionMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => ({ __coll: args }),
  doc: (...args: unknown[]) => ({ __doc: args }),
  // Discriminate the two subscriptions by the path they were built with,
  // not by the ref's shape — so a future re-ordering of the two
  // useEffects (or a refactor that changes the ref shape) still routes
  // seed data to the correct subscriber.
  onSnapshot: (
    ref: { __doc?: unknown[]; __coll?: unknown[] },
    onNext: (snap: unknown) => void,
    _onError?: (err: unknown) => void,
  ) => {
    const path = (ref.__doc ?? ref.__coll ?? []).join('/');
    if (path.includes('/fcmTokens')) {
      devicesSubscriberFn = onNext as (snap: DevicesSnapshotPayload) => void;
      return unsubDevices;
    }
    prefSubscriberFn = onNext as (snap: PreferencesSnapshotPayload) => void;
    return unsubPref;
  },
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
}));

const getTokenMock = vi.fn(async (..._args: unknown[]) => 'fcm-token-local-device');
vi.mock('firebase/messaging', () => ({
  getMessaging: () => ({ __messaging: true }),
  isSupported: async () => true,
  getToken: (...args: unknown[]) => getTokenMock(...args),
}));

vi.mock('../../firebase/config', () => ({
  db: { __db: true },
  app: { __app: true },
}));

// hashToken is small + pure — re-implement here rather than spy through it.
async function realHashToken(token: string): Promise<string> {
  const encoded = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex.slice(0, 24);
}
vi.mock('./notificationsService', () => ({
  registerToken: (...args: unknown[]) => registerTokenMock(...args),
  unregisterToken: (...args: unknown[]) => unregisterTokenMock(...args),
  hashToken: (token: string) => realHashToken(token),
}));

let flagEnabled = true;
vi.mock('./featureFlag', () => ({
  isPushNotificationsEnabled: () => flagEnabled,
}));

const showToastMock = vi.fn();
vi.mock('../../hooks/useToast', () => ({
  // Real ToastProvider stays available via the Wrapper, but useToast is
  // mocked so the route's hook resolves against a stable spy regardless
  // of the resetModules tear-down between tests.
  useToast: () => ({ message: null, showToast: showToastMock, dismiss: vi.fn() }),
  ToastProvider: ({ children }: { children: unknown }) => children,
}));

const sarah: UserWithId = {
  id: 'uid-parent',
  name: 'Sarah',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
};
vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => familyState,
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

beforeEach(() => {
  prefSubscriberFn = null;
  devicesSubscriberFn = null;
  setDocMock.mockClear();
  deleteDocMock.mockClear();
  unsubPref.mockClear();
  unsubDevices.mockClear();
  showToastMock.mockClear();
  registerTokenMock.mockReset().mockResolvedValue('fcm-token-abc');
  unregisterTokenMock.mockReset().mockResolvedValue(undefined);
  requestPermissionMock.mockReset().mockResolvedValue('granted');
  getTokenMock.mockReset().mockResolvedValue('fcm-token-local-device');
  flagEnabled = true;
  familyState = {
    familyId: 'fam-A',
    role: 'parent',
    currentUser: sarah,
    members: [sarah],
    loading: false,
  };
  // Default: VAPID key configured. Individual tests stub empty to exercise
  // the "not configured" placeholder branch.
  vi.stubEnv('VITE_FCM_VAPID_KEY', 'test-vapid-public-key');
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: {
      permission: 'default',
      requestPermission: (...args: unknown[]) => requestPermissionMock(...args),
    },
  });
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function renderRoute() {
  const Mod = await import('./NotificationsRoute');
  const ui = render(<Mod.default />, { wrapper: Wrapper });
  // Flush effects so the subscriptions register.
  await act(async () => {
    await Promise.resolve();
  });
  return ui;
}

function seedPreferences(prefs: Record<string, unknown> | null) {
  if (!prefSubscriberFn) throw new Error('prefSubscriberFn not registered');
  act(() => {
    prefSubscriberFn!({
      exists: () => prefs !== null,
      data: () => (prefs === null ? undefined : { notificationPreferences: prefs }),
    });
  });
}

function seedDevices(rows: Array<{ id: string; userAgent: string; lastSeenAt: number }>) {
  if (!devicesSubscriberFn) throw new Error('devicesSubscriberFn not registered');
  act(() => {
    devicesSubscriberFn!({
      forEach: (cb) => {
        for (const r of rows) {
          cb({ id: r.id, data: () => ({ userAgent: r.userAgent, lastSeenAt: r.lastSeenAt }) });
        }
      },
    });
  });
}

describe('NotificationsRoute — placeholders', () => {
  it('renders a placeholder when no currentUser', async () => {
    familyState.currentUser = null;
    await renderRoute();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('renders a placeholder when the FCM feature flag is off', async () => {
    flagEnabled = false;
    await renderRoute();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('renders a "not configured" placeholder when VITE_FCM_VAPID_KEY is empty', async () => {
    vi.stubEnv('VITE_FCM_VAPID_KEY', '');
    await renderRoute();
    // Master switch must NOT be present — the screen never mounts when
    // the key is missing, so the master toggle cannot silently no-op.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(requestPermissionMock).not.toHaveBeenCalled();
  });
});

describe('NotificationsRoute — live subscriptions', () => {
  it('subscribes to userPrivate/{uid} and to the fcmTokens subcollection', async () => {
    await renderRoute();
    expect(prefSubscriberFn).not.toBeNull();
    expect(devicesSubscriberFn).not.toBeNull();
  });

  it('renders devices from the live subscription, newest first', async () => {
    await renderRoute();
    seedPreferences({ pushEnabled: true });
    seedDevices([
      { id: 'old', userAgent: 'Old UA', lastSeenAt: 1000 },
      { id: 'new', userAgent: 'New UA', lastSeenAt: 9000 },
    ]);
    const list = await screen.findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('New UA');
    expect(items[1]).toHaveTextContent('Old UA');
  });

  it('reflects pushEnabled flips from the live subscription on the master switch', async () => {
    await renderRoute();
    seedPreferences({ pushEnabled: true });
    const switches = await screen.findAllByRole('switch');
    const master = switches.find((s) => s.getAttribute('aria-checked') === 'true');
    expect(master).toBeDefined();
  });
});

describe('NotificationsRoute — handlers wired to the real service', () => {
  it('OFF -> ON: requests browser permission, registers token, writes pushEnabled=true', async () => {
    await renderRoute();
    seedPreferences({ pushEnabled: false });
    const switches = await screen.findAllByRole('switch');
    const master = switches[0]!; // master is the first switch on the screen
    await act(async () => {
      fireEvent.click(master);
      // Flush the await chain inside the handler.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(registerTokenMock).toHaveBeenCalledTimes(1));
    const regArgs = registerTokenMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(regArgs).toMatchObject({ uid: 'uid-parent' });
    expect('vapidKey' in regArgs).toBe(true);
    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    const lastWrite = setDocMock.mock.calls.at(-1) ?? [];
    const writePayload = (lastWrite[1] ?? undefined) as
      | { notificationPreferences?: { pushEnabled?: boolean } }
      | undefined;
    expect(writePayload?.notificationPreferences?.pushEnabled).toBe(true);
  });

  it('OFF -> ON with permission DENIED: does NOT register and does NOT write pushEnabled', async () => {
    requestPermissionMock.mockResolvedValue('denied');
    await renderRoute();
    seedPreferences({ pushEnabled: false });
    const switches = await screen.findAllByRole('switch');
    await act(async () => {
      fireEvent.click(switches[0]!);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(registerTokenMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('ON -> OFF: calls unregisterToken AND writes pushEnabled=false', async () => {
    await renderRoute();
    seedPreferences({ pushEnabled: true });
    const switches = await screen.findAllByRole('switch');
    const master = switches[0]!;
    await act(async () => {
      fireEvent.click(master);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(unregisterTokenMock).toHaveBeenCalledTimes(1));
    const lastOff = setDocMock.mock.calls.at(-1) ?? [];
    const offWrite = (lastOff[1] ?? undefined) as
      | { notificationPreferences?: { pushEnabled?: boolean } }
      | undefined;
    expect(offWrite?.notificationPreferences?.pushEnabled).toBe(false);
  });

  it('category toggle writes categories[key]=next via setDoc', async () => {
    await renderRoute();
    seedPreferences({
      pushEnabled: true,
      categories: { familyBoardPosts: false },
    });
    const boardToggle = await screen.findByTestId('notif-cat-toggle-familyBoardPosts');
    await act(async () => {
      fireEvent.click(boardToggle);
      await Promise.resolve();
    });
    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    const lastCat = setDocMock.mock.calls.at(-1) ?? [];
    const payload = (lastCat[1] ?? undefined) as
      | {
          notificationPreferences?: {
            categories?: Record<string, boolean>;
          };
        }
      | undefined;
    expect(payload?.notificationPreferences?.categories?.familyBoardPosts).toBe(true);
  });

  it('sign-out OTHER device deletes the matching fcmTokens/{tokenHash} doc (no unregisterToken)', async () => {
    // getToken returns a token whose hash differs from "hash-A" — so the
    // row being signed out is NOT this device.
    getTokenMock.mockResolvedValue('different-token-not-local');
    await renderRoute();
    seedPreferences({ pushEnabled: true });
    seedDevices([{ id: 'hash-A', userAgent: 'UA-A', lastSeenAt: 1 }]);
    const signOut = await screen.findByText(/sign out/i);
    await act(async () => {
      fireEvent.click(signOut);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(deleteDocMock).toHaveBeenCalledTimes(1));
    expect(unregisterTokenMock).not.toHaveBeenCalled();
    const delArgs = deleteDocMock.mock.calls[0] ?? [];
    const ref = (delArgs[0] ?? {}) as { __doc?: unknown[] };
    expect(JSON.stringify(ref.__doc)).toContain('hash-A');
  });

  it('sign-out THIS device routes through unregisterToken (so the row does not silently reappear)', async () => {
    // Seed devices with a row whose tokenHash matches what hashing the
    // mocked local token will produce. We compute it from the same hash
    // function the route uses (sha256 + slice(0,24)).
    const localToken = 'fcm-token-local-device';
    const localHash = await realHashToken(localToken);
    getTokenMock.mockResolvedValue(localToken);
    await renderRoute();
    seedPreferences({ pushEnabled: true });
    seedDevices([{ id: localHash, userAgent: 'UA-local', lastSeenAt: 1 }]);
    const signOut = await screen.findByText(/sign out/i);
    await act(async () => {
      fireEvent.click(signOut);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(unregisterTokenMock).toHaveBeenCalledTimes(1));
    // Direct deleteDoc must NOT be called — unregisterTokenService owns
    // both the SDK-side deleteToken AND the doc deletion.
    expect(deleteDocMock).not.toHaveBeenCalled();
  });
});

describe('NotificationsRoute — write-error surfacing', () => {
  it('a Firestore write failure during category toggle surfaces a toast (no silent failure)', async () => {
    setDocMock.mockRejectedValueOnce(new Error('permission-denied: userPrivate create rejected'));
    await renderRoute();
    seedPreferences({ pushEnabled: true, categories: { familyBoardPosts: false } });
    const boardToggle = await screen.findByTestId('notif-cat-toggle-familyBoardPosts');
    await act(async () => {
      fireEvent.click(boardToggle);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(showToastMock).toHaveBeenCalledTimes(1));
  });
});

describe('NotificationsRoute — mid-flight cancellation guard', () => {
  it('OFF -> ON: if uid flips after requestPermission resolves, NO registerToken AND NO setDoc fires', async () => {
    // Slow-walk the permission prompt so the test can flip uid mid-flight.
    let resolvePermission: ((v: NotificationPermission) => void) | null = null;
    requestPermissionMock.mockImplementation(
      () =>
        new Promise<NotificationPermission>((res) => {
          resolvePermission = res;
        }),
    );
    const Mod = await import('./NotificationsRoute');
    const { rerender } = render(<Mod.default />, { wrapper: Wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    seedPreferences({ pushEnabled: false });
    const switches = await screen.findAllByRole('switch');
    fireEvent.click(switches[0]!);
    // Flip uid -> null (simulate sign-out) and force a re-render so the
    // route's uidRef.current is synchronously updated to null.
    familyState = { ...familyState, currentUser: null };
    rerender(<Mod.default />);
    await act(async () => {
      resolvePermission!('granted');
      // Flush the await chain inside the handler — every hop sees
      // uidRef.current === null !== capturedUid (the original parent uid)
      // and short-circuits.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(registerTokenMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});
