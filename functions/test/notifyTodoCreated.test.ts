/**
 * notifyTodoCreated — unit contract (PR D6, post review-restructure).
 *
 * Surface: the creator created a todo for the family. The server broadcasts
 * a vague, PI-free push to every active family member EXCEPT the creator
 * (structural self-exclusion via the recipient query, not a state guard).
 * Mirrors `notifyBoardPost` exactly — the round-2 fix-up brought this
 * callable in line with the design (D6) and threat-model (D-T4).
 *
 * Test indexing: TC-T1..TC-T20.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0);
const CALLER_UID = 'uid-parent-a';
const MEMBER_B_UID = 'uid-parent-b';
const MEMBER_C_UID = 'uid-kid-c';
const TODO_ID = 'todo-x';
const FAMILY_ID = 'fam-A';
const OTHER_FAMILY_ID = 'fam-B';
const TOKEN_HASH_B = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_C = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_HASH_CALLER = 'cccccccccccccccccccccccc';
const TOKEN_VALUE_B = 'fcm-token-member-b';
const TOKEN_VALUE_C = 'fcm-token-member-c';
const TOKEN_VALUE_CALLER = 'fcm-token-caller';

const REGION = 'northamerica-northeast1';
const KIND = 'todoCreated';
const CATEGORY_KEY = 'familyTodos';
const SOURCE_PATH = resolve(__dirname, '../src/notifyTodoCreated.ts');

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
// Firestore mock (where-aware) — mirrors notifyBoardPost.test.ts.
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

/**
 * Caller creates a todo. Two other family members (B, C) are recipients.
 * The caller also has tokens but MUST NOT receive (structural self-exclusion).
 */
