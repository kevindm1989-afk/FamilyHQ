/**
 * notifyWishlistRequested — unit contract (PR D3, kid → parents).
 *
 * Surface: kid flips a wishlistItems doc from status='wishing' → 'requested'.
 * Server re-derives parent recipients (active parents in the kid's family,
 * excluding the requester if they're somehow a parent). Body comes from
 * notificationBodies.wishlistRequested (still empty placeholder today —
 * that's the TDD signal).
 *
 * Test indexing: WR-T1..WR-T20 — verbatim parallel of CS-T*.
 *
 * MUST FAIL today: functions/src/notifyWishlistRequested.ts does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0);
const CALLER_UID = 'uid-kid-a';
const PARENT_A_UID = 'uid-parent-a';
const PARENT_B_UID = 'uid-parent-b';
const ITEM_ID = 'wish-x';
const FAMILY_ID = 'fam-A';
const OTHER_FAMILY_ID = 'fam-B';
const TOKEN_HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_VALUE_A = 'fcm-token-parent-a';
const TOKEN_VALUE_B = 'fcm-token-parent-b';

const REGION = 'northamerica-northeast1';
const KIND = 'wishlistRequested';
const CATEGORY_KEY = 'wishlistApprovalsNeeded';
const SOURCE_PATH = resolve(__dirname, '../src/notifyWishlistRequested.ts');

// ---------------------------------------------------------------------------
// onCall capture
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
// Firestore mock (where-aware)
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

const collectionListMock = vi.fn(
  async (prefix: string, whereClauses?: Array<[string, string, unknown]>): Promise<DocSnap[]> => {
    const out: DocSnap[] = [];
    for (const [path, data] of docStore.entries()) {
      if (!path.startsWith(`${prefix}/`) || data === undefined) continue;
      if (path.slice(prefix.length + 1).split('/').length !== 1) continue;
      let pass = true;
      for (const [field, op, value] of whereClauses ?? []) {
        const fieldValue = data[field];
        if (op === '==' && fieldValue !== value) pass = false;
        if (op === '!=' && fieldValue === value) pass = false;
      }
      if (!pass) continue;
      const segs = path.split('/');
      const id = segs[segs.length - 1] ?? '';
      out.push({ exists: true, data, id });
    }
    return out;
  },
);

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: 'serverTimestamp' };
const incrementSentinel = (n: number) => ({ __sentinel: 'increment', n });

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
function buildCollectionRef(
  path: string,
  whereClauses: Array<[string, string, unknown]> = [],
): unknown {
  return {
    path,
    doc: (id: string) => buildDocRef(`${path}/${id}`),
    add: async (data: Record<string, unknown>) => {
      const id = `auto-${Math.random().toString(36).slice(2)}`;
      const fullPath = `${path}/${id}`;
      await docSetMock(fullPath, data);
      return buildDocRef(fullPath);
    },
    where: (field: string, op: string, value: unknown) =>
      buildCollectionRef(path, [...whereClauses, [field, op, value]]),
    get: async () => {
      const docs = await collectionListMock(path, whereClauses);
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
      const docs = await collectionListMock(path, whereClauses);
      return docs.map((d) => buildDocRef(`${path}/${d.id}`));
    },
  };
}

const firestoreApp = {
  collection: (path: string) => buildCollectionRef(path),
  doc: (path: string) => buildDocRef(path),
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

let sendEachForMulticastMock: ReturnType<typeof vi.fn>;
const getMessagingMock = vi.fn(() => ({
  sendEachForMulticast: (...a: unknown[]) => sendEachForMulticastMock(...a),
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: (...a: unknown[]) => getMessagingMock(...a),
}));
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
// Scaffolding
// ---------------------------------------------------------------------------

/** A kid (member) requested a wishlist item; 2 parents stand to be notified. */
function seedHappyPath(): void {
  docStore.set(`users/${CALLER_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'member',
  });
  docStore.set(`users/${PARENT_A_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'parent',
  });
  docStore.set(`users/${PARENT_B_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'parent',
  });
  docStore.set(`wishlistItems/${ITEM_ID}`, {
    familyId: FAMILY_ID,
    ownerUid: CALLER_UID,
    status: 'requested',
    title: 'Lego Death Star',
    costCents: 49999,
  });
  docStore.set(`userPrivate/${PARENT_A_UID}`, {
    familyId: FAMILY_ID,
    notificationPreferences: {
      pushEnabled: true,
      categories: { [CATEGORY_KEY]: true },
    },
  });
  docStore.set(`userPrivate/${PARENT_B_UID}`, {
    familyId: FAMILY_ID,
    notificationPreferences: {
      pushEnabled: true,
      categories: { [CATEGORY_KEY]: true },
    },
  });
  docStore.set(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`, {
    token: TOKEN_VALUE_A,
    userAgent: 'Chrome',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
  docStore.set(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`, {
    token: TOKEN_VALUE_B,
    userAgent: 'Firefox',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
}

async function loadModule(): Promise<Record<string, unknown>> {
  captured.options = undefined;
  captured.handler = undefined;
  vi.resetModules();
  return (await import('../src/notifyWishlistRequested.js')) as Record<string, unknown>;
}

async function invoke(request: {
  auth?: { uid: string } | undefined;
  app?: { appId: string } | undefined;
  data?: unknown;
  rawRequest?: unknown;
}): Promise<unknown> {
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyWishlistRequested did not register an onCall handler at import time');
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
  sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => ({
    successCount: msg.tokens.length,
    failureCount: 0,
    responses: msg.tokens.map(() => ({ success: true })),
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ===========================================================================
// WR-T1 — Declaration: enforceAppCheck + region pinned.
// ===========================================================================

describe('WR-T1: declaration includes enforceAppCheck:true and pins the region', () => {
  it('the source file exists', () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it('contains literal `enforceAppCheck: true`', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).toMatch(/enforceAppCheck\s*:\s*true/);
  });

  it('AST-level: enforceAppCheck:true appears inside an onCall(...) options object literal', () => {
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

  it('pins region to northamerica-northeast1', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).toMatch(/region\s*:\s*['"]northamerica-northeast1['"]/);
  });

  it('registers via onCall at import time with the captured options', async () => {
    await loadModule();
    expect(onCallMock).toHaveBeenCalledTimes(1);
    expect(captured.options).toMatchObject({ enforceAppCheck: true, region: REGION });
  });
});

// ===========================================================================
// WR-T2 — auth.
// ===========================================================================

describe('WR-T2: unauthenticated caller → UNAUTHENTICATED, no FCM', () => {
  it('rejects with unauthenticated when request.auth is undefined', async () => {
    seedHappyPath();
    const err = await invoke({ auth: undefined, data: { itemId: ITEM_ID } }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('unauthenticated');
  });

  it('no FCM call on auth-missing', async () => {
    seedHappyPath();
    await invoke({ auth: undefined, data: { itemId: ITEM_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// WR-T3, WR-T4 — caller users doc / isActive.
// ===========================================================================

describe('WR-T3: caller users/{uid} doc missing → permission-denied', () => {
  it('rejects with permission-denied', async () => {
    seedHappyPath();
    docStore.delete(`users/${CALLER_UID}`);
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

describe('WR-T4: caller isActive==false → permission-denied', () => {
  it('rejects with permission-denied for deactivated caller', async () => {
    seedHappyPath();
    docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: false, role: 'member' });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

// ===========================================================================
// WR-T5 — invalid input.
// ===========================================================================

describe('WR-T5: invalid itemId input → invalid-argument', () => {
  it.each([
    ['missing', {}],
    ['empty string', { itemId: '' }],
    ['number', { itemId: 12345 }],
    ['undefined data', undefined],
  ] as const)('rejects when data is %s', async (_label, data) => {
    seedHappyPath();
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data,
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('invalid-argument');
  });
});

// ===========================================================================
// WR-T6 — wishlist item missing.
// ===========================================================================

describe('WR-T6: wishlistItems/{itemId} doc missing → not-found', () => {
  it('rejects with not-found', async () => {
    seedHappyPath();
    docStore.delete(`wishlistItems/${ITEM_ID}`);
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('not-found');
  });

  it('no FCM call', async () => {
    seedHappyPath();
    docStore.delete(`wishlistItems/${ITEM_ID}`);
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// WR-T7 — cross-tenant guard.
// ===========================================================================

describe('WR-T7: item.familyId != caller.familyId → permission-denied; no foreign id echoed', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.set(`wishlistItems/${ITEM_ID}`, {
      familyId: OTHER_FAMILY_ID,
      ownerUid: CALLER_UID,
      status: 'requested',
      title: 'irrelevant',
      costCents: 100,
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string; message?: string },
    );
    expect(err.code).toBe('permission-denied');
    expect(err.message ?? '').not.toContain(OTHER_FAMILY_ID);
  });

  it('no FCM call', async () => {
    seedHappyPath();
    docStore.set(`wishlistItems/${ITEM_ID}`, {
      familyId: OTHER_FAMILY_ID,
      ownerUid: CALLER_UID,
      status: 'requested',
      title: 'irrelevant',
      costCents: 100,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// WR-T8 — state guard: status must be 'requested'.
// ===========================================================================

describe('WR-T8: item.status != "requested" → permission-denied', () => {
  it.each(['wishing', 'redeemed', 'denied'] as const)(
    'rejects when item.status == %p',
    async (status) => {
      seedHappyPath();
      docStore.set(`wishlistItems/${ITEM_ID}`, {
        familyId: FAMILY_ID,
        ownerUid: CALLER_UID,
        status,
        title: 'irrelevant',
        costCents: 100,
      });
      const err = await invoke({
        auth: { uid: CALLER_UID },
        data: { itemId: ITEM_ID },
      }).then(
        () => new Error('expected rejection'),
        (e: unknown) => e as { code?: string },
      );
      expect(err.code).toBe('permission-denied');
    },
  );
});

// ===========================================================================
// WR-T8b — recipient cross-tenant guard.
// ===========================================================================

describe('WR-T8b: a recipient userPrivate.familyId mismatch → permission-denied', () => {
  it('rejects when any parent userPrivate.familyId belongs to a different family', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${PARENT_A_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

// ===========================================================================
// WR-T9 — all parents push-off.
// ===========================================================================

describe('WR-T9: every recipient pushEnabled==false → opted_out', () => {
  it('returns opted_out, no FCM', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${PARENT_A_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    docStore.set(`userPrivate/${PARENT_B_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    });
    expect(result).toMatchObject({ sent: 0, reason: 'opted_out' });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('one parent pushEnabled=false drops their tokens only; the other parent still receives', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${PARENT_A_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual([TOKEN_VALUE_B]);
  });
});

// ===========================================================================
// WR-T10 — category muted.
// ===========================================================================

describe(`WR-T10: categories.${CATEGORY_KEY} == false for every recipient → opted_out`, () => {
  it('returns opted_out', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${PARENT_A_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: false },
      },
    });
    docStore.set(`userPrivate/${PARENT_B_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: false },
      },
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    });
    expect(result).toMatchObject({ sent: 0, reason: 'opted_out' });
  });
});

// ===========================================================================
// WR-T11 — no tokens.
// ===========================================================================

describe('WR-T11: no fcmTokens anywhere → no_tokens', () => {
  it('returns no_tokens, no FCM', async () => {
    seedHappyPath();
    docStore.delete(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`);
    docStore.delete(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`);
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    });
    expect(result).toMatchObject({ sent: 0, reason: 'no_tokens' });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// WR-T12 — happy path: 2 parents × 1 token each.
// ===========================================================================

describe('WR-T12: happy path — 2 parents × 1 token → { sent: 2, cleaned: 0 } via ONE multicast', () => {
  it('returns { sent: 2, cleaned: 0 }', async () => {
    seedHappyPath();
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 2, cleaned: 0 });
  });

  it('calls sendEachForMulticast EXACTLY ONCE (aggregated)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it('passes both parent tokens in the single multicast', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual(expect.arrayContaining([TOKEN_VALUE_A, TOKEN_VALUE_B]));
    expect(message.tokens).toHaveLength(2);
  });

  it('title matches notificationBodies.wishlistRequested.title VERBATIM', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      wishlistRequested?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.wishlistRequested ??
      bodies.NOTIFICATION_BODIES?.['wishlistRequested'] ??
      bodies.NOTIF_BODIES?.['wishlistRequested'] ??
      bodies.notificationBodies?.['wishlistRequested'];
    expect(entry, 'wishlistRequested constants must be defined and non-empty').toBeDefined();
    expect((entry?.title ?? '').length).toBeGreaterThan(0);
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.title).toBe(entry!.title);
    expect(message.notification.title).not.toContain('${');
    expect(message.notification.title).not.toContain('{{');
  });

  it('body matches notificationBodies.wishlistRequested.body VERBATIM', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      wishlistRequested?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.wishlistRequested ??
      bodies.NOTIFICATION_BODIES?.['wishlistRequested'] ??
      bodies.NOTIF_BODIES?.['wishlistRequested'] ??
      bodies.notificationBodies?.['wishlistRequested'];
    expect(entry).toBeDefined();
    expect((entry?.body ?? '').length).toBeGreaterThan(0);
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.body).toBe(entry!.body);
    expect(message.notification.body).not.toContain('${');
    expect(message.notification.body).not.toContain('{{');
  });

  it('does NOT delete any token doc on the happy path', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    expect(docStore.has(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`)).toBe(true);
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// WR-T13, WR-T14 — stale-token deletion.
// ===========================================================================

