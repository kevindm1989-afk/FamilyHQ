/**
 * notifyChoreSubmitted — unit contract (PR D1, threat-model §A.10 mirror of
 * the PR C C-T1..C-T20 contract).
 *
 * Surface: the kid → all parents HTTPS-callable triggered from
 * `markChoreComplete` when a chore moves status pending → complete. Server
 * re-derives recipients = every active parent in the chore's family (the
 * submitter is excluded when they themselves are a parent — defense for
 * the parent-double-account case).
 *
 * Test indexing: CS-T1..CS-T23 — one assertion family per architect AC.
 *
 * Boundaries mocked at firebase-functions/v2/https, firebase-admin/messaging,
 * firebase-admin/firestore, firebase-admin/app — verbatim parallel to
 * `notifyChoreApproved.test.ts`. These tests MUST FAIL today: the source
 * file `functions/src/notifyChoreSubmitted.ts` does not exist yet AND the
 * body constants for `choreSubmitted` are still empty placeholders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Fixtures (synthetic — no PI). Submitter is a kid; recipients are parents.
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0);
const CALLER_UID = 'uid-kid-a';
const PARENT_A_UID = 'uid-parent-a';
const PARENT_B_UID = 'uid-parent-b';
const CHORE_ID = 'chore-x';
const FAMILY_ID = 'fam-A';
const OTHER_FAMILY_ID = 'fam-B';
const TOKEN_HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_HASH_C = 'cccccccccccccccccccccccc';
const TOKEN_VALUE_A = 'fcm-token-parent-a';
const TOKEN_VALUE_B = 'fcm-token-parent-b';
const TOKEN_VALUE_C = 'fcm-token-parent-b-2';

const REGION = 'northamerica-northeast1';
const KIND = 'choreSubmitted';
const CATEGORY_KEY = 'choreApprovalsNeeded';
const SOURCE_PATH = resolve(__dirname, '../src/notifyChoreSubmitted.ts');

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
// Firestore mock with a `where`-aware collection query so the server can
// re-derive parent recipients via `users where familyId == X and role ==
// 'parent' and isActive == true`. The mock filters the in-memory docStore
// by accumulated `.where()` clauses; that's enough for the contract here.
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
  const ref = {
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
  return ref;
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
// Scaffolding helpers
// ---------------------------------------------------------------------------

/**
 * Seed a kid submitting a chore in a family with 2 active parents. Both
 * parents are opted-in to the choreApprovalsNeeded category and each have
 * one fcmToken. The submitter is a kid (role='member') and is NOT in the
 * parent recipient set.
 */
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
  docStore.set(`chores/${CHORE_ID}`, {
    familyId: FAMILY_ID,
    status: 'complete',
    assignedTo: CALLER_UID,
    createdBy: PARENT_A_UID,
    title: 'Take out the trash',
    dollarValue: 3,
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
    userAgent: 'Chrome on macOS',
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
  return (await import('../src/notifyChoreSubmitted.js')) as Record<string, unknown>;
}

async function invoke(request: {
  auth?: { uid: string } | undefined;
  app?: { appId: string } | undefined;
  data?: unknown;
  rawRequest?: unknown;
}): Promise<unknown> {
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyChoreSubmitted did not register an onCall handler at import time');
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
// CS-T1 — declaration shape: enforceAppCheck + region pinned in source.
// ===========================================================================

describe.skip('CS-T1: callable declaration includes `enforceAppCheck: true` and pins the region', () => {
  it('the source file exists at functions/src/notifyChoreSubmitted.ts', () => {
    expect(existsSync(SOURCE_PATH)).toBe(true);
  });

  it('contains the literal `enforceAppCheck: true` (M32)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).toMatch(/enforceAppCheck\s*:\s*true/);
  });

  it('AST-level: `enforceAppCheck: true` is an inline onCall(...) options property (not a const var)', () => {
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

  it('pins region to northamerica-northeast1 in source', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).toMatch(/region\s*:\s*['"]northamerica-northeast1['"]/);
  });

  it('registers via onCall at import time with enforceAppCheck + region', async () => {
    await loadModule();
    expect(onCallMock).toHaveBeenCalledTimes(1);
    expect(captured.options).toMatchObject({ enforceAppCheck: true, region: REGION });
  });
});

// ===========================================================================
// CS-T2 — Unauthenticated caller.
// ===========================================================================

describe('CS-T2: unauthenticated caller → UNAUTHENTICATED, no FCM call', () => {
  it('rejects with HttpsError code "unauthenticated" when request.auth is undefined', async () => {
    seedHappyPath();
    const err = await invoke({ auth: undefined, data: { choreId: CHORE_ID } }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('unauthenticated');
  });

  it('does NOT call FCM when auth is absent', async () => {
    seedHappyPath();
    await invoke({ auth: undefined, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CS-T3, CS-T4 — Caller users doc missing OR isActive == false.
// ===========================================================================

describe('CS-T3: caller users/{uid} doc missing → permission-denied', () => {
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

  it('does NOT call FCM when caller has no users doc', async () => {
    seedHappyPath();
    docStore.delete(`users/${CALLER_UID}`);
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

describe('CS-T4: caller isActive == false → permission-denied', () => {
  it('rejects with permission-denied when caller is deactivated', async () => {
    seedHappyPath();
    docStore.set(`users/${CALLER_UID}`, {
      familyId: FAMILY_ID,
      isActive: false,
      role: 'member',
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
// CS-T5 — invalid input.
// ===========================================================================

describe('CS-T5: invalid choreId input → invalid-argument', () => {
  it('rejects when data.choreId is missing', async () => {
    seedHappyPath();
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: {},
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('invalid-argument');
  });

  it('rejects when data.choreId is not a string (number)', async () => {
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

  it('rejects when data.choreId is an empty string', async () => {
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

  it('rejects when data itself is undefined', async () => {
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
// CS-T6 — chore doc missing → not-found.
// ===========================================================================

describe('CS-T6: chores/{choreId} doc missing → not-found', () => {
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
    expect(err.code).toBe('not-found');
  });

  it('does NOT call FCM when chore doc is missing', async () => {
    seedHappyPath();
    docStore.delete(`chores/${CHORE_ID}`);
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CS-T7 — cross-tenant guard: chore.familyId != caller.familyId.
// ===========================================================================

describe('CS-T7: chore familyId mismatch → permission-denied; message hides foreign id', () => {
  it('rejects with permission-denied when chore.familyId != caller.familyId', async () => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: OTHER_FAMILY_ID,
      status: 'complete',
      assignedTo: CALLER_UID,
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
    expect(err.code).toBe('permission-denied');
  });

  it('rejection message does NOT echo the foreign familyId (no enumeration oracle)', async () => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: OTHER_FAMILY_ID,
      status: 'complete',
      assignedTo: CALLER_UID,
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
      status: 'complete',
      assignedTo: CALLER_UID,
      title: 'irrelevant',
      dollarValue: 0,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CS-T8 — state guard: chore.status must be 'complete'.
// ===========================================================================

describe('CS-T8: chore.status != "complete" → permission-denied', () => {
  it.each(['pending', 'approved', 'rejected'] as const)(
    'rejects with permission-denied when chore.status == %p',
    async (status) => {
      seedHappyPath();
      docStore.set(`chores/${CHORE_ID}`, {
        familyId: FAMILY_ID,
        status,
        assignedTo: CALLER_UID,
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
      expect(err.code).toBe('permission-denied');
    },
  );

  it('does NOT call FCM when chore.status is not "complete"', async () => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: FAMILY_ID,
      status: 'pending',
      assignedTo: CALLER_UID,
      title: 'irrelevant',
      dollarValue: 0,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CS-T8b — recipient cross-tenant guard (any parent userPrivate familyId mismatch).
// ===========================================================================

describe('CS-T8b: a recipient userPrivate.familyId mismatch is SKIPPED — multicast continues for the rest (Fix 6)', () => {
  it('skips the corrupt recipient and still sends to the good parent (sent:1, not sent:0)', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${PARENT_A_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual([TOKEN_VALUE_B]);
  });

  it('emits a structured warn (no recipientUid, no foreign familyId) when skipping a corrupt recipient', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${PARENT_A_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(loggerWarnMock).toHaveBeenCalled();
    const warnSerialized = JSON.stringify(loggerWarnMock.mock.calls);
    expect(warnSerialized).not.toContain(PARENT_A_UID);
    expect(warnSerialized).not.toContain(OTHER_FAMILY_ID);
  });
});

// ===========================================================================
// CS-T9 — All parents opted-out → opted_out, no FCM.
// ===========================================================================

describe('CS-T9: every recipient has pushEnabled==false → { sent: 0, cleaned: 0 } (skipReason server-side only)', () => {
  it('returns the uniform skip shape when ALL parent recipients have master push off', async () => {
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
      data: { choreId: CHORE_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('a SINGLE parent with pushEnabled=false drops that parent ONLY; other parents still receive', async () => {
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
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual([TOKEN_VALUE_B]);
  });
});

// ===========================================================================
// CS-T10 — Category muted for ALL recipients → opted_out (exact key pinned).
// ===========================================================================

describe(`CS-T10: categories.${CATEGORY_KEY} == false for every recipient → uniform skip shape`, () => {
  it(`returns { sent: 0, cleaned: 0 } when every parent has categories.${CATEGORY_KEY} == false`, async () => {
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
      data: { choreId: CHORE_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CS-T11 — No tokens across all recipients → no_tokens.
// ===========================================================================

describe('CS-T11: no fcmTokens anywhere → { sent: 0, cleaned: 0 } (privacy review Fix 1)', () => {
  it('returns the uniform skip shape when every parent has zero tokens', async () => {
    seedHappyPath();
    docStore.delete(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`);
    docStore.delete(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`);
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CS-T11b — Submitter is a parent (parent-double-account) → excluded from recipients.
// ===========================================================================

describe('CS-T11b: when the submitter is themselves a parent, they are excluded from the recipient set', () => {
  it('excludes the submitter from the multicast (no self-ping) even when role=="parent"', async () => {
    seedHappyPath();
    // Promote the caller to parent — they should still NOT appear in recipients.
    docStore.set(`users/${CALLER_UID}`, {
      familyId: FAMILY_ID,
      isActive: true,
      role: 'parent',
    });
    docStore.set(`userPrivate/${CALLER_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    docStore.set(`userPrivate/${CALLER_UID}/fcmTokens/${TOKEN_HASH_C}`, {
      token: TOKEN_VALUE_C,
      userAgent: 'Safari',
      createdAt: FIXED_NOW - 60_000,
      lastSeenAt: FIXED_NOW - 60_000,
    });
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 2, cleaned: 0 });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual(expect.arrayContaining([TOKEN_VALUE_A, TOKEN_VALUE_B]));
    expect(message.tokens).not.toContain(TOKEN_VALUE_C);
  });
});

// ===========================================================================
// CS-T12 — Happy path: 2 parents × 1 token each → ONE multicast, sent:2.
// ===========================================================================

describe('CS-T12: happy path — 2 parents × 1 token each → { sent: 2, cleaned: 0 } via ONE multicast', () => {
  it('returns { sent: 2, cleaned: 0 }', async () => {
    seedHappyPath();
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 2, cleaned: 0 });
  });

  it('calls sendEachForMulticast EXACTLY ONCE (aggregated multicast, not per-recipient)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it('passes both parent tokens (length=2) in the single multicast call', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual(expect.arrayContaining([TOKEN_VALUE_A, TOKEN_VALUE_B]));
    expect(message.tokens).toHaveLength(2);
  });

  it('title matches notificationBodies.choreSubmitted.title VERBATIM (no PI, no template marker)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      choreSubmitted?: { title: string; body: string };
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.choreSubmitted ??
      bodies.NOTIFICATION_BODIES?.['choreSubmitted'] ??
      bodies.NOTIF_BODIES?.['choreSubmitted'] ??
      bodies.notificationBodies?.['choreSubmitted'];
    expect(entry, 'choreSubmitted constants must be defined and non-empty').toBeDefined();
    expect((entry?.title ?? '').length).toBeGreaterThan(0);
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.title).toBe(entry!.title);
    expect(message.notification.title).not.toContain('${');
    expect(message.notification.title).not.toContain('{{');
  });

  it('body matches notificationBodies.choreSubmitted.body VERBATIM', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      choreSubmitted?: { title: string; body: string };
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.choreSubmitted ??
      bodies.NOTIFICATION_BODIES?.['choreSubmitted'] ??
      bodies.NOTIF_BODIES?.['choreSubmitted'] ??
      bodies.notificationBodies?.['choreSubmitted'];
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
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    expect(docStore.has(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`)).toBe(true);
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// CS-T13, CS-T14 — Stale-token cleanup: per-recipient, exact doc deleted.
// ===========================================================================

describe('CS-T13: messaging/registration-token-not-registered → that token doc deleted, the other survives', () => {
  it('deletes EXACTLY the bad token doc; returns { sent: 1, cleaned: 1 }', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_B
          ? {
              success: false,
              error: { code: 'messaging/registration-token-not-registered', message: 'gone' },
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
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(false);
    expect(docStore.has(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`)).toBe(true);
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
  });
});

describe('CS-T14: messaging/invalid-registration-token → that token doc deleted', () => {
  it('deletes the invalid token doc only; returns { sent: 1, cleaned: 1 }', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_B
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
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(false);
    expect(docStore.has(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_A}`)).toBe(true);
  });
});

// ===========================================================================
// CS-T15, CS-T16 — Transient codes: NEVER delete token doc.
// ===========================================================================

describe('CS-T15: messaging/server-unavailable is transient — token doc NOT deleted, cleaned does NOT bump', () => {
  it('returns { sent: 1, cleaned: 0 } and leaves the failing token doc in place', async () => {
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
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

describe('CS-T16: messaging/internal-error and quota-exceeded are transient — token doc NOT deleted', () => {
  it.each(['messaging/internal-error', 'messaging/quota-exceeded'] as const)(
    'leaves the token doc intact when the code is %p',
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
        data: { choreId: CHORE_ID },
      })) as { sent: number; cleaned: number };
      expect(result.cleaned).toBe(0);
      expect(docStore.has(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    },
  );
});

// ===========================================================================
// CS-T17 — Rate limit (M36). doc at rateLimits/choreSubmitted__{callerUid}.
// ===========================================================================

describe('CS-T17: M36 rate limit — 11th call within 60s → resource-exhausted', () => {
  const RATE_LIMIT_PATH = `rateLimits/${KIND}__${CALLER_UID}`;

  it('rejects with resource-exhausted at count >= 10 within the 60s window', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 30_000 });
    const err = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('resource-exhausted');
  });

  it('does NOT call FCM when rate-limited', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 30_000 });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('ALLOWS the call at count == 9 (boundary)', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 9, windowStartMs: FIXED_NOW - 30_000 });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('ALLOWS the call when the window expired (windowStartMs > 60s ago) and resets the counter', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 61_000 });
    const result = await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    });
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('increments the counter on a successful call', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 3, windowStartMs: FIXED_NOW - 10_000 });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const after = docStore.get(RATE_LIMIT_PATH) as { count?: number } | undefined;
    expect(after).toBeDefined();
    expect(after?.count ?? 0).toBeGreaterThan(3);
  });
});

// ===========================================================================
// CS-T18 — FCM throws → { sent: 0, cleaned: 0 } (privacy review Fix 1); raw code never echoed.
// ===========================================================================

describe('CS-T18: FCM throws → { sent: 0, cleaned: 0 } (M39 + privacy review Fix 1, no HttpsError)', () => {
  beforeEach(() => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async () => {
      const e = new Error('messaging/server-unavailable — RAW PROVIDER TEXT, must not surface');
      (e as Error & { code: string }).code = 'messaging/server-unavailable';
      throw e;
    });
  });

  it('returns the generic send-failed skip shape (no `reason` on the wire)', async () => {
    const result = (await invoke({
      auth: { uid: CALLER_UID },
      data: { choreId: CHORE_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it('does NOT throw any HttpsError', async () => {
    let threw = false;
    try {
      await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('structured error log NEVER contains the raw `messaging/*` provider text', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const serialized = JSON.stringify(loggerErrorMock.mock.calls);
    expect(serialized).not.toMatch(/messaging\//i);
    expect(serialized).not.toMatch(/RAW PROVIDER TEXT/);
  });
});

// ===========================================================================
// CS-T19 — Privacy: outbound FCM payload contains NO PI substrings.
// ===========================================================================

describe('CS-T19: outbound FCM payload contains NO PI substrings (M34, B10)', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: FAMILY_ID,
      status: 'complete',
      assignedTo: CALLER_UID,
      createdBy: PARENT_A_UID,
      title: 'Take out the trash and clean Maya room',
      dollarValue: 38,
      assigneeName: 'Maya',
    });
  });

  it('the multicast payload contains none of the forbidden PI substrings', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [Record<string, unknown>];
    const clone: Record<string, unknown> = { ...message };
    delete clone.tokens;
    const serialized = JSON.stringify(clone).toLowerCase();
    const forbidden = [
      'maya',
      'trash',
      'clean',
      'room',
      '$38',
      '38.00',
      'dollar',
      'wishlist',
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

  it('data.url click-target (if present) is an opaque app route, not a PI-templated string', async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ data?: { url?: string } }];
    if (message.data && typeof message.data.url === 'string') {
      expect(message.data.url).toMatch(/^\/[A-Za-z0-9/_-]*$/);
      expect(message.data.url.toLowerCase()).not.toMatch(/maya|trash|dollar|amount|name/);
    }
  });
});

// ===========================================================================
// CS-T19b — M38 structured log allow-list.
// ===========================================================================

describe(`CS-T19b: M38 success-log payload contains kind="${KIND}" + canonical fields, no PI`, () => {
  beforeEach(() => seedHappyPath());

  it(`success info-log carries kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount, durationMs`, async () => {
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
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
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const skipCall = loggerInfoMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload && 'skipReason' in payload;
    });
    expect(skipCall).toBeDefined();
    expect(skipCall![1]).toMatchObject({ kind: KIND, skipReason: 'opted_out' });
  });

  it('success log NEVER contains raw token values or chore-doc PI', async () => {
    docStore.set(`chores/${CHORE_ID}`, {
      familyId: FAMILY_ID,
      status: 'complete',
      assignedTo: CALLER_UID,
      createdBy: PARENT_A_UID,
      title: 'Take out the trash',
      dollarValue: 38,
    });
    await invoke({ auth: { uid: CALLER_UID }, data: { choreId: CHORE_ID } });
    const serialized = JSON.stringify(loggerInfoMock.mock.calls).toLowerCase();
    expect(serialized).not.toContain(TOKEN_VALUE_A.toLowerCase());
    expect(serialized).not.toContain(TOKEN_VALUE_B.toLowerCase());
    for (const sub of ['trash', '$38', '38.00', 'dollar', 'wishlist']) {
      expect(serialized).not.toContain(sub.toLowerCase());
    }
  });
});

// ===========================================================================
// CS-T20 — No console.* in the source file (AST scan, M38).
// ===========================================================================

describe('CS-T20: no console.* in functions/src/notifyChoreSubmitted.ts', () => {
  it('the source file uses functions.logger.* or imports from firebase-functions/logger', () => {
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
        `console.* found in functions/src/notifyChoreSubmitted.ts — use logger.* instead:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
