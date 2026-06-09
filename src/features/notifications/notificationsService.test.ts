/**
 * notificationsService — client unit contract (PR B, threat-model §A.10).
 *
 * Pins the register / unregister / refresh paths the implementer must build.
 * Mocks the Firebase Messaging SDK + `firebase/firestore` at the boundary —
 * NO real network, NO real FCM, NO real Firestore.
 *
 * Test IDs map to threat-model §A.10:
 *   B-T9  — registerToken happy path: upserts fcmTokens/{tokenHash} with
 *           exactly {token, userAgent, createdAt, lastSeenAt}; tokenHash is
 *           the first 24 hex chars of SHA-256(token).
 *   B-T10 — registerToken null permission path: getToken returns null →
 *           returns null, NO Firestore write.
 *   B-T11 — per-user device cap: existing 20 docs + a new device →
 *           the oldest (by lastSeenAt) is deleted before the new one is
 *           created, leaving exactly 20.
 *   B-T12 — unregisterToken: calls deleteToken(messaging) AND deletes the
 *           device's matching fcmTokens doc. Idempotent on second call
 *           (no current token → no-op, no throw).
 *   B-T13 — refreshToken / onTokenRefresh: old doc deleted, new doc upserted
 *           with the new hash.
 *   B-T14 — AODA primitive-level: handled in
 *           NotificationsPreferencesScreen.test.tsx (per-category toggles
 *           render as real form controls). Marker test here pins the test
 *           ID for traceability.
 *
 * These FAIL today: no service module exists at this path. The implementer
 * builds it to make them pass.
 *
 * Determinism guarantees:
 *   - vi.useFakeTimers() + a pinned FIXED_NOW so createdAt / lastSeenAt are
 *     deterministic.
 *   - No real crypto (we mock the SDK's behaviour with a known sha256
 *     output via the WebCrypto polyfill — see beforeAll).
 *   - No real network — every Firebase SDK call is intercepted.
 *   - Each test resets mocks + timers in beforeEach/afterEach.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 9, 12, 0, 0); // 2026-06-09 noon UTC
const TEST_UID = 'uid-member-a';
const TEST_USER_AGENT = 'Chrome on macOS';
const TEST_TOKEN = 'fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TEST_VAPID_KEY = 'BVAPIDvapidvapidvapidvapidvapidvapidvapidvapid';

/** Deterministic SHA-256 hex of TEST_TOKEN, used in B-T9 to pin the tokenHash. */
let TEST_TOKEN_HASH_24: string;

beforeAll(async () => {
  // Node's webcrypto is the spec-compliant SHA-256 source; assigned to global
  // crypto so a browser-style `crypto.subtle.digest('SHA-256', ...)` call in
  // the service module works under jsdom. (jsdom 24 exposes crypto.subtle
  // partially; pinning to Node's webcrypto is portable.)
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  }
  const enc = new TextEncoder().encode(TEST_TOKEN);
  const digest = await webcrypto.subtle.digest('SHA-256', enc);
  TEST_TOKEN_HASH_24 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
});

// ---------------------------------------------------------------------------
// Firestore SDK boundary mocks — every call captured for assertion.
// ---------------------------------------------------------------------------
interface CapturedRef {
  __path: string;
  __segments: string[];
}

let setDocCalls: { ref: CapturedRef; data: Record<string, unknown> }[];
let deleteDocCalls: CapturedRef[];
let getDocsResult: { id: string; data: Record<string, unknown> }[];
let getDocsCalls: CapturedRef[];

function makeRef(segments: string[]): CapturedRef {
  return { __segments: segments, __path: segments.join('/') };
}

const docMock = vi.fn((_db: unknown, ...rest: string[]) => makeRef(rest));
const collectionMock = vi.fn((_db: unknown, ...rest: string[]) => makeRef(rest));
const setDocMock = vi.fn(async (ref: CapturedRef, data: Record<string, unknown>) => {
  setDocCalls.push({ ref, data });
});
const deleteDocMock = vi.fn(async (ref: CapturedRef) => {
  deleteDocCalls.push(ref);
});
const getDocsMock = vi.fn(async (ref: CapturedRef) => {
  getDocsCalls.push(ref);
  return {
    size: getDocsResult.length,
    empty: getDocsResult.length === 0,
    docs: getDocsResult.map((d) => ({
      id: d.id,
      data: () => d.data,
      ref: makeRef([...ref.__segments, d.id]),
      exists: () => true,
    })),
    forEach: function (cb: (snap: { id: string; data: () => Record<string, unknown> }) => void) {
      this.docs.forEach(cb);
    },
  };
});

