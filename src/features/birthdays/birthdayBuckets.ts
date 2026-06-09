/**
 * Pure helpers for surfacing upcoming birthdays on the dashboard.
 *
 * The "days until next occurrence" math is the only non-trivial piece —
 * it must handle:
 *   - today's birthday (0 days)
 *   - tomorrow's birthday (1 day, even across month boundary)
 *   - a birthday earlier this month (wraps to next year)
 *   - Feb 29 in a non-leap year (treat as Feb 28 for the next-occurrence
 *     comparison)
 *
 * `todayLocal` is `{ year, month, day }` injected by the caller so the
 * selector is deterministic + unit-testable without freezing the system
 * clock. Month is 1-12.
 */
import type { BirthdayWithId } from './birthdaysService';

export interface LocalDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

export function localToday(now: Date = new Date()): LocalDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * Days until the next occurrence of `MM-DD` given `todayLocal`. Returns 0
 * when today IS the day. Wraps to next year when the date has already
 * passed this year. Returns `null` when `monthDay` is malformed.
 *
 * Feb 29 is treated as Feb 28 in non-leap years for the comparison only
 * — the source MM-DD on the doc is unchanged.
 */
export function daysUntilNextOccurrence(monthDay: string, todayLocal: LocalDate): number | null {
  const m = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (m === null) return null;
  const month = Number.parseInt(m[1]!, 10);
  const day = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const todayUtcMs = Date.UTC(todayLocal.year, todayLocal.month - 1, todayLocal.day);

  // Candidate occurrence this year. Feb 29 in a non-leap year shifts to Feb 28
  // for the comparison so the widget never says "366 days" or skips a year.
  const candidateThisYear = makeOccurrence(todayLocal.year, month, day);
  if (candidateThisYear === null) return null;
  let candidateMs = candidateThisYear.getTime();

  if (candidateMs < todayUtcMs) {
    const next = makeOccurrence(todayLocal.year + 1, month, day);
    if (next === null) return null;
    candidateMs = next.getTime();
  }

  return Math.round((candidateMs - todayUtcMs) / (24 * 60 * 60 * 1000));
}

/** Construct a UTC Date for the given Y/M/D, falling back to Feb 28 for Feb 29 in a non-leap year. */
function makeOccurrence(year: number, month: number, day: number): Date | null {
  let dt = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC silently overflows (Feb 29 in a non-leap year → Mar 1). Detect
  // and fall back to the prior day for the leap-day case; otherwise return
  // null so a 04-31 input doesn't sneak through as May 1.
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    if (month === 2 && day === 29) {
      dt = new Date(Date.UTC(year, 1, 28));
    } else {
      return null;
    }
  }
  return dt;
}

/**
 * Pick the next N birthdays starting from `todayLocal`. Sorted by days-until
 * ascending (0 first), then by name for stable ties. Drops entries with a
 * malformed `monthDay` (so the widget never throws on bad data).
 */
export interface UpcomingBirthday extends BirthdayWithId {
  daysUntil: number;
  /**
   * If `birthYear` is set, the age the subject will be on the next
   * occurrence (today included). Null when `birthYear` is absent OR when the
   * computed age would be impossible (e.g. future year).
   */
  turningAge: number | null;
}

export function selectUpcomingBirthdays(
  items: BirthdayWithId[],
  todayLocal: LocalDate,
  limit: number,
  windowDays: number = 60,
): UpcomingBirthday[] {
  const out: UpcomingBirthday[] = [];
  for (const item of items) {
    const days = daysUntilNextOccurrence(item.monthDay, todayLocal);
    if (days === null) continue;
    if (days > windowDays) continue;
    out.push({ ...item, daysUntil: days, turningAge: computeTurningAge(item, todayLocal, days) });
  }
  out.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return a.name.localeCompare(b.name);
  });
  return out.slice(0, limit);
}

function computeTurningAge(
  item: BirthdayWithId,
  todayLocal: LocalDate,
  daysUntil: number,
): number | null {
  if (item.birthYear === undefined) return null;
  if (!Number.isFinite(item.birthYear)) return null;
  // The next occurrence falls in todayLocal.year unless daysUntil pushed us
  // past Dec 31 — then it's next year.
  const occurrenceYear =
    daysUntil === 0 ? todayLocal.year : occurrenceYearOf(item.monthDay, todayLocal);
  if (occurrenceYear === null) return null;
  const age = occurrenceYear - item.birthYear;
  if (age < 0) return null;
  return age;
}

function occurrenceYearOf(monthDay: string, todayLocal: LocalDate): number | null {
  const m = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (m === null) return null;
  const month = Number.parseInt(m[1]!, 10);
  const day = Number.parseInt(m[2]!, 10);
  const isPastThisYear =
    month < todayLocal.month || (month === todayLocal.month && day < todayLocal.day);
  return isPastThisYear ? todayLocal.year + 1 : todayLocal.year;
}
