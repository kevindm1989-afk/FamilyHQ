/**
 * notifyBoardPost — unit contract (PR D5, author → every other family member).
 *
 * Surface: someone posts to the family board. The server reads
 * `posts/{postId}`, verifies the caller is the author (defense-in-depth —
 * the client can't forge), then queries `users` for every other active
 * member of that family and aggregates their tokens into ONE multicast.
 *
 * Test indexing: BP-T1..BP-T20.
 *
 * MUST FAIL today: functions/src/notifyBoardPost.ts does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0);
const AUTHOR_UID = 'uid-parent-a';
const MEMBER_B_UID = 'uid-parent-b';
const MEMBER_C_UID = 'uid-kid-c';
const POST_ID = 'post-x';
const FAMILY_ID = 'fam-A';
const OTHER_FAMILY_ID = 'fam-B';
const TOKEN_HASH_B = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_C = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_HASH_AUTHOR = 'cccccccccccccccccccccccc';
const TOKEN_VALUE_B = 'fcm-token-member-b';
const TOKEN_VALUE_C = 'fcm-token-member-c';
const TOKEN_VALUE_AUTHOR = 'fcm-token-author';

const REGION = 'northamerica-northeast1';
const KIND = 'familyBoardPost';
const CATEGORY_KEY = 'familyBoardPosts';
const SOURCE_PATH = resolve(__dirname, '../src/notifyBoardPost.ts');

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
// Firestore mock (where-aware)
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
 * Author posts to the family board. Two other members (B, C) are in the
 * family. Author has a token of their own, but it must NOT receive the
 * multicast (self-ping guard).
 */
