/**
 * notificationsService — client-side FCM token lifecycle (PR B3).
 *
 * Pure functional wrappers over `firebase/messaging` + `firebase/firestore`
 * that the UI calls to register / unregister / refresh this device's FCM
 * token. All side effects (SDK calls, Firestore writes) are funneled
 * through dependency-injected `db` + `messaging` handles so the test
 * suite can assert on every call at the boundary.
 *
 * Authority contract (mirrors firestore.rules + threat-model §A.10):
 *   - The doc path is `userPrivate/{uid}/fcmTokens/{tokenHash}`.
 *   - `tokenHash` is `sha256(token).slice(0, 24)` — first 24 hex chars of
 *     SHA-256. The truncation makes the doc id non-reversible without
 *     the full token; the body carries the full token for FCM send-time.
 *   - Body shape is EXACTLY `{token, userAgent, createdAt, lastSeenAt}`
 *     (epoch ms numbers). The rules don't enforce this shape, but the
 *     `Devices` UI needs `userAgent`, and the server needs `token`;
 *     `createdAt`/`lastSeenAt` drive the cap-eviction policy below.
 *   - Per-user cap: 20 tokens (M36). On register, if the user already has
 *     20 distinct tokenHashes and the new device is NOT one of them, the
 *     OLDEST (smallest `lastSeenAt`) is deleted BEFORE the new doc is
 *     upserted. Same-device re-register is an upsert (no eviction).
 *   - On register, a `getToken` resolving to null (permission denied) or
 *     throwing returns null without writing anything.
 */
