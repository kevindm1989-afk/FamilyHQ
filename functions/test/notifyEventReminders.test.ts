/**
 * notifyEventReminders — unit contract (PR F7, onSchedule v2).
 *
 * Surface: an hourly UTC sweep selects every family whose local hour is 8,
 * queries that family's events for the local-day, and fires ONE multicast
 * per family. No caller identity (no `request.auth`); the function is
 * Pub/Sub-equivalent — the event payload is IGNORED entirely (M46).
 *
 * Test indexing F-T1..F-T13 (mirrors threat-model §A.10 PR F row). F-T4 and
 * F-T13 are BLOCKING / security-critical (cross-tenant isolation in a
 * single invocation — DF19 is the FIRST trusted code path that legitimately
 * iterates across families).
 *
 * Mock surface mirrors notifyBoardPost.test.ts: vi mocks for Firestore +
 * messaging + logger, per-test docStore reset, deterministic clock pinned
 * to 12:00 UTC on 2026-06-11 (= 8am EDT America/Toronto in June).
 *
 * MUST FAIL today: functions/src/notifyEventReminders.ts does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Fixtures — June 11, 2026 12:00 UTC == 8:00 EDT (America/Toronto, summer DST).
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0);
const LOCAL_DAY_TORONTO = '2026-06-11'; // family-local calendar day in America/Toronto
const REGION = 'northamerica-northeast1';
const KIND = 'eventReminder';
const CATEGORY_KEY = 'eventReminders';

const FAMILY_A = 'fam-A';
const FAMILY_B = 'fam-B';
const FAMILY_VANCOUVER = 'fam-V'; // not at hour 8 local
const PARENT_A_UID = 'uid-parent-a';
const KID_A_UID = 'uid-kid-a';
const PARENT_B_UID = 'uid-parent-b';

const EVENT_A_ID = 'evt-A-1';
const EVENT_B_ID = 'evt-B-1';

const TOKEN_HASH_PARENT_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_KID_A = 'cccccccccccccccccccccccc';
const TOKEN_HASH_PARENT_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_VALUE_PARENT_A = 'fcm-token-parent-a';
const TOKEN_VALUE_KID_A = 'fcm-token-kid-a';
const TOKEN_VALUE_PARENT_B = 'fcm-token-parent-b';

const SOURCE_PATH = resolve(__dirname, '../src/notifyEventReminders.ts');
const BARREL_PATH = resolve(__dirname, '../src/index.ts');

// ---------------------------------------------------------------------------
// Mocks — capture onSchedule registration shape + invocation handler.
// ---------------------------------------------------------------------------
interface CapturedSchedule {
  options: Record<string, unknown> | undefined;
  handler: ((event: unknown) => unknown | Promise<unknown>) | undefined;
}
const captured: CapturedSchedule = { options: undefined, handler: undefined };
const onScheduleMock = vi.fn((options: unknown, handler: unknown) => {
  captured.options = options as Record<string, unknown>;
  captured.handler = handler as (event: unknown) => unknown | Promise<unknown>;
  return { __trigger: 'scheduler.onSchedule', options };
});
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (options: unknown, handler: unknown) => onScheduleMock(options, handler),
}));
vi.mock('firebase-functions/scheduler', () => ({
  onSchedule: (options: unknown, handler: unknown) => onScheduleMock(options, handler),
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
// Firestore mock (where-aware + orderBy + limit) — extends the
// notifyBoardPost pattern with the query operations the sweep needs.
// ---------------------------------------------------------------------------
type DocSnap = { exists: boolean; data: Record<string, unknown> | undefined; id: string };
type DocStore = Map<string, Record<string, unknown> | undefined>;
let docStore: DocStore;
// Per-prefix collection-list-throw override (e.g. throw when listing
// `events` under fam-A's local-day window).
let collectionThrowPrefixes: Set<string>;
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
const docCreateMock = vi.fn(async (path: string, data: Record<string, unknown>) => {
  if (docStore.has(path)) {
    const err = new Error(`firestore-mock: ALREADY_EXISTS at ${path}`);
    (err as Error & { code: number | string }).code = 6; // gRPC ALREADY_EXISTS
    throw err;
  }
  docStore.set(path, data);
});
const docDeleteMock = vi.fn(async (path: string) => {
  docStore.delete(path);
});

interface QueryClause {
  field: string;
  op: string;
  value: unknown;
}
interface QueryOrder {
  field: string;
  dir: 'asc' | 'desc';
}

const collectionListMock = vi.fn(
  async (
    prefix: string,
    whereClauses: QueryClause[] = [],
    orderBys: QueryOrder[] = [],
    limitN?: number,
  ): Promise<DocSnap[]> => {
    for (const p of collectionThrowPrefixes) {
      if (prefix === p) throw new Error(`firestore-mock: forced collection throw at ${prefix}`);
    }
    const out: DocSnap[] = [];
    for (const [path, data] of docStore.entries()) {
      if (!path.startsWith(`${prefix}/`) || data === undefined) continue;
      // Direct children only (no nested collections).
      if (path.slice(prefix.length + 1).split('/').length !== 1) continue;
      let pass = true;
      for (const { field, op, value } of whereClauses) {
        const fieldValue = data[field];
        if (op === '==' && fieldValue !== value) pass = false;
        if (op === '!=' && fieldValue === value) pass = false;
        const strCmp = typeof fieldValue === 'string' && typeof value === 'string';
        if (
          op === '>=' &&
          !(strCmp ? fieldValue >= (value as string) : (fieldValue as number) >= (value as number))
        )
          pass = false;
        if (
          op === '<=' &&
          !(strCmp ? fieldValue <= (value as string) : (fieldValue as number) <= (value as number))
        )
          pass = false;
        if (
          op === '<' &&
          !(strCmp ? fieldValue < (value as string) : (fieldValue as number) < (value as number))
        )
          pass = false;
        if (
          op === '>' &&
          !(strCmp ? fieldValue > (value as string) : (fieldValue as number) > (value as number))
        )
          pass = false;
      }
      if (!pass) continue;
      const segs = path.split('/');
      const id = segs[segs.length - 1] ?? '';
      out.push({ exists: true, data, id });
    }
    if (orderBys.length > 0) {
      out.sort((a, b) => {
        for (const { field, dir } of orderBys) {
          const av = (a.data ?? {})[field];
          const bv = (b.data ?? {})[field];
          if (av === bv) continue;
          let cmp = 0;
          if (typeof av === 'string' && typeof bv === 'string') cmp = av < bv ? -1 : 1;
          else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
          else cmp = String(av) < String(bv) ? -1 : 1;
          return dir === 'asc' ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (typeof limitN === 'number') return out.slice(0, limitN);
    return out;
  },
);

function buildDocRef(path: string): unknown {
  return {
    path,
    id: path.split('/').pop(),
    get: () => docGetMock(path),
    set: (data: Record<string, unknown>, opts?: { merge?: boolean }) =>
      docSetMock(path, data, opts),
    update: (data: Record<string, unknown>) => docSetMock(path, data, { merge: true }),
    create: (data: Record<string, unknown>) => docCreateMock(path, data),
    delete: () => docDeleteMock(path),
    collection: (sub: string) => buildCollectionRef(`${path}/${sub}`),
  };
}
function buildCollectionRef(
  path: string,
  whereClauses: QueryClause[] = [],
  orderBys: QueryOrder[] = [],
  limitN?: number,
): unknown {
  const self = {
    path,
    doc: (id: string) => buildDocRef(`${path}/${id}`),
    add: async (data: Record<string, unknown>) => {
      const id = `auto-${Math.random().toString(36).slice(2)}`;
      const fullPath = `${path}/${id}`;
      await docSetMock(fullPath, data);
      return buildDocRef(fullPath);
    },
    where: (field: string, op: string, value: unknown) =>
      buildCollectionRef(path, [...whereClauses, { field, op, value }], orderBys, limitN),
    orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') =>
      buildCollectionRef(path, whereClauses, [...orderBys, { field, dir }], limitN),
    limit: (n: number) => buildCollectionRef(path, whereClauses, orderBys, n),
    get: async () => {
      const docs = await collectionListMock(path, whereClauses, orderBys, limitN);
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
      const docs = await collectionListMock(path, whereClauses, orderBys, limitN);
      return docs.map((d) => buildDocRef(`${path}/${d.id}`));
    },
  };
  return self;
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
      create: (ref: { path: string }, data: Record<string, unknown>) =>
        docCreateMock(ref.path, data),
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
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    increment: (n: number) => ({ __sentinel: 'increment', n }),
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
 * Seed family A with one event for today, parent + kid recipients (both
 * opted-in with one token each).
 */
