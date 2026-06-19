/**
 * notifyChoreApproved — unit contract (PR C, threat-model §A.10 C-T1..C-T20).
 *
 * Test surface: the first chargeable HTTPS-callable. Boundaries mocked at the
 * Firebase Admin SDK + `firebase-functions/v2/https` + `firebase-admin/messaging`
 * + `firebase-admin/firestore` layers so we can drive every branch
 * deterministically without an emulator or network.
 *
 * These tests MUST FAIL today: `functions/src/notifyChoreApproved.ts` does not
 * exist yet, and the dependent body-constants module is also absent. The
 * implementer makes them pass.
 *
 * What this file pins (one assertion per behavior):
 *   - C-T1: literal `enforceAppCheck: true` is present in the SOURCE file
 *     (static-source-scan; the only safe way to assert App Check at the
 *     declaration site without the firebase-functions runtime evaluating the
 *     attestation chain — see brief).
 *   - C-T2..C-T8: auth + user-doc + chore-doc + cross-tenant guards.
 *   - C-T9..C-T11: silent-skip branches (opt-out, category-off, no tokens)
 *     return `{ sent: 0, cleaned: 0 }` (the skip reason classification is
 *     logged server-side as `skipReason` per privacy review Fix 1 — the
 *     wire shape carries no preference-enumeration oracle).
 *   - C-T12: happy path + the exact body the implementer must read from
 *     notificationBodies.choreApproved. Returns `{ sent, cleaned }`.
 *   - C-T13..C-T16: per-token FCM response handling — delete on stale codes
 *     (and bump `cleaned`), NEVER delete on transient codes (and do NOT
 *     bump `cleaned`). M37 + M39 contract.
 *   - C-T17: rate-limit (M36) using a Firestore-counter doc at
 *     rateLimits/{kind}__{callerUid}.
 *   - C-T18: FCM throws → `{ sent: 0, cleaned: 0 }` (skipReason in log only); raw error
 *     never echoed in the surfaced shape (M39, threat-model C-T14).
 *   - C-T19: privacy — outbound FCM payload contains no PI substrings.
 *   - C-T20: log-hygiene — no console.* in the source (extends the PR A AST
 *     scan; pinned here too so the implementer can't ship the file with a
 *     stray console.log).
 *
 * Determinism: no real clock (vi.useFakeTimers + FIXED_NOW), no real network,
 * no real Firestore, no real FCM. Each test resets all mocks in beforeEach
 * and re-imports the module so the captured `onCall` registration is fresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Test fixtures (synthetic — no PI)
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0); // 2026-06-11 12:00 UTC
const CALLER_UID = 'uid-parent-a';
const RECIPIENT_UID = 'uid-member-a';
const CHORE_ID = 'chore-x';
const FAMILY_ID = 'fam-A';
const OTHER_FAMILY_ID = 'fam-B';
const TOKEN_HASH_GOOD = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_BAD = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_VALUE_GOOD = 'fcm-token-good';
const TOKEN_VALUE_BAD = 'fcm-token-bad';

const REGION = 'northamerica-northeast1';
const SOURCE_PATH = resolve(__dirname, '../src/notifyChoreApproved.ts');

// ---------------------------------------------------------------------------
// onCall capture — pins the trigger declaration shape AND lets us invoke the
// inner handler with synthetic CallableRequest objects.
// ---------------------------------------------------------------------------
interface CapturedCallable {
  options: Record<string, unknown> | undefined;
  handler: ((request: unknown) => unknown | Promise<unknown>) | undefined;
}
const captured: CapturedCallable = { options: undefined, handler: undefined };

const onCallMock = vi.fn((options: unknown, handler: unknown) => {
  captured.options = options as Record<string, unknown>;
  captured.handler = handler as (request: unknown) => unknown | Promise<unknown>;
  return { __trigger: 'https.onCall', options };
});

// HttpsError stand-in that mirrors the firebase-functions v2 shape so the
// implementer can throw `new HttpsError('unauthenticated', '...')` and we
// recognize it in assertions. Vitest's `toThrow(Error)` with `.toMatchObject`
// against the `.code` field is how we pin the canonical Firebase error codes
// (M-design from the brief — see "flagged item" below).
class FakeHttpsError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'HttpsError';
  }
}

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (options: unknown, handler: unknown) => onCallMock(options, handler),
  HttpsError: FakeHttpsError,
}));

// Tolerate either import shape — `import { logger } from 'firebase-functions'`
// or `import * as logger from 'firebase-functions/logger'`. Spy on every level.
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();
vi.mock('firebase-functions/logger', () => ({
  info: (...a: unknown[]) => loggerInfoMock(...a),
  warn: (...a: unknown[]) => loggerWarnMock(...a),
  error: (...a: unknown[]) => loggerErrorMock(...a),
}));
vi.mock('firebase-functions', () => ({
  logger: {
    info: (...a: unknown[]) => loggerInfoMock(...a),
    warn: (...a: unknown[]) => loggerWarnMock(...a),
    error: (...a: unknown[]) => loggerErrorMock(...a),
  },
  setGlobalOptions: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Firestore (Admin SDK) mock. Each test controls the doc tree via `docStore`;
// the mock translates path strings into get/set/delete operations against the
// in-memory map. `serverTimestamp()` returns a sentinel value the test can
// assert against without depending on the real clock.
// ---------------------------------------------------------------------------
type DocSnap = {
  exists: boolean;
  data: Record<string, unknown> | undefined;
  id: string;
};
type DocStore = Map<string, Record<string, unknown> | undefined>;

let docStore: DocStore;
const docGetMock = vi.fn(async (path: string): Promise<DocSnap> => {
  const data = docStore.get(path);
  const segs = path.split('/');
  const id = segs.length > 0 ? segs[segs.length - 1] ?? '' : '';
  return { exists: data !== undefined, data, id };
});
const docSetMock = vi.fn(
  async (path: string, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
    const prev = docStore.get(path);
    if (opts?.merge && prev) {
      docStore.set(path, { ...prev, ...data });
    } else {
      docStore.set(path, data);
    }
  },
);
const docDeleteMock = vi.fn(async (path: string) => {
  docStore.delete(path);
});

/**
 * Subcollection list — returns every doc whose path starts with the prefix.
 * Used for `userPrivate/{uid}/fcmTokens`.
 */