vi.mock('firebase/firestore', () => ({
  doc: (...a: [unknown, ...string[]]) => docMock(...a),
  collection: (...a: [unknown, ...string[]]) => collectionMock(...a),
  setDoc: (ref: CapturedRef, data: Record<string, unknown>) => setDocMock(ref, data),
  deleteDoc: (ref: CapturedRef) => deleteDocMock(ref),
  getDocs: (ref: CapturedRef) => getDocsMock(ref),
}));

// ---------------------------------------------------------------------------
// Firebase Messaging SDK boundary mocks. The service module is expected to
// import `getToken`, `deleteToken`, and `onMessage` (or `onTokenRefresh`)
// from 'firebase/messaging'. We control each return value per-test.
// ---------------------------------------------------------------------------
let getTokenResult: string | null;
let getTokenShouldThrow: Error | null;
let deleteTokenResult: boolean;
let onMessageHandlerRef: ((p: unknown) => void) | null = null;
// Reserved for a future refreshToken-via-onTokenRefresh-callback test (PR B's
// refreshToken happy path is exercised directly via the function call). The
// ref is set in the firebase/messaging mock so tests CAN observe the handler
// registration if needed — accessed via the lint-friendly export below.
void onMessageHandlerRef;

const getTokenMock = vi.fn(async (_messaging: unknown, _opts: { vapidKey: string }) => {
  if (getTokenShouldThrow) throw getTokenShouldThrow;
  return getTokenResult;
});
const deleteTokenMock = vi.fn(async (_messaging: unknown) => deleteTokenResult);
const onMessageMock = vi.fn((_messaging: unknown, handler: (p: unknown) => void) => {
  onMessageHandlerRef = handler;
  return () => {
    onMessageHandlerRef = null;
  };
});

vi.mock('firebase/messaging', () => ({
  getToken: (...a: [unknown, { vapidKey: string }]) => getTokenMock(...a),
  deleteToken: (m: unknown) => deleteTokenMock(m),
  onMessage: (m: unknown, h: (p: unknown) => void) => onMessageMock(m, h),
}));

// ---------------------------------------------------------------------------
// Service under test — imported AFTER the mocks are declared so the module
// graph picks up the mocked SDKs.
// ---------------------------------------------------------------------------
import {
  MAX_FCM_TOKENS_PER_USER,
  hashToken,
  registerToken,
  unregisterToken,
  refreshToken,
} from './notificationsService';

const db = {} as import('firebase/firestore').Firestore;
const messaging = {} as import('firebase/messaging').Messaging;