function seedFamilyA(): void {
  docStore.set(`families/${FAMILY_A}`, {
    familyName: 'Fam A',
    createdBy: PARENT_A_UID,
    createdAt: FIXED_NOW - 1_000_000,
    timezone: 'America/Toronto',
  });
  docStore.set(`users/${PARENT_A_UID}`, {
    familyId: FAMILY_A,
    isActive: true,
    role: 'parent',
    name: 'P-A',
  });
  docStore.set(`users/${KID_A_UID}`, {
    familyId: FAMILY_A,
    isActive: true,
    role: 'member',
    name: 'K-A',
  });
  for (const uid of [PARENT_A_UID, KID_A_UID]) {
    docStore.set(`userPrivate/${uid}`, {
      familyId: FAMILY_A,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
  }
  docStore.set(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_PARENT_A}`, {
    token: TOKEN_VALUE_PARENT_A,
    userAgent: 'Chrome',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
  docStore.set(`userPrivate/${KID_A_UID}/fcmTokens/${TOKEN_HASH_KID_A}`, {
    token: TOKEN_VALUE_KID_A,
    userAgent: 'Safari',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
  // Today's event for family A (date is family-local ISO datetime).
  docStore.set(`events/${EVENT_A_ID}`, {
    title: 'Soccer practice — child PI here',
    description: 'with Coach',
    date: `${LOCAL_DAY_TORONTO}T18:00:00.000`,
    tag: 'sports',
    familyId: FAMILY_A,
    createdBy: PARENT_A_UID,
    createdAt: FIXED_NOW - 86_400_000,
  });
}

/**
 * Seed family B alongside family A — same hour-8 timezone, one event each.
 * Used by the F-T4 / F-T13 cross-product blocking tests.
 */
function seedFamilyB(): void {
  docStore.set(`families/${FAMILY_B}`, {
    familyName: 'Fam B',
    createdBy: PARENT_B_UID,
    createdAt: FIXED_NOW - 1_000_000,
    timezone: 'America/Toronto',
  });
  docStore.set(`users/${PARENT_B_UID}`, {
    familyId: FAMILY_B,
    isActive: true,
    role: 'parent',
    name: 'P-B',
  });
  docStore.set(`userPrivate/${PARENT_B_UID}`, {
    familyId: FAMILY_B,
    notificationPreferences: {
      pushEnabled: true,
      categories: { [CATEGORY_KEY]: true },
    },
  });
  docStore.set(`userPrivate/${PARENT_B_UID}/fcmTokens/${TOKEN_HASH_PARENT_B}`, {
    token: TOKEN_VALUE_PARENT_B,
    userAgent: 'Firefox',
    createdAt: FIXED_NOW - 60_000,
    lastSeenAt: FIXED_NOW - 60_000,
  });
  docStore.set(`events/${EVENT_B_ID}`, {
    title: 'Dentist for B kid',
    description: '',
    date: `${LOCAL_DAY_TORONTO}T15:00:00.000`,
    tag: 'family',
    familyId: FAMILY_B,
    createdBy: PARENT_B_UID,
    createdAt: FIXED_NOW - 86_400_000,
  });
}

/** Seed Vancouver family (PT) where 8am local is FIXED_NOW + 3h — NOT matched this hour. */
function seedFamilyVancouverOffHour(): void {
  docStore.set(`families/${FAMILY_VANCOUVER}`, {
    familyName: 'Fam V',
    createdBy: 'uid-parent-v',
    createdAt: FIXED_NOW - 1_000_000,
    timezone: 'America/Vancouver',
  });
}

async function loadModule(): Promise<Record<string, unknown>> {
  captured.options = undefined;
  captured.handler = undefined;
  vi.resetModules();
  return (await import('../src/notifyEventReminders.js')) as Record<string, unknown>;
}

async function invokeSweep(event: unknown = undefined): Promise<unknown> {
  if (!existsSync(SOURCE_PATH)) {
    throw new Error(
      `notifyEventReminders.ts is missing at ${SOURCE_PATH} — implementer must create per PR F task F7`,
    );
  }
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyEventReminders did not register an onSchedule handler at import time');
  }
  return captured.handler(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  docStore = new Map();
  collectionThrowPrefixes = new Set();
  onScheduleMock.mockClear();
  loggerInfoMock.mockReset();
  loggerWarnMock.mockReset();
  loggerErrorMock.mockReset();
  docGetMock.mockClear();
  docSetMock.mockClear();
  docDeleteMock.mockClear();
  docCreateMock.mockClear();
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
// F-T0 — preconditions (diagnosable failure when implementer hasn't shipped).
// ===========================================================================

describe('F-T0: preconditions — source file + barrel export exist', () => {
  it('source file exists at functions/src/notifyEventReminders.ts (implementer must create — PR F task F7)', () => {
    expect(
      existsSync(SOURCE_PATH),
      `notifyEventReminders.ts is missing at ${SOURCE_PATH} — implementer must create per PR F task F7`,
    ).toBe(true);
  });

  it('the barrel re-exports `notifyEventReminders`', () => {
    expect(existsSync(BARREL_PATH)).toBe(true);
    const barrel = readFileSync(BARREL_PATH, 'utf8');
    expect(
      /export\s*\{[^}]*\bnotifyEventReminders\b[^}]*\}\s*from\s*['"]\.\/notifyEventReminders/.test(
        barrel,
      ),
      'functions/src/index.ts must re-export notifyEventReminders so `firebase deploy --only functions:notifyEventReminders` resolves it',
    ).toBe(true);
  });
});

// ===========================================================================
// F-T1 — payload-ignoring contract (M46(a)). Two forms: a Throwing Proxy
// runtime invocation; AST scan of the source to forbid `event` reads.
// ===========================================================================

describe('F-T1 (M46(a)): handler IGNORES the event payload', () => {
  it('runtime: invoking with a throwing Proxy as the event completes without ever reading any property', async () => {
    seedFamilyA();
    const throwingEvent = new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(`payload-read: handler touched event.${String(prop)}`);
        },
        has() {
          throw new Error('payload-read: handler did `in` on event');
        },
      },
    );
    let threw: unknown = undefined;
    try {
      await invokeSweep(throwingEvent);
    } catch (e) {
      threw = e;
    }
    expect(
      threw,
      `handler must ignore the event payload; got: ${threw instanceof Error ? threw.message : String(threw)}`,
    ).toBeUndefined();
  });

  it('AST: handler body does NOT reference the `event` identifier', () => {
    if (!existsSync(SOURCE_PATH)) {
      throw new Error(
        `notifyEventReminders.ts missing at ${SOURCE_PATH} — implementer must create per PR F task F7 (this test cannot run without the source)`,
      );
    }
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const sf = ts.createSourceFile(SOURCE_PATH, src, ts.ScriptTarget.ES2022, true);

    interface Hit {
      line: number;
      text: string;
    }
    const hits: Hit[] = [];

    function checkBody(body: ts.Node): void {
      function walk(node: ts.Node): void {
        if (ts.isIdentifier(node) && node.text === 'event') {
          const parent = node.parent;
          if (parent && ts.isPropertyAssignment(parent) && parent.name === node) {
            // key position — fine
          } else if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) {
            // foo.event — fine (not reading the parameter)
          } else {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            hits.push({ line: line + 1, text: node.getText() });
          }
        }
        ts.forEachChild(node, walk);
      }
      walk(body);
    }

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'onSchedule' &&
        node.arguments.length >= 2
      ) {
        const handler = node.arguments[1];
        if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
          if (handler.body) checkBody(handler.body);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);
    if (hits.length > 0) {
      const report = hits.map((h) => `  - line ${h.line}: ${h.text}`).join('\n');
      throw new Error(
        `F-T1 (M46(a)) violation: handler body references the \`event\` identifier — must ignore the payload entirely (rename param to \`_event\` or omit it):\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});

// ===========================================================================
// F-T2 (M46(b)) — never-throw + per-family try/catch contract.
// ===========================================================================

describe('F-T2 (M46(b)): handler resolves even when one family throws; other families still processed', () => {
  it('family 1 of 3 throws → handler resolves, families 2+3 still send', async () => {
    seedFamilyA();
    seedFamilyB();
    // A third family that should still get processed.
    const FAMILY_C = 'fam-C';
    const PARENT_C_UID = 'uid-parent-c';
    const TOKEN_HASH_C = 'dddddddddddddddddddddddd';
    const TOKEN_VALUE_C = 'fcm-token-parent-c';
    const EVENT_C_ID = 'evt-C-1';
    docStore.set(`families/${FAMILY_C}`, {
      familyName: 'Fam C',
      createdBy: PARENT_C_UID,
      createdAt: FIXED_NOW - 1_000_000,
      timezone: 'America/Toronto',
    });
    docStore.set(`users/${PARENT_C_UID}`, {
      familyId: FAMILY_C,
      isActive: true,
      role: 'parent',
      name: 'P-C',
    });
    docStore.set(`userPrivate/${PARENT_C_UID}`, {
      familyId: FAMILY_C,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    docStore.set(`userPrivate/${PARENT_C_UID}/fcmTokens/${TOKEN_HASH_C}`, {
      token: TOKEN_VALUE_C,
      userAgent: 'Edge',
      createdAt: FIXED_NOW - 60_000,
      lastSeenAt: FIXED_NOW - 60_000,
    });
    docStore.set(`events/${EVENT_C_ID}`, {
      title: 'Vet visit',
      description: '',
      date: `${LOCAL_DAY_TORONTO}T10:00:00.000`,
      tag: 'family',
      familyId: FAMILY_C,
      createdBy: PARENT_C_UID,
      createdAt: FIXED_NOW - 86_400_000,
    });

    // Wrap the events list call to throw on the FIRST per-family events
    // read only — subsequent families still process. Whichever family is
    // iterated first triggers the throw; the loop's per-family try/catch
    // (M46(b)) must absorb it and continue.
    let eventsCalls = 0;
    const realImpl = collectionListMock.getMockImplementation();
    collectionListMock.mockImplementation(
      async (
        prefix: string,
        whereClauses?: QueryClause[],
        orderBys?: QueryOrder[],
        limitN?: number,
      ) => {
        if (prefix === 'events') {
          eventsCalls += 1;
          if (eventsCalls === 1) {
            throw new Error('forced: first family events read fails');
          }
        }
        if (!realImpl) return [];
        return realImpl(prefix, whereClauses ?? [], orderBys ?? [], limitN);
      },
    );

    let threw: unknown = undefined;
    try {
      await invokeSweep();
    } catch (e) {
      threw = e;
    }
    expect(threw, 'handler must never throw (M46(b))').toBeUndefined();

    // sendEachForMulticast must have been called for the surviving families.
    const totalSends = sendEachForMulticastMock.mock.calls.length;
    expect(
      totalSends,
      `expected ≥2 multicasts (for surviving families after one throws); got ${totalSends}`,
    ).toBeGreaterThanOrEqual(2);

    // A structured warn for the failed family must exist.
    expect(loggerWarnMock, 'a structured warn must fire for the failed family').toHaveBeenCalled();
  });
});

// ===========================================================================
// F-T3 (M46(c)) — explicit retry-disabled setting in onSchedule options.
// ===========================================================================

describe('F-T3 (M46(c)): onSchedule options declare retry disabled', () => {
  it('options include retryCount: 0 (or a tolerant equivalent for older shapes)', async () => {
    // firebase-functions v2 ScheduleOptions has flat `retryCount` (verified
    // against functions/node_modules/firebase-functions/lib/v2/providers/
    // scheduler.d.ts at firebase-functions 7.2.5). Older brief-side
    // shapes (`retryConfig.retryCount`, `retryConfig.maxRetries`) are
    // accepted as defense against a future SDK rename — the SAFETY
    // contract (M46(c): retry is disabled) is the invariant; the field
    // name is incidental.
    await invokeSweep().catch(() => undefined);
    expect(onScheduleMock).toHaveBeenCalledTimes(1);
    const opts = (captured.options ?? {}) as Record<string, unknown>;
    const flatRetryCount = opts.retryCount;
    const nested = opts.retryConfig as { retryCount?: unknown; maxRetries?: unknown } | undefined;
    const ok = flatRetryCount === 0 || nested?.retryCount === 0 || nested?.maxRetries === 0;
    expect(
      ok,
      `F-T3 (M46(c)) violation: onSchedule options must declare retry disabled — flat retryCount === 0 OR retryConfig.retryCount === 0 OR retryConfig.maxRetries === 0; got retryCount=${JSON.stringify(opts.retryCount)} retryConfig=${JSON.stringify(opts.retryConfig)}`,
    ).toBe(true);
  });

  it('pins region to northamerica-northeast1', async () => {
    await invokeSweep().catch(() => undefined);
    const opts = (captured.options ?? {}) as Record<string, unknown>;
    expect(opts.region).toBe(REGION);
  });

  it("pins an hourly UTC cron (schedule '0 * * * *', timeZone 'UTC')", async () => {
    await invokeSweep().catch(() => undefined);
    const opts = (captured.options ?? {}) as Record<string, unknown>;
    expect(
      opts.schedule,
      `schedule must be '0 * * * *' (hourly UTC); got ${String(opts.schedule)}`,
    ).toBe('0 * * * *');
    expect(opts.timeZone ?? opts.timezone).toBe('UTC');
  });
});

// ===========================================================================
// F-T4 (M47) — BLOCKING. Cross-family isolation in a single invocation.
// ===========================================================================

describe('F-T4 (M47) [BLOCKING]: two families at hour 8 each get exactly their own tokens — no token leak', () => {
  it("exactly ONE multicast per family, each containing ONLY that family's tokens", async () => {
    seedFamilyA();
    seedFamilyB();
    await invokeSweep();

    expect(
      sendEachForMulticastMock,
      `expected exactly 2 multicasts (one per family); got ${sendEachForMulticastMock.mock.calls.length}`,
    ).toHaveBeenCalledTimes(2);

    const calls = sendEachForMulticastMock.mock.calls as Array<[{ tokens: string[] }]>;
    const tokenSets = calls.map(([m]) => new Set(m.tokens));

    const familyATokens = new Set([TOKEN_VALUE_PARENT_A, TOKEN_VALUE_KID_A]);
    const familyBTokens = new Set([TOKEN_VALUE_PARENT_B]);

    const aCall = tokenSets.find((s) => s.has(TOKEN_VALUE_PARENT_A));
    const bCall = tokenSets.find((s) => s.has(TOKEN_VALUE_PARENT_B));
    expect(aCall, 'family A multicast should be present').toBeDefined();
    expect(bCall, 'family B multicast should be present').toBeDefined();
    expect(
      aCall,
      `family A multicast must contain EXACTLY {PARENT_A, KID_A}; got: ${JSON.stringify(Array.from(aCall ?? []))}`,
    ).toEqual(familyATokens);
    expect(
      bCall,
      `family B multicast must contain EXACTLY {PARENT_B}; got: ${JSON.stringify(Array.from(bCall ?? []))}`,
    ).toEqual(familyBTokens);

    const intersection = new Set([...(aCall ?? [])].filter((t) => (bCall ?? new Set()).has(t)));
    expect(
      intersection.size,
      `family A and family B token sets MUST NOT intersect; intersection=${JSON.stringify(Array.from(intersection))}`,
    ).toBe(0);
  });
});

// ===========================================================================
// F-T5 (M47) — per-recipient cross-tenant skip + structured warn (allow-list only).
// ===========================================================================

describe('F-T5 (M47): recipient with userPrivate.familyId ≠ loop family is SKIPPED + warned', () => {
  it("the corrupt recipient's tokens are never read; multicast continues for the rest", async () => {
    seedFamilyA();
    // Corrupt the kid's userPrivate familyId so it does NOT match family A.
    docStore.set(`userPrivate/${KID_A_UID}`, {
      familyId: FAMILY_B, // mismatch — this recipient must be skipped
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(
      msg.tokens,
      `kid's token must not be in the multicast (familyId mismatch — skipped); got: ${JSON.stringify(msg.tokens)}`,
    ).toEqual([TOKEN_VALUE_PARENT_A]);
  });

  it('emits a structured warn — payload does NOT contain recipientUid OR the foreign familyId', async () => {
    seedFamilyA();
    docStore.set(`userPrivate/${KID_A_UID}`, {
      familyId: FAMILY_B,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    await invokeSweep();
    expect(loggerWarnMock).toHaveBeenCalled();
    const warnSerialized = JSON.stringify(loggerWarnMock.mock.calls);
    expect(warnSerialized, 'warn payload must NOT contain the recipient uid').not.toContain(
      KID_A_UID,
    );
    expect(warnSerialized, 'warn payload must NOT contain the foreign familyId').not.toContain(
      FAMILY_B,
    );
  });
});