const collectionListMock = vi.fn(async (prefix: string): Promise<DocSnap[]> => {
  const out: DocSnap[] = [];
  for (const [path, data] of docStore.entries()) {
    if (path.startsWith(`${prefix}/`) && data !== undefined) {
      const segs = path.split('/');
      const id = segs[segs.length - 1] ?? '';
      // Only docs that are one level under the prefix (skip deeper paths).
      if (path.slice(prefix.length + 1).split('/').length === 1) {
        out.push({ exists: true, data, id });
      }
    }
  }
  return out;
});

// Firestore.FieldValue (server timestamp + atomic increment) — return sentinels.
const SERVER_TIMESTAMP_SENTINEL = { __sentinel: 'serverTimestamp' };
const incrementSentinel = (n: number) => ({ __sentinel: 'increment', n });

/**
 * Build a fluent doc/collection chain that mirrors the Admin SDK shape so
 * the implementer can write code like:
 *   db.collection('users').doc(uid).get()
 *   db.collection('userPrivate').doc(uid).collection('fcmTokens').listDocuments()
 * without us having to fake every node.
 */
function buildDocRef(path: string): unknown {
  return {
    path,
    id: path.split('/').pop(),
    get: () => docGetMock(path),
    set: (data: Record<string, unknown>, opts?: { merge?: boolean }) =>
      docSetMock(path, data, opts),
    update: (data: Record<string, unknown>) => docSetMock(path, data, { merge: true }),
    delete: () => docDeleteMock(path),
    collection: (sub: string) => buildCollectionRef(`${path}/${sub}`),
  };
}
function buildCollectionRef(path: string): unknown {
  return {
    path,
    doc: (id: string) => buildDocRef(`${path}/${id}`),
    add: async (data: Record<string, unknown>) => {
      const id = `auto-${Math.random().toString(36).slice(2)}`;
      const fullPath = `${path}/${id}`;
      await docSetMock(fullPath, data);
      return buildDocRef(fullPath);
    },
    /**
     * Either `get()` (Admin SDK reads use this for collection queries) or
     * `listDocuments()` is supported — both return every doc in the
     * subcollection. The implementer can pick whichever is more ergonomic.
     */
    get: async () => {
      const docs = await collectionListMock(path);
      return {
        empty: docs.length === 0,
        size: docs.length,
        docs: docs.map((d) => ({
          ...d,
          ref: buildDocRef(`${path}/${d.id}`),
          data: () => d.data,
        })),
      };
    },
    listDocuments: async () => {
      const docs = await collectionListMock(path);
      return docs.map((d) => buildDocRef(`${path}/${d.id}`));
    },
  };
}

const firestoreApp = {
  collection: (path: string) => buildCollectionRef(path),
  doc: (path: string) => buildDocRef(path),
  /**
   * Some implementations call `db.runTransaction(async (tx) => ...)`. The
   * brief does NOT require a transaction here (the send is fire-and-forget;
   * stale-token cleanup is independent), but we tolerate it.
   */
  runTransaction: async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: { path: string }) => docGetMock(ref.path),
      set: (ref: { path: string }, data: Record<string, unknown>) => docSetMock(ref.path, data),
      update: (ref: { path: string }, data: Record<string, unknown>) =>
        docSetMock(ref.path, data, { merge: true }),
      delete: (ref: { path: string }) => docDeleteMock(ref.path),
    };
    return cb(tx);
  },
};

