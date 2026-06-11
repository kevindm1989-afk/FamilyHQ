/**
 * notifyTodoCompleted — unit contract (PR D7, completer → creator).
 *
 * Surface: a todo doc's isCompleted flipped to true. Recipient = the
 * original creator. Self-completion (completer == creator) MUST NOT
 * self-ping — the callable returns { sent: 0, reason: 'no_tokens' } and
 * never calls FCM.
 *
 * Test indexing: TD-T1..TD-T20.
 *
 * MUST FAIL today: functions/src/notifyTodoCompleted.ts does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0);
const CALLER_UID = 'uid-member-a'; // the completer
const CREATOR_UID = 'uid-parent-a'; // the recipient
const TODO_ID = 'todo-x';
const FAMILY_ID = 'fam-A';
const OTHER_FAMILY_ID = 'fam-B';
const TOKEN_HASH_GOOD = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_BAD = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_VALUE_GOOD = 'fcm-token-good';
const TOKEN_VALUE_BAD = 'fcm-token-bad';

const REGION = 'northamerica-northeast1';
const KIND = 'todoCompleted';
const CATEGORY_KEY = 'familyTodos';
const SOURCE_PATH = resolve(__dirname, '../src/notifyTodoCompleted.ts');

// ---------------------------------------------------------------------------
// Mocks
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
// Firestore mock
// ---------------------------------------------------------------------------
type DocSnap = { exists: boolean; data: Record<string, unknown> | undefined; id: string };
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
const collectionListMock = vi.fn(async (prefix: string): Promise<DocSnap[]> => {
  const out: DocSnap[] = [];
  for (const [path, data] of docStore.entries()) {
    if (path.startsWith(`${prefix}/`) && data !== undefined) {
      const segs = path.split('/');
      const id = segs[segs.length - 1] ?? '';
      if (path.slice(prefix.length + 1).split('/').length === 1) {
        out.push({ exists: true, data, id });
      }
    }
  }
  return out;
});

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
    where: () => buildCollectionRef(path),
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

/**
 * Member just completed a todo created by parent A. The todo is now
 * isCompleted: true. Recipient = creator (parent A).
 */