// ===========================================================================
// F-T6 (M48) — marker dedupe + create-BEFORE-send ordering.
// ===========================================================================

describe('F-T6 (M48): marker absence → create() BEFORE send; marker present → no send', () => {
  it('marker absent: docCreate fires BEFORE sendEachForMulticast (mock call-order assertion)', async () => {
    seedFamilyA();
    const callOrder: string[] = [];
    docCreateMock.mockImplementation(async (path: string, data: Record<string, unknown>) => {
      callOrder.push(`create:${path}`);
      docStore.set(path, data);
    });
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      callOrder.push('send');
      return {
        successCount: msg.tokens.length,
        failureCount: 0,
        responses: msg.tokens.map(() => ({ success: true })),
      };
    });

    await invokeSweep();

    const createIdx = callOrder.findIndex(
      (s) => s.startsWith('create:scheduledSends/') && s.includes(EVENT_A_ID),
    );
    const sendIdx = callOrder.indexOf('send');
    expect(
      createIdx,
      `scheduledSends/{kind}__{eventId}__{yyyymmdd} create must fire (got callOrder=${JSON.stringify(callOrder)})`,
    ).toBeGreaterThanOrEqual(0);
    expect(sendIdx, 'sendEachForMulticast must fire').toBeGreaterThanOrEqual(0);
    expect(
      createIdx,
      `marker create must precede send (M48); got createIdx=${createIdx}, sendIdx=${sendIdx}`,
    ).toBeLessThan(sendIdx);
  });

  it('marker present: no send fires (at-most-once, M48)', async () => {
    seedFamilyA();
    // Pre-create the marker (simulates a prior tick that already sent).
    const yyyymmdd = LOCAL_DAY_TORONTO.replace(/-/g, '');
    const markerPath = `scheduledSends/${KIND}__${EVENT_A_ID}__${yyyymmdd}`;
    docStore.set(markerPath, {
      kind: KIND,
      familyId: FAMILY_A,
      sourceId: EVENT_A_ID,
      localDay: LOCAL_DAY_TORONTO,
      sentAt: FIXED_NOW - 60_000,
      recipientCount: 2,
      expiresAt: FIXED_NOW + 7 * 24 * 60 * 60 * 1000,
    });

    await invokeSweep();

    expect(
      sendEachForMulticastMock,
      'send must NOT fire when the marker already exists (at-most-once, M48)',
    ).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// F-T7 (M48) — marker-then-send-fail: at-most-once.
// ===========================================================================

describe('F-T7 (M48): marker created, FCM send throws → marker REMAINS, re-invocation sends nothing (at-most-once)', () => {
  it('after a send-throw on the first invocation, the marker remains in scheduledSends', async () => {
    seedFamilyA();
    sendEachForMulticastMock = vi.fn(async () => {
      throw new Error('FCM unavailable');
    });
    await invokeSweep();

    const yyyymmdd = LOCAL_DAY_TORONTO.replace(/-/g, '');
    const markerPath = `scheduledSends/${KIND}__${EVENT_A_ID}__${yyyymmdd}`;
    expect(
      docStore.has(markerPath),
      `marker must remain after send-throw (at-most-once); without it a retry would send a duplicate — looked for ${markerPath}`,
    ).toBe(true);
  });

  it('second invocation: marker is present, so no further send fires', async () => {
    seedFamilyA();
    let sendCalls = 0;
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      sendCalls += 1;
      if (sendCalls === 1) {
        throw new Error('FCM unavailable');
      }
      return {
        successCount: msg.tokens.length,
        failureCount: 0,
        responses: msg.tokens.map(() => ({ success: true })),
      };
    });
    await invokeSweep();
    // Re-invoke — marker already exists, so no second send.
    await invokeSweep();

    expect(
      sendCalls,
      `second invocation must NOT send (marker already exists, at-most-once); got ${sendCalls} send calls`,
    ).toBe(1);
  });
});

