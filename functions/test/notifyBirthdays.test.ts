/**
 * notifyBirthdays — unit contract (PR F8, onSchedule v2).
 *
 * Mirror of notifyEventReminders.test.ts. The same M46/M47/M48/M49/M50/M51
 * structural contract applies (F-T1..F-T13 analogs); plus two
 * birthday-specific assertions:
 *   - F-T14 anniversary path: a `birthdays/{id}.type === 'anniversary'`
 *     doc fires under the same sweep using the `anniversaryToday` body.
 *   - F-T15 Feb-29 policy: a `monthDay === '02-29'` doc is matched by a
 *     Feb-28 sweep in a non-leap year; marker id uses the actual sweep
 *     yyyymmdd so leap-year Feb 28 + Feb 29 don't double-fire.
 *
 * MUST FAIL today: functions/src/notifyBirthdays.ts does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXED_NOW = Date.UTC(2026, 5, 11, 12, 0, 0); // 8am EDT America/Toronto
const LOCAL_DAY_TORONTO = '2026-06-11';
const MONTH_DAY_TODAY = '06-11';
const REGION = 'northamerica-northeast1';
const CATEGORY_KEY = 'birthdays';

const FAMILY_A = 'fam-A';
const FAMILY_B = 'fam-B';
const PARENT_A_UID = 'uid-parent-a';
const KID_A_UID = 'uid-kid-a';
const PARENT_B_UID = 'uid-parent-b';

const BIRTHDAY_A_ID = 'bd-A-1';
const ANNIVERSARY_A_ID = 'anv-A-1';
const BIRTHDAY_B_ID = 'bd-B-1';

const TOKEN_HASH_PARENT_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_HASH_KID_A = 'cccccccccccccccccccccccc';
const TOKEN_HASH_PARENT_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN_VALUE_PARENT_A = 'fcm-token-parent-a';
const TOKEN_VALUE_KID_A = 'fcm-token-kid-a';
const TOKEN_VALUE_PARENT_B = 'fcm-token-parent-b';

const SOURCE_PATH = resolve(__dirname, '../src/notifyBirthdays.ts');
const BARREL_PATH = resolve(__dirname, '../src/index.ts');

// ---------------------------------------------------------------------------
// Mocks
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
// Firestore mock (where-aware + orderBy + limit) — same shape as the
// event-reminders test.
// ---------------------------------------------------------------------------
type DocSnap = { exists: boolean; data: Record<string, unknown> | undefined; id: string };
type DocStore = Map<string, Record<string, unknown> | undefined>;
let docStore: DocStore;
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
    (err as Error & { code: number | string }).code = 6;
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
  // Today's birthday for family A — name carries child PI ("Grandma Helen"
  // is the design's example; we use a deliberately distinctive synthetic
  // name so the no-leak assertion is unambiguous).
  docStore.set(`birthdays/${BIRTHDAY_A_ID}`, {
    name: 'Helen-Grandma-XYZZY',
    monthDay: MONTH_DAY_TODAY,
    type: 'birthday',
    birthYear: 1945,
    familyId: FAMILY_A,
    createdBy: PARENT_A_UID,
    createdAt: FIXED_NOW - 86_400_000,
  });
}

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
  docStore.set(`birthdays/${BIRTHDAY_B_ID}`, {
    name: 'B-Person',
    monthDay: MONTH_DAY_TODAY,
    type: 'birthday',
    familyId: FAMILY_B,
    createdBy: PARENT_B_UID,
    createdAt: FIXED_NOW - 86_400_000,
  });
}

async function loadModule(): Promise<Record<string, unknown>> {
  captured.options = undefined;
  captured.handler = undefined;
  vi.resetModules();
  return (await import('../src/notifyBirthdays.js')) as Record<string, unknown>;
}

async function invokeSweep(event: unknown = undefined): Promise<unknown> {
  if (!existsSync(SOURCE_PATH)) {
    throw new Error(
      `notifyBirthdays.ts is missing at ${SOURCE_PATH} — implementer must create per PR F task F8`,
    );
  }
  await loadModule();
  if (typeof captured.handler !== 'function') {
    throw new Error('notifyBirthdays did not register an onSchedule handler at import time');
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
// F-T0 — preconditions.
// ===========================================================================

describe('F-T0 (birthdays): preconditions — source + barrel', () => {
  it('source file exists (implementer must create — PR F task F8)', () => {
    expect(
      existsSync(SOURCE_PATH),
      `notifyBirthdays.ts is missing at ${SOURCE_PATH} — implementer must create per PR F task F8`,
    ).toBe(true);
  });

  it('barrel re-exports `notifyBirthdays`', () => {
    expect(existsSync(BARREL_PATH)).toBe(true);
    const barrel = readFileSync(BARREL_PATH, 'utf8');
    expect(
      /export\s*\{[^}]*\bnotifyBirthdays\b[^}]*\}\s*from\s*['"]\.\/notifyBirthdays/.test(barrel),
      'functions/src/index.ts must re-export notifyBirthdays',
    ).toBe(true);
  });
});

// ===========================================================================
// F-T1 (M46(a)) — payload-ignoring contract.
// ===========================================================================

describe('F-T1 (birthdays, M46(a)): handler IGNORES the event payload', () => {
  it('runtime: throwing Proxy as event → handler completes without reading any property', async () => {
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
    expect(threw).toBeUndefined();
  });

  it('AST: handler body does NOT reference the `event` identifier', () => {
    if (!existsSync(SOURCE_PATH)) {
      throw new Error(
        `notifyBirthdays.ts missing at ${SOURCE_PATH} — implementer must create per PR F task F8`,
      );
    }
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const sf = ts.createSourceFile(SOURCE_PATH, src, ts.ScriptTarget.ES2022, true);
    const hits: Array<{ line: number; text: string }> = [];

    function checkBody(body: ts.Node): void {
      function walk(node: ts.Node): void {
        if (ts.isIdentifier(node) && node.text === 'event') {
          const parent = node.parent;
          if (
            !(parent && ts.isPropertyAssignment(parent) && parent.name === node) &&
            !(parent && ts.isPropertyAccessExpression(parent) && parent.name === node)
          ) {
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
        `F-T1 (M46(a)) violation: handler body references the \`event\` identifier:\n${report}`,
      );
    }
    expect(hits).toEqual([]);
  });
});

// ===========================================================================
// F-T2 (M46(b)) — never-throw + per-family try/catch.
// ===========================================================================

describe('F-T2 (birthdays, M46(b)): one family throws → handler resolves; other families still process', () => {
  it('first per-family birthdays read throws → other families still process; handler does not reject', async () => {
    seedFamilyA();
    seedFamilyB();
    const FAMILY_C = 'fam-C';
    const PARENT_C_UID = 'uid-parent-c';
    const TOKEN_HASH_C = 'dddddddddddddddddddddddd';
    const TOKEN_VALUE_C = 'fcm-token-parent-c';
    const BIRTHDAY_C_ID = 'bd-C-1';
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
    docStore.set(`birthdays/${BIRTHDAY_C_ID}`, {
      name: 'C-Person',
      monthDay: MONTH_DAY_TODAY,
      type: 'birthday',
      familyId: FAMILY_C,
      createdBy: PARENT_C_UID,
      createdAt: FIXED_NOW - 86_400_000,
    });

    let birthdaysCalls = 0;
    const realImpl = collectionListMock.getMockImplementation();
    collectionListMock.mockImplementation(
      async (
        prefix: string,
        whereClauses?: QueryClause[],
        orderBys?: QueryOrder[],
        limitN?: number,
      ) => {
        if (prefix === 'birthdays') {
          birthdaysCalls += 1;
          if (birthdaysCalls === 1) {
            throw new Error('forced: first family birthdays read fails');
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
    const totalSends = sendEachForMulticastMock.mock.calls.length;
    expect(
      totalSends,
      `expected ≥2 multicasts (surviving families after one throws); got ${totalSends}`,
    ).toBeGreaterThanOrEqual(2);
    expect(loggerWarnMock).toHaveBeenCalled();
  });
});

// ===========================================================================
// F-T3 (M46(c)) — retry disabled + region + cron.
// ===========================================================================

describe('F-T3 (birthdays, M46(c)): onSchedule options declare retry disabled', () => {
  it('options include retryCount: 0 (or tolerant equivalent — flat or nested)', async () => {
    // firebase-functions v2 ScheduleOptions uses flat `retryCount` (see
    // notifyEventReminders.test.ts F-T3 for the SDK-type reference).
    // Accept the nested shapes too as a defense against future SDK
    // renames — the SAFETY contract M46(c) is "retry is disabled", not a
    // specific field name.
    await invokeSweep().catch(() => undefined);
    expect(onScheduleMock).toHaveBeenCalledTimes(1);
    const opts = (captured.options ?? {}) as Record<string, unknown>;
    const flatRetryCount = opts.retryCount;
    const nested = opts.retryConfig as { retryCount?: unknown; maxRetries?: unknown } | undefined;
    const ok = flatRetryCount === 0 || nested?.retryCount === 0 || nested?.maxRetries === 0;
    expect(
      ok,
      `F-T3 violation: onSchedule options must declare retry disabled — flat retryCount === 0 OR retryConfig.retryCount === 0 OR retryConfig.maxRetries === 0; got retryCount=${JSON.stringify(opts.retryCount)} retryConfig=${JSON.stringify(opts.retryConfig)}`,
    ).toBe(true);
  });

  it('pins region + schedule + timeZone', async () => {
    await invokeSweep().catch(() => undefined);
    const opts = (captured.options ?? {}) as Record<string, unknown>;
    expect(opts.region).toBe(REGION);
    expect(opts.schedule).toBe('0 * * * *');
    expect(opts.timeZone ?? opts.timezone).toBe('UTC');
  });
});

// ===========================================================================
// F-T4 (M47) — BLOCKING. Cross-family isolation in a single invocation.
// ===========================================================================

describe('F-T4 (birthdays, M47) [BLOCKING]: per-family token isolation', () => {
  it("exactly ONE multicast per family; each contains ONLY that family's tokens", async () => {
    seedFamilyA();
    seedFamilyB();
    await invokeSweep();

    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(2);
    const calls = sendEachForMulticastMock.mock.calls as Array<[{ tokens: string[] }]>;
    const aCall = calls.map(([m]) => m.tokens).find((t) => t.includes(TOKEN_VALUE_PARENT_A));
    const bCall = calls.map(([m]) => m.tokens).find((t) => t.includes(TOKEN_VALUE_PARENT_B));
    expect(aCall, 'family A multicast must exist').toBeDefined();
    expect(bCall, 'family B multicast must exist').toBeDefined();
    expect(new Set(aCall ?? [])).toEqual(new Set([TOKEN_VALUE_PARENT_A, TOKEN_VALUE_KID_A]));
    expect(new Set(bCall ?? [])).toEqual(new Set([TOKEN_VALUE_PARENT_B]));
    expect(aCall, 'A multicast must NOT contain B token').not.toContain(TOKEN_VALUE_PARENT_B);
    expect(bCall, 'B multicast must NOT contain A tokens').not.toContain(TOKEN_VALUE_PARENT_A);
  });
});

// ===========================================================================
// F-T5 (M47) — per-recipient skip + structured warn.
// ===========================================================================

describe('F-T5 (birthdays, M47): cross-tenant recipient SKIPPED + warned (allow-listed fields only)', () => {
  it('corrupt recipient with foreign userPrivate.familyId is not multicast to', async () => {
    seedFamilyA();
    docStore.set(`userPrivate/${KID_A_UID}`, {
      familyId: FAMILY_B,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(msg.tokens).toEqual([TOKEN_VALUE_PARENT_A]);
  });

  it('warn payload does NOT contain recipientUid or foreign familyId', async () => {
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
    const serialized = JSON.stringify(loggerWarnMock.mock.calls);
    expect(serialized).not.toContain(KID_A_UID);
    expect(serialized).not.toContain(FAMILY_B);
  });
});

// ===========================================================================
// F-T6 (M48) — marker dedupe + create-BEFORE-send.
// ===========================================================================

describe('F-T6 (birthdays, M48): marker create() BEFORE send; marker present → no send', () => {
  it('marker create precedes send (call-order assertion)', async () => {
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
      (s) => s.startsWith('create:scheduledSends/') && s.includes(BIRTHDAY_A_ID),
    );
    const sendIdx = callOrder.indexOf('send');
    expect(
      createIdx,
      `marker create must fire; got ${JSON.stringify(callOrder)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(sendIdx, 'send must fire').toBeGreaterThanOrEqual(0);
    expect(
      createIdx,
      `marker create must precede send; got create=${createIdx}, send=${sendIdx}`,
    ).toBeLessThan(sendIdx);
  });

  it('marker present: no send', async () => {
    seedFamilyA();
    const yyyymmdd = LOCAL_DAY_TORONTO.replace(/-/g, '');
    // Try both 'birthday' and 'birthdayToday' kind-stem possibilities — pin
    // the most common path (the design uses `kind: 'birthday'` for the
    // marker id stem; the body constant key is `birthdayToday`).
    const markerPath = `scheduledSends/birthday__${BIRTHDAY_A_ID}__${yyyymmdd}`;
    docStore.set(markerPath, {
      kind: 'birthday',
      familyId: FAMILY_A,
      sourceId: BIRTHDAY_A_ID,
      localDay: LOCAL_DAY_TORONTO,
      sentAt: FIXED_NOW - 60_000,
      recipientCount: 2,
      expiresAt: FIXED_NOW + 7 * 24 * 60 * 60 * 1000,
    });
    await invokeSweep();
    expect(
      sendEachForMulticastMock,
      `send must NOT fire when marker exists at ${markerPath}`,
    ).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// F-T7 (M48) — at-most-once.
// ===========================================================================

describe('F-T7 (birthdays, M48): marker created, FCM send throws → marker remains, no replay', () => {
  it('second invocation (after first send-throw) does NOT send again', async () => {
    seedFamilyA();
    let sendCalls = 0;
    sendEachForMulticastMock = vi.fn(async (msg: { tokens: string[] }) => {
      sendCalls += 1;
      if (sendCalls === 1) throw new Error('FCM unavailable');
      return {
        successCount: msg.tokens.length,
        failureCount: 0,
        responses: msg.tokens.map(() => ({ success: true })),
      };
    });
    await invokeSweep();
    await invokeSweep();
    expect(
      sendCalls,
      `second invocation must NOT replay; got ${sendCalls} send calls (expected 1)`,
    ).toBe(1);
  });
});

// ===========================================================================
// F-T9 (M49) — fan-out cap.
// ===========================================================================

describe('F-T9 (birthdays, M49): 11 birthdays in one family per day → 10 markers + 10 sends + 1 dropped warn', () => {
  it('cap enforced: 10 markers landed (createdAt asc), 1 dropped, 1 structured warn', async () => {
    seedFamilyA();
    docStore.delete(`birthdays/${BIRTHDAY_A_ID}`);
    for (let i = 0; i < 11; i += 1) {
      docStore.set(`birthdays/bd-A-${i}`, {
        name: `P${i}`,
        monthDay: MONTH_DAY_TODAY,
        type: 'birthday',
        familyId: FAMILY_A,
        createdBy: PARENT_A_UID,
        createdAt: FIXED_NOW - 86_400_000 + i, // ordering anchor
      });
    }

    await invokeSweep();

    const markerPaths = Array.from(docStore.keys()).filter(
      (p) => p.startsWith('scheduledSends/') && /__bd-A-\d+__/.test(p),
    );
    expect(
      markerPaths.length,
      `expected exactly 10 markers; got ${markerPaths.length}: ${JSON.stringify(markerPaths)}`,
    ).toBe(10);

    const droppedMarker = markerPaths.find((p) => p.includes('__bd-A-10__'));
    expect(
      droppedMarker,
      'bd-A-10 (latest createdAt) must NOT have a marker (cap takes earliest 10)',
    ).toBeUndefined();

    const overflowWarn = loggerWarnMock.mock.calls.find((call) => {
      const payload = call[1] as Record<string, unknown> | undefined;
      return payload && payload.droppedCount === 1 && payload.familyId === FAMILY_A;
    });
    expect(
      overflowWarn,
      `expected one warn {familyId:"${FAMILY_A}", droppedCount:1}; got ${JSON.stringify(loggerWarnMock.mock.calls)}`,
    ).toBeDefined();

    expect(sendEachForMulticastMock.mock.calls.length).toBe(10);
  });
});

// ===========================================================================
// F-T10 (M50) — timezone fallback + log containment.
// ===========================================================================

describe('F-T10 (birthdays, M50): timezone fallback + forbidden log fields', () => {
  it('missing timezone → fallback used; family still matches hour 8', async () => {
    seedFamilyA();
    docStore.set(`families/${FAMILY_A}`, {
      familyName: 'Fam A',
      createdBy: PARENT_A_UID,
      createdAt: FIXED_NOW - 1_000_000,
    });
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
  });

  it('AST: no logger.* payload key is `timezone` or `localDay`', () => {
    if (!existsSync(SOURCE_PATH)) {
      throw new Error(
        `notifyBirthdays.ts missing at ${SOURCE_PATH} — implementer must create per PR F task F8`,
      );
    }
    const src = readFileSync(SOURCE_PATH, 'utf8');
    const sf = ts.createSourceFile(SOURCE_PATH, src, ts.ScriptTarget.ES2022, true);
    const hits: Array<{ line: number; key: string }> = [];

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
      throw new Error(`F-T10 (M50) violation: forbidden log field(s):\n${report}`);
    }
    expect(hits).toEqual([]);
  });
});

// ===========================================================================
// F-T12 (M51) — fire-time recipient evaluation.
// ===========================================================================

describe('F-T12 (birthdays, M51): isActive=false / prefs-off at sweep time → no send for that recipient', () => {
  it('deactivated recipient skipped', async () => {
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
    expect(msg.tokens).not.toContain(TOKEN_VALUE_KID_A);
  });

  it('category off → recipient skipped', async () => {
    seedFamilyA();
    docStore.set(`userPrivate/${KID_A_UID}`, {
      familyId: FAMILY_A,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: false },
      },
    });
    await invokeSweep();
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [{ tokens: string[] }];
    expect(msg.tokens).not.toContain(TOKEN_VALUE_KID_A);
  });
});

// ===========================================================================
// F-T13 (M51/M47) — BLOCKING cross-product per-kind.
// ===========================================================================

describe('F-T13 (birthdays, M51/M47) [BLOCKING]: family-B birthday NEVER reaches family-A recipients', () => {
  it('every multicast contains tokens from exactly one family', async () => {
    seedFamilyA();
    seedFamilyB();
    await invokeSweep();

    const calls = sendEachForMulticastMock.mock.calls as Array<[{ tokens: string[] }]>;
    expect(calls.length).toBe(2);

    const tokenToFamily: Record<string, string> = {
      [TOKEN_VALUE_PARENT_A]: FAMILY_A,
      [TOKEN_VALUE_KID_A]: FAMILY_A,
      [TOKEN_VALUE_PARENT_B]: FAMILY_B,
    };
    for (const [msg] of calls) {
      const familiesInCall = new Set(msg.tokens.map((t) => tokenToFamily[t]));
      expect(
        familiesInCall.size,
        `F-T13 violation: multicast spans families ${JSON.stringify(Array.from(familiesInCall))}; tokens=${JSON.stringify(msg.tokens)}`,
      ).toBe(1);
    }
  });
});

// ===========================================================================
// F-T14 (M52) — anniversary path: anniversaryToday body used for type='anniversary'.
// ===========================================================================

describe('F-T14 (M52): anniversary fixture fires under same sweep with anniversaryToday body', () => {
  it('a birthdays/{id}.type==="anniversary" doc is matched + notified', async () => {
    seedFamilyA();
    // Replace the seeded birthday with an anniversary.
    docStore.delete(`birthdays/${BIRTHDAY_A_ID}`);
    docStore.set(`birthdays/${ANNIVERSARY_A_ID}`, {
      name: 'Wedding-XYZZY',
      monthDay: MONTH_DAY_TODAY,
      type: 'anniversary',
      familyId: FAMILY_A,
      createdBy: PARENT_A_UID,
      createdAt: FIXED_NOW - 86_400_000,
    });

    await invokeSweep();

    expect(
      sendEachForMulticastMock,
      'anniversary fixture must trigger a multicast under the same sweep',
    ).toHaveBeenCalledTimes(1);

    const [msg] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    // Resolve the anniversaryToday body constant and assert verbatim match.
    let constants: Record<string, { title: string; body: string }> | undefined;
    try {
      const mod = (await import('../src/notificationBodies.js')) as {
        anniversaryToday?: { title: string; body: string };
        NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      };
      const entry = mod.anniversaryToday ?? mod.NOTIFICATION_BODIES?.['anniversaryToday'];
      if (entry) constants = { anniversaryToday: entry };
    } catch {
      /* fall through — body assertion below catches it */
    }
    const expectedBody = constants?.['anniversaryToday'];
    expect(
      expectedBody,
      'anniversaryToday entry must be exported from functions/src/notificationBodies.ts (F5)',
    ).toBeDefined();
    if (expectedBody) {
      expect(
        msg.notification.title,
        `anniversary notification title must match anniversaryToday constant; got "${msg.notification.title}"`,
      ).toBe(expectedBody.title);
      expect(
        msg.notification.body,
        `anniversary notification body must match anniversaryToday constant; got "${msg.notification.body}"`,
      ).toBe(expectedBody.body);
    }

    // Privacy: the anniversary name must never appear in the outbound payload.
    const serialized = JSON.stringify(msg.notification).toLowerCase();
    expect(serialized, 'anniversary name must NEVER appear in the FCM payload (M52)').not.toContain(
      'xyzzy',
    );
  });

  it('a birthday-type fixture uses the birthdayToday body (not anniversaryToday)', async () => {
    seedFamilyA();
    await invokeSweep();
    expect(sendEachForMulticastMock).toHaveBeenCalledTimes(1);
    const [msg] = sendEachForMulticastMock.mock.calls[0] as [
      { notification: { title: string; body: string } },
    ];
    let constants: Record<string, { title: string; body: string }> | undefined;
    try {
      const mod = (await import('../src/notificationBodies.js')) as {
        birthdayToday?: { title: string; body: string };
        anniversaryToday?: { title: string; body: string };
        NOTIFICATION_BODIES?: Record<string, { title: string; body: string }>;
      };
      const bdEntry = mod.birthdayToday ?? mod.NOTIFICATION_BODIES?.['birthdayToday'];
      const anvEntry = mod.anniversaryToday ?? mod.NOTIFICATION_BODIES?.['anniversaryToday'];
      if (bdEntry && anvEntry) constants = { birthdayToday: bdEntry, anniversaryToday: anvEntry };
    } catch {
      /* fall through */
    }
    expect(
      constants?.['birthdayToday'],
      'birthdayToday entry must be exported from notificationBodies.ts (F5)',
    ).toBeDefined();
    if (constants) {
      expect(msg.notification.title).toBe(constants['birthdayToday']!.title);
      expect(msg.notification.body).toBe(constants['birthdayToday']!.body);
      // It must NOT be the anniversary body.
      expect(msg.notification.title, 'birthday push must NOT use anniversaryToday body').not.toBe(
        constants['anniversaryToday']!.title,
      );
    }
    // Privacy: the birthday name "Helen-Grandma-XYZZY" must never appear.
    const serialized = JSON.stringify(msg.notification).toLowerCase();
    expect(
      serialized,
      'birthday name must NEVER appear in the FCM payload (M34/M52)',
    ).not.toContain('xyzzy');
    expect(serialized).not.toContain('helen');
  });
});