function seedHappyPath(): void {
  docStore.set(`users/${CALLER_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'member',
  });
  docStore.set(`users/${CREATOR_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'parent',
  });
  docStore.set(`todos/${TODO_ID}`, {
    familyId: FAMILY_ID,
    createdBy: CREATOR_UID,
    assignedTo: CALLER_UID,
    title: 'Take out the trash',
    isCompleted: true,
    completedAt: FIXED_NOW - 500,
  });
  docStore.set(`userPrivate/${CREATOR_UID}`, {
    familyId: FAMILY_ID,
    notificationPreferences: {
      pushEnabled: true,
      categories: { [CATEGORY_KEY]: true },
    },
  });
  docStore.set(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_GOOD}`, {
    token: TOKEN_VALUE_GOOD,
    userAgent: 'Chrome',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
}

async function loadModule(): Promise<Record<string, unknown>> {
  captured.options = undefined;
  captured.handler = undefined;
  vi.resetModules();
  return (await import('../src/notifyTodoCompleted.js')) as Record<string, unknown>;
}

async function invoke(request: {
  auth?: { uid: string } | undefined;
  app?: { appId: string } | undefined;
  data?: unknown;
  rawRequest?: unknown;
}): Promise<unknown> {
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyTodoCompleted did not register an onCall handler at import time');
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
  sendEachForMulticastMock = vi.fn(async () => ({
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
// TD-T1 — declaration.
// ===========================================================================

describe('TD-T1: declaration includes enforceAppCheck:true + region', () => {
  it('source file exists', () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it('contains literal `enforceAppCheck: true`', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).toMatch(/enforceAppCheck\s*:\s*true/);
  });

  it('AST: enforceAppCheck:true is an inline onCall(...) property', () => {
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

  it('registers via onCall at import time', async () => {
    await loadModule();
    expect(onCallMock).toHaveBeenCalledTimes(1);
    expect(captured.options).toMatchObject({ enforceAppCheck: true, region: REGION });
  });
});

// ===========================================================================
// TD-T2 — auth.
// ===========================================================================

describe('TD-T2: unauthenticated → UNAUTHENTICATED, no FCM', () => {
  it('rejects with unauthenticated', async () => {
    seedHappyPath();
    const err = await invoke({ auth: undefined, data: { todoId: TODO_ID } }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('unauthenticated');
  });

  it('no FCM call', async () => {
    seedHappyPath();
    await invoke({ auth: undefined, data: { todoId: TODO_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T3, TD-T4 — caller users doc / isActive.
// ===========================================================================

describe('TD-T3: caller users/{uid} missing → permission-denied', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.delete(`users/${CALLER_UID}`);
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

describe('TD-T4: caller isActive==false → permission-denied', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.set(`users/${CALLER_UID}`, {
      familyId: FAMILY_ID,
      isActive: false,
      role: 'member',
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

// ===========================================================================
// TD-T5 — invalid input.
// ===========================================================================

describe('TD-T5: invalid todoId → invalid-argument', () => {
  it.each([
    ['missing', {}],
    ['empty string', { todoId: '' }],
    ['number', { todoId: 12345 }],
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
// TD-T6 — todo missing.
// ===========================================================================

describe('TD-T6: todos/{todoId} doc missing → not-found', () => {
  it('rejects with not-found', async () => {
    seedHappyPath();
    docStore.delete(`todos/${TODO_ID}`);
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('not-found');
  });

  it('no FCM call', async () => {
    seedHappyPath();
    docStore.delete(`todos/${TODO_ID}`);
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T7 — cross-tenant guard.
// ===========================================================================

describe('TD-T7: todo.familyId mismatch → permission-denied; no foreign id echoed', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: OTHER_FAMILY_ID,
      createdBy: CREATOR_UID,
      assignedTo: CALLER_UID,
      title: 'irrelevant',
      isCompleted: true,
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string; message?: string },
    );
    expect(err.code).toBe('permission-denied');
    expect(err.message ?? '').not.toContain(OTHER_FAMILY_ID);
  });

  it('no FCM call', async () => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: OTHER_FAMILY_ID,
      createdBy: CREATOR_UID,
      assignedTo: CALLER_UID,
      title: 'irrelevant',
      isCompleted: true,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T8 — state guard: isCompleted must be true.
// ===========================================================================

describe('TD-T8: todo.isCompleted != true → permission-denied (state-machine guard)', () => {
  it.each([false, undefined, null] as const)('rejects when isCompleted == %p', async (val) => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CREATOR_UID,
      assignedTo: CALLER_UID,
      title: 'irrelevant',
      isCompleted: val,
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });

  it('does NOT call FCM when isCompleted is false', async () => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CREATOR_UID,
      assignedTo: CALLER_UID,
      title: 'irrelevant',
      isCompleted: false,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T8b — recipient cross-tenant guard.
// ===========================================================================

describe('TD-T8b: creator userPrivate.familyId mismatch → permission-denied', () => {
  it('rejects when creator userPrivate.familyId differs', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${CREATOR_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

// ===========================================================================
// TD-T9 — pushEnabled=false.
// ===========================================================================

describe('TD-T9: creator pushEnabled==false → opted_out, no FCM', () => {
  it('returns opted_out', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${CREATOR_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toMatchObject({ sent: 0, reason: 'opted_out' });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T10 — category muted.
// ===========================================================================

describe(`TD-T10: categories.${CATEGORY_KEY} == false → opted_out`, () => {
  it('returns opted_out', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${CREATOR_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: false },
      },
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toMatchObject({ sent: 0, reason: 'opted_out' });
  });
});

// ===========================================================================
// TD-T11 — no tokens.
// ===========================================================================

describe('TD-T11: creator has no fcmTokens → no_tokens', () => {
  it('returns no_tokens', async () => {
    seedHappyPath();
    docStore.delete(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_GOOD}`);
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toMatchObject({ sent: 0, reason: 'no_tokens' });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T11b — Self-completion skip: completer == creator → no_tokens, no FCM.
// ===========================================================================