beforeEach(() => {
  setDocCalls = [];
  deleteDocCalls = [];
  getDocsCalls = [];
  getDocsResult = [];
  getTokenResult = TEST_TOKEN;
  getTokenShouldThrow = null;
  deleteTokenResult = true;
  onMessageHandlerRef = null;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// hashToken — pure helper. Pin to SHA-256 first 24 hex chars (no MD5, no
// truncation drift). Threat-model is silent on the algorithm; pinned here
// to remove ambiguity for the implementer.
// ---------------------------------------------------------------------------
describe('hashToken — deterministic, first 24 hex chars of SHA-256(token)', () => {
  it('returns exactly 24 hex characters', async () => {
    const h = await hashToken(TEST_TOKEN);
    expect(h).toMatch(/^[0-9a-f]{24}$/);
    expect(h.length).toBe(24);
  });

  it('is deterministic for the same input', async () => {
    const a = await hashToken(TEST_TOKEN);
    const b = await hashToken(TEST_TOKEN);
    expect(a).toBe(b);
  });

  it('matches the reference SHA-256(token).slice(0,24)', async () => {
    const h = await hashToken(TEST_TOKEN);
    expect(h).toBe(TEST_TOKEN_HASH_24);
  });

  it('produces different hashes for different tokens (no MD5 truncation collisions)', async () => {
    const a = await hashToken(TEST_TOKEN);
    const b = await hashToken(TEST_TOKEN + 'differ');
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// B-T9 — registerToken happy path
// ---------------------------------------------------------------------------
describe('B-T9: registerToken — happy path upserts the fcmTokens/{tokenHash} doc', () => {
  it('calls getToken with the VAPID key from input', async () => {
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(getTokenMock.mock.calls[0]?.[1]).toEqual({ vapidKey: TEST_VAPID_KEY });
  });

  it('writes setDoc at userPrivate/{uid}/fcmTokens/{tokenHash} where tokenHash = sha256(token).slice(0,24)', async () => {
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(setDocCalls, 'exactly one setDoc on the fcmToken doc').toHaveLength(1);
    const path = setDocCalls[0]!.ref.__segments;
    expect(path).toEqual(['userPrivate', TEST_UID, 'fcmTokens', TEST_TOKEN_HASH_24]);
  });

  it('writes EXACTLY the {token, userAgent, createdAt, lastSeenAt} keys — no smuggled fields', async () => {
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    const payload = setDocCalls[0]!.data;
    expect(Object.keys(payload).sort()).toEqual(
      ['createdAt', 'lastSeenAt', 'token', 'userAgent'].sort(),
    );
  });

  it('writes the full FCM token (not the hash) in the doc body', async () => {
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(setDocCalls[0]!.data.token).toBe(TEST_TOKEN);
  });

  it('writes userAgent verbatim (display label for the Devices view — pushback #2 purpose-of-collection)', async () => {
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(setDocCalls[0]!.data.userAgent).toBe(TEST_USER_AGENT);
  });

  it('stamps createdAt + lastSeenAt as epoch ms (numbers, equal to Date.now() under fake clock)', async () => {
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    const { createdAt, lastSeenAt } = setDocCalls[0]!.data;
    expect(typeof createdAt).toBe('number');
    expect(typeof lastSeenAt).toBe('number');
    expect(createdAt).toBe(FIXED_NOW);
    expect(lastSeenAt).toBe(FIXED_NOW);
  });

  it('returns the FCM token string on success (so callers can verify)', async () => {
    const out = await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(out).toBe(TEST_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// B-T10 — getToken returns null (browser permission denied) → no write
// ---------------------------------------------------------------------------
describe('B-T10: registerToken returns null when permission is denied; NO Firestore write', () => {
  it('returns null when getToken resolves to null', async () => {
    getTokenResult = null;
    const out = await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(out).toBeNull();
  });

  it('does NOT call setDoc when getToken returns null', async () => {
    getTokenResult = null;
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(setDocMock).not.toHaveBeenCalled();
    expect(setDocCalls).toHaveLength(0);
  });

  it('does NOT call deleteDoc either (a null token is not a delete trigger)', async () => {
    getTokenResult = null;
    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(deleteDocMock).not.toHaveBeenCalled();
  });

  it('returns null when getToken throws (browser feature unavailable / blocked)', async () => {
    getTokenShouldThrow = new Error('messaging/permission-blocked');
    const out = await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(out).toBeNull();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// B-T11 — per-user device cap (20 docs). New device → oldest deleted first.
// ---------------------------------------------------------------------------
describe('B-T11: per-user device cap of 20 — evict oldest by lastSeenAt before adding new', () => {
  it('the cap constant is exactly 20 (pinned by spec)', () => {
    expect(MAX_FCM_TOKENS_PER_USER).toBe(20);
  });

  it('with 20 existing tokens and a NEW device, deletes the OLDEST (smallest lastSeenAt) before setDoc', async () => {
    // Seed 20 existing token docs with lastSeenAt 1, 2, ..., 20 — token '1'
    // is the oldest and must be the one deleted.
    getDocsResult = Array.from({ length: 20 }, (_, i) => ({
      id: `existing-hash-${String(i + 1).padStart(2, '0')}`,
      data: {
        token: `existing-token-${i + 1}`,
        userAgent: 'UA',
        createdAt: i + 1,
        lastSeenAt: i + 1, // ascending — id "01" is oldest
      },
    }));
    // Shuffle the docs to prove the implementer sorts, not relies on
    // iteration order. (oldest is still id "existing-hash-01".)
    getDocsResult = [...getDocsResult].reverse();

    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });

    // EXACTLY one delete (the oldest), EXACTLY one set (the new token).
    expect(deleteDocCalls, 'exactly one delete on cap eviction').toHaveLength(1);
    expect(deleteDocCalls[0]!.__segments).toEqual([
      'userPrivate',
      TEST_UID,
      'fcmTokens',
      'existing-hash-01',
    ]);
    expect(setDocCalls, 'exactly one setDoc for the new device').toHaveLength(1);
    expect(setDocCalls[0]!.ref.__segments).toEqual([
      'userPrivate',
      TEST_UID,
      'fcmTokens',
      TEST_TOKEN_HASH_24,
    ]);
  });

  it('with 20 existing tokens but the NEW token matches an EXISTING tokenHash, NO eviction (it is an upsert)', async () => {
    // The current device's hash already exists — re-registering is an
    // upsert, not a new device. Cap is not breached; no eviction needed.
    getDocsResult = [
      ...Array.from({ length: 19 }, (_, i) => ({
        id: `existing-hash-${String(i + 1).padStart(2, '0')}`,
        data: {
          token: `existing-token-${i + 1}`,
          userAgent: 'UA',
          createdAt: i + 1,
          lastSeenAt: i + 1,
        },
      })),
      {
        id: TEST_TOKEN_HASH_24, // <- this device's hash is already on file
        data: {
          token: TEST_TOKEN,
          userAgent: TEST_USER_AGENT,
          createdAt: 100,
          lastSeenAt: 100,
        },
      },
    ];

    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });

    expect(deleteDocCalls, 'no eviction on a same-device re-register').toHaveLength(0);
    expect(setDocCalls).toHaveLength(1); // still upserted (refreshes lastSeenAt)
  });

  it('with fewer than 20 existing tokens, NO eviction occurs', async () => {
    getDocsResult = Array.from({ length: 5 }, (_, i) => ({
      id: `existing-hash-${i}`,
      data: { token: `t-${i}`, userAgent: 'UA', createdAt: i, lastSeenAt: i },
    }));

    await registerToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
    });

    expect(deleteDocCalls).toHaveLength(0);
    expect(setDocCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B-T12 — unregisterToken: deleteToken(messaging) + deleteDoc(this-device);
// idempotent on a second call when there is no current token.
// ---------------------------------------------------------------------------
describe('B-T12: unregisterToken — deletes SDK token + this device\'s fcmTokens doc; idempotent', () => {
  it('calls deleteToken(messaging)', async () => {
    await unregisterToken({
      messaging,
      db,
      uid: TEST_UID,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(deleteTokenMock).toHaveBeenCalledTimes(1);
    expect(deleteTokenMock.mock.calls[0]?.[0]).toBe(messaging);
  });

  it('deletes the fcmTokens doc keyed by THIS device\'s tokenHash (matched by the current FCM token)', async () => {
    // The service must figure out *which* doc to delete on this device.
    // It reads the current token (via getToken or a cached value), hashes
    // it, and deletes that single doc. Assert exactly one delete, at the
    // path matching TEST_TOKEN_HASH_24.
    await unregisterToken({
      messaging,
      db,
      uid: TEST_UID,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(deleteDocCalls, 'exactly one fcmToken doc deleted on this device').toHaveLength(1);
    expect(deleteDocCalls[0]!.__segments).toEqual([
      'userPrivate',
      TEST_UID,
      'fcmTokens',
      TEST_TOKEN_HASH_24,
    ]);
  });

  it('is idempotent — a second call when there is NO current token does NOT throw and writes nothing extra', async () => {
    // First call: succeeds with token present.
    await unregisterToken({
      messaging,
      db,
      uid: TEST_UID,
      vapidKey: TEST_VAPID_KEY,
    });
    expect(deleteDocCalls).toHaveLength(1);
    const deletesAfterFirst = deleteDocCalls.length;
    const sdkDeletesAfterFirst = deleteTokenMock.mock.calls.length;

    // Second call: simulate no current token (getToken now resolves null).
    getTokenResult = null;
    await expect(
      unregisterToken({ messaging, db, uid: TEST_UID, vapidKey: TEST_VAPID_KEY }),
    ).resolves.not.toThrow();
    // No NEW Firestore delete on the second call (idempotent).
    expect(deleteDocCalls.length).toBe(deletesAfterFirst);
    // deleteToken may or may not be called — both are acceptable IFF it
    // does not throw. Implementer's choice; we don't pin it.
    expect(deleteTokenMock.mock.calls.length).toBeGreaterThanOrEqual(sdkDeletesAfterFirst);
  });

  it('does NOT throw if deleteToken returns false (browser already detached the token)', async () => {
    deleteTokenResult = false;
    await expect(
      unregisterToken({ messaging, db, uid: TEST_UID, vapidKey: TEST_VAPID_KEY }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B-T13 — refreshToken: on a token-refresh event, the OLD hash doc is
// deleted and the NEW hash doc is upserted.
// ---------------------------------------------------------------------------
describe('B-T13: refreshToken — old fcmToken doc deleted, new one upserted with new hash', () => {
  it('deletes the OLD-hash doc and writes a NEW-hash doc when token rotates', async () => {
    const OLD_TOKEN = 'old-fcm-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const NEW_TOKEN = 'new-fcm-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const oldEnc = new TextEncoder().encode(OLD_TOKEN);
    const newEnc = new TextEncoder().encode(NEW_TOKEN);
    const oldHash = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', oldEnc)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 24);
    const newHash = Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', newEnc)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 24);

    await refreshToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
      previousToken: OLD_TOKEN,
      nextToken: NEW_TOKEN,
    });

    // One delete on the old hash, one setDoc on the new hash.
    const deletes = deleteDocCalls.filter(
      (r) =>
        r.__segments[0] === 'userPrivate' &&
        r.__segments[2] === 'fcmTokens' &&
        r.__segments[3] === oldHash,
    );
    expect(deletes, 'old-hash doc deleted exactly once').toHaveLength(1);

    const sets = setDocCalls.filter(
      (c) =>
        c.ref.__segments[0] === 'userPrivate' &&
        c.ref.__segments[2] === 'fcmTokens' &&
        c.ref.__segments[3] === newHash,
    );
    expect(sets, 'new-hash doc upserted exactly once').toHaveLength(1);
    expect(sets[0]!.data.token).toBe(NEW_TOKEN);
  });

  it('when previousToken == nextToken (no rotation), NO delete is issued', async () => {
    await refreshToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
      previousToken: TEST_TOKEN,
      nextToken: TEST_TOKEN,
    });
    expect(deleteDocCalls).toHaveLength(0);
    // The upsert may refresh lastSeenAt — that is acceptable; we only pin
    // the no-delete contract here.
  });

  it('when previousToken is null (first-ever issuance), only the new doc is written; nothing deleted', async () => {
    await refreshToken({
      messaging,
      db,
      uid: TEST_UID,
      userAgent: TEST_USER_AGENT,
      vapidKey: TEST_VAPID_KEY,
      previousToken: null,
      nextToken: TEST_TOKEN,
    });
    expect(deleteDocCalls).toHaveLength(0);
    expect(setDocCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B-T14 marker — actual a11y primitive assertion lives in the screen test
// (NotificationsPreferencesScreen.test.tsx). Pinning the ID here so the
// traceability map (test-writer report) finds it.
// ---------------------------------------------------------------------------
describe('B-T14 (marker): preferences-UI primitive-level a11y test lives in screen test', () => {
  it('is asserted in src/features/notifications/NotificationsPreferencesScreen.test.tsx', () => {
    // No service-layer behaviour. This existence pin keeps B-T14 findable
    // when reviewing this file. The real assertion is the per-category
    // toggle DOM-shape check in the screen test (Lesson 2026-06-08 #1).
    expect(true).toBe(true);
  });
});