import { collection, deleteDoc, doc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { deleteToken, getToken, type Messaging } from 'firebase/messaging';

/** Per-user device cap (M36 — pinned by spec; see B-T11). */
export const MAX_FCM_TOKENS_PER_USER = 20;

const FCM_TOKENS_SUBCOLLECTION = 'fcmTokens';
const USER_PRIVATE_COLLECTION = 'userPrivate';

/**
 * Hash a token to its document-id form: first 24 hex characters of
 * SHA-256(token). Uses the Web Crypto API which is present in modern
 * browsers and via `globalThis.crypto` under Node 20.
 */
export async function hashToken(token: string): Promise<string> {
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

export interface NotificationServiceDeps {
  db: Firestore;
  messaging: Messaging;
}

export interface RegisterTokenInput {
  db: Firestore;
  messaging: Messaging;
  uid: string;
  vapidKey: string;
  userAgent: string;
}

/**
 * The minimal doc shape stored at `userPrivate/{uid}/fcmTokens/{tokenHash}`.
 * The rule does NOT enforce shape (the test's exact-keys assertion does);
 * the body carries the full token so the server-side notifier can deliver
 * to it.
 */
interface FcmTokenDocBody {
  token: string;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
}

/**
 * Best-effort safe call into getToken — a null return (browser permission
 * denied) and a thrown error (messaging unavailable, blocked, etc.) both
 * resolve to null. Callers treat null as "no token, do nothing".
 */
async function safeGetToken(messaging: Messaging, vapidKey: string): Promise<string | null> {
  try {
    const tok = await getToken(messaging, { vapidKey });
    return tok ?? null;
  } catch {
    return null;
  }
}

/**
 * Register THIS device's FCM token in the user's `fcmTokens` subcollection.
 *
 * Returns the FCM token string on success, or `null` if the browser declined
 * permission / FCM is unavailable. Idempotent: re-registering the same
 * device upserts the existing doc (refreshing `lastSeenAt`).
 *
 * Enforces the per-user 20-token cap CLIENT-SIDE — when the user has 20
 * existing tokens and the new device's hash isn't one of them, the OLDEST
 * (smallest `lastSeenAt`) is deleted BEFORE the new doc is upserted.
 */
export async function registerToken(input: RegisterTokenInput): Promise<string | null> {
  const { db, messaging, uid, vapidKey, userAgent } = input;
  const token = await safeGetToken(messaging, vapidKey);
  if (token === null) return null;

  const tokenHash = await hashToken(token);
  const now = Date.now();

  // Read existing tokens so we can enforce the 20-cap (rules can't count).
  // We still attempt the upsert if the count read fails — the rules layer
  // remains the real authority for write authorization; this is a soft cap.
  const existing = await listExistingTokens(db, uid);
  const alreadyOnFile = existing.some((d) => d.id === tokenHash);
  if (!alreadyOnFile && existing.length >= MAX_FCM_TOKENS_PER_USER) {
    // Evict the OLDEST (smallest lastSeenAt). Sort ascending; the first is
    // the eviction target. Ties broken by id for determinism (unlikely in
    // practice with epoch-ms timestamps).
    const sorted = [...existing].sort((a, b) => {
      if (a.lastSeenAt !== b.lastSeenAt) return a.lastSeenAt - b.lastSeenAt;
      return a.id.localeCompare(b.id);
    });
    const victim = sorted[0];
    if (victim !== undefined) {
      await deleteDoc(doc(db, USER_PRIVATE_COLLECTION, uid, FCM_TOKENS_SUBCOLLECTION, victim.id));
    }
  }

  const body: FcmTokenDocBody = {
    token,
    userAgent,
    createdAt: now,
    lastSeenAt: now,
  };
  await setDoc(doc(db, USER_PRIVATE_COLLECTION, uid, FCM_TOKENS_SUBCOLLECTION, tokenHash), body);
  return token;
}

interface ExistingTokenSummary {
  id: string;
  lastSeenAt: number;
}

/**
 * Read every doc under `userPrivate/{uid}/fcmTokens` and project to the
 * id + lastSeenAt fields the cap-eviction policy needs.
 */
async function listExistingTokens(db: Firestore, uid: string): Promise<ExistingTokenSummary[]> {
  try {
    const snap = await getDocs(
      collection(db, USER_PRIVATE_COLLECTION, uid, FCM_TOKENS_SUBCOLLECTION),
    );
    const out: ExistingTokenSummary[] = [];
    snap.forEach((d) => {
      const data = d.data() as Partial<FcmTokenDocBody>;
      const lastSeenAt = typeof data.lastSeenAt === 'number' ? data.lastSeenAt : 0;
      out.push({ id: d.id, lastSeenAt });
    });
    return out;
  } catch {
    return [];
  }
}

export interface UnregisterTokenInput {
  db: Firestore;
  messaging: Messaging;
  uid: string;
  vapidKey: string;
}

/**
 * Unregister THIS device:
 *   1. Determine the device's current FCM token (via getToken).
 *   2. If present, delete the matching `fcmTokens/{tokenHash}` doc.
 *   3. Call `deleteToken(messaging)` to release the SDK-side token.
 *
 * Idempotent: a second call after the token is gone (getToken returns null)
 * is a no-op. Tolerates `deleteToken` returning false (browser has already
 * detached) without throwing.
 */
export async function unregisterToken(input: UnregisterTokenInput): Promise<void> {
  const { db, messaging, uid, vapidKey } = input;
  const token = await safeGetToken(messaging, vapidKey);
  if (token !== null) {
    const tokenHash = await hashToken(token);
    try {
      await deleteDoc(doc(db, USER_PRIVATE_COLLECTION, uid, FCM_TOKENS_SUBCOLLECTION, tokenHash));
    } catch {
      // Swallow — idempotent. The SDK-side delete below still proceeds.
    }
  }
  try {
    await deleteToken(messaging);
  } catch {
    // Tolerate — SDK already detached, or browser blocked. Nothing to do.
  }
}

export interface RefreshTokenInput {
  db: Firestore;
  messaging: Messaging;
  uid: string;
  vapidKey: string;
  userAgent: string;
  previousToken: string | null;
  nextToken: string;
}

/**
 * Handle a token-rotation event. When the FCM SDK issues a new token, the
 * old doc is stale (its hash no longer matches a live device). If the
 * previous token is non-null AND differs from the next, delete the old
 * doc and upsert a new one keyed by the new hash. When the previous
 * equals the next (no rotation), only the upsert runs (refreshes
 * `lastSeenAt`). When the previous is null (first issuance), only the
 * upsert runs.
 */
export async function refreshToken(input: RefreshTokenInput): Promise<void> {
  const { db, uid, userAgent, previousToken, nextToken } = input;
  const now = Date.now();
  if (previousToken !== null && previousToken !== nextToken) {
    const oldHash = await hashToken(previousToken);
    try {
      await deleteDoc(doc(db, USER_PRIVATE_COLLECTION, uid, FCM_TOKENS_SUBCOLLECTION, oldHash));
    } catch {
      // The old doc may have already been evicted by the cap policy. Don't
      // fail the rotation just because we couldn't clean it up.
    }
  }
  const newHash = await hashToken(nextToken);
  const body: FcmTokenDocBody = {
    token: nextToken,
    userAgent,
    createdAt: now,
    lastSeenAt: now,
  };
  await setDoc(doc(db, USER_PRIVATE_COLLECTION, uid, FCM_TOKENS_SUBCOLLECTION, newHash), body);
}