describe('TD-T11b: self-completion (completer == creator) → no self-ping, no FCM', () => {
  it('returns { sent: 0, reason: "no_tokens" } when the creator completed their own todo', async () => {
    seedHappyPath();
    // Caller IS the creator.
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CALLER_UID,
      assignedTo: CALLER_UID,
      title: 'irrelevant',
      isCompleted: true,
    });
    // The caller has their own token — must NOT receive.
    docStore.set(`userPrivate/${CALLER_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    docStore.set(`userPrivate/${CALLER_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Safari',
      createdAt: FIXED_NOW - 60_000,
      lastSeenAt: FIXED_NOW - 60_000,
    });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toMatchObject({ sent: 0, reason: 'no_tokens' });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T12 — happy path.
// ===========================================================================

describe('TD-T12: happy path — creator with 1 token → { sent: 1, cleaned: 0 }', () => {
  it('returns { sent: 1, cleaned: 0 }', async () => {
    seedHappyPath();
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
  });

  it('returns { sent: 2, cleaned: 0 } when creator has 2 tokens (both succeed)', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
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
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 2, cleaned: 0 });
  });

  it('calls sendEachForMulticast EXACTLY ONCE', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it('title matches notificationBodies.todoCompleted.title VERBATIM', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      todoCompleted?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.todoCompleted ??
      bodies.NOTIFICATION_BODIES?.['todoCompleted'] ??
      bodies.NOTIF_BODIES?.['todoCompleted'] ??
      bodies.notificationBodies?.['todoCompleted'];
    expect(entry, 'todoCompleted constants must be defined and non-empty').toBeDefined();
    expect((entry?.title ?? '').length).toBeGreaterThan(0);
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.title).toBe(entry!.title);
    expect(message.notification.title).not.toContain('${');
    expect(message.notification.title).not.toContain('{{');
  });

  it('body matches notificationBodies.todoCompleted.body VERBATIM', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      todoCompleted?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.todoCompleted ??
      bodies.NOTIFICATION_BODIES?.['todoCompleted'] ??
      bodies.NOTIF_BODIES?.['todoCompleted'] ??
      bodies.notificationBodies?.['todoCompleted'];
    expect(entry).toBeDefined();
    expect((entry?.body ?? '').length).toBeGreaterThan(0);
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.body).toBe(entry!.body);
    expect(message.notification.body).not.toContain('${');
    expect(message.notification.body).not.toContain('{{');
  });

  it('does NOT delete the token doc on the happy path', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    expect(docStore.has(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_GOOD}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TD-T13, TD-T14 — stale-token cleanup.
// ===========================================================================

describe('TD-T13: registration-token-not-registered → that token doc deleted', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_BAD
          ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
  });

  it('returns { sent: 1, cleaned: 1 }', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
  });

  it('deletes EXACTLY the bad token doc', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    expect(docStore.has(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(false);
    expect(docStore.has(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_GOOD}`)).toBe(true);
  });
});

describe('TD-T14: invalid-registration-token → that token doc deleted', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_BAD
          ? { success: false, error: { code: 'messaging/invalid-registration-token' } }
          : { success: true },
      );
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    });
  });

  it('returns { sent: 1, cleaned: 1 }', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
  });

  it('deletes the invalid token doc', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    expect(docStore.has(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(false);
  });
});

// ===========================================================================
// TD-T15, TD-T16 — transient codes leave doc intact.
// ===========================================================================

describe('TD-T15: server-unavailable transient — doc NOT deleted', () => {
  it('returns { sent: 1, cleaned: 0 }, doc intact', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
      token: TOKEN_VALUE_BAD,
      userAgent: 'Firefox',
      createdAt: FIXED_NOW - 30_000,
      lastSeenAt: FIXED_NOW - 30_000,
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_BAD
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
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    expect(docStore.has(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(true);
  });
});

describe('TD-T16: internal-error / quota-exceeded transient', () => {
  it.each(['messaging/internal-error', 'messaging/quota-exceeded'] as const)(
    'leaves doc intact for %p',
    async (code) => {
      seedHappyPath();
      docStore.set(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`, {
        token: TOKEN_VALUE_BAD,
        userAgent: 'Firefox',
        createdAt: FIXED_NOW - 30_000,
        lastSeenAt: FIXED_NOW - 30_000,
      });
      sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
        const responses = msg.tokens.map((t) =>
          t === TOKEN_VALUE_BAD ? { success: false, error: { code } } : { success: true },
        );
        return {
          successCount: responses.filter((r) => r.success).length,
          failureCount: responses.filter((r) => !r.success).length,
          responses,
        };
      });
      const result = (await invoke({
        auth: { uid: CALLER_UID },
        data: { todoId: TODO_ID },
      })) as { sent: number; cleaned: number };
      expect(result.cleaned).toBe(0);
      expect(docStore.has(`userPrivate/${CREATOR_UID}/fcmTokens/${TOKEN_HASH_BAD}`)).toBe(true);
    },
  );
});

// ===========================================================================
// TD-T17 — Rate limit.
// ===========================================================================