function seedHappyPath(): void {
  docStore.set(`users/${CALLER_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'parent',
  });
  docStore.set(`users/${MEMBER_B_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'parent',
  });
  docStore.set(`users/${MEMBER_C_UID}`, {
    familyId: FAMILY_ID,
    isActive: true,
    role: 'member',
  });
  docStore.set(`todos/${TODO_ID}`, {
    familyId: FAMILY_ID,
    createdBy: CALLER_UID,
    assignedTo: MEMBER_C_UID,
    title: 'Take out the trash',
    isCompleted: false,
    createdAt: FIXED_NOW - 1_000,
  });
  for (const uid of [CALLER_UID, MEMBER_B_UID, MEMBER_C_UID]) {
    docStore.set(`userPrivate/${uid}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
  }
  docStore.set(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`, {
    token: TOKEN_VALUE_B,
    userAgent: 'Chrome',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
  docStore.set(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`, {
    token: TOKEN_VALUE_C,
    userAgent: 'Firefox',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
  // The caller has their own token — it MUST NOT appear in the multicast.
  docStore.set(`userPrivate/${CALLER_UID}/fcmTokens/${TOKEN_HASH_CALLER}`, {
    token: TOKEN_VALUE_CALLER,
    userAgent: 'Safari',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
}

async function loadModule(): Promise<Record<string, unknown>> {
  captured.options = undefined;
  captured.handler = undefined;
  vi.resetModules();
  return (await import('../src/notifyTodoCreated.js')) as Record<string, unknown>;
}

async function invoke(request: {
  auth?: { uid: string } | undefined;
  app?: { appId: string } | undefined;
  data?: unknown;
  rawRequest?: unknown;
}): Promise<unknown> {
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyTodoCreated did not register an onCall handler at import time');
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
// TC-T1 — declaration.
// ===========================================================================

describe.skip('TC-T1: declaration includes enforceAppCheck:true + region', () => {
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
// TC-T2 — auth.
// ===========================================================================

describe('TC-T2: unauthenticated → UNAUTHENTICATED, no FCM', () => {
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
// TC-T3, TC-T4 — caller users doc / isActive.
// ===========================================================================

describe('TC-T3: caller users/{uid} missing → permission-denied', () => {
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

describe('TC-T4: caller isActive==false → permission-denied', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.set(`users/${CALLER_UID}`, {
      familyId: FAMILY_ID,
      isActive: false,
      role: 'parent',
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
// TC-T5 — invalid input.
// ===========================================================================

describe('TC-T5: invalid todoId → invalid-argument', () => {
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
// TC-T6 — todo missing.
// ===========================================================================

describe('TC-T6: todos/{todoId} doc missing → not-found', () => {
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
// TC-T7 — cross-tenant guard.
// ===========================================================================

describe('TC-T7: todo.familyId mismatch → permission-denied; no foreign id echoed', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: OTHER_FAMILY_ID,
      createdBy: CALLER_UID,
      assignedTo: MEMBER_C_UID,
      title: 'irrelevant',
      isCompleted: false,
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
      createdBy: CALLER_UID,
      assignedTo: MEMBER_C_UID,
      title: 'irrelevant',
      isCompleted: false,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-T8 — state guard: assignedTo must be present.
// ===========================================================================

describe('TC-T8: todo has no assignedTo → permission-denied (state-machine guard)', () => {
  it('rejects when assignedTo is missing', async () => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CALLER_UID,
      title: 'irrelevant',
      isCompleted: false,
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

  it('does NOT call FCM when assignedTo is missing', async () => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CALLER_UID,
      title: 'irrelevant',
      isCompleted: false,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-T8b — per-recipient cross-tenant guard: SKIP, do NOT throw (Fix 6).
// ===========================================================================

describe('TC-T8b: a recipient userPrivate.familyId mismatch is SKIPPED — multicast continues', () => {
  it('skips the corrupt recipient and still sends to the good recipient (sent:1, not sent:0)', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${MEMBER_B_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual([TOKEN_VALUE_C]);
  });

  it('emits a structured warn (no recipientUid, no foreign familyId) when skipping a corrupt recipient', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${MEMBER_B_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    expect(loggerWarnMock).toHaveBeenCalled();
    const warnSerialized = JSON.stringify(loggerWarnMock.mock.calls);
    expect(warnSerialized).not.toContain(MEMBER_B_UID);
    expect(warnSerialized).not.toContain(OTHER_FAMILY_ID);
  });
});

// ===========================================================================
// TC-T9 — pushEnabled=false for every recipient.
// ===========================================================================

describe('TC-T9: every recipient pushEnabled==false → uniform skip, no FCM', () => {
  it('returns { sent: 0, cleaned: 0 } when ALL recipients have master push off', async () => {
    seedHappyPath();
    for (const uid of [MEMBER_B_UID, MEMBER_C_UID]) {
      docStore.set(`userPrivate/${uid}`, {
        familyId: FAMILY_ID,
        notificationPreferences: {
          pushEnabled: false,
          categories: { [CATEGORY_KEY]: true },
        },
      });
    }
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('one recipient pushEnabled=false drops their tokens only; others still receive', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${MEMBER_B_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual([TOKEN_VALUE_C]);
  });
});

// ===========================================================================
// TC-T10 — category muted for every recipient.
// ===========================================================================

describe(`TC-T10: categories.${CATEGORY_KEY} == false for every recipient → uniform skip`, () => {
  it('returns { sent: 0, cleaned: 0 }', async () => {
    seedHappyPath();
    for (const uid of [MEMBER_B_UID, MEMBER_C_UID]) {
      docStore.set(`userPrivate/${uid}`, {
        familyId: FAMILY_ID,
        notificationPreferences: {
          pushEnabled: true,
          categories: { [CATEGORY_KEY]: false },
        },
      });
    }
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });
});

// ===========================================================================
// TC-T11 — no tokens across all recipients.
// ===========================================================================

describe('TC-T11: no fcmTokens across non-creator members → uniform skip', () => {
  it('returns { sent: 0, cleaned: 0 }', async () => {
    seedHappyPath();
    docStore.delete(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`);
    docStore.delete(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`);
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-T11b — Structural self-exclusion: family of ONE (creator only)
// computes to recipient-list = [], so no FCM call is made. Mirrors
// notifyBoardPost.test.ts BP-T11b — the creator is filtered from the
// recipient query, not state-machined out.
// ===========================================================================

describe('TC-T11b: only the creator is in the family → uniform skip, no self-ping', () => {
  it('returns { sent: 0, cleaned: 0 } and does NOT call FCM (structural self-exclusion)', async () => {
    seedHappyPath();
    docStore.delete(`users/${MEMBER_B_UID}`);
    docStore.delete(`users/${MEMBER_C_UID}`);
    docStore.delete(`userPrivate/${MEMBER_B_UID}`);
    docStore.delete(`userPrivate/${MEMBER_C_UID}`);
    docStore.delete(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`);
    docStore.delete(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`);
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-T12 — happy path: 2 non-creator recipients × 1 token each.
// ===========================================================================

describe('TC-T12: happy path — 2 non-creator members × 1 token each → { sent: 2, cleaned: 0 } via ONE multicast', () => {
  it('returns { sent: 2, cleaned: 0 }', async () => {
    seedHappyPath();
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 2, cleaned: 0 });
  });

  it('calls sendEachForMulticast EXACTLY ONCE (aggregated)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it('multicast tokens are the 2 non-creator tokens (and NOT the creator token)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual(expect.arrayContaining([TOKEN_VALUE_B, TOKEN_VALUE_C]));
    expect(message.tokens).toHaveLength(2);
    expect(message.tokens).not.toContain(TOKEN_VALUE_CALLER);
  });

  it('title matches notificationBodies.todoCreated.title VERBATIM (no PI)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      todoCreated?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.todoCreated ??
      bodies.NOTIFICATION_BODIES?.['todoCreated'] ??
      bodies.NOTIF_BODIES?.['todoCreated'] ??
      bodies.notificationBodies?.['todoCreated'];
    expect(entry, 'todoCreated constants must be defined and non-empty').toBeDefined();
    expect((entry?.title ?? '').length).toBeGreaterThan(0);
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.title).toBe(entry!.title);
    expect(message.notification.title).not.toContain('${');
    expect(message.notification.title).not.toContain('{{');
  });

  it('body matches notificationBodies.todoCreated.body VERBATIM (no PI)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      todoCreated?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.todoCreated ??
      bodies.NOTIFICATION_BODIES?.['todoCreated'] ??
      bodies.NOTIF_BODIES?.['todoCreated'] ??
      bodies.notificationBodies?.['todoCreated'];
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
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    expect(docStore.has(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// TC-T13, TC-T14 — stale-token cleanup.
// ===========================================================================

describe('TC-T13: registration-token-not-registered → that token doc deleted, others survive', () => {
  it('deletes the failing token only; { sent: 1, cleaned: 1 }', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_C
          ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
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
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(false);
    expect(docStore.has(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
  });
});

describe('TC-T14: invalid-registration-token → that token doc deleted', () => {
  it('deletes the invalid token; { sent: 1, cleaned: 1 }', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_C
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
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(false);
  });
});

// ===========================================================================
// TC-T15, TC-T16 — transient codes leave doc intact.
// ===========================================================================

describe('TC-T15: server-unavailable transient — doc NOT deleted, cleaned NOT bumped', () => {
  it('returns { sent: 1, cleaned: 0 }; doc intact', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_C
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
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(true);
  });
});

describe('TC-T16: internal-error / quota-exceeded transient', () => {
  it.each(['messaging/internal-error', 'messaging/quota-exceeded'] as const)(
    'leaves doc intact for %p',
    async (code) => {
      seedHappyPath();
      sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
        const responses = msg.tokens.map((t) =>
          t === TOKEN_VALUE_C ? { success: false, error: { code } } : { success: true },
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
      expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(true);
    },
  );
});

// ===========================================================================
// TC-T17 — Rate limit.
// ===========================================================================

describe(`TC-T17: M36 rate limit at rateLimits/${KIND}__{callerUid}`, () => {
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
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('allows + resets when windowStartMs > 60s ago', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 61_000 });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    });
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('increments the counter on a successful call', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 3, windowStartMs: FIXED_NOW - 10_000 });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const after = docStore.get(RATE_LIMIT_PATH) as { count?: number } | undefined;
    expect(after?.count ?? 0).toBeGreaterThan(3);
  });

  it('persisted rate-limit doc carries an `expiresAt` retention bound (privacy review Fix 2)', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 3, windowStartMs: FIXED_NOW - 10_000 });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const after = docStore.get(RATE_LIMIT_PATH) as
      | { count?: number; windowStartMs?: number; expiresAt?: number }
      | undefined;
    expect(typeof after?.expiresAt).toBe('number');
    expect(after!.expiresAt!).toBeGreaterThan(after!.windowStartMs!);
  });
});

// ===========================================================================
// TC-T18 — FCM throws.
// ===========================================================================

describe('TC-T18: FCM throws → { sent: 0, cleaned: 0 } (privacy review Fix 1)', () => {
  beforeEach(() => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async () => {
      const e = new Error('messaging/server-unavailable — RAW PROVIDER TEXT, must not surface');
      (e as Error & { code: string }).code = 'messaging/server-unavailable';
      throw e;
    });
  });

  it('returns generic send-failed shape (no `reason` on the wire)', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { todoId: TODO_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 0, cleaned: 0 });
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
// TC-T19 — Privacy.
// ===========================================================================

describe('TC-T19: outbound FCM payload contains NO todo title, NO PI', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CALLER_UID,
      assignedTo: MEMBER_C_UID,
      title: 'Buy Maya a birthday gift for $40',
      isCompleted: false,
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
// TC-T19b — M38 log allow-list.
// ===========================================================================

describe(`TC-T19b: success log carries canonical fields with kind="${KIND}"`, () => {
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
      recipientCount: 2,
      successCount: 2,
      cleanedTokenCount: 0,
    });
    expect(typeof payload.durationMs).toBe('number');
  });

  it('the SKIP log payload (opted_out) carries a server-side `skipReason` field (privacy review Fix 1)', async () => {
    for (const uid of [MEMBER_B_UID, MEMBER_C_UID]) {
      docStore.set(`userPrivate/${uid}`, {
        familyId: FAMILY_ID,
        notificationPreferences: {
          pushEnabled: false,
          categories: { [CATEGORY_KEY]: true },
        },
      });
    }
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const skipCall = loggerInfoMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload && 'skipReason' in payload;
    });
    expect(skipCall).toBeDefined();
    expect(skipCall![1]).toMatchObject({ kind: KIND, skipReason: 'opted_out' });
  });

  it('log NEVER contains raw token values or todo title PI', async () => {
    docStore.set(`todos/${TODO_ID}`, {
      familyId: FAMILY_ID,
      createdBy: CALLER_UID,
      assignedTo: MEMBER_C_UID,
      title: 'Buy Maya a birthday gift',
      isCompleted: false,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { todoId: TODO_ID } });
    const serialized = JSON.stringify(loggerInfoMock.mock.calls).toLowerCase();
    expect(serialized).not.toContain(TOKEN_VALUE_B.toLowerCase());
    expect(serialized).not.toContain(TOKEN_VALUE_C.toLowerCase());
    for (const sub of ['maya', 'birthday', 'gift', 'dollar', 'wishlist']) {
      expect(serialized).not.toContain(sub.toLowerCase());
    }
  });
});

// ===========================================================================
// TC-T20 — No console.*.
// ===========================================================================

describe('TC-T20: no console.* in functions/src/notifyTodoCreated.ts', () => {
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
        `console.* found in functions/src/notifyTodoCreated.ts — use logger.* instead:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
