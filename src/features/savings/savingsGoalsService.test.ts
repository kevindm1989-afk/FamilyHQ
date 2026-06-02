/**
 * savingsGoalsService — unit contract.
 *
 * Pins:
 *   - createSavingsGoal validates title (trim + non-empty + length cap),
 *     targetAmount (positive integer cents, under MONEY_MAX_CENTS), and
 *     skips writing an undefined `targetDate` (exactOptionalPropertyTypes
 *     compliance — never round-trip `targetDate: undefined` to Firestore).
 *   - updateSavingsGoal patches only what the caller passes; null
 *     `targetDate` clears the field.
 *   - contributeToSavingsGoal validates the bump, reads the current goal,
 *     refuses non-active goals, and CAPS at targetAmount (no over-saved).
 *   - setSavingsGoalStatus updates only `status` + `updatedAt`.
 *   - savingsGoalProgressPercent is pure + clamped 0..100.
 *
 * Acceptance / rules-enforced behaviour (parent-only complete/archive,
 * cross-tenant isolation, etc.) is pinned in `test/rules/savings-goals.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addDocMock = vi.fn();
const updateDocMock = vi.fn();
const deleteDocMock = vi.fn();
const getDocMock = vi.fn();
const collectionMock = vi.fn();
const docMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  addDoc: (...a: unknown[]) => addDocMock(...a),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  deleteDoc: (...a: unknown[]) => deleteDocMock(...a),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  collection: (...a: unknown[]) => collectionMock(...a),
  doc: (...a: unknown[]) => docMock(...a),
}));

import {
  contributeToSavingsGoal,
  createSavingsGoal,
  deleteSavingsGoal,
  savingsGoalProgressPercent,
  setSavingsGoalStatus,
  SAVINGS_GOAL_TITLE_MAX,
  SAVINGS_TERMINAL,
  SAVINGS_TITLE_EMPTY,
  SAVINGS_TITLE_TOO_LONG,
  SAVINGS_TARGET_INVALID,
  SAVINGS_AMOUNT_INVALID,
  SavingsGoalActionError,
  updateSavingsGoal,
} from './savingsGoalsService';

const db = { __db: true } as never;

beforeEach(() => {
  addDocMock.mockReset();
  updateDocMock.mockReset();
  deleteDocMock.mockReset();
  getDocMock.mockReset();
  collectionMock.mockReset();
  docMock.mockReset();
  // `.withConverter` is chained on collection/doc references — mock the
  // chain so the service code doesn't TypeError.
  const refWithConverter = (ref: { __ref?: true }) => ({
    ...ref,
    withConverter: () => ref,
  });
  collectionMock.mockImplementation(() => refWithConverter({ __ref: true }));
  docMock.mockImplementation(() => refWithConverter({ __ref: true }));
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('createSavingsGoal', () => {
  it('rejects an empty title (trimmed)', async () => {
    await expect(
      createSavingsGoal(
        { db },
        {
          title: '   ',
          targetAmount: 1000,
          ownerUid: 'uid-m',
          familyId: 'fam-A',
        },
      ),
    ).rejects.toMatchObject({
      name: 'SavingsGoalActionError',
      message: SAVINGS_TITLE_EMPTY,
    });
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects a title over the length cap', async () => {
    await expect(
      createSavingsGoal(
        { db },
        {
          title: 'x'.repeat(SAVINGS_GOAL_TITLE_MAX + 1),
          targetAmount: 1000,
          ownerUid: 'uid-m',
          familyId: 'fam-A',
        },
      ),
    ).rejects.toMatchObject({ message: SAVINGS_TITLE_TOO_LONG });
  });

  it('rejects a zero / negative targetAmount', async () => {
    await expect(
      createSavingsGoal(
        { db },
        { title: 'Bike', targetAmount: 0, ownerUid: 'uid-m', familyId: 'fam-A' },
      ),
    ).rejects.toMatchObject({ message: SAVINGS_TARGET_INVALID });
    await expect(
      createSavingsGoal(
        { db },
        { title: 'Bike', targetAmount: -100, ownerUid: 'uid-m', familyId: 'fam-A' },
      ),
    ).rejects.toMatchObject({ message: SAVINGS_TARGET_INVALID });
  });

  it('rejects a non-integer / non-finite targetAmount', async () => {
    await expect(
      createSavingsGoal(
        { db },
        { title: 'Bike', targetAmount: 12.5, ownerUid: 'uid-m', familyId: 'fam-A' },
      ),
    ).rejects.toMatchObject({ message: SAVINGS_TARGET_INVALID });
    await expect(
      createSavingsGoal(
        { db },
        {
          title: 'Bike',
          targetAmount: Number.NaN,
          ownerUid: 'uid-m',
          familyId: 'fam-A',
        },
      ),
    ).rejects.toMatchObject({ message: SAVINGS_TARGET_INVALID });
  });

  it('writes a well-formed payload (trimmed title, active status, currentAmount=0) when input is valid', async () => {
    addDocMock.mockResolvedValue({ id: 'new-goal' });
    const id = await createSavingsGoal(
      { db },
      {
        title: '  New bike  ',
        targetAmount: 50000,
        ownerUid: 'uid-m',
        familyId: 'fam-A',
      },
    );
    expect(id).toBe('new-goal');
    const payload = addDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.title).toBe('New bike');
    expect(payload.status).toBe('active');
    expect(payload.currentAmount).toBe(0);
    expect(payload.familyId).toBe('fam-A');
    expect(payload.ownerUid).toBe('uid-m');
  });

  it('OMITS the `targetDate` key when none provided (exactOptionalPropertyTypes — never round-trip undefined)', async () => {
    addDocMock.mockResolvedValue({ id: 'new-goal' });
    await createSavingsGoal(
      { db },
      {
        title: 'Bike',
        targetAmount: 50000,
        ownerUid: 'uid-m',
        familyId: 'fam-A',
      },
    );
    const payload = addDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect('targetDate' in payload).toBe(false);
  });

  it('INCLUDES `targetDate` when a non-empty value is provided', async () => {
    addDocMock.mockResolvedValue({ id: 'new-goal' });
    await createSavingsGoal(
      { db },
      {
        title: 'Bike',
        targetAmount: 50000,
        ownerUid: 'uid-m',
        familyId: 'fam-A',
        targetDate: '2026-12-31',
      },
    );
    const payload = addDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.targetDate).toBe('2026-12-31');
  });

  it('maps a Firestore failure to a user-safe generic error (no raw provider text)', async () => {
    addDocMock.mockRejectedValue(new Error('permission-denied'));
    await expect(
      createSavingsGoal(
        { db },
        { title: 'Bike', targetAmount: 50000, ownerUid: 'uid-m', familyId: 'fam-A' },
      ),
    ).rejects.toBeInstanceOf(SavingsGoalActionError);
  });
});

describe('updateSavingsGoal', () => {
  it('patches only `title` + `updatedAt` when only title is provided', async () => {
    updateDocMock.mockResolvedValue(undefined);
    await updateSavingsGoal({ db }, 'g-1', { title: 'New name' });
    const patch = updateDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.title).toBe('New name');
    expect('targetAmount' in patch).toBe(false);
    expect(typeof patch.updatedAt).toBe('number');
  });

  it('passes a NULL `targetDate` through so callers can clear the field', async () => {
    updateDocMock.mockResolvedValue(undefined);
    await updateSavingsGoal({ db }, 'g-1', { targetDate: null });
    const patch = updateDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.targetDate).toBeNull();
  });

  it('rejects a too-long title before reaching updateDoc', async () => {
    await expect(
      updateSavingsGoal({ db }, 'g-1', { title: 'x'.repeat(SAVINGS_GOAL_TITLE_MAX + 1) }),
    ).rejects.toMatchObject({ message: SAVINGS_TITLE_TOO_LONG });
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('contributeToSavingsGoal', () => {
  it('rejects a zero / negative bump', async () => {
    await expect(contributeToSavingsGoal({ db }, 'g-1', 0)).rejects.toMatchObject({
      message: SAVINGS_AMOUNT_INVALID,
    });
    await expect(contributeToSavingsGoal({ db }, 'g-1', -100)).rejects.toMatchObject({
      message: SAVINGS_AMOUNT_INVALID,
    });
  });

  it('refuses to contribute to a non-active goal (terminal — completed/archived)', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ currentAmount: 100, targetAmount: 500, status: 'completed' }),
    });
    await expect(contributeToSavingsGoal({ db }, 'g-1', 100)).rejects.toMatchObject({
      message: SAVINGS_TERMINAL,
    });
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('CAPS the new currentAmount at targetAmount (no over-saved surplus)', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ currentAmount: 400, targetAmount: 500, status: 'active' }),
    });
    updateDocMock.mockResolvedValue(undefined);
    await contributeToSavingsGoal({ db }, 'g-1', 1000);
    const patch = updateDocMock.mock.calls[0]![1] as { currentAmount: number };
    expect(patch.currentAmount).toBe(500);
  });

  it('happy path: 200 + 250 = 450, written through', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ currentAmount: 200, targetAmount: 1000, status: 'active' }),
    });
    updateDocMock.mockResolvedValue(undefined);
    await contributeToSavingsGoal({ db }, 'g-1', 250);
    const patch = updateDocMock.mock.calls[0]![1] as { currentAmount: number };
    expect(patch.currentAmount).toBe(450);
  });
});

describe('setSavingsGoalStatus', () => {
  it('writes only `status` + `updatedAt`', async () => {
    updateDocMock.mockResolvedValue(undefined);
    await setSavingsGoalStatus({ db }, 'g-1', 'completed');
    const patch = updateDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.status).toBe('completed');
    expect(typeof patch.updatedAt).toBe('number');
    expect(Object.keys(patch).sort()).toEqual(['status', 'updatedAt']);
  });
});

describe('deleteSavingsGoal', () => {
  it('calls deleteDoc with the right path', async () => {
    deleteDocMock.mockResolvedValue(undefined);
    await deleteSavingsGoal({ db }, 'g-1');
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
  });

  it('wraps a Firestore failure in a user-safe error', async () => {
    deleteDocMock.mockRejectedValue(new Error('rules-denied'));
    await expect(deleteSavingsGoal({ db }, 'g-1')).rejects.toBeInstanceOf(
      SavingsGoalActionError,
    );
  });
});

describe('savingsGoalProgressPercent', () => {
  it('returns 0 for zero / negative target', () => {
    expect(savingsGoalProgressPercent(100, 0)).toBe(0);
    expect(savingsGoalProgressPercent(100, -1)).toBe(0);
  });

  it('returns 0 for non-finite inputs', () => {
    expect(savingsGoalProgressPercent(Number.NaN, 100)).toBe(0);
    expect(savingsGoalProgressPercent(50, Number.NaN)).toBe(0);
  });

  it('clamps above 100', () => {
    expect(savingsGoalProgressPercent(500, 100)).toBe(100);
  });

  it('clamps below 0 (defensive)', () => {
    expect(savingsGoalProgressPercent(-50, 100)).toBe(0);
  });

  it('rounds to a whole percent in the happy path', () => {
    expect(savingsGoalProgressPercent(33, 100)).toBe(33);
    expect(savingsGoalProgressPercent(666, 1000)).toBe(67);
  });
});
