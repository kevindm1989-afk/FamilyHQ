/**
 * resetManagedChildPassword — unit contract (ADR-0003 Option C;
 * docs/specs/managed-child-accounts.md §5, §9).
 *
 * Pins: App Check literal + region; auth + parent-only + active guards; rate
 * limit; input validation; the target must be a MANAGED child in the caller's
 * family (cross-family / non-managed / missing all reject permission-denied);
 * the Admin-SDK updateUser call; PI-free logs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXED_NOW = Date.UTC(2026, 6, 4, 12, 0, 0);
const CALLER_UID = 'uid-parent-a';
const FAMILY_ID = 'fam-A';
const CHILD_UID = 'uid-child';
const SOURCE_PATH = resolve(__dirname, '../src/resetManagedChildPassword.ts');

interface Captured {
  options: Record<string, unknown> | undefined;
  handler: ((request: unknown) => unknown) | undefined;
}
const captured: Captured = { options: undefined, handler: undefined };
const onCallMock = vi.fn((options: unknown, handler: unknown) => {
  captured.options = options as Record<string, unknown>;
  captured.handler = handler as (request: unknown) => unknown;
  return {};
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
  };
}
const firestoreApp = {
  doc: (path: string) => buildDocRef(path),
  runTransaction: async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: async (ref: { path: string }) => snap(ref.path),
      set: (ref: { path: string }, data: Record<string, unknown>) =>
        buildDocRef(ref.path).set(data),
    };
    return cb(tx);
  },
};
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), getApps: () => [{ __app: true }] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => firestoreApp }));

const updateUserMock = vi.fn(async () => ({}));
let updateUserShouldThrow = false;
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    updateUser: async (u: string, p: unknown) => {
      if (updateUserShouldThrow) throw new Error('auth down');
      return updateUserMock(u, p);
    },
  }),
}));

async function loadHandler() {
  vi.resetModules();
  await import('../src/resetManagedChildPassword.js');
  if (!captured.handler) throw new Error('handler not captured');
  return captured.handler;
}
function req(data: unknown, uid: string | null = CALLER_UID) {
  return { auth: uid ? { uid } : null, data };
}
function seedParentAndChild(childOver: Record<string, unknown> = {}): void {
  docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: true, role: 'parent' });
  docStore.set(`users/${CHILD_UID}`, {
    familyId: FAMILY_ID,
    role: 'member',
    accountType: 'managed',
    ...childOver,
  });
}
const GOOD = { childUid: CHILD_UID, newPassword: 'a-good-password' };

beforeEach(() => {
  docStore = new Map();
  updateUserShouldThrow = false;
  vi.clearAllMocks();
  vi.setSystemTime(FIXED_NOW);
});

describe('resetManagedChildPassword — declaration', () => {
  it('sets the LITERAL enforceAppCheck: true (App Check, CI source-scan)', () => {
    expect(readFileSync(SOURCE_PATH, 'utf8')).toMatch(/enforceAppCheck:\s*true/);
  });
  it('registers in the northamerica-northeast1 region', async () => {
    await loadHandler();
    expect(captured.options?.region).toBe('northamerica-northeast1');
    expect(captured.options?.enforceAppCheck).toBe(true);
  });
});

describe('resetManagedChildPassword — auth & authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const h = await loadHandler();
    await expect(h(req(GOOD, null))).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('rejects a non-parent caller', async () => {
    docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: true, role: 'member' });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('resetManagedChildPassword — rate limit', () => {
  it('rejects when the window is at the cap', async () => {
    seedParentAndChild();
    docStore.set(`rateLimits/resetChildPw__${CALLER_UID}`, { count: 10, windowStartMs: FIXED_NOW });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(updateUserMock).not.toHaveBeenCalled();
  });
});

describe('resetManagedChildPassword — input validation', () => {
  it('rejects an empty childUid', async () => {
    seedParentAndChild();
    const h = await loadHandler();
    await expect(h(req({ childUid: '', newPassword: 'a-good-password' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
  it('rejects a short password', async () => {
    seedParentAndChild();
    const h = await loadHandler();
    await expect(h(req({ childUid: CHILD_UID, newPassword: 'short' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('resetManagedChildPassword — target guards', () => {
  it('rejects a missing target', async () => {
    docStore.set(`users/${CALLER_UID}`, { familyId: FAMILY_ID, isActive: true, role: 'parent' });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('rejects a cross-family target', async () => {
    seedParentAndChild({ familyId: 'fam-B' });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('rejects a non-managed target (a standard member / co-parent)', async () => {
    seedParentAndChild({ accountType: 'standard' });
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('resetManagedChildPassword — happy path + failure + logs', () => {
  it('resets the password via the Admin SDK and returns ok', async () => {
    seedParentAndChild();
    const h = await loadHandler();
    const res = await h(req(GOOD));
    expect(res).toEqual({ ok: true });
    expect(updateUserMock).toHaveBeenCalledWith(CHILD_UID, { password: 'a-good-password' });
  });
  it('maps an Admin-SDK failure to internal', async () => {
    seedParentAndChild();
    updateUserShouldThrow = true;
    const h = await loadHandler();
    await expect(h(req(GOOD))).rejects.toMatchObject({ code: 'internal' });
  });
  it('logs only allow-listed PI-free fields', async () => {
    seedParentAndChild();
    const h = await loadHandler();
    await h(req(GOOD));
    const payloads = loggerInfoMock.mock.calls.map((c) => JSON.stringify(c));
    for (const p of payloads) expect(p).not.toMatch(/a-good-password/);
    const logged = loggerInfoMock.mock.calls.find((c) =>
      String(c[0]).includes('resetManagedChildPassword'),
    );
    expect(logged?.[1]).toMatchObject({
      kind: 'resetChildPw',
      familyId: FAMILY_ID,
      actorUid: CALLER_UID,
    });
  });
});