function seedHappyPath(): void {
  docStore.set(`users/${AUTHOR_UID}`, {
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
  docStore.set(`posts/${POST_ID}`, {
    familyId: FAMILY_ID,
    authorId: AUTHOR_UID,
    authorName: 'Maya',
    content: 'I made cookies and the kitchen is a disaster',
    createdAt: FIXED_NOW - 1_000,
  });
  for (const uid of [AUTHOR_UID, MEMBER_B_UID, MEMBER_C_UID]) {
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
  // The author has their own token — it MUST NOT appear in the recipient list.
  docStore.set(`userPrivate/${AUTHOR_UID}/fcmTokens/${TOKEN_HASH_AUTHOR}`, {
    token: TOKEN_VALUE_AUTHOR,
    userAgent: 'Safari',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
}

async function loadModule(): Promise<Record<string, unknown>> {
  captured.options = undefined;
  captured.handler = undefined;
  vi.resetModules();
  return (await import('../src/notifyBoardPost.js')) as Record<string, unknown>;
}

async function invoke(request: {
  auth?: { uid: string } | undefined;
  app?: { appId: string } | undefined;
  data?: unknown;
  rawRequest?: unknown;
}): Promise<unknown> {
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyBoardPost did not register an onCall handler at import time');
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
// BP-T1 — declaration.
// ===========================================================================

describe('BP-T1: declaration includes enforceAppCheck:true + region', () => {
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
// BP-T2 — auth.
// ===========================================================================

describe('BP-T2: unauthenticated → UNAUTHENTICATED, no FCM', () => {
  it('rejects with unauthenticated', async () => {
    seedHappyPath();
    const err = await invoke({ auth: undefined, data: { postId: POST_ID } }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err).toBeInstanceOf(FakeHttpsError);
    expect(err.code).toBe('unauthenticated');
  });

  it('no FCM call', async () => {
    seedHappyPath();
    await invoke({ auth: undefined, data: { postId: POST_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BP-T3, BP-T4 — caller users doc / isActive.
// ===========================================================================

describe('BP-T3: caller users/{uid} missing → permission-denied', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.delete(`users/${AUTHOR_UID}`);
    const err = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

describe('BP-T4: caller isActive==false → permission-denied', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.set(`users/${AUTHOR_UID}`, {
      familyId: FAMILY_ID,
      isActive: false,
      role: 'parent',
    });
    const err = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });
});

// ===========================================================================
// BP-T5 — invalid input.
// ===========================================================================

describe('BP-T5: invalid postId → invalid-argument', () => {
  it.each([
    ['missing', {}],
    ['empty string', { postId: '' }],
    ['number', { postId: 12345 }],
    ['undefined data', undefined],
  ] as const)('rejects when data is %s', async (_label, data) => {
    seedHappyPath();
    const err = await invoke({
      auth: { uid: AUTHOR_UID },
      data,
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('invalid-argument');
  });
});

// ===========================================================================
// BP-T6 — post missing.
// ===========================================================================

describe('BP-T6: posts/{postId} doc missing → not-found', () => {
  it('rejects with not-found', async () => {
    seedHappyPath();
    docStore.delete(`posts/${POST_ID}`);
    const err = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('not-found');
  });

  it('no FCM call', async () => {
    seedHappyPath();
    docStore.delete(`posts/${POST_ID}`);
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BP-T7 — cross-tenant guard.
// ===========================================================================

describe('BP-T7: post.familyId mismatch → permission-denied; no foreign id echoed', () => {
  it('rejects', async () => {
    seedHappyPath();
    docStore.set(`posts/${POST_ID}`, {
      familyId: OTHER_FAMILY_ID,
      authorId: AUTHOR_UID,
      authorName: 'Maya',
      content: 'irrelevant',
    });
    const err = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string; message?: string },
    );
    expect(err.code).toBe('permission-denied');
    expect(err.message ?? '').not.toContain(OTHER_FAMILY_ID);
  });

  it('no FCM call', async () => {
    seedHappyPath();
    docStore.set(`posts/${POST_ID}`, {
      familyId: OTHER_FAMILY_ID,
      authorId: AUTHOR_UID,
      authorName: 'Maya',
      content: 'irrelevant',
    });
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BP-T8 — caller must be the author (state-equivalent guard).
// ===========================================================================

describe('BP-T8: caller != post.authorId → permission-denied (forged-author guard)', () => {
  it('rejects when caller is NOT the authorId on the post', async () => {
    seedHappyPath();
    docStore.set(`posts/${POST_ID}`, {
      familyId: FAMILY_ID,
      authorId: MEMBER_B_UID, // post was authored by B, not the caller
      authorName: 'B',
      content: 'irrelevant',
    });
    const err = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    }).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as { code?: string },
    );
    expect(err.code).toBe('permission-denied');
  });

  it('does NOT call FCM on a forged-author attempt', async () => {
    seedHappyPath();
    docStore.set(`posts/${POST_ID}`, {
      familyId: FAMILY_ID,
      authorId: MEMBER_B_UID,
      authorName: 'B',
      content: 'irrelevant',
    });
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } }).catch(() => undefined);
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BP-T8b — recipient cross-tenant guard. Multi-recipient callable:
// a single corrupt userPrivate must NOT DoS the whole multicast — the
// implementation skips the bad recipient + warns, and the OTHER
// recipients in the family continue normally (SOR Concern 3 / Fix 6).
// ===========================================================================

describe('BP-T8b: a recipient userPrivate.familyId mismatch is SKIPPED — multicast continues for the rest', () => {
  it('skips the corrupt recipient and still sends to the good parent (sent:1, not sent:0)', async () => {
    seedHappyPath();
    // Member B has a corrupted userPrivate doc whose familyId points to
    // another family. The callable MUST skip B silently and still
    // deliver to member C.
    docStore.set(`userPrivate/${MEMBER_B_UID}`, {
      familyId: OTHER_FAMILY_ID,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = (await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
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
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    expect(loggerWarnMock).toHaveBeenCalled();
    const warnSerialized = JSON.stringify(loggerWarnMock.mock.calls);
    // Payload must NOT leak the recipient uid or the foreign familyId
    // (M38 allow-list).
    expect(warnSerialized).not.toContain(MEMBER_B_UID);
    expect(warnSerialized).not.toContain(OTHER_FAMILY_ID);
  });
});

// ===========================================================================
// BP-T9 — pushEnabled=false for everyone.
// ===========================================================================

describe('BP-T9: every recipient pushEnabled==false → opted_out', () => {
  it('returns opted_out, no FCM', async () => {
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
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });

  it('one member pushEnabled=false drops their tokens only', async () => {
    seedHappyPath();
    docStore.set(`userPrivate/${MEMBER_B_UID}`, {
      familyId: FAMILY_ID,
      notificationPreferences: {
        pushEnabled: false,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    const result = (await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual([TOKEN_VALUE_C]);
  });
});

// ===========================================================================
// BP-T10 — category muted.
// ===========================================================================

describe(`BP-T10: categories.${CATEGORY_KEY} == false for every recipient → opted_out`, () => {
  it('returns opted_out', async () => {
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
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });
});

// ===========================================================================
// BP-T11 — no tokens anywhere.
// ===========================================================================

describe('BP-T11: no fcmTokens across non-author members → no_tokens', () => {
  it('returns no_tokens, no FCM', async () => {
    seedHappyPath();
    docStore.delete(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`);
    docStore.delete(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`);
    const result = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BP-T11b — Self-recipient skip: family of ONE (author only) → no_tokens, no FCM.
// ===========================================================================

describe('BP-T11b: only the author is in the family (computed recipient set excludes author) → uniform skip, no self-ping', () => {
  it('returns { sent: 0, cleaned: 0 } and does NOT call FCM (privacy review Fix 1)', async () => {
    seedHappyPath();
    // Remove all other members from the family.
    docStore.delete(`users/${MEMBER_B_UID}`);
    docStore.delete(`users/${MEMBER_C_UID}`);
    docStore.delete(`userPrivate/${MEMBER_B_UID}`);
    docStore.delete(`userPrivate/${MEMBER_C_UID}`);
    docStore.delete(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`);
    docStore.delete(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`);
    const result = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    });
    expect(result).toEqual({ sent: 0, cleaned: 0 });
    expect(sendEachForMulticastMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BP-T12 — happy path: 2 non-author recipients × 1 token each.
// ===========================================================================

describe('BP-T12: happy path — 2 non-author members × 1 token each → { sent: 2, cleaned: 0 } via ONE multicast', () => {
  it('returns { sent: 2, cleaned: 0 }', async () => {
    seedHappyPath();
    const result = (await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 2, cleaned: 0 });
  });

  it('calls sendEachForMulticast EXACTLY ONCE (aggregated)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it('multicast tokens are the 2 non-author tokens (and NOT the author token)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(message.tokens).toEqual(expect.arrayContaining([TOKEN_VALUE_B, TOKEN_VALUE_C]));
    expect(message.tokens).toHaveLength(2);
    expect(message.tokens).not.toContain(TOKEN_VALUE_AUTHOR);
  });

  it('title matches notificationBodies.familyBoardPost.title VERBATIM (no PI)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      familyBoardPost?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.familyBoardPost ??
      bodies.NOTIFICATION_BODIES?.['familyBoardPost'] ??
      bodies.NOTIF_BODIES?.['familyBoardPost'] ??
      bodies.notificationBodies?.['familyBoardPost'];
    expect(entry, 'familyBoardPost constants must be defined and non-empty').toBeDefined();
    expect((entry?.title ?? '').length).toBeGreaterThan(0);
    const [message] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(message.notification.title).toBe(entry!.title);
    expect(message.notification.title).not.toContain('${');
    expect(message.notification.title).not.toContain('{{');
  });

  it('body matches notificationBodies.familyBoardPost.body VERBATIM (no PI)', async () => {
    seedHappyPath();
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const bodies = (await import('../src/notificationBodies.js')) as {
      familyBoardPost?: { title: string; body: string };
      NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      NOTIF_BODIES?: Record<string, { title: string; body: string }>;
      notificationBodies?: Record<string, { title: string; body: string }>;
    };
    const entry =
      bodies.familyBoardPost ??
      bodies.NOTIFICATION_BODIES?.['familyBoardPost'] ??
      bodies.NOTIF_BODIES?.['familyBoardPost'] ??
      bodies.notificationBodies?.['familyBoardPost'];
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
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    expect(docStore.has(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(true);
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// BP-T13, BP-T14 — stale-token cleanup.
// ===========================================================================

describe('BP-T13: registration-token-not-registered → that token doc deleted, others survive', () => {
  it('deletes the failing token only; { sent: 1, cleaned: 1 }', async () => {
    seedHappyPath();
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      const responses = msg.tokens.map((t) =>
        t === TOKEN_VALUE_C
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
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(false);
    expect(docStore.has(`userPrivate/${MEMBER_B_UID}/fcmTokens/${TOKEN_HASH_B}`)).toBe(true);
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
  });
});

describe('BP-T14: invalid-registration-token → that token doc deleted', () => {
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
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 1 });
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(false);
  });
});

// ===========================================================================
// BP-T15, BP-T16 — transient codes.
// ===========================================================================

describe('BP-T15: server-unavailable transient — doc NOT deleted, cleaned NOT bumped', () => {
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
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 1, cleaned: 0 });
    expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(true);
  });
});

describe('BP-T16: internal-error / quota-exceeded transient', () => {
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
        auth: { uid: AUTHOR_UID },
        data: { postId: POST_ID },
      })) as { sent: number; cleaned: number };
      expect(result.cleaned).toBe(0);
      expect(docStore.has(`userPrivate/${MEMBER_C_UID}/fcmTokens/${TOKEN_HASH_C}`)).toBe(true);
    },
  );
});

// ===========================================================================
// BP-T17 — Rate limit.
// ===========================================================================

describe(`BP-T17: M36 rate limit at rateLimits/${KIND}__{callerUid}`, () => {
  const RATE_LIMIT_PATH = `rateLimits/${KIND}__${AUTHOR_UID}`;

  it('rejects with resource-exhausted at count >= 10', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 30_000 });
    const err = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
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
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    });
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('allows + resets when windowStartMs > 60s ago', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 10, windowStartMs: FIXED_NOW - 61_000 });
    const result = await invoke({
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    });
    expect(result).toMatchObject({ sent: 2, cleaned: 0 });
  });

  it('increments the counter on a successful call', async () => {
    seedHappyPath();
    docStore.set(RATE_LIMIT_PATH, { count: 3, windowStartMs: FIXED_NOW - 10_000 });
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const after = docStore.get(RATE_LIMIT_PATH) as { count?: number } | undefined;
    expect(after?.count ?? 0).toBeGreaterThan(3);
  });
});

// ===========================================================================
// BP-T18 — FCM throws.
// ===========================================================================

describe('BP-T18: FCM throws → { sent: 0, cleaned: 0 } (privacy review Fix 1)', () => {
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
      auth: { uid: AUTHOR_UID },
      data: { postId: POST_ID },
    })) as { sent: number; cleaned: number };
    expect(result).toEqual({ sent: 0, cleaned: 0 });
  });

  it('does NOT throw HttpsError', async () => {
    let threw = false;
    try {
      await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('error log never contains messaging/* prefix or raw provider text', async () => {
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const serialized = JSON.stringify(loggerErrorMock.mock.calls);
    expect(serialized).not.toMatch(/messaging\//i);
    expect(serialized).not.toMatch(/RAW PROVIDER TEXT/);
  });
});

// ===========================================================================
// BP-T19 — Privacy: post content + author name MUST NOT leak.
// ===========================================================================

describe('BP-T19: outbound FCM payload contains NO post content, NO author name, NO generic PI', () => {
  beforeEach(() => {
    seedHappyPath();
    docStore.set(`posts/${POST_ID}`, {
      familyId: FAMILY_ID,
      authorId: AUTHOR_UID,
      authorName: 'Maya',
      content: 'I made cookies and the kitchen is a disaster — call grandma about birthday plans',
      createdAt: FIXED_NOW - 1_000,
    });
  });

  it('forbidden PI substrings absent from the outbound payload', async () => {
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [Record<string, unknown>];
    const clone: Record<string, unknown> = { ...message };
    delete clone.tokens;
    const serialized = JSON.stringify(clone).toLowerCase();
    const forbidden = [
      'maya',
      'cookies',
      'kitchen',
      'disaster',
      'grandma',
      'birthday',
      'plans',
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
        `outbound FCM payload contains forbidden substring "${sub}" (M34/B10)`,
      ).not.toContain(sub.toLowerCase());
    }
  });

  it('data.url is opaque and lacks PI', async () => {
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const [message] = sendEachForMulticastMock.mock.calls[0] as [{ data?: { url?: string } }];
    if (message.data && typeof message.data.url === 'string') {
      expect(message.data.url).toMatch(/^\/[A-Za-z0-9/_-]*$/);
      expect(message.data.url.toLowerCase()).not.toMatch(/maya|grandma|cookies|name/);
    }
  });
});

// ===========================================================================
// BP-T19b — M38 log allow-list.
// ===========================================================================

describe(`BP-T19b: success log carries canonical fields with kind="${KIND}"`, () => {
  beforeEach(() => seedHappyPath());

  it('canonical 7-field payload present', async () => {
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const sendCompleteCall = loggerInfoMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload && 'successCount' in payload;
    });
    expect(sendCompleteCall).toBeDefined();
    const payload = sendCompleteCall![1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: KIND,
      familyId: FAMILY_ID,
      actorUid: AUTHOR_UID,
      recipientCount: 2,
      successCount: 2,
      cleanedTokenCount: 0,
    });
    expect(typeof payload.durationMs).toBe('number');
  });

  it('log NEVER contains raw token values or post content', async () => {
    docStore.set(`posts/${POST_ID}`, {
      familyId: FAMILY_ID,
      authorId: AUTHOR_UID,
      authorName: 'Maya',
      content: 'I made cookies',
    });
    await invoke({ auth: { uid: AUTHOR_UID }, data: { postId: POST_ID } });
    const serialized = JSON.stringify(loggerInfoMock.mock.calls).toLowerCase();
    expect(serialized).not.toContain(TOKEN_VALUE_B.toLowerCase());
    expect(serialized).not.toContain(TOKEN_VALUE_C.toLowerCase());
    for (const sub of ['maya', 'cookies', 'dollar', 'wishlist']) {
      expect(serialized).not.toContain(sub.toLowerCase());
    }
  });
});

// ===========================================================================
// BP-T20 — No console.*.
// ===========================================================================

describe('BP-T20: no console.* in functions/src/notifyBoardPost.ts', () => {
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
        `console.* found in functions/src/notifyBoardPost.ts — use logger.* instead:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