// ===========================================================================
// F-T9 (M49) — fan-out cap 10 per family per kind per day.
// ===========================================================================

describe('F-T9 (M49): 11 same-day events in one family → exactly 10 markers + 10 sends', () => {
  it('cap enforced: 10 markers landed (date asc), 1 dropped, 1 structured warn', async () => {
    seedFamilyA();
    // Remove the seeded single event and add 11 with deterministic dates.
    docStore.delete(`events/${EVENT_A_ID}`);
    for (let i = 0; i < 11; i += 1) {
      const hour = String(i).padStart(2, '0');
      docStore.set(`events/evt-A-${i}`, {
        title: `Event ${i}`,
        description: '',
        date: `${LOCAL_DAY_TORONTO}T${hour}:00:00.000`,
        tag: 'family',
        familyId: FAMILY_A,
        createdBy: PARENT_A_UID,
        createdAt: FIXED_NOW - 86_400_000 + i,
      });
    }

    await invokeSweep();

    // Count the marker docs that landed in scheduledSends for this family.
    const markerPaths = Array.from(docStore.keys()).filter(
      (p) => p.startsWith('scheduledSends/') && p.includes('eventReminder__evt-A-'),
    );
    expect(
      markerPaths.length,
      `expected exactly 10 markers; got ${markerPaths.length}: ${JSON.stringify(markerPaths)}`,
    ).toBe(10);

    // evt-A-10 (latest date) must NOT have a marker — cap takes the EARLIEST 10.
    const droppedMarker = markerPaths.find((p) => p.includes('evt-A-10'));
    expect(
      droppedMarker,
      'evt-A-10 (the latest date) must NOT have a marker (cap is the EARLIEST 10 by date asc)',
    ).toBeUndefined();

    // One structured warn carrying {kind, familyId, droppedCount: 1}.
    const overflowWarn = loggerWarnMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return (
        payload &&
        payload.droppedCount === 1 &&
        payload.familyId === FAMILY_A &&
        payload.kind === KIND
      );
    });
    expect(
      overflowWarn,
      `expected one structured warn {kind:"${KIND}", familyId:"${FAMILY_A}", droppedCount:1}; got logs: ${JSON.stringify(loggerWarnMock.mock.calls)}`,
    ).toBeDefined();

    // Exactly 10 multicasts (one per event marker).
    expect(
      sendEachForMulticastMock.mock.calls.length,
      `expected exactly 10 sends (one per kept event); got ${sendEachForMulticastMock.mock.calls.length}`,
    ).toBe(10);
  });
});

