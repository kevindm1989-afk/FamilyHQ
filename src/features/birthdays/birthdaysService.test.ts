/**
 * Unit-level contract for the birthdays service.
 *
 * Firestore SDK mocked so we can pin:
 *   - validation BEFORE any write (empty/oversized name, malformed monthDay,
 *     impossible date 02-30, invalid birthYear),
 *   - the EXACT shape of the create body (closed key set, no undefined leaks),
 *   - deleteField() on clearing optionals (note, birthYear),
 *   - error mapping (any thrown failure → BirthdayActionError).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addDocMock = vi.fn();
const updateDocMock = vi.fn();
const deleteDocMock = vi.fn();
const deleteFieldSentinel = { __sentinel: 'deleteField' };

vi.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => addDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  collection: (_db: unknown, name: string) => ({
    __ref: `col:${name}`,
    withConverter: () => ({ __ref: `col:${name}` }),
  }),
  doc: (_db: unknown, name: string, id: string) => ({ __ref: `doc:${name}/${id}` }),
  deleteField: () => deleteFieldSentinel,
}));

vi.mock('../../lib/converters', () => ({
  birthdayConverter: { __converter: 'birthday' },
}));

import {
  BIRTHDAY_MONTHDAY_INVALID,
  BIRTHDAY_NAME_EMPTY,
  BirthdayActionError,
  createBirthday,
  deleteBirthday,
  isValidMonthDay,
  monthDayFromParts,
  updateBirthday,
} from './birthdaysService';

const db = { __db: true } as unknown as import('firebase/firestore').Firestore;

beforeEach(() => {
  addDocMock.mockReset();
  updateDocMock.mockReset();
  deleteDocMock.mockReset();
  addDocMock.mockResolvedValue({ id: 'generated-id' });
  updateDocMock.mockResolvedValue(undefined);
  deleteDocMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('isValidMonthDay', () => {
  it.each([
    ['06-15', true],
    ['01-01', true],
    ['12-31', true],
    ['02-29', true], // accepted (leap-day birthdays are real)
    ['13-01', false],
    ['00-15', false],
    ['02-30', false],
    ['04-31', false],
    ['6-15', false], // not zero-padded
    ['2026-06-15', false],
    ['June 15', false],
    ['', false],
  ])('isValidMonthDay(%j) === %s', (input, expected) => {
    expect(isValidMonthDay(input)).toBe(expected);
  });
});

describe('monthDayFromParts', () => {
  it('zero-pads single-digit month and day', () => {
    expect(monthDayFromParts(6, 5)).toBe('06-05');
    expect(monthDayFromParts(12, 31)).toBe('12-31');
  });
});

describe('createBirthday — validation BEFORE write', () => {
  it('rejects empty name', async () => {
    await expect(
      createBirthday(
        { db },
        { familyId: 'fam-A', createdBy: 'uid-a', name: '   ', monthDay: '06-15', type: 'birthday' },
      ),
    ).rejects.toMatchObject({ message: BIRTHDAY_NAME_EMPTY });
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects name over 80 chars', async () => {
    await expect(
      createBirthday(
        { db },
        {
          familyId: 'fam-A',
          createdBy: 'uid-a',
          name: 'a'.repeat(81),
          monthDay: '06-15',
          type: 'birthday',
        },
      ),
    ).rejects.toBeInstanceOf(BirthdayActionError);
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects malformed monthDay', async () => {
    await expect(
      createBirthday(
        { db },
        {
          familyId: 'fam-A',
          createdBy: 'uid-a',
          name: 'Maya',
          monthDay: '2026-06-15',
          type: 'birthday',
        },
      ),
    ).rejects.toMatchObject({ message: BIRTHDAY_MONTHDAY_INVALID });
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects impossible monthDay (02-30)', async () => {
    await expect(
      createBirthday(
        { db },
        { familyId: 'fam-A', createdBy: 'uid-a', name: 'x', monthDay: '02-30', type: 'birthday' },
      ),
    ).rejects.toBeInstanceOf(BirthdayActionError);
  });

  it('rejects future birthYear', async () => {
    const future = new Date().getFullYear() + 5;
    await expect(
      createBirthday(
        { db },
        {
          familyId: 'fam-A',
          createdBy: 'uid-a',
          name: 'x',
          monthDay: '06-15',
          type: 'birthday',
          birthYear: future,
        },
      ),
    ).rejects.toBeInstanceOf(BirthdayActionError);
  });
});

describe('createBirthday — body shape', () => {
  it('writes the closed key set (no undefined leaks for unset optionals)', async () => {
    await createBirthday(
      { db },
      {
        familyId: 'fam-A',
        createdBy: 'uid-a',
        name: '  Maya  ',
        monthDay: '06-15',
        type: 'birthday',
      },
    );
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'createdBy', 'familyId', 'monthDay', 'name', 'type'].sort(),
    );
    expect(body.name).toBe('Maya');
    expect(body.type).toBe('birthday');
    expect(body.monthDay).toBe('06-15');
  });

  it('includes birthYear + note when supplied', async () => {
    await createBirthday(
      { db },
      {
        familyId: 'fam-A',
        createdBy: 'uid-a',
        name: 'Maya',
        monthDay: '06-15',
        type: 'birthday',
        birthYear: 2014,
        note: 'Loves Pokémon',
      },
    );
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(body.birthYear).toBe(2014);
    expect(body.note).toBe('Loves Pokémon');
  });

  it('maps Firestore failure to BirthdayActionError', async () => {
    addDocMock.mockRejectedValueOnce(new Error('FIRESTORE/permission-denied'));
    await expect(
      createBirthday(
        { db },
        { familyId: 'fam-A', createdBy: 'uid-a', name: 'x', monthDay: '06-15', type: 'birthday' },
      ),
    ).rejects.toBeInstanceOf(BirthdayActionError);
  });
});

describe('updateBirthday', () => {
  it('writes only changed fields', async () => {
    await updateBirthday({ db }, 'b-1', { name: '  Renamed  ' });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:birthdays/b-1' }, { name: 'Renamed' });
  });

  it('rejects empty-trimmed name', async () => {
    await expect(updateBirthday({ db }, 'b-1', { name: '   ' })).rejects.toBeInstanceOf(
      BirthdayActionError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('rejects malformed monthDay on update', async () => {
    await expect(
      updateBirthday({ db }, 'b-1', { monthDay: 'tomorrow' }),
    ).rejects.toBeInstanceOf(BirthdayActionError);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('clears note with deleteField when null', async () => {
    await updateBirthday({ db }, 'b-1', { note: null });
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:birthdays/b-1' },
      { note: deleteFieldSentinel },
    );
  });

  it('clears birthYear with deleteField when null', async () => {
    await updateBirthday({ db }, 'b-1', { birthYear: null });
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:birthdays/b-1' },
      { birthYear: deleteFieldSentinel },
    );
  });

  it('does NOT write if the patch is empty', async () => {
    await updateBirthday({ db }, 'b-1', {});
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('deleteBirthday', () => {
  it('calls deleteDoc on the matching ref', async () => {
    await deleteBirthday({ db }, 'b-1');
    expect(deleteDocMock).toHaveBeenCalledWith({ __ref: 'doc:birthdays/b-1' });
  });

  it('maps Firestore failure to BirthdayActionError', async () => {
    deleteDocMock.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteBirthday({ db }, 'b-1')).rejects.toBeInstanceOf(BirthdayActionError);
  });
});
