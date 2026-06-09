/**
 * Birthdays service — family birthdays + anniversaries.
 *
 * Thin client-side wrapper over the `birthdays` collection. Authority: ANY
 * active same-family caller has full CRUD (firestore.rules is authoritative
 * — see `test/rules/birthdays.test.ts`). This module validates input shape +
 * trims strings + maps any Firestore failure to a PII-free user-safe error.
 *
 * Date model: `monthDay` is `"MM-DD"` (zero-padded). Year is omitted so the
 * dashboard widget's "days until next occurrence" math works without a known
 * birth year, and avoids the "0 days old" edge. Optional `birthYear` is for
 * the "turning N" badge.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { birthdayConverter } from '../../lib/converters';
import type { Birthday, BirthdayType } from '../../lib/types';

const BIRTHDAYS_COLLECTION = 'birthdays';

export const BIRTHDAY_NAME_MAX = 80;
export const BIRTHDAY_NOTE_MAX = 500;

export const BIRTHDAY_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const BIRTHDAY_NAME_EMPTY = 'Please enter a name.';
export const BIRTHDAY_NAME_TOO_LONG = `Keep the name under ${BIRTHDAY_NAME_MAX} characters.`;
export const BIRTHDAY_NOTE_TOO_LONG = `Keep the note under ${BIRTHDAY_NOTE_MAX} characters.`;
export const BIRTHDAY_MONTHDAY_INVALID = 'Please pick a valid month and day.';
export const BIRTHDAY_BIRTHYEAR_INVALID = 'Please enter a valid birth year.';

export class BirthdayActionError extends Error {
  constructor(message: string = BIRTHDAY_GENERIC_ERROR) {
    super(message);
    this.name = 'BirthdayActionError';
  }
}

export interface BirthdayWithId extends Birthday {
  id: string;
}

const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

/**
 * True when `s` is `MM-DD` AND a real calendar day (rejects 02-30, 04-31).
 * Feb 29 is accepted because the widget anchors to a year context at render
 * time (a leap-day birthday is "celebrated on Feb 28 in non-leap years" is
 * a UI policy choice — the data model just stores the source MM-DD).
 */
export function isValidMonthDay(s: string): boolean {
  if (!MONTH_DAY_RE.test(s)) return false;
  const parts = s.split('-').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 2) return false;
  const [m, d] = parts as [number, number];
  // Use a leap year (2024) so 02-29 is accepted. Other months still
  // round-trip the day-of-month bound.
  const dt = new Date(Date.UTC(2024, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Helper to format `MM-DD` from local date parts (month is 1-12, day 1-31).
 * Pads to two digits. Useful for tests + the dashboard selector.
 */
export function monthDayFromParts(month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${m}-${d}`;
}

export interface CreateBirthdayInput {
  familyId: string;
  createdBy: string;
  name: string;
  monthDay: string;
  type: BirthdayType;
  birthYear?: number;
  note?: string;
}

export async function createBirthday(
  deps: { db: Firestore },
  input: CreateBirthdayInput,
): Promise<string> {
  const name = input.name.trim();
  if (name.length === 0) throw new BirthdayActionError(BIRTHDAY_NAME_EMPTY);
  if (name.length > BIRTHDAY_NAME_MAX) throw new BirthdayActionError(BIRTHDAY_NAME_TOO_LONG);
  if (!isValidMonthDay(input.monthDay)) {
    throw new BirthdayActionError(BIRTHDAY_MONTHDAY_INVALID);
  }
  let note: string | undefined;
  if (typeof input.note === 'string') {
    const trimmed = input.note.trim();
    if (trimmed.length > BIRTHDAY_NOTE_MAX) {
      throw new BirthdayActionError(BIRTHDAY_NOTE_TOO_LONG);
    }
    if (trimmed.length > 0) note = trimmed;
  }
  if (input.birthYear !== undefined && !isValidBirthYear(input.birthYear)) {
    throw new BirthdayActionError(BIRTHDAY_BIRTHYEAR_INVALID);
  }

  const body = {
    familyId: input.familyId,
    createdBy: input.createdBy,
    name,
    monthDay: input.monthDay,
    type: input.type,
    createdAt: Date.now(),
    ...(note !== undefined ? { note } : {}),
    ...(input.birthYear !== undefined ? { birthYear: input.birthYear } : {}),
  };

  try {
    const ref = await addDoc(
      collection(deps.db, BIRTHDAYS_COLLECTION).withConverter(birthdayConverter),
      body as unknown as Birthday,
    );
    return ref.id;
  } catch {
    throw new BirthdayActionError();
  }
}

export interface UpdateBirthdayInput {
  name?: string;
  monthDay?: string;
  type?: BirthdayType;
  birthYear?: number | null;
  note?: string | null;
}

export async function updateBirthday(
  deps: { db: Firestore },
  birthdayId: string,
  input: UpdateBirthdayInput,
): Promise<void> {
  const patch: { [k: string]: unknown } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) throw new BirthdayActionError(BIRTHDAY_NAME_EMPTY);
    if (name.length > BIRTHDAY_NAME_MAX) throw new BirthdayActionError(BIRTHDAY_NAME_TOO_LONG);
    patch.name = name;
  }
  if (input.monthDay !== undefined) {
    if (!isValidMonthDay(input.monthDay)) {
      throw new BirthdayActionError(BIRTHDAY_MONTHDAY_INVALID);
    }
    patch.monthDay = input.monthDay;
  }
  if (input.type !== undefined) {
    patch.type = input.type;
  }
  if (input.birthYear === null) {
    patch.birthYear = deleteField();
  } else if (typeof input.birthYear === 'number') {
    if (!isValidBirthYear(input.birthYear)) {
      throw new BirthdayActionError(BIRTHDAY_BIRTHYEAR_INVALID);
    }
    patch.birthYear = input.birthYear;
  }
  if (input.note === null) {
    patch.note = deleteField();
  } else if (typeof input.note === 'string') {
    const trimmed = input.note.trim();
    if (trimmed.length > BIRTHDAY_NOTE_MAX) {
      throw new BirthdayActionError(BIRTHDAY_NOTE_TOO_LONG);
    }
    if (trimmed.length === 0) patch.note = deleteField();
    else patch.note = trimmed;
  }
  if (Object.keys(patch).length === 0) return;
  try {
    await updateDoc(
      doc(deps.db, BIRTHDAYS_COLLECTION, birthdayId),
      patch as unknown as { [k: string]: string | number },
    );
  } catch {
    throw new BirthdayActionError();
  }
}

export async function deleteBirthday(deps: { db: Firestore }, birthdayId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, BIRTHDAYS_COLLECTION, birthdayId));
  } catch {
    throw new BirthdayActionError();
  }
}

function isValidBirthYear(year: number): boolean {
  if (!Number.isFinite(year) || !Number.isInteger(year)) return false;
  // Reject obviously-impossible years. 1900 = "the family ancestor cap" —
  // anything before is almost certainly a typo. Future years also rejected.
  const thisYear = new Date().getFullYear();
  return year >= 1900 && year <= thisYear;
}