// ===========================================================================
// F-T10 (M50) — timezone fallback + log containment.
// ===========================================================================

describe('F-T10 (M50): invalid/absent timezone → America/Toronto fallback; warn does NOT leak tz string', () => {
  it('missing timezone → fallback used; family still matches hour 8 and sends', async () => {
    seedFamilyA();
    // Strip the timezone field.
    docStore.set(`families/${FAMILY_A}`, {
      familyName: 'Fam A',
      createdBy: PARENT_A_UID,
      createdAt: FIXED_NOW - 1_000_000,
      // no timezone
    });
    await invokeSweep();
    expect(
      sendEachForMulticastMock,
      'missing timezone must fall back to America/Toronto so family A still matches hour 8',
    ).toHaveBeenCalledTimes(1);
  });

  it('invalid timezone → structured warn does NOT include the invalid tz string', async () => {
    seedFamilyA();
    docStore.set(`families/${FAMILY_A}`, {
      familyName: 'Fam A',
      createdBy: PARENT_A_UID,
      createdAt: FIXED_NOW - 1_000_000,
      timezone: 'Not/A_Real_Zone_With_Secret_Location_Data',
    });
    await invokeSweep();

    const serialized = JSON.stringify(loggerWarnMock.mock.calls);
    expect(
      serialized,
      'warn payload must NOT include the (potentially invalid) tz string — M50 quasi-location containment',
    ).not.toContain('Not/A_Real_Zone_With_Secret_Location_Data');
  });
});

