/**
 * createManagedChild — unit contract (ADR-0003 Option C;
 * docs/specs/managed-child-accounts.md §5, §9).
 *
 * Boundaries mocked at firebase-functions/v2/https + firebase-admin/{app,
 * firestore,auth} + node:crypto so every branch is deterministic without an
 * emulator or network. The Admin-SDK Firestore mock here EXTENDS the notify-*
 * harness with `.where(...).get()` and `db.batch()`, which this callable uses.
 *
 * Pins: App Check literal (source scan); auth + parent-only + active guards;
 * rate limit; input validation; member cap; handle-uniqueness; the exact auth
 * user + users/userPrivate doc shapes on the happy path; loginCode reservation
 * on first child; orphan-auth-user compensation on batch failure; PI-free logs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXED_NOW = Date.UTC(2026, 6, 4, 12, 0, 0);
const CALLER_UID = 'uid-parent-a';
const FAMILY_ID = 'fam-A';
const SOURCE_PATH = resolve(__dirname, '../src/createManagedChild.ts');

// --- onCall capture ---------------------------------------------------------
interface Captured {
  options: Record<string, unknown> | undefined;
  handler: ((request: unknown) => unknown) | undefined;
}
const captured: Captured = { options: undefined, handler: undefined };
const onCallMock = vi.fn((options: unknown, handler: unknown) => {
  captured.options = options as Record<string, unknown>;
  captured.handler = handler as (request: unknown) => unknown;
  return { __trigger: 'https.onCall' };
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
  onCall: (o: unknown, h: unknown) => onCallMock(o, h),
  HttpsError: FakeHttpsError,
}));

const loggerInfoMock = vi.fn();
vi.mock('firebase-functions/logger', () => ({
  info: (...a: unknown[]) => loggerInfoMock(...a),
  warn: vi.fn(),
  error: vi.fn(),
}));

// --- Firestore Admin mock (docStore + where + batch + transaction) ----------
type DocStore = Map<string, Record<string, unknown>>;
let docStore: DocStore;

function snap(path: string) {
  const data = docStore.get(path);
  return { exists: data !== undefined, id: path.split('/').pop() ?? '', data: () => data };
}
function buildDocRef(path: string) {
  return {
    path,
    get: async () => snap(path),
    set: (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
      const prev = docStore.get(path);
      docStore.set(path, opts?.merge && prev ? { ...prev, ...data } : data);
    },
    delete: async () => {
      docStore.delete(path);
    },
  };
}
function collectionDocs(prefix: string) {
  const out: Array<{ id: string; data: () => Record<string, unknown> }> = [];
  for (const [path, data] of docStore.entries()) {
    if (path.startsWith(`${prefix}/`) && path.slice(prefix.length + 1).split('/').length === 1) {
      out.push({ id: path.split('/').pop() ?? '', data: () => data });
    }
  }
  return out;
}
function buildQuery(prefix: string, filters: Array<[string, unknown]>) {
  return {
    where: (field: string, _op: string, value: unknown) =>
      buildQuery(prefix, [...filters, [field, value]]),
    get: async () => {
      const docs = collectionDocs(prefix).filter((d) =>
        filters.every(([f, v]) => d.data()[f] === v),
      );
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}
function buildCollectionRef(path: string) {
  return {
    doc: (id: string) => buildDocRef(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) => buildQuery(path, [[field, value]]),
    get: async () => {
      const docs = collectionDocs(path);
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}
interface BatchOp {
  path: string;
  data: Record<string, unknown>;
}
let batchCommitShouldThrow = false;
const firestoreApp = {
  doc: (path: string) => buildDocRef(path),
  collection: (path: string) => buildCollectionRef(path),
  runTransaction: async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: { path: string }) => snap(ref.path),
      set: (ref: { path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
        buildDocRef(ref.path).set(data, opts),
    };
    return cb(tx);
  },
  batch: () => {
    const ops: BatchOp[] = [];
    return {
      set: (ref: { path: string }, data: Record<string, unknown>) =>
        ops.push({ path: ref.path, data }),
      commit: async () => {
        if (batchCommitShouldThrow) throw new Error('batch failed');
        for (const op of ops) docStore.set(op.path, op.data);
      },
    };
  },
};
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: () => [{ __app: true }],
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => firestoreApp }));

// --- Auth Admin mock --------------------------------------------------------
const createUserMock = vi.fn(async (_props: unknown) => ({ uid: 'uid-child' }));
const updateUserMock = vi.fn(async () => ({}));
const deleteUserMock = vi.fn(async () => undefined);
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    createUser: (p: unknown) => createUserMock(p),
    updateUser: (u: string, p: unknown) => updateUserMock(u, p),
    deleteUser: (u: string) => deleteUserMock(u),
  }),
}));

// --- crypto: deterministic loginCode ('aaaaaa') -----------------------------
vi.mock('node:crypto', () => ({ randomInt: () => 0 }));

// ---------------------------------------------------------------------------
async function loadHandler() {
  vi.resetModules();
  await import('../src/createManagedChild.js');
  if (!captured.handler) throw new Error('handler not captured');
  return captured.handler;
}
function req(data: unknown, uid: string | null = CALLER_UID) {
  return { auth: uid ? { uid } : null, data };
}
function seedParent(): void {
  docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: true, role: 'parent' });
  docStore.set(`families/${FAMILY_ID}`, { familyName: 'Fam', loginCode: 'otter4' });
}
const GOOD = { displayName: 'Maya', handle: 'maya', password: 'a-good-password' };

beforeEach(() => {
  docStore = new Map();
  batchCommitShouldThrow = false;
  vi.clearAllMocks();
  vi.setSystemTime(FIXED_NOW);
});

describe('createManagedChild — declaration', () => {
  it('sets the LITERAL enforceAppCheck: true in source (App Check, CI source-scan)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).toMatch(/enforceAppCheck:\s*true/);
  });
  it('registers in the northamerica-northeast1 region', async () => {
    await loadHandler();
    expect(captured.options?.region).toBe('northamerica-northeast1');
    expect(captured.options?.enforceAppCheck).toBe(true);
  });
});

describe('createManagedChild — auth & authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const h = await loadHandler();
    await expect(h(req(GOOD, null))).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('rejects a caller with no users doc (permission-denied)', async () => {
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('rejects a non-parent caller', async () => {
    docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: true, role: 'member' });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('rejects a deactivated parent', async () => {
    docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: false, role: 'parent' });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('createManagedChild — rate limit', () => {
  it('rejects when the window is already at the cap', async () => {
    seedParent();
    docStore.set(`rateLimits/createChild__${CALLER_UID}`, { count: 5, windowStartMs: FIXED_NOW });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe('createManagedChild — input validation', () => {
  it.each([
    ['empty name', { ...GOOD, displayName: '  ' }],
    ['bad handle (symbol)', { ...GOOD, handle: 'ma-ya' }],
    ['bad handle (too short)', { ...GOOD, handle: 'a' }],
    ['short password', { ...GOOD, password: 'short' }],
  ])('rejects %s with invalid-argument', async (_label, data) => {
    seedParent();
    const h = await loadHandler();
    await expect(h(req(data))).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe('createManagedChild — family constraints', () => {
  it('rejects when the family is at the member cap (failed-precondition)', async () => {
    seedParent();
    for (let i = 0; i < 12; i += 1) {
      docStore.set(`users/m${i}`, { familyId: FAMILY_ID, isActive: true, role: 'member' });
    }
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'failed-precondition' });
  });
  it('rejects a duplicate handle within the family (already-exists)', async () => {
    seedParent();
    docStore.set(`users/sibling`, {
      familyId: FAMILY_ID,
      isActive: true,
      role: 'member',
      loginHandle: 'maya',
    });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'already-exists' });
  });
});

describe('createManagedChild — happy path', () => {
  it('creates the auth user + docs and returns the sign-in coordinates', async () => {
    seedParent();
    const h = await loadHandler();
    const res = (await h(req(GOOD))) as { childUid: string; loginCode: string; handle: string };

    expect(res).toEqual({ childUid: 'uid-child', loginCode: 'otter4', handle: 'maya' });
    // Auth user: synthetic non-routable address, parent-set password, not verified.
    expect(createUserMock).toHaveBeenCalledWith({
      email: 'maya@otter4.familyhq.invalid',
      password: 'a-good-password',
      emailVerified: false,
      displayName: 'Maya',
    });
    // users doc: member + managed + loginHandle, zero balance, active.
    expect(docStore.get('users/uid-child')).toEqual({
      name: 'Maya',
      role: 'member',
      familyId: FAMILY_ID,
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
      accountType: 'managed',
      loginHandle: 'maya',
    });
    // userPrivate: exactly {email, familyId} (parity with the invite flow).
    expect(docStore.get('userPrivate/uid-child')).toEqual({
      email: 'maya@otter4.familyhq.invalid',
      familyId: FAMILY_ID,
    });
  });

  it('reserves a globally-unique loginCode + writes it on the first child', async () => {
    docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: true, role: 'parent' });
    docStore.set(`families/${FAMILY_ID}`, { familyName: 'Fam' }); // no loginCode yet
    const h = await loadHandler();
    const res = (await h(req(GOOD))) as { loginCode: string };
    expect(res.loginCode).toBe('aaaaaa'); // randomInt mocked to 0
    expect(docStore.get('familyLoginCodes/aaaaaa')).toEqual({ familyId: FAMILY_ID });
    expect(docStore.get(`families/${FAMILY_ID}`)).toMatchObject({ loginCode: 'aaaaaa' });
  });
});

describe('createManagedChild — failure compensation', () => {
  it('deletes the orphaned auth user if the doc batch fails, then throws internal', async () => {
    seedParent();
    batchCommitShouldThrow = true;
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'internal' });
    expect(deleteUserMock).toHaveBeenCalledWith('uid-child');
  });
});

describe('createManagedChild — log hygiene (PI-free)', () => {
  it('logs only the allow-listed fields — no handle, name, email, or password', async () => {
    seedParent();
    const h = await loadHandler();
    await h(req(GOOD));
    const payloads = loggerInfoMock.mock.calls.map((c) => JSON.stringify(c));
    for (const p of payloads) {
      expect(p).not.toMatch(/maya|Maya|a-good-password|familyhq\.invalid/);
    }
    // and it DID log the allow-listed shape
    const logged = loggerInfoMock.mock.calls.find((c) =>
      String(c[0]).includes('createManagedChild'),
    );
    expect(logged?.[1]).toMatchObject({
      kind: 'createChild',
      familyId: FAMILY_ID,
      actorUid: CALLER_UID,
    });
  });
  it('never logs the source of no console.* in the file', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).not.toMatch(/console\.(log|info|warn|error)/);
  });
});