const getFirestoreMock = vi.fn(() => firestoreApp);
const initializeAppMock = vi.fn();
const getAppsMock = vi.fn(() => [{ __app: true }]);

vi.mock('firebase-admin/app', () => ({
  initializeApp: (...a: unknown[]) => initializeAppMock(...a),
  getApps: () => getAppsMock(),
  applicationDefault: vi.fn(() => ({ __creds: 'adc' })),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: (...a: unknown[]) => getFirestoreMock(...a),
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
    increment: (n: number) => incrementSentinel(n),
    delete: () => ({ __sentinel: 'fieldDelete' }),
  },
  Timestamp: {
    now: () => ({
      toMillis: () => FIXED_NOW,
      seconds: Math.floor(FIXED_NOW / 1000),
      nanoseconds: 0,
    }),
    fromMillis: (ms: number) => ({
      toMillis: () => ms,
      seconds: Math.floor(ms / 1000),
      nanoseconds: 0,
    }),
  },
}));

// ---------------------------------------------------------------------------
// firebase-admin/messaging — sendEachForMulticast capture.
// ---------------------------------------------------------------------------
let sendEachForMulticastMock: ReturnType<typeof vi.fn>;
const getMessagingMock = vi.fn(() => ({
  sendEachForMulticast: (...a: unknown[]) => sendEachForMulticastMock(...a),
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: (...a: unknown[]) => getMessagingMock(...a),
}));

// Some implementations import the singleton via the legacy aggregator
// `firebase-admin` ("admin.messaging()"). Cover both paths.
vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: (...a: unknown[]) => initializeAppMock(...a),
    apps: [{ __app: true }],
    firestore: () => firestoreApp,
    messaging: () => ({
      sendEachForMulticast: (...a: unknown[]) => sendEachForMulticastMock(...a),
    }),
    credential: { applicationDefault: () => ({ __creds: 'adc' }) },
  },
}));

// ---------------------------------------------------------------------------
// Test scaffolding helpers
// ---------------------------------------------------------------------------

/** Seed the doc tree with a valid happy-path family. Individual tests mutate after. */
function seedHappyPath(): void {
  docStore.set(`users/${CALLER_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'parent',
  });
  docStore.set(`users/${RECIPIENT_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'member',
  });
  docStore.set(`chores/${CHORE_ID}`, {
    familyId: FAMILY_ID,
    status: 'approved',
    assignedTo: RECIPIENT_UID,
    createdBy: CALLER_UID,
    // Deliberately include PI-looking fields on the chore doc so we can prove
    // the FCM body NEVER reflects them (C-T19).
    title: 'Take out the trash',
    dollarValue: 3,
  });
  docStore.set(`userPrivate/${RECIPIENT_UID}`, {
    familyId: FAMILY_ID,
    notificationPreferences: {
      pushEnabled: true,
      categories: { myChoreResolved: true },
    },
  });
  docStore.set(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_GOOD}`, {
    token: TOKEN_VALUE_GOOD,
    userAgent: 'Chrome on macOS',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
}

/** Force-load (or reload) the implementer's module so onCall(...) is registered fresh. */
async function loadModule(): Promise<Record<string, unknown>> {
  captured.options = undefined;
  captured.handler = undefined;
  vi.resetModules();
  return (await import('../src/notifyChoreApproved.js')) as Record<string, unknown>;
}

/** Invoke the captured handler with a synthetic CallableRequest. */
async function invoke(request: {
  auth?: { uid: string } | undefined;
  app?: { appId: string } | undefined;
  data?: unknown;
  rawRequest?: unknown;
}): Promise<unknown> {
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyChoreApproved did not register an onCall handler at import time');
  }
  return captured.handler(request);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  docStore = new Map();
  onCallMock.mockClear();
  loggerInfoMock.mockReset();
  loggerWarnMock.mockReset();
  loggerErrorMock.mockReset();
  docGetMock.mockClear();
  docSetMock.mockClear();
  docDeleteMock.mockClear();
  collectionListMock.mockClear();
  getFirestoreMock.mockClear();
  initializeAppMock.mockClear();
  getMessagingMock.mockClear();
  // Default: send returns a successful single-token response. Individual tests
  // override the implementation before invoking.
  sendEachForMulticastMock = vi.fn(async (_message: unknown) => ({
    successCount: 1,
    failureCount: 0,
    responses: [{ success: true }],
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ===========================================================================
// C-T1 — Source-scan: enforceAppCheck: true LITERAL must appear at the
// onCall declaration site (M32, threat-modeler pushback #3). App Check
// positive-branch testing is library-limited; this static assertion is the
// only way to pin the flag without a real reCAPTCHA round-trip.
// ===========================================================================

describe('C-T1: callable declaration includes the literal `enforceAppCheck: true`', () => {
  it('the source file exists at functions/src/notifyChoreApproved.ts', () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it('contains the literal string `enforceAppCheck: true` (M32 — threat-modeler pushback #3)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    // Be tolerant of whitespace + a trailing comma, but pin the literal.
    // A comment like `// enforceAppCheck: true` would not satisfy this; we
    // walk the AST below to confirm it's an actual property assignment.
    expect(src).toMatch(/enforceAppCheck\s*:\s*true/);
  });

  it('AST-level: `enforceAppCheck: true` appears inside an onCall(...) options object (not a comment)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const sf = ts.createSourceFile(SOURCE_PATH, src, ts.ScriptTarget.ES2022, true);

    let foundInOnCall = false;
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'onCall' &&
        node.arguments.length >= 1
      ) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          for (const prop of firstArg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'enforceAppCheck' &&
              prop.initializer.kind === ts.SyntaxKind.TrueKeyword
            ) {
              foundInOnCall = true;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    expect(foundInOnCall).toBe(true);
  });

  it('pins the region to northamerica-northeast1 (Canadian residency, ADR-0013)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).toMatch(/region\s*:\s*['"]northamerica-northeast1['"]/);
  });

  it('registers via onCall at import time', async () => {
    await loadModule();
    expect(onCallMock).toHaveBeenCalledTimes(1);
    expect(captured.options).toBeDefined();
  });

  it('the captured options object carries enforceAppCheck: true (defense in depth)', async () => {
    await loadModule();
    expect(captured.options).toMatchObject({ enforceAppCheck: true });
  });

  it('the captured options object carries the region', async () => {
    await loadModule();
    expect(captured.options).toMatchObject({ region: REGION });
  });
});