describe('F-T10 (M50): forbidden log fields — `timezone` and `localDay` never appear as logger.* payload keys', () => {
  it('AST scan: no logger.* call in source has `timezone` or `localDay` as a payload key', () => {
    if (!existsSync(SOURCE_PATH)) {
      throw new Error(
        `notifyEventReminders.ts missing at ${SOURCE_PATH} — implementer must create per PR F task F7`,
      );
    }
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const sf = ts.createSourceFile(SOURCE_PATH, src, ts.ScriptTarget.ES2022, true);

    interface Hit {
      line: number;
      key: string;
    }
    const hits: Hit[] = [];

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'logger'
      ) {
        for (const arg of node.arguments) {
          if (ts.isObjectLiteralExpression(arg)) {
            for (const prop of arg.properties) {
              let keyText: string | undefined;
              if (ts.isPropertyAssignment(prop)) {
                if (ts.isIdentifier(prop.name)) keyText = prop.name.text;
                else if (ts.isStringLiteral(prop.name)) keyText = prop.name.text;
              } else if (ts.isShorthandPropertyAssignment(prop)) {
                keyText = prop.name.text;
              }
              if (keyText === 'timezone' || keyText === 'localDay') {
                const { line } = sf.getLineAndCharacterOfPosition(prop.getStart());
                hits.push({ line: line + 1, key: keyText });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
    if (hits.length > 0) {
      const report = hits.map((h) => `  - line ${h.line}: key=${h.key}`).join('\n');
      throw new Error(
        `F-T10 (M50) violation: logger.* payload includes forbidden field name(s) — \`timezone\` and \`localDay\` are quasi-location/PI:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });

  it('runtime: happy-path invocation never logs a payload that contains a `timezone` or `localDay` key', async () => {
    seedFamilyA();
    await invokeSweep();
    const all = [
      ...loggerInfoMock.mock.calls,
      ...loggerWarnMock.mock.calls,
      ...loggerErrorMock.mock.calls,
    ];
    for (const call of all) {
      for (const arg of call) {
        if (arg && typeof arg === 'object' && !Array.isArray(arg)) {
          const keys = Object.keys(arg);
          expect(
            keys,
            `logger.* payload must not contain "timezone" (M50); got keys=${JSON.stringify(keys)}`,
          ).not.toContain('timezone');
          expect(
            keys,
            `logger.* payload must not contain "localDay" (M50); got keys=${JSON.stringify(keys)}`,
          ).not.toContain('localDay');
        }
      }
    }
  });
});

// ===========================================================================
// F-T12 (M51) — fire-time recipient evaluation (deactivated / prefs-off).
// ===========================================================================

describe('F-T12 (M51): isActive=false at sweep time → no token read, no send for that recipient', () => {
  it('a deactivated recipient is skipped entirely (their tokens are never multicast)', async () => {
    seedFamilyA();
    docStore.set(`users/${KID_A_UID}`, {
      familyId: FAMILY_A,
      isActive: false,
      role: 'member',
      name: 'K-A',
    });
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(
      msg.tokens,
      `deactivated recipient kid's token must not be in multicast; got: ${JSON.stringify(msg.tokens)}`,
    ).not.toContain(TOKEN_VALUE_KID_A);
    expect(msg.tokens).toContain(TOKEN_VALUE_PARENT_A);
  });

  it('a recipient with categories.eventReminders == false is skipped', async () => {
    seedFamilyA();
    docStore.set(`userPrivate/${KID_A_UID}`, {
      familyId: FAMILY_A,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: false },
      },
    });
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(msg.tokens).not.toContain(TOKEN_VALUE_KID_A);
  });

  it('a recipient with pushEnabled == false is skipped', async () => {
    seedFamilyA();
    docStore.set(`userPrivate/${KID_A_UID}`, {
      familyId: FAMILY_A,
      notificationPreferences: {
        pushEnabled: false,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(msg.tokens).not.toContain(TOKEN_VALUE_KID_A);
  });
});

// ===========================================================================
// F-T13 (M51/M47) — BLOCKING. Cross-product per-kind isolation.
// ===========================================================================

describe('F-T13 (M51/M47) [BLOCKING]: family-B event NEVER reaches family-A recipients (cross-product, per-kind)', () => {
  it('every multicast contains tokens from exactly one family — never spans two', async () => {
    seedFamilyA();
    seedFamilyB();
    await invokeSweep();

    const calls = sendEachForMulticastMock.mock.calls as Array<[{ tokens: string[] }]>;
    expect(calls.length, `expected 2 multicasts (one per family); got ${calls.length}`).toBe(2);

    const tokenToFamily: Record<string, string> = {
      [TOKEN_VALUE_PARENT_A]: FAMILY_A,
      [TOKEN_VALUE_KID_A]: FAMILY_A,
      [TOKEN_VALUE_PARENT_B]: FAMILY_B,
    };
    for (const [msg] of calls) {
      const familiesInCall = new Set(msg.tokens.map((t) => tokenToFamily[t]));
      expect(
        familiesInCall.size,
        `F-T13 violation: a single multicast must contain tokens from EXACTLY ONE family; got tokens=${JSON.stringify(
          msg.tokens,
        )} which span families=${JSON.stringify(Array.from(familiesInCall))}`,
      ).toBe(1);
    }

    const bCall = calls.map(([m]) => m.tokens).find((t) => t.includes(TOKEN_VALUE_PARENT_B));
    expect(bCall, 'family B multicast must exist').toBeDefined();
    expect(bCall, 'family B multicast must NOT contain family A parent token').not.toContain(
      TOKEN_VALUE_PARENT_A,
    );
    expect(bCall, 'family B multicast must NOT contain family A kid token').not.toContain(
      TOKEN_VALUE_KID_A,
    );

    const aCall = calls.map(([m]) => m.tokens).find((t) => t.includes(TOKEN_VALUE_PARENT_A));
    expect(aCall, 'family A multicast must exist').toBeDefined();
    expect(aCall, 'family A multicast must NOT contain family B token').not.toContain(
      TOKEN_VALUE_PARENT_B,
    );
  });

  it('every scheduledSends marker.familyId equals the loop family (M47)', async () => {
    seedFamilyA();
    seedFamilyB();
    await invokeSweep();
    let inspected = 0;
    for (const [path, data] of docStore.entries()) {
      if (!path.startsWith('scheduledSends/')) continue;
      const d = data as { sourceId?: string; familyId?: string };
      if (d.sourceId === EVENT_A_ID) {
        inspected += 1;
        expect(
          d.familyId,
          `marker for ${EVENT_A_ID} must carry familyId=${FAMILY_A}; got ${d.familyId}`,
        ).toBe(FAMILY_A);
      }
      if (d.sourceId === EVENT_B_ID) {
        inspected += 1;
        expect(
          d.familyId,
          `marker for ${EVENT_B_ID} must carry familyId=${FAMILY_B}; got ${d.familyId}`,
        ).toBe(FAMILY_B);
      }
    }
    expect(
      inspected,
      'at least one scheduledSends marker per family must be inspected (none found)',
    ).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// F-T-EXTRA — happy-path body sanity + Vancouver off-hour skip.
// ===========================================================================

describe('F-T-EXTRA: happy path body & off-hour skip', () => {
  it('outbound FCM payload uses the eventReminder body constants (no template markers, no event PI)', async () => {
    seedFamilyA();
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    expect(typeof msg.notification.title).toBe('string');
    expect(typeof msg.notification.body).toBe('string');
    expect(msg.notification.title.length).toBeGreaterThan(0);
    expect(msg.notification.body.length).toBeGreaterThan(0);
    expect(msg.notification.title).not.toContain('${');
    expect(msg.notification.body).not.toContain('${');
    // The vague body never references the seeded event title/description.
    const lower = JSON.stringify(msg.notification).toLowerCase();
    expect(lower, 'event title must NEVER appear in the outbound FCM payload').not.toContain(
      'soccer',
    );
    expect(lower, 'event description must NEVER appear in the outbound FCM payload').not.toContain(
      'coach',
    );
  });

  it('Vancouver family (PT 05:00 at FIXED_NOW — not hour 8) does NOT receive a multicast', async () => {
    seedFamilyA();
    seedFamilyVancouverOffHour();
    await invokeSweep();
    expect(
      sendEachForMulticastMock.mock.calls.length,
      'Vancouver family is at hour 5 local (PT), not hour 8 — must not match',
    ).toBe(1);
  });
});
