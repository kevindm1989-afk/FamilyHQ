/**
 * Pure timezone helper shared by PR F's two scheduled functions
 * (`notifyEventReminders`, `notifyBirthdays`). Extracted per second-opinion
 * concern 1 — previously duplicated verbatim in both files; a future
 * Feb-29 / DST / IANA-zone bugfix would have had to land twice.
 *
 * Computes the family's local hour (0-23, h23 cycle) and the family-local
 * date string (YYYY-MM-DD) for a given UTC instant + IANA timezone.
 * Falls back to `America/Toronto` if the supplied timezone is invalid
 * (Intl.DateTimeFormat throws on unknown zone identifiers).
 *
 * `usedFallback` is true when the supplied tz was invalid and the fallback
 * was used — the sweep handler logs a structured warn (without the invalid
 * tz string itself, per M50) so operators can see which families need
 * settings UI follow-up (F13).
 *
 * NOTE on the unit field name: returns `day` as the family-local YYYY-MM-DD
 * string. This value is BANNED from logger payloads (M38 forbidden-field
 * list: `timezone` AND `localDay`) — it is consumed inline only.
 */
export const DEFAULT_TIMEZONE = 'America/Toronto';

export function localHourAndDay(
  nowMs: number,
  tz: string,
): { hour: number; day: string; usedFallback: boolean } {
  function compute(zone: string): { hour: number; day: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(nowMs));
    const lookup: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') lookup[part.type] = part.value;
    }
    const year = lookup['year'] ?? '1970';
    const month = lookup['month'] ?? '01';
    const dayOfMonth = lookup['day'] ?? '01';
    const hourStr = lookup['hour'] ?? '00';
    return {
      hour: Number.parseInt(hourStr, 10),
      day: `${year}-${month}-${dayOfMonth}`,
    };
  }
  try {
    const result = compute(tz);
    return { ...result, usedFallback: false };
  } catch {
    const fallback = compute(DEFAULT_TIMEZONE);
    return { ...fallback, usedFallback: true };
  }
}