// ===========================================================================
// F-T15 (M52 / Feb-29) — leap-day policy.
// ===========================================================================

describe('F-T15: Feb-29 birthday matched by Feb-28 sweep in NON-leap year', () => {
  it('marker id uses the actual sweep yyyymmdd (no Feb 29 marker generated in a non-leap year)', async () => {
    // 2026 is a non-leap year. Set the clock to 8am EDT on Feb 28, 2026.
    // Feb 28 in EST (UTC-5): UTC 13:00 = 08:00 EST.
    const FEB_28_2026_8AM_EST = Date.UTC(2026, 1, 28, 13, 0, 0);
    vi.setSystemTime(FEB_28_2026_8AM_EST);

    // Seed family A with the right timezone and a Feb-29 birthday fixture.
    docStore.set(`families/${FAMILY_A}`, {
      familyName: 'Fam A',
      createdBy: PARENT_A_UID,
      createdAt: FEB_28_2026_8AM_EST - 1_000_000,
      timezone: 'America/Toronto',
    });
    docStore.set(`users/${PARENT_A_UID}`, {
      familyId: FAMILY_A,
      isActive: true,
      role: 'parent',
      name: 'P-A',
    });
    docStore.set(`userPrivate/${PARENT_A_UID}`, {
      familyId: FAMILY_A,
      notificationPreferences: {
        pushEnabled: true,
        categories: { [CATEGORY_KEY]: true },
      },
    });
    docStore.set(`userPrivate/${PARENT_A_UID}/fcmTokens/${TOKEN_HASH_PARENT_A}`, {
      token: TOKEN_VALUE_PARENT_A,
      userAgent: 'Chrome',
      createdAt: FEB_28_2026_8AM_EST - 60_000,
      lastSeenAt: FEB_28_2026_8AM_EST - 60_000,
    });
    const FEB29_BD_ID = 'bd-leap-1';
    docStore.set(`birthdays/${FEB29_BD_ID}`, {
      name: 'LeapDayPerson',
      monthDay: '02-29',
      type: 'birthday',
      familyId: FAMILY_A,
      createdBy: PARENT_A_UID,
      createdAt: FEB_28_2026_8AM_EST - 86_400_000,
    });

    await invokeSweep();

    // The Feb-29 person must have been matched (the sweep day in a non-leap
    // year folds Feb 29 onto Feb 28). The send must have fired.
    expect(
      sendEachForMulticastMock,
      'Feb-29 birthday must be matched by the Feb-28 sweep in a non-leap year',
    ).toHaveBeenCalledTimes(1);

    // The marker id must use the SWEEP yyyymmdd (20260228), not 20260229.
    const markerPaths = Array.from(docStore.keys()).filter(
      (p) => p.startsWith('scheduledSends/') && p.includes(FEB29_BD_ID),
    );
    expect(
      markerPaths.length,
      `expected one marker for ${FEB29_BD_ID}; got ${JSON.stringify(markerPaths)}`,
    ).toBe(1);
    const m = markerPaths[0] ?? '';
    expect(
      m.endsWith('__20260228'),
      `marker id must end with the SWEEP day 20260228 (not 20260229); got ${m}`,
    ).toBe(true);
    expect(
      m.endsWith('__20260229'),
      `marker id must NOT use the Feb 29 yyyymmdd (would double-fire in leap years); got ${m}`,
    ).toBe(false);
  });
});