describe('WR-T13: registration-token-not-registered → that token deleted', () => {
  it('deletes only the bad token; { sent: 1, cleaned: 1 }', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_B
          ? {
              success: false,
              error: { code: 'messaging/registration-token-not-registered' },
            }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(false);
    expect(docStore.has(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`)).toBe(true);
  });
});

describe('WR-T14: invalid-registration-token → that token deleted', () => {
  it('deletes only the invalid token; { sent: 1, cleaned: 1 }', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_B
          ? { success: false, error: { code: 'messaging/invalid-registration-token' } }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(false);
  });
});

// ===========================================================================
// WR-T15, WR-T16 — transient codes leave doc intact.
// ===========================================================================

describe('WR-T15: server-unavailable is transient — doc NOT deleted, cleaned NOT bumped', () => {
  it('returns { sent: 1, cleaned: 0 }, doc still present', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_B
          ? { success: false, error: { code: 'messaging/server-unavailable' } }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
  });
});

describe('WR-T16: internal-error / quota-exceeded are transient', () => {
  it.each(['messaging/internal-error', 'messaging/quota-exceeded'] as const)(
    'leaves the doc intact for %p',
    async (code) => {
      seedHappyPath();
      sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
        const responses = msg.tokens.map((t) =>
          t === TOKEN_VALUE_B ? { success: false, error: { code } } : { success: true },
        );
        return {
          successCount: responses.filter((r) => r.success).length,
          failureCount: responses.filter((r) => !r.success).length,
          responses,
        };
      });
      const result = (await invoke({
        auth: { uid: CALLER_UID },
        data: { itemId: ITEM_ID },
      })) as { sent: number; cleaned: number };
      expect(result.cleaned).toBe(0);
      expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    },
  );
});

// ===========================================================================
// WR-T17 — Rate limit.
// ===========================================================================

describe(`WR-T17: M36 rate limit at rateLimits/${KIND}__{callerUid}`, () => {
  const RATE_LIMIT_PATH = `rateLimits/${KIND}__${CALLER_UID}`;

  it('rejects with resource-exhausted at count >= 10', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 30_000 });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('resource-exhausted');
  });

  it('allows count == 9', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 9, windowStartMs: FIXED_NOW - 30_000 });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    });
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('allows + resets when windowStartMs > 60s ago', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 61_000 });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    });
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('increments the counter on a successful call', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 3, windowStartMs: FIXED_NOW - 10_000 });
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const after = docStore.get(RATE_LIMIT_PATH) as { count?: number } | undefined;
    expect(after).toBeDefined();
    expect(after?.count ?? 0).toBeGreaterThan(3);
  });
});

// ===========================================================================
// WR-T18 — FCM throws.
// ===========================================================================

describe('WR-T18: FCM throws → { sent: 0, reason: "send_failed" }, raw text not echoed', () => {
  beforeEach(() => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async () => {
      const e = new Error('messaging/internal-error — RAW PROVIDER TEXT, must not surface');
      (e as Error & { code: string }).code = 'messaging/internal-error';
      throw e;
    });
  });

  it('returns the generic send-failed shape', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { itemId: ITEM_ID },
    })) as { sent: number; reason: string };
    expect(result).toEqual({ sent: 0, reason: 'send_failed' });
  });

  it('does NOT throw HttpsError', async () => {
    let threw = false;
    try {
      await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('error log never contains messaging/* prefix or raw provider text', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const serialized = JSON.stringify(loggerErrorMock.mock.calls);
    expect(serialized).not.toMatch(/messaging\//i);
    expect(serialized).not.toMatch(/RAW PROVIDER TEXT/);
  });
});

// ===========================================================================
// WR-T19 — Privacy.
// ===========================================================================

describe('WR-T19: outbound FCM payload contains NO PI substrings (M34, B10)', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`wishlistItems/${ITEM_ID}`, {
      familyId: FAMILY_ID,
      ownerUid: CALLER_UID,
      status: 'requested',
      title: 'Lego Death Star for Maya birthday',
      costCents: 49999,
    });
  });

  it('no forbidden PI substrings appear in the outbound payload', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [Record<string, unknown>];
    const clone: Record<string, unknown> = { ...message };
    delete clone.tokens;
    const serialized = JSON.stringify(clone).toLowerCase();
    const forbidden = [
      'lego',
      'death',
      'star',
      'maya',
      'birthday',
      '$499',
      '499.99',
      'dollar',
      'amount',
      'balance',
      'kid',
      'child',
      'parent',
      'email',
      'name',
    ];
    for (const sub of forbidden) {
      expect(
        serialized,
        `outbound FCM payload contains forbidden substring "${sub}" (M34/B10)`,
      ).not.toContain(sub.toLowerCase());
    }
  });

  it('data.url is an opaque app route without PI substrings', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ data?: { url?: string } }];
    if (message.data && typeof message.data.url === 'string') {
      expect(message.data.url).toMatch(/^\/[A-Za-z0-9/_-]*$/);
      expect(message.data.url.toLowerCase()).not.toMatch(/maya|lego|dollar|amount|name/);
    }
  });
});

// ===========================================================================
// WR-T19b — M38 log allow-list.
// ===========================================================================

describe(`WR-T19b: success log payload contains canonical fields with kind="${KIND}"`, () => {
  beforeEach(() => seedHappyPath());

  it('success log includes kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount, durationMs', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const sendCompleteCall = loggerInfoMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload && 'successCount' in payload;
    });
    expect(sendCompleteCall).toBeDefined();
    const payload = sendCompleteCall![1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: KIND,
      familyId: FAMILY_ID,
      actorUid: CALLER_UID,
      recipientCount: 2,
      successCount: 2,
      cleanedTokenCount: 0,
    });
    expect(typeof payload.durationMs).toBe('number');
  });

  it('log NEVER contains raw token values or wishlist-item PI', async () => {
    docStore.set(`wishlistItems/${ITEM_ID}`, {
      familyId: FAMILY_ID,
      ownerUid: CALLER_UID,
      status: 'requested',
      title: 'Lego Death Star',
      costCents: 49999,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { itemId: ITEM_ID } });
    const serialized = JSON.stringify(loggerInfoMock.mock.calls).toLowerCase();
    expect(serialized).not.toContain(TOKEN_VALUE_A.toLowerCase());
    expect(serialized).not.toContain(TOKEN_VALUE_B.toLowerCase());
    for (const sub of ['lego', '$499', '499.99', 'dollar', 'wishlist']) {
      expect(serialized).not.toContain(sub.toLowerCase());
    }
  });
});

// ===========================================================================
// WR-T20 — No console.*.
// ===========================================================================

describe('WR-T20: no console.* in functions/src/notifyWishlistRequested.ts', () => {
  it('the source file imports a logger module', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const usesLogger =
      /functions\.logger\.(info|warn|error)\s*\(/.test(src) ||
      /from\s+['"]firebase-functions\/logger['"]/.test(src) ||
      /from\s+['"]firebase-functions['"]/.test(src);
    expect(usesLogger).toBe(true);
  });

  it('contains ZERO console.* call expressions', () => {
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
        `console.* found in functions/src/notifyWishlistRequested.ts — use logger.* instead:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
