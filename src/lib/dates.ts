/**
 * Local-day helpers.
 *
 * Both functions reduce a date to the viewer's LOCAL calendar day so day
 * comparisons / groupings survive a UTC roll-over. Pure: no clock read.
 *
 * Lesson 2026-05-28 (`.context/lessons.md`): never `iso.slice(0,10)` for
 * "today" (that's UTC), and never `new Date('YYYY-MM-DD')` for a date-only
 * input (that's UTC-midnight and shifts a day back in a UTC-behind zone). Both
 * sides of a day comparison must come through these helpers — the SAME basis
 * on both sides.
 */

/**
 * Map an instant (epoch ms) to the viewer's LOCAL calendar day as a comparable
 * `YYYY-MM-DD` string. Uses local date PARTS (`getFullYear`/`getMonth`/`getDate`),
 * never an ISO substring. Callers should pass a finite number; a non-finite
 * input is returned as `NaN-NaN-NaN` (the function is pure — no `Date.now()`
 * fallback). Guard at the call site if your input may be non-finite.
 */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Resolve an event date string to the SAME local-day basis as `localDayKey`.
 *
 * Returns `{ key, instant }` where `key` is the event's LOCAL `YYYY-MM-DD` and
 * `instant` is the parsed epoch ms (useful for soonest-first ordering). Returns
 * `null` for empty / non-string / unparseable input so the caller can drop the
 * record.
 *
 * - A bare `YYYY-MM-DD` is interpreted as a LOCAL calendar day directly — built
 *   via `new Date(year, month-1, day)`, NOT `new Date('YYYY-MM-DD')` (which is
 *   UTC-midnight and shifts a day back in a UTC-behind zone).
 * - A time-bearing / offset-bearing ISO datetime is parsed to an instant, then
 *   reduced to its LOCAL day via the same parts `localDayKey` uses.
 */
export function eventLocalDay(input: string): { key: string; instant: number } | null {
  if (typeof input !== 'string' || input === '') return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const local = new Date(year, month - 1, day);
    if (Number.isNaN(local.getTime())) return null;
    return { key: localDayKey(local.getTime()), instant: local.getTime() };
  }

  const instant = new Date(input).getTime();
  if (Number.isNaN(instant)) return null;
  return { key: localDayKey(instant), instant };
}