// ===========================================================================
// C-T2 — Unauthenticated caller → UNAUTHENTICATED.
// ===========================================================================

describe('C-T2: unauthenticated caller is rejected with UNAUTHENTICATED', () => {
  it('rejects with HttpsError code "unauthenticated" when context.auth is undefined', async () => {
    seedHappyPath();
    const err = await invoke({ auth: undefined, data: { choreId: CHORE_ID } }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string; message?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('unauthenticated');
  });

  it('does NOT call FCM or read any docs when auth is absent (short-circuit)', async () => {
    seedHappyPath();
    await invoke({ auth: undefined, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C-T3, C-T4 — Caller users doc missing OR isActive == false.
// ===========================================================================

describe('C-T3: caller users/{uid} doc missing → permission-denied', () => {
  it('rejects with permission-denied when users/{uid} does not exist', async () => {
    seedHappyPath();
    docStore.delete(`users/${CALLER_UID}`);
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('permission-denied');
  });

  it('does NOT call FCM when the caller has no users doc', async () => {
    seedHappyPath();
    docStore.delete(`users/${CALLER_UID}`);
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

describe('C-T4: caller isActive == false → permission-denied', () => {
  it('rejects with permission-denied when the caller is deactivated', async () => {
    seedHappyPath();
    docStore.set(`users/${CALLER_UID}`, {
      familyId: FAMILY_ID,
      isActive: false,
      role: 'parent',
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('permission-denied');
  });
});

// ===========================================================================
// C-T5 — input validation: choreId missing / not a string.
// ===========================================================================

describe('C-T5: invalid choreId input → invalid-argument', () => {
  it('rejects with invalid-argument when data.choreId is missing', async () => {
    seedHappyPath();
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: {},
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('invalid-argument');
  });

  it('rejects with invalid-argument when data.choreId is not a string (number)', async () => {
    seedHappyPath();
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: 12345 },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('invalid-argument');
  });

  it('rejects with invalid-argument when data.choreId is an empty string', async () => {
    seedHappyPath();
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: '' },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('invalid-argument');
  });

  it('rejects with invalid-argument when data itself is undefined', async () => {
    seedHappyPath();
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: undefined,
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('invalid-argument');
  });
});

// ===========================================================================
// C-T6 — chores/{choreId} missing → not-found.
// ===========================================================================

describe('C-T6: chores/{choreId} doc missing → not-found', () => {
  it('rejects with not-found when the chore doc does not exist', async () => {
    seedHappyPath();
    docStore.delete(`chores/${CHORE_ID}`);
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('not-found');
  });

  it('does NOT call FCM when the chore doc is missing', async () => {
    seedHappyPath();
    docStore.delete(`chores/${CHORE_ID}`);
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C-T7 — cross-tenant: chore.familyId !== caller.familyId.
// ===========================================================================

describe('C-T7: chore familyId mismatch with caller (cross-tenant guard) → permission-denied', () => {
  it('rejects with permission-denied when chore.familyId != caller.familyId', async () => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: OTHER_FAMILY_ID,
      status: 'approved',
      assignedTo: RECIPIENT_UID,
      title: 'irrelevant',
      dollarValue: 0,
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('permission-denied');
  });

  it('the rejection message does NOT echo the foreign familyId (no enumeration oracle, M39)', async () => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: OTHER_FAMILY_ID,
      status: 'approved',
      assignedTo: RECIPIENT_UID,
      title: 'irrelevant',
      dollarValue: 0,
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { message?: string },
    );
    expect(err.message ?? '').not.toContain(OTHER_FAMILY_ID);
  });

  it('does NOT call FCM on a cross-tenant attempt', async () => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: OTHER_FAMILY_ID,
      status: 'approved',
      assignedTo: RECIPIENT_UID,
      title: 'irrelevant',
      dollarValue: 0,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C-T8 — chore state guard: status must be 'approved'.
// ===========================================================================

describe('C-T8: chore.status != "approved" → permission-denied (state-machine guard)', () => {
  it.each(['pending', 'complete', 'rejected'] as const)(
    'rejects with permission-denied when chore.status == %p',
    async (status) => {
      seedHappyPath();
      docStore.set(`chores/${CHORE_ID}`, {
        familyId: FAMILY_ID,
        status,
        assignedTo: RECIPIENT_UID,
        title: 'irrelevant',
        dollarValue: 0,
      });
      const err = await invoke({
        auth: { uid: CALLER_UID },
        data: { choreId: CHORE_ID },
      }).then(
        () => new Error('expected rejection'),
        (e: unknown) => e as { code?: string },
      );
      expect(err).toBeInstanceOf(FakeHttpsError);
      expect(err.code).toBe('permission-denied');
    },
  );

  it('does NOT call FCM when chore.status is not "approved"', async () => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: FAMILY_ID,
      status: 'pending',
      assignedTo: RECIPIENT_UID,
      title: 'irrelevant',
      dollarValue: 0,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C-T8b — recipient (assignedTo) not in the family → permission-denied
// (defense-in-depth recipient lookup per M35.7)
// ===========================================================================

describe('C-T8b: recipient userPrivate.familyId mismatch → permission-denied', () => {
  it('rejects when recipient userPrivate.familyId != caller.familyId', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { myChoreResolved: true },
      },
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('permission-denied');
  });
});

// ===========================================================================
// C-T9, C-T10, C-T11 — silent no-op branches: opt-out, category-off, no tokens
// ===========================================================================

describe('C-T9: pushEnabled == false → silent skip, no FCM call', () => {
  it('returns { sent: 0, cleaned: 0 } when recipient master push is off (M39 — no `reason` on the wire, privacy review Fix 1)', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { myChoreResolved: true },
      },
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it('does NOT call FCM when recipient master push is off', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { myChoreResolved: true },
      },
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

describe('C-T10: categories.myChoreResolved == false → silent skip, no FCM call', () => {
  it('returns { sent: 0, cleaned: 0 } when category is muted (M39 + privacy review Fix 1 — skip reason never on the wire)', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { myChoreResolved: false },
      },
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it('does NOT call FCM when category is muted', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { myChoreResolved: false },
      },
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

describe('C-T11: recipient has no fcmTokens → silent skip, no FCM call', () => {
  it('returns { sent: 0, cleaned: 0 } when subcollection is empty (M39 + privacy review Fix 1)', async () => {
    seedHappyPath();
    docStore.delete(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_GOOD}`);
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it('does NOT call FCM when there are no tokens', async () => {
    seedHappyPath();
    docStore.delete(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_GOOD}`);
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C-T12 — happy path: 2 tokens, both succeed, return {sent:2, failed:0}.
// Body must match notificationBodies.choreApproved verbatim (no PI).
// ===========================================================================

describe('C-T12: happy path — 2 tokens both succeed → { sent: 2, cleaned: 0 }', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async () => ({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    }));
  });

  it('returns { sent: 2, cleaned: 0 }', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 2, cleaned: 0 });
  });

  it('calls sendEachForMulticast exactly once', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it('passes BOTH token values in the multicast tokens array', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { tokens: string[]; notification: { title: string; body: string } },
    ];
    expect(message.tokens).toEqual(expect.arrayContaining([TOKEN_VALUE_GOOD, TOKEN_VALUE_BAD]));
    expect(message.tokens).toHaveLength(2);
  });

  it('the FCM message.notification.title matches notificationBodies.choreApproved.title VERBATIM', async () => {
    // Pin the EXACT string the constants module exports — by reading the
    // constants file at runtime, not by hardcoding a literal here. This
    // keeps the body wording the implementer's decision (subject to M34's
    // forbidden-substring gate in test/functions/notification-bodies-no-pi.test.ts)
    // while still proving the callable consumes the constants and does no
    // template substitution.
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      choreApproved?: { title: string; body: string };
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const choreApproved =
      bodies.choreApproved ??
      bodies.NOTIF_BODIES?.['choreApproved'] ??
      bodies.notificationBodies?.['choreApproved'];
    expect(choreApproved, 'choreApproved constants must be importable').toBeDefined();
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.title).toBe(choreApproved!.title);
    // Defense in depth: the title MUST NOT have been templated (no left-
    // over `${` markers from a runtime substitution leaking through).
    expect(message.notification.title).not.toContain('${');
    expect(message.notification.title).not.toContain('{{');
  });

  it('the FCM message.notification.body matches notificationBodies.choreApproved.body VERBATIM', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      choreApproved?: { title: string; body: string };
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const choreApproved =
      bodies.choreApproved ??
      bodies.NOTIF_BODIES?.['choreApproved'] ??
      bodies.notificationBodies?.['choreApproved'];
    expect(choreApproved).toBeDefined();
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.body).toBe(choreApproved!.body);
    expect(message.notification.body).not.toContain('${');
    expect(message.notification.body).not.toContain('{{');
  });

  it('does NOT delete either token doc on the happy path (M37 only deletes on stale codes)', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_GOOD}`)).toBe(true);
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// C-T13, C-T14 — stale-token codes: delete the corresponding fcmTokens doc.
// ===========================================================================

describe('C-T13: registration-token-not-registered → that token doc is deleted, the other survives', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    // Order tokens array deterministically so the per-token response array
    // maps 1:1. The implementer's send-builder must preserve order.
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) => {
        if (t === TOKEN_VALUE_BAD) {
          return {
            success: false,
            error: { code: 'messaging/registration-token-not-registered', message: 'gone' },
          };
        }
        return { success: true };
      });
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
  });

  it('returns { sent: 1, cleaned: 1 } (stale-token code bumps cleaned)', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
  });

  it('deletes EXACTLY the bad token doc (registration-token-not-registered)', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(false);
  });

  it('LEAVES the good token doc intact', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_GOOD}`)).toBe(true);
  });

  it('calls delete exactly once (NOT for every token in the multicast)', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
  });
});

describe('C-T14: invalid-registration-token → that token doc is deleted', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_BAD
          ? {
              success: false,
              error: { code: 'messaging/invalid-registration-token', message: 'invalid' },
            }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
  });

  it('returns { sent: 1, cleaned: 1 } (stale-token code bumps cleaned)', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
  });

  it('deletes the invalid token doc', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(false);
  });

  it('leaves the good token doc intact', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_GOOD}`)).toBe(true);
  });
});

// ===========================================================================
// C-T15, C-T16 — transient codes: NEVER delete the token doc.
// ===========================================================================

describe('C-T15: messaging/server-unavailable is transient — token doc NOT deleted', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_BAD
          ? {
              success: false,
              error: { code: 'messaging/server-unavailable', message: 'transient' },
            }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
  });

  it('returns { sent: 1, cleaned: 0 } (transient code does NOT bump cleaned — M39)', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
  });

  it('does NOT delete the token doc on a transient error', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

describe('C-T16: messaging/internal-error is transient — token doc NOT deleted', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_BAD
          ? {
              success: false,
              error: { code: 'messaging/internal-error', message: 'transient' },
            }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
  });

  it('returns { sent: 1, cleaned: 0 } (transient code does NOT bump cleaned — M39)', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
  });

  it('does NOT delete the token doc on an internal-error response', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(true);
  });
});

describe('C-T16b: messaging/quota-exceeded is transient — token doc NOT deleted', () => {
  // The threat-model F-PN-3 + brief explicitly call out quota-exceeded as
  // transient. Pin it so a future "be aggressive" change can't silently
  // delete tokens on a quota blip.
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_BAD
          ? {
              success: false,
              error: { code: 'messaging/quota-exceeded', message: 'transient' },
            }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
  });

  it('does NOT delete the token doc when quota-exceeded is returned', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${RECIPIENT_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(true);
  });
});

// ===========================================================================
// C-T17 — Rate limit (M36). The brief pins the implementation: a Firestore
// counter doc at `rateLimits/{kind}__{callerUid}` with `count` +
// `windowStartMs`.
// ===========================================================================

describe('C-T17: M36 rate limit — 11th call within 60s by the same caller → resource-exhausted', () => {
  const RATE_LIMIT_PATH = `rateLimits/choreApproved__${CALLER_UID}`;

  it('rejects the 11th invocation with resource-exhausted when count >= 10 inside the 60s window', async () => {
    seedHappyPath();
    // Pre-seed a rate-limit counter at the boundary.
    docStore.set(RATE_LIMIT_PATH, {
      count: 10,
      windowStartMs: FIXED_NOW - 30_000, // 30s into the window
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('resource-exhausted');
  });

  it('does NOT call FCM when rate-limited', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, {
      count: 10,
      windowStartMs: FIXED_NOW - 30_000,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('ALLOWS the call when count is below the limit (count == 9)', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, {
      count: 9,
      windowStartMs: FIXED_NOW - 30_000,
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toMatchObject({ sent: 1, cleaned: 0 });
  });

  it('ALLOWS the call when the window has expired (windowStartMs > 60s ago) — counter resets', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, {
      count: 10,
      windowStartMs: FIXED_NOW - 61_000, // window expired
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toMatchObject({ sent: 1, cleaned: 0 });
  });

  it('increments the counter doc on a successful call', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, {
      count: 3,
      windowStartMs: FIXED_NOW - 10_000,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    // After the call, the counter must reflect at least one more invocation
    // in the current window. Be tolerant of implementation choice (read-
    // increment-write OR transactional increment); just assert the count
    // moved up.
    const after = docStore.get(RATE_LIMIT_PATH) as { count?: number } | undefined;
    expect(after).toBeDefined();
    expect(typeof after?.count).toBe('number');
    expect(after?.count ?? 0).toBeGreaterThan(3);
  });
});

// ===========================================================================
// C-T18 — FCM throws → generic INTERNAL; raw error never echoed (M39).
// ===========================================================================

describe('C-T18: sendEachForMulticast throws → { sent: 0, cleaned: 0 }, raw error never echoed (M39 + privacy review Fix 1)', () => {
  beforeEach(() => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async () => {
      const e = new Error('messaging/server-unavailable — RAW PROVIDER TEXT, must not surface');
      // Real FCM errors carry a `.code` field — keep it so the test proves
      // the implementer didn't just pass it through.
      (e as Error & { code: string }).code = 'messaging/server-unavailable';
      throw e;
    });
  });

  it('returns the generic send-failed skip shape (NOT a thrown HttpsError) — M39 / C-T14', async () => {
    // The chore approval already committed; rethrowing here would invite
    // client retry storms during the exact window we'd be brownout-throttling.
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it('does NOT throw any HttpsError on FCM provider failure', async () => {
    let threw = false;
    try {
      await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('the structured log payload does NOT contain the raw FCM provider text', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    // Walk every error-log call and assert no payload string carries the
    // provider text. Operator-side observability ALSO must not leak the
    // code prefix (would re-expose the M39 oracle to anyone with logs).
    const serialized = JSON.stringify(loggerErrorMock.mock.calls);
    expect(serialized).not.toMatch(/messaging\/server-unavailable/);
    expect(serialized).not.toMatch(/RAW PROVIDER TEXT/);
  });

  it('the structured log payload does NOT contain any FCM error code prefix at all', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const serialized = JSON.stringify(loggerErrorMock.mock.calls);
    expect(serialized).not.toMatch(/messaging\//i);
  });
});

// ===========================================================================
// C-T19 — Privacy: FCM payload contains NO PI substrings.
// ===========================================================================

describe('C-T19: outbound FCM payload contains NO PI substrings (M34, B10 anti-regression)', () => {
  beforeEach(() => {
    seedHappyPath();
    // Seed the chore with PI-looking content; the body MUST NOT reflect it.
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: FAMILY_ID,
      status: 'approved',
      assignedTo: RECIPIENT_UID,
      title: 'Take out the trash and clean Maya room',
      dollarValue: 38, // would render "$38.00" if leaked
      assigneeName: 'Maya',
    });
  });

  it('the multicast payload contains none of the forbidden PI substrings (case-insensitive)', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [Record<string, unknown>];
    // Stringify the whole outbound payload (notification + data + tokens
    // metadata, EXCLUDING the opaque token strings themselves, which are
    // device handles, not PI).
    const messageClone: Record<string, unknown> = { ...message };
    delete messageClone.tokens; // opaque device handles — not PI
    const serialized = JSON.stringify(messageClone).toLowerCase();
    // Substrings that came FROM the chore doc — proof the implementer didn't
    // splice any of it into the outbound payload. The constants file's own
    // string-literal scan (test/functions/notification-bodies-no-pi.test.ts)
    // covers the M34 generic PI vocabulary; here we focus on chore-doc PI.
    const forbidden = [
      'maya', // assigneeName
      'trash', // title fragment
      'clean', // title fragment
      'room', // title fragment
      '$38', // dollarValue rendered
      '38.00', // dollarValue rendered
      'dollar', // M34 generic
      'wishlist', // M34 generic (must never appear in the chore-approved push)
    ];
    for (const sub of forbidden) {
      expect(
        serialized,
        `outbound FCM payload contains forbidden substring "${sub}" — would leak PI to lock screen (M34/B10)`,
      ).not.toContain(sub.toLowerCase());
    }
  });

  it('the data.url click-target (if present) is an opaque route path, not a templated PI string', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ data?: { url?: string } }];
    if (message.data && typeof message.data.url === 'string') {
      // Allowed paths: /, /inbox, /notifications, /chore/{opaqueId}, /chores
      // (no querystring with PI).
      expect(message.data.url).toMatch(/^\/[A-Za-z0-9/_-]*$/);
      expect(message.data.url.toLowerCase()).not.toMatch(/maya|trash|dollar|amount|name/);
    }
  });
});

// ===========================================================================
// C-T19b — Structured log payload (M38 allow-list). The success-path log
// MUST carry exactly the seven canonical fields: kind, familyId, actorUid,
// recipientCount, successCount, cleanedTokenCount, durationMs. No raw token
// values, no chore title, no PI, no FCM error codes. Pinned because the
// second-opinion review caught a divergent log payload as a spec violation.
// ===========================================================================

describe('C-T19b: M38 success-log payload contains the canonical fields and no PI / token bodies', () => {
  beforeEach(() => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async () => ({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    }));
  });

  it('the success info-log payload contains kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount, durationMs', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    // Find the send-complete log entry (the one that carries `successCount`).
    const sendCompleteCall = loggerInfoMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload && 'successCount' in payload;
    });
    expect(
      sendCompleteCall,
      'expected a logger.info call with `successCount` in its payload',
    ).toBeDefined();
    const payload = sendCompleteCall![1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: 'choreApproved',
      familyId: FAMILY_ID,
      actorUid: CALLER_UID,
      recipientCount: 1,
      successCount: 1,
      cleanedTokenCount: 0,
    });
    expect(typeof payload.durationMs).toBe('number');
  });

  it('the SKIP log payload (opted_out) carries a server-side `skipReason` field (privacy review Fix 1)', async () => {
    // Re-seed the recipient to be opted out — exercises the skip-log path.
    docStore.set(`userPrivate/${RECIPIENT_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { myChoreResolved: true },
      },
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const skipCall = loggerInfoMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload && 'skipReason' in payload;
    });
    expect(skipCall, 'expected a skip logger.info call carrying `skipReason`').toBeDefined();
    const payload = skipCall![1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: 'choreApproved',
      familyId: FAMILY_ID,
      actorUid: CALLER_UID,
      skipReason: 'opted_out',
    });
  });

  it('the success-log payload does NOT contain the raw FCM token value', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const serialized = JSON.stringify(loggerInfoMock.mock.calls);
    expect(serialized).not.toContain(TOKEN_VALUE_GOOD);
  });

  it('the success-log payload does NOT contain chore-doc PI substrings', async () => {
    // Re-seed the chore with PI-looking content the implementer might
    // accidentally interpolate into a log line.
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: FAMILY_ID,
      status: 'approved',
      assignedTo: RECIPIENT_UID,
      title: 'Take out the trash',
      dollarValue: 38,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const serialized = JSON.stringify(loggerInfoMock.mock.calls).toLowerCase();
    for (const sub of ['trash', '$38', '38.00', 'dollar', 'wishlist']) {
      expect(serialized).not.toContain(sub.toLowerCase());
    }
  });
});

