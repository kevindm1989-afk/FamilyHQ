/**
 * managedChildService + managedChildFeatureFlag — unit contract
 * (docs/specs/managed-child-accounts.md §5, §7).
 *
 * Boundaries mocked at `firebase/functions` so every branch is deterministic
 * without a real Functions backend. Pins: the synthetic-email composition
 * (which MUST match the server's `composeChildEmail`), client-side input
 * validation short-circuits (no callable call on bad input), the happy-path
 * callable name + normalised payload, and the user-safe error mapping (server
 * codes → PI-free copy).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- firebase/functions mock ------------------------------------------------
interface CallableCall {
  name: string;
  payload: unknown;
}
let callableCalls: CallableCall[];
// The function returned by httpsCallable(fns, name). Each test sets its
// behaviour via `nextResult` / `nextError`.
let nextResult: unknown;
let nextError: unknown;

const httpsCallableMock = vi.fn((_fns: unknown, name: string) => {
  return async (payload: unknown) => {
    callableCalls.push({ name, payload });
    if (nextError !== undefined) throw nextError;
    return { data: nextResult };
  };
});

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({ __fns: true })),
  httpsCallable: (fns: unknown, name: string) => httpsCallableMock(fns, name),
}));

import {
  composeChildLoginEmail,
  createManagedChild,
  resetManagedChildPassword,
  ManagedChildActionError,
  CHILD_LOGIN_EMAIL_DOMAIN,
} from './managedChildService';
import { isManagedChildEnabled } from './managedChildFeatureFlag';

beforeEach(() => {
  callableCalls = [];
  nextResult = undefined;
  nextError = undefined;
  httpsCallableMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('composeChildLoginEmail', () => {
  it('composes handle@code.familyhq.invalid', () => {
    expect(composeChildLoginEmail('otter42', 'maya')).toBe('maya@otter42.familyhq.invalid');
  });

  it('normalises case + whitespace so a child can type loosely', () => {
    expect(composeChildLoginEmail('  OTTER42 ', ' Maya ')).toBe('maya@otter42.familyhq.invalid');
  });

  it('uses the RFC 2606 reserved .invalid TLD (never routable)', () => {
    expect(CHILD_LOGIN_EMAIL_DOMAIN).toBe('familyhq.invalid');
    expect(composeChildLoginEmail('c', 'h').endsWith('.familyhq.invalid')).toBe(true);
  });
});

describe('createManagedChild — client-side validation short-circuits', () => {
  it('rejects an empty name WITHOUT calling the callable', async () => {
    await expect(
      createManagedChild({ displayName: '  ', handle: 'maya', password: 'longenough' }),
    ).rejects.toBeInstanceOf(ManagedChildActionError);
    expect(callableCalls).toHaveLength(0);
  });

  it('rejects a bad handle (symbols / too short / too long) without a callable call', async () => {
    // NB: case is normalised before validation, so 'MAYA' is ACCEPTED as 'maya'
    // (see the happy-path test). Only genuinely-invalid handles reject here.
    for (const handle of ['a', 'ma-ya', 'ma_ya', 'thishandleiswaytoolongtobevalid']) {
      await expect(
        createManagedChild({ displayName: 'Maya', handle, password: 'longenough' }),
      ).rejects.toBeInstanceOf(ManagedChildActionError);
    }
    expect(callableCalls).toHaveLength(0);
  });

  it('rejects a short password without a callable call', async () => {
    await expect(
      createManagedChild({ displayName: 'Maya', handle: 'maya', password: 'short' }),
    ).rejects.toBeInstanceOf(ManagedChildActionError);
    expect(callableCalls).toHaveLength(0);
  });
});

describe('createManagedChild — happy path', () => {
  it('calls the createManagedChild callable with a normalised handle and returns its data', async () => {
    nextResult = { childUid: 'uid-child', loginCode: 'otter42', handle: 'maya' };
    const res = await createManagedChild({
      displayName: '  Maya  ',
      handle: '  MAYA ',
      password: 'a-good-password',
    });
    expect(res).toEqual({ childUid: 'uid-child', loginCode: 'otter42', handle: 'maya' });
    expect(callableCalls).toEqual([
      { name: 'createManagedChild', payload: { displayName: 'Maya', handle: 'maya', password: 'a-good-password' } },
    ]);
  });
});

describe('createManagedChild — server error mapping (PI-free)', () => {
  it('surfaces the server message for already-exists (username taken)', async () => {
    nextError = { code: 'functions/already-exists', message: 'That username is already taken in your family.' };
    await expect(
      createManagedChild({ displayName: 'Maya', handle: 'maya', password: 'a-good-password' }),
    ).rejects.toThrow('That username is already taken in your family.');
  });

  it('maps resource-exhausted to a friendly rate-limit line', async () => {
    nextError = { code: 'functions/resource-exhausted', message: 'Too many requests. Try again shortly.' };
    await expect(
      createManagedChild({ displayName: 'Maya', handle: 'maya', password: 'a-good-password' }),
    ).rejects.toThrow(/wait a minute/i);
  });

  it('collapses permission-denied to a generic message (no server detail leaked)', async () => {
    nextError = { code: 'functions/permission-denied', message: 'Not permitted.' };
    await expect(
      createManagedChild({ displayName: 'Maya', handle: 'maya', password: 'a-good-password' }),
    ).rejects.toThrow(/something went wrong/i);
  });
});

describe('resetManagedChildPassword', () => {
  it('rejects a short password before any callable call', async () => {
    await expect(
      resetManagedChildPassword({ childUid: 'uid-child', newPassword: 'short' }),
    ).rejects.toBeInstanceOf(ManagedChildActionError);
    expect(callableCalls).toHaveLength(0);
  });

  it('invokes the resetManagedChildPassword callable on the happy path', async () => {
    nextResult = { ok: true };
    await resetManagedChildPassword({ childUid: 'uid-child', newPassword: 'a-good-password' });
    expect(callableCalls).toEqual([
      { name: 'resetManagedChildPassword', payload: { childUid: 'uid-child', newPassword: 'a-good-password' } },
    ]);
  });

  it('maps an internal error to a generic message', async () => {
    nextError = { code: 'functions/internal', message: 'boom' };
    await expect(
      resetManagedChildPassword({ childUid: 'uid-child', newPassword: 'a-good-password' }),
    ).rejects.toThrow(/something went wrong/i);
  });
});

describe('isManagedChildEnabled — strict "true" contract', () => {
  it('is true ONLY for the exact literal "true"', () => {
    vi.stubEnv('VITE_MANAGED_CHILD_ENABLED', 'true');
    expect(isManagedChildEnabled()).toBe(true);
  });

  it('is false for anything else', () => {
    for (const v of ['', '1', 'yes', 'True', 'TRUE', ' true ']) {
      vi.stubEnv('VITE_MANAGED_CHILD_ENABLED', v);
      expect(isManagedChildEnabled()).toBe(false);
    }
  });
});