describe(`TD-T17: M36 rate limit at rateLimits/${KIND}__{callerUid}`, () => {
  const RATE_LIMIT_PATH = `rateLimits/${KIND}__${CALLER_UID}`;

  it('rejects with resource-exhausted at count >= 10', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 30_000 });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
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
      data: { todoId: TODO_ID },
    });
    expect(result).toMatchObject({ sent: 1, cleaned: 0 });
  });

  it('allows + resets when windowStartMs > 60s ago', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 61_000 });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toMatchObject({ sent: 1, cleaned: 0 });
  });

  it('increments the counter on a successful call', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 3, windowStartMs: FIXED_NOW - 10_000 });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const after = docStore.get(RATE_LIMIT_PATH) as { count?: number } | undefined;
    expect(after?.count ?? 0).toBeGreaterThan(3);
  });
});

// ===========================================================================
// TD-T18 — FCM throws.
// ===========================================================================

describe('TD-T18: FCM throws → { sent: 0, reason: "send_failed" }', () => {
  beforeEach(() => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async () => {
      const e = new Error('messaging/quota-exceeded — RAW PROVIDER TEXT, must not surface');
      (e as Error & { code: string }).code = 'messaging/quota-exceeded';
      throw e;
    });
  });

  it('returns generic send-failed shape', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; reason: string };
    expect(result).toEqual({ sent: 0, reason: 'send_failed' });
  });

  it('does NOT throw HttpsError', async () => {
    let threw = false;
    try {
      await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('error log never contains messaging/* prefix or raw provider text', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const serialized = JSON.stringify(loggerErrorMock.mock.calls);
    expect(serialized).not.toMatch(/messaging\//i);
    expect(serialized).not.toMatch(/RAW PROVIDER TEXT/);
  });
});

// ===========================================================================
// TD-T19 — Privacy.
// ===========================================================================

describe('TD-T19: outbound FCM payload contains NO todo title, NO PI', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CREATOR_UID,
      assignedTo: CALLER_UID,
      title: 'Buy Maya a birthday gift for $40',
      isCompleted: true,
    });
  });

  it('forbidden PI substrings absent', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [Record<string, unknown>];
    const clone: Record<string, unknown> = { ...message };
    delete clone.tokens;
    const serialized = JSON.stringify(clone).toLowerCase();
    const forbidden = [
      'maya',
      'birthday',
      'gift',
      'buy',
      '$40',
      '40.00',
      'dollar',
      'amount',
      'balance',
      'kid',
      'child',
      'parent',
      'email',
      'wishlist',
      'name',
    ];
    for (const sub of forbidden) {
      expect(
        serialized,
        `outbound FCM payload contains forbidden substring "${sub}"`,
      ).not.toContain(sub.toLowerCase());
    }
  });

  it('data.url is opaque', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ data?: { url?: string } }];
    if (message.data && typeof message.data.url === 'string') {
      expect(message.data.url).toMatch(/^\/[A-Za-z0-9/_-]*$/);
      expect(message.data.url.toLowerCase()).not.toMatch(/maya|birthday|gift|dollar|name/);
    }
  });
});

// ===========================================================================
// TD-T19b — M38 log allow-list.
// ===========================================================================

describe(`TD-T19b: success log carries canonical fields with kind="${KIND}"`, () => {
  beforeEach(() => seedHappyPath());

  it('canonical 7-field payload present', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
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
      recipientCount: 1,
      successCount: 1,
      cleanedTokenCount: 0,
    });
    expect(typeof payload.durationMs).toBe('number');
  });

  it('log NEVER contains raw token values or todo title PI', async () => {
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CREATOR_UID,
      assignedTo: CALLER_UID,
      title: 'Buy Maya a birthday gift',
      isCompleted: true,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const serialized = JSON.stringify(loggerInfoMock.mock.calls).toLowerCase();
    expect(serialized).not.toContain(TOKEN_VALUE_GOOD.toLowerCase());
    for (const sub of ['maya', 'birthday', 'gift', 'dollar', 'wishlist']) {
      expect(serialized).not.toContain(sub.toLowerCase());
    }
  });
});

// ===========================================================================
// TD-T20 — No console.*.
// ===========================================================================

describe('TD-T20: no console.* in functions/src/notifyTodoCompleted.ts', () => {
  it('uses a logger import', () => {
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
        `console.* found in functions/src/notifyTodoCompleted.ts — use logger.* instead:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