// ===========================================================================
// C-T20 — No console.* in the source file (extends PR A's AST scan to PR C).
// ===========================================================================

describe('C-T20: no console.* calls in functions/src/notifyChoreApproved.ts (AST scan)', () => {
  it('the source file uses functions.logger.* (or `logger.*` after import) for ALL logging', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const usesLogger =
      /functions\.logger\.(info|warn|error)\s*\(/.test(src) ||
      /from\s+['"]firebase-functions\/logger['"]/.test(src) ||
      /from\s+['"]firebase-functions['"]/.test(src);
    expect(usesLogger).toBe(true);
  });

  it('contains ZERO console.* call expressions (AST walk)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const sf = ts.createSourceFile(SOURCE_PATH, src, ts.ScriptTarget.ES2022, true);

    const hits: Array<{ line: number; text: string }> = [];
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const obj = node.expression.expression;
        if (ts.isIdentifier(obj) && obj.text === 'console') {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          hits.push({ line: line + 1, text: node.getText().slice(0, 80) });
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isElementAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'console'
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        hits.push({ line: line + 1, text: node.getText().slice(0, 80) });
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    if (hits.length > 0) {
      const report = hits.map((h) => `  - line ${h.line}: ${h.text}`).join('\n');
      throw new Error(
        `console.* found in functions/src/notifyChoreApproved.ts — use functions.logger.{info,warn,error} instead:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
