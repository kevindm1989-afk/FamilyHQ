/**
 * Family Management service — unit contract (Phase 4; ADR-0002 rules contract:
 * a member-doc update may only touch a non-empty subset of `{name, isActive}`).
 *
 * Level: unit. Firestore is mocked at the SDK boundary so we assert the EXACT
 * payload shape on every write — never a spread of the full user doc and never
 * a key outside the rules contract. Server authority (the rules) is exercised
 * elsewhere (test/rules/*.ts on the emulator); here we pin the CLIENT contract.
 *
 * SECURITY-CRITICAL exact-payload assertion mechanism:
 *  - the mock captures every updateDoc call as `{ ref, data }`.
 *  - assertions use `Object.keys(captured.data).sort()` deeply equal to a
 *    canonical key list (e.g. `['name']` for rename, `['isActive']` for
 *    (de)activate). This catches a spread of the full user doc (would carry
 *    role / familyId / email / allowanceBalance / theme) AND a sneaky extra
 *    field. Both `Object.keys` and a per-key absence assertion are included so
 *    a failure names exactly which forbidden field leaked into the payload.
 *
 * Privacy contract pinned: the surfaced error message never carries raw
 * Firebase text and never carries the member's name or uid.
 *
 * FAILS today: familyManagementService.ts is a declare-only contract stub
 * (renameMember / setMemberActive throw 'not implemented').
 *
 * Isolation: each test re-creates its mocks (no shared mutable state across
 * tests, no order dependence). No clock / network / RNG.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Firestore SDK boundary mock ----
interface UpdateOp {
  ref: { __collection: string; __id?: string };
  data: Record<string, unknown>;
}

let updateOps: UpdateOp[];
let updateShouldReject: boolean;

const docMock = vi.fn((_db: unknown, collectionName: string, id: string) => ({
  __collection: collectionName,
  __id: id,
}));

const updateDocMock = vi.fn(
  async (ref: { __collection: string; __id?: string }, data: Record<string, unknown>) => {
    if (updateShouldReject) {
      // Realistic raw Firebase text the service MUST NOT surface to callers.
      throw new Error('permission-denied: raw firebase, must not surface');
    }
    updateOps.push({ ref, data });
  },
);

vi.mock('firebase/firestore', () => ({
  doc: (...a: [unknown, string, string]) => docMock(...a),
  updateDoc: (...a: [{ __collection: string; __id?: string }, Record<string, unknown>]) =>
    updateDocMock(...a),
}));

// Imported AFTER the mocks are registered.
import {
  FAMILY_GENERIC_ERROR,
  FamilyManagementError,
  MEMBER_DEACTIVATED,
  MEMBER_REACTIVATED,
  NAME_MAX_LENGTH,
  RENAME_SUCCESS,
  TIMEZONE_MAX_LENGTH,
  TIMEZONE_OPTIONS,
  TIMEZONE_UPDATED,
  renameMember,
  setFamilyTimezone,
  setMemberActive,
} from './familyManagementService';

const db = {} as import('firebase/firestore').Firestore;

beforeEach(() => {
  updateOps = [];
  updateShouldReject = false;
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// =====================================================================
// renameMember — EXACT payload `{ name: <trimmed> }`
// =====================================================================
describe('renameMember — writes EXACTLY {name} to users/{uid} (no other keys)', () => {
  it('writes a single updateDoc with EXACTLY the `name` key (Object.keys deeply equals ["name"])', async () => {
    await renameMember({ db }, 'uid-maya', 'Maya Rivera');
    expect(updateDocMock, 'one updateDoc call for the rename').toHaveBeenCalledTimes(1);
    expect(updateOps).toHaveLength(1);
    const payload = updateOps[0]!.data;
    // The SECURITY-CRITICAL exact-keys assertion — anything else means a forbidden
    // field leaked into the write and the rules would deny it.
    expect(Object.keys(payload).sort()).toEqual(['name']);
  });

  it('targets users/{uid} (not any other collection or another uid)', async () => {
    await renameMember({ db }, 'uid-target', 'Ada');
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.ref.__collection).toBe('users');
    expect(updateOps[0]!.ref.__id).toBe('uid-target');
  });

  it('writes the EXACT trimmed name as the value (whitespace trimmed before write)', async () => {
    await renameMember({ db }, 'uid-maya', '   Maya Rivera   ');
    expect(updateOps[0]!.data.name).toBe('Maya Rivera');
  });

  it('never includes role / familyId / isActive / email / allowanceBalance / theme in the payload (no full-doc spread)', async () => {
    await renameMember({ db }, 'uid-maya', 'Maya');
    const payload = updateOps[0]!.data;
    for (const forbidden of ['role', 'familyId', 'isActive', 'email', 'allowanceBalance', 'theme']) {
      expect(
        Object.prototype.hasOwnProperty.call(payload, forbidden),
        `forbidden key "${forbidden}" must NOT be in the rename payload (rules: hasOnly([name,isActive]))`,
      ).toBe(false);
    }
  });
});

// =====================================================================
// renameMember — name validation BEFORE any write
// =====================================================================
describe('renameMember — name validation rejects bad input BEFORE any Firestore write', () => {
  it('rejects an empty name without issuing any write', async () => {
    await expect(renameMember({ db }, 'uid-x', '')).rejects.toBeInstanceOf(FamilyManagementError);
    expect(updateDocMock, 'no write on empty name').not.toHaveBeenCalled();
    expect(updateOps).toHaveLength(0);
  });

  it('rejects a whitespace-only name without issuing any write', async () => {
    await expect(renameMember({ db }, 'uid-x', '   \t\n  ')).rejects.toBeInstanceOf(
      FamilyManagementError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it(`rejects an over-length name (> ${NAME_MAX_LENGTH} chars after trim) without issuing any write`, async () => {
    const tooLong = 'A'.repeat(NAME_MAX_LENGTH + 1);
    await expect(renameMember({ db }, 'uid-x', tooLong)).rejects.toBeInstanceOf(
      FamilyManagementError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it(`accepts a name of EXACTLY the cap (${NAME_MAX_LENGTH} chars) — boundary inclusive`, async () => {
    const atCap = 'B'.repeat(NAME_MAX_LENGTH);
    await renameMember({ db }, 'uid-x', atCap);
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.data.name).toBe(atCap);
  });

  it('rejected validation surfaces the GENERIC user-safe message (no PII)', async () => {
    const err = await renameMember({ db }, 'uid-secret', '').then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(FamilyManagementError);
    expect(err.message).toBe(FAMILY_GENERIC_ERROR);
    // The uid is sensitive — never echoed into a user-visible message.
    expect(err.message).not.toContain('uid-secret');
  });
});

// =====================================================================
// renameMember — Firestore failure mapping (privacy)
// =====================================================================
describe('renameMember — error mapping: raw Firebase text + PII never surface', () => {
  it('maps a Firestore failure to the generic PII-free message (no raw provider text)', async () => {
    updateShouldReject = true;
    await expect(renameMember({ db }, 'uid-x', 'Maya')).rejects.toThrow(FAMILY_GENERIC_ERROR);
  });

  it('the surfaced error contains no raw provider text and no member name / uid', async () => {
    updateShouldReject = true;
    const err = await renameMember({ db }, 'uid-secret-1234', 'Maya Top-Secret').then(
      () => new Error('expected renameMember to reject'),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(FamilyManagementError);
    expect(err.message).toBe(FAMILY_GENERIC_ERROR);
    expect(err.message).not.toMatch(/permission-denied|firebase|firestore/i);
    expect(err.message).not.toContain('uid-secret-1234');
    expect(err.message).not.toContain('Maya Top-Secret');
  });
});

// =====================================================================
// setMemberActive — EXACT payload `{ isActive: <boolean> }`
// =====================================================================
describe('setMemberActive — writes EXACTLY {isActive} to users/{uid} (no other keys)', () => {
  it('deactivate: writes EXACTLY {isActive:false}', async () => {
    await setMemberActive({ db }, 'uid-ben', false);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateOps).toHaveLength(1);
    expect(Object.keys(updateOps[0]!.data).sort()).toEqual(['isActive']);
    expect(updateOps[0]!.data.isActive).toBe(false);
  });

  it('reactivate: writes EXACTLY {isActive:true}', async () => {
    await setMemberActive({ db }, 'uid-ben', true);
    expect(updateOps).toHaveLength(1);
    expect(Object.keys(updateOps[0]!.data).sort()).toEqual(['isActive']);
    expect(updateOps[0]!.data.isActive).toBe(true);
  });

  it('targets users/{uid} (not any other collection or another uid)', async () => {
    await setMemberActive({ db }, 'uid-target', false);
    expect(updateOps[0]!.ref.__collection).toBe('users');
    expect(updateOps[0]!.ref.__id).toBe('uid-target');
  });

  it('never includes role / familyId / name / email / allowanceBalance / theme in the payload (no full-doc spread)', async () => {
    await setMemberActive({ db }, 'uid-ben', false);
    const payload = updateOps[0]!.data;
    for (const forbidden of ['role', 'familyId', 'name', 'email', 'allowanceBalance', 'theme']) {
      expect(
        Object.prototype.hasOwnProperty.call(payload, forbidden),
        `forbidden key "${forbidden}" must NOT be in the (de)activate payload (rules: hasOnly([name,isActive]))`,
      ).toBe(false);
    }
  });
});

// =====================================================================
// setMemberActive — Firestore failure mapping
// =====================================================================
describe('setMemberActive — error mapping: raw Firebase text + PII never surface', () => {
  it('maps a Firestore failure to the generic PII-free message', async () => {
    updateShouldReject = true;
    await expect(setMemberActive({ db }, 'uid-x', false)).rejects.toThrow(FAMILY_GENERIC_ERROR);
  });

  it('the surfaced error contains no raw provider text and no member uid', async () => {
    updateShouldReject = true;
    const err = await setMemberActive({ db }, 'uid-secret-9999', true).then(
      () => new Error('expected setMemberActive to reject'),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(FamilyManagementError);
    expect(err.message).toBe(FAMILY_GENERIC_ERROR);
    expect(err.message).not.toMatch(/permission-denied|firebase|firestore/i);
    expect(err.message).not.toContain('uid-secret-9999');
  });
});

// =====================================================================
// Exported toast copy — defined for the toast-everything rule
// =====================================================================
describe('toast copy + generic error string', () => {
  it('rename / deactivate / reactivate success copy + generic error are non-empty strings', () => {
    for (const s of [RENAME_SUCCESS, MEMBER_DEACTIVATED, MEMBER_REACTIVATED, FAMILY_GENERIC_ERROR]) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('no copy leaks a raw provider token / PII pattern', () => {
    for (const s of [RENAME_SUCCESS, MEMBER_DEACTIVATED, MEMBER_REACTIVATED, FAMILY_GENERIC_ERROR]) {
      expect(s).not.toMatch(/permission-denied|firestore|firebase|@|uid-/i);
    }
  });
});

// =====================================================================
// NAME_MAX_LENGTH — pinned to a sensible cap (also pinned by the screen test)
// =====================================================================
describe('NAME_MAX_LENGTH — cap is the pinned value (matches the screen test)', () => {
  it('is the integer 60 (matches the UI cap pinned in FamilyManagementScreen.test.tsx)', () => {
    expect(NAME_MAX_LENGTH).toBe(60);
  });
});

// =====================================================================
// Sec2 — non-string `name` is mapped to FamilyManagementError, not a raw TypeError
//
// Today `name.trim()` runs OUTSIDE the `try` block; a non-string argument
// (TS escape hatch via `unknown as string`) throws a raw TypeError that
// bubbles to the caller as something OTHER than FamilyManagementError. The
// fix: move the validation (including the typeof check) INSIDE the try, or
// guard before trimming, so EVERY failure path leaves through the generic
// PII-free error class.
// =====================================================================
describe('renameMember — Sec2: a non-string `name` is mapped to FamilyManagementError (no raw TypeError)', () => {
  it('rejects with FamilyManagementError when name is a number', async () => {
    await expect(
      renameMember({ db }, 'uid-x', 123 as unknown as string),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('rejects with FamilyManagementError when name is null', async () => {
    await expect(
      renameMember({ db }, 'uid-x', null as unknown as string),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('rejects with FamilyManagementError when name is undefined', async () => {
    await expect(
      renameMember({ db }, 'uid-x', undefined as unknown as string),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('rejects with FamilyManagementError when name is an object', async () => {
    await expect(
      renameMember({ db }, 'uid-x', { name: 'hax' } as unknown as string),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('the surfaced error message is the generic copy (no raw TypeError text, no PII)', async () => {
    const err = await renameMember({ db }, 'uid-secret', 42 as unknown as string).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(FamilyManagementError);
    expect(err.message).toBe(FAMILY_GENERIC_ERROR);
    expect(
      err.message,
      'no raw TypeError text may surface to the user',
    ).not.toMatch(/TypeError|trim is not a function|undefined is not/i);
    expect(err.message).not.toContain('uid-secret');
  });

  it('a non-string name results in NO updateDoc call (rejected before any write)', async () => {
    await renameMember({ db }, 'uid-x', 123 as unknown as string).catch(() => undefined);
    expect(
      updateDocMock,
      'Sec2 — a non-string name must be rejected BEFORE issuing any Firestore write',
    ).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Sec3 — non-boolean `isActive` is mapped to FamilyManagementError, never round-tripped
//
// Today a TS escape hatch (`'true' as unknown as boolean`) round-trips into
// Firestore as a string value. Pin: setMemberActive rejects with
// FamilyManagementError and updateDoc is NOT called.
// =====================================================================
describe('setMemberActive — Sec3: a non-boolean `isActive` is mapped to FamilyManagementError; no write', () => {
  it('rejects with FamilyManagementError when isActive is the string "true"', async () => {
    await expect(
      setMemberActive({ db }, 'uid-x', 'true' as unknown as boolean),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('rejects with FamilyManagementError when isActive is the number 1', async () => {
    await expect(
      setMemberActive({ db }, 'uid-x', 1 as unknown as boolean),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('rejects with FamilyManagementError when isActive is null', async () => {
    await expect(
      setMemberActive({ db }, 'uid-x', null as unknown as boolean),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('rejects with FamilyManagementError when isActive is undefined', async () => {
    await expect(
      setMemberActive({ db }, 'uid-x', undefined as unknown as boolean),
    ).rejects.toBeInstanceOf(FamilyManagementError);
  });

  it('a non-boolean isActive results in NO updateDoc call (rejected before any write)', async () => {
    await setMemberActive({ db }, 'uid-x', 'true' as unknown as boolean).catch(() => undefined);
    expect(
      updateDocMock,
      'Sec3 — a non-boolean isActive must be rejected BEFORE issuing any Firestore write (no round-trip)',
    ).not.toHaveBeenCalled();
  });

  it('the surfaced error message is the generic copy (no raw TypeError text, no PII)', async () => {
    const err = await setMemberActive(
      { db },
      'uid-secret',
      'true' as unknown as boolean,
    ).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(FamilyManagementError);
    expect(err.message).toBe(FAMILY_GENERIC_ERROR);
    expect(err.message).not.toContain('uid-secret');
  });

  it('positive control: a real boolean true STILL writes (Sec3 must not over-block)', async () => {
    await setMemberActive({ db }, 'uid-x', true);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.data.isActive).toBe(true);
  });

  it('positive control: a real boolean false STILL writes (Sec3 must not over-block)', async () => {
    await setMemberActive({ db }, 'uid-x', false);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.data.isActive).toBe(false);
  });
});

// =====================================================================
// F13 — setFamilyTimezone writes EXACTLY {timezone} to families/{familyId}
//
// Rules contract is `isParent() && callerFamily() == familyId &&
// timezoneFieldValid()` — the service mirrors the narrow shape: validate
// type + length BEFORE any write, write only the `timezone` key, map every
// failure to the generic PII-free FamilyManagementError.
// =====================================================================
describe('setFamilyTimezone — writes EXACTLY {timezone} to families/{familyId} (no other keys)', () => {
  it('writes a single updateDoc with EXACTLY the `timezone` key', async () => {
    await setFamilyTimezone({ db }, 'fam-A', 'America/Vancouver');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateOps).toHaveLength(1);
    const payload = updateOps[0]!.data;
    expect(Object.keys(payload).sort()).toEqual(['timezone']);
    expect(payload.timezone).toBe('America/Vancouver');
  });

  it('targets families/{familyId} (not users / other collections)', async () => {
    await setFamilyTimezone({ db }, 'fam-target', 'America/Halifax');
    expect(updateOps[0]!.ref.__collection).toBe('families');
    expect(updateOps[0]!.ref.__id).toBe('fam-target');
  });

  it('trims surrounding whitespace before write', async () => {
    await setFamilyTimezone({ db }, 'fam-A', '   America/Edmonton   ');
    expect(updateOps[0]!.data.timezone).toBe('America/Edmonton');
  });

  it('never includes familyName / createdBy / createdAt in the payload (no full-doc spread)', async () => {
    await setFamilyTimezone({ db }, 'fam-A', 'America/Toronto');
    const payload = updateOps[0]!.data;
    for (const forbidden of ['familyName', 'createdBy', 'createdAt']) {
      expect(
        Object.prototype.hasOwnProperty.call(payload, forbidden),
        `forbidden key "${forbidden}" must NOT be in the timezone payload`,
      ).toBe(false);
    }
  });

  it('accepts every value in TIMEZONE_OPTIONS (boundary control on the shortlist)', async () => {
    for (const tz of TIMEZONE_OPTIONS) {
      updateOps = [];
      await setFamilyTimezone({ db }, 'fam-A', tz);
      expect(updateOps).toHaveLength(1);
      expect(updateOps[0]!.data.timezone).toBe(tz);
    }
  });

  it('accepts a legacy/off-shortlist value (the service does NOT enforce the shortlist; the screen does)', async () => {
    await setFamilyTimezone({ db }, 'fam-A', 'America/Whitehorse');
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.data.timezone).toBe('America/Whitehorse');
  });
});

describe('setFamilyTimezone — validation rejects bad input BEFORE any Firestore write', () => {
  it('rejects an empty timezone without issuing any write', async () => {
    await expect(setFamilyTimezone({ db }, 'fam-A', '')).rejects.toBeInstanceOf(
      FamilyManagementError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only timezone without issuing any write', async () => {
    await expect(setFamilyTimezone({ db }, 'fam-A', '   \t\n  ')).rejects.toBeInstanceOf(
      FamilyManagementError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it(`rejects an over-length timezone (> ${TIMEZONE_MAX_LENGTH} chars after trim) without issuing any write`, async () => {
    const tooLong = 'A'.repeat(TIMEZONE_MAX_LENGTH + 1);
    await expect(setFamilyTimezone({ db }, 'fam-A', tooLong)).rejects.toBeInstanceOf(
      FamilyManagementError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it(`accepts a timezone of EXACTLY the cap (${TIMEZONE_MAX_LENGTH} chars) — boundary inclusive`, async () => {
    const atCap = 'B'.repeat(TIMEZONE_MAX_LENGTH);
    await setFamilyTimezone({ db }, 'fam-A', atCap);
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0]!.data.timezone).toBe(atCap);
  });

  it('rejects a non-string timezone (TS escape hatch) without issuing any write', async () => {
    for (const bad of [
      123 as unknown as string,
      null as unknown as string,
      undefined as unknown as string,
      { tz: 'hax' } as unknown as string,
    ]) {
      await expect(setFamilyTimezone({ db }, 'fam-A', bad)).rejects.toBeInstanceOf(
        FamilyManagementError,
      );
    }
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('rejects an empty familyId without issuing any write', async () => {
    await expect(setFamilyTimezone({ db }, '', 'America/Toronto')).rejects.toBeInstanceOf(
      FamilyManagementError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('rejects a non-string familyId without issuing any write', async () => {
    await expect(
      setFamilyTimezone({ db }, null as unknown as string, 'America/Toronto'),
    ).rejects.toBeInstanceOf(FamilyManagementError);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('setFamilyTimezone — error mapping: raw Firebase text + PII never surface', () => {
  it('maps a Firestore failure to the generic PII-free message (no raw provider text)', async () => {
    updateShouldReject = true;
    await expect(
      setFamilyTimezone({ db }, 'fam-A', 'America/Toronto'),
    ).rejects.toThrow(FAMILY_GENERIC_ERROR);
  });

  it('the surfaced error contains no raw provider text and no familyId', async () => {
    updateShouldReject = true;
    const err = await setFamilyTimezone({ db }, 'fam-secret-1234', 'America/Toronto').then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(FamilyManagementError);
    expect(err.message).toBe(FAMILY_GENERIC_ERROR);
    expect(err.message).not.toMatch(/permission-denied|firebase|firestore/i);
    expect(err.message).not.toContain('fam-secret-1234');
  });

  it('the surfaced error message contains no raw TypeError text on a non-string input', async () => {
    const err = await setFamilyTimezone(
      { db },
      'fam-secret',
      42 as unknown as string,
    ).then(
      () => new Error('expected rejection'),
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(FamilyManagementError);
    expect(err.message).toBe(FAMILY_GENERIC_ERROR);
    expect(err.message).not.toMatch(/TypeError|trim is not a function/i);
    expect(err.message).not.toContain('fam-secret');
  });
});

describe('TIMEZONE constants — shape + non-empty', () => {
  it('TIMEZONE_UPDATED is a non-empty string with no provider tokens / PII', () => {
    expect(typeof TIMEZONE_UPDATED).toBe('string');
    expect(TIMEZONE_UPDATED.length).toBeGreaterThan(0);
    expect(TIMEZONE_UPDATED).not.toMatch(/permission-denied|firebase|firestore|@|uid-|fam-/i);
  });

  it('TIMEZONE_OPTIONS includes the architect-approved Canadian shortlist (Toronto first as the default)', () => {
    expect(TIMEZONE_OPTIONS[0]).toBe('America/Toronto');
    expect(TIMEZONE_OPTIONS).toContain('America/Vancouver');
    expect(TIMEZONE_OPTIONS).toContain('America/Edmonton');
    expect(TIMEZONE_OPTIONS).toContain('America/Halifax');
    expect(TIMEZONE_OPTIONS).toContain('America/St_Johns');
  });

  it('TIMEZONE_MAX_LENGTH matches the firestore.rules cap (50)', () => {
    expect(TIMEZONE_MAX_LENGTH).toBe(50);
  });
});
