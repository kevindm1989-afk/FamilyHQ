/**
 * Natural-language event parser — turn "Soccer practice next Friday" (or
 * "Entraînement de soccer vendredi prochain") into a structured {title, date,
 * tag} the existing calendarService.createEvent path can store. 100%
 * CLIENT-SIDE and DETERMINISTIC: no LLM, no network, no third-party processor —
 * so it stays clean against constraints.md (children are users; any
 * analytics/NLP subprocessor is a human gate) and works offline.
 *
 * BILINGUAL (EN + FR) to honour the app's official-languages parity: English
 * and French weekday/month names, relative words (today/tomorrow ·
 * aujourd'hui/demain/après-demain), and both word orders for "next" ("next
 * Friday" · "vendredi prochain").
 *
 * Why this matters: the AddEvent form only offers Today / Tomorrow radios
 * ("Pick date" is a deferred placeholder), so today there is NO way to create
 * an event for an arbitrary day from the UI. This parser fills that gap AND
 * makes capture faster.
 *
 * Day granularity (deliberate): the locked event schema has no time-of-day
 * field, and the UI renders the DAY (friendlyDate reads the YYYY-MM-DD prefix).
 * So we resolve the DAY and store it at UTC-noon exactly like
 * AddEvent.isoForDay — unambiguous, DST-safe, day prefix always correct. We do
 * NOT invent a stored time the UI would never show; time words are left in the
 * title.
 *
 * The parse is ALWAYS previewed before anything is created — a mis-parse must
 * never silently write an event (see CalendarScreen quick-add).
 */
import type { EventTag } from '../../lib/types';

export interface ParsedNaturalEvent {
  /** Cleaned event title (date phrase removed, original casing preserved). */
  title: string;
  /** ISO datetime at UTC-noon for the resolved day (mirrors AddEvent.isoForDay). */
  date: string;
  /** Category inferred from keywords; defaults to 'family'. */
  tag: EventTag;
  /** True when an explicit date phrase was found; false means we defaulted to today. */
  hadDate: boolean;
  /** Resolved day parts (0-based month) — used by the preview + tests. */
  ymd: { year: number; month: number; day: number };
}

interface Ymd {
  year: number;
  month: number; // 0-based
  day: number;
}

// Weekday names (0=Sun), EN + FR. Ambiguous 3-letter forms are omitted.
const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  dimanche: 0,
  mon: 1,
  monday: 1,
  lundi: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  mardi: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  mercredi: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  jeudi: 4,
  fri: 5,
  friday: 5,
  vendredi: 5,
  sat: 6,
  saturday: 6,
  samedi: 6,
};

// Month names (0-based), EN + FR (accented + de-accented FR variants).
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  janvier: 0,
  feb: 1,
  february: 1,
  février: 1,
  fevrier: 1,
  mar: 2,
  march: 2,
  mars: 2,
  apr: 3,
  april: 3,
  avril: 3,
  may: 4,
  mai: 4,
  jun: 5,
  june: 5,
  juin: 5,
  jul: 6,
  july: 6,
  juillet: 6,
  aug: 7,
  august: 7,
  août: 7,
  aout: 7,
  sep: 8,
  sept: 8,
  september: 8,
  septembre: 8,
  oct: 9,
  october: 9,
  octobre: 9,
  nov: 10,
  november: 10,
  novembre: 10,
  dec: 11,
  december: 11,
  décembre: 11,
  decembre: 11,
};

// Category keyword sets (EN + FR). First set (in priority order) with a
// whole-word hit wins; no hit → 'family' (the safe default for a family app).
const TAG_KEYWORDS: ReadonlyArray<{ tag: EventTag; words: readonly string[] }> = [
  {
    tag: 'sports',
    words: [
      'practice',
      'game',
      'match',
      'tournament',
      'scrimmage',
      'tryout',
      'tryouts',
      'soccer',
      'hockey',
      'baseball',
      'basketball',
      'football',
      'volleyball',
      'tennis',
      'swim',
      'swimming',
      'dance',
      'gym',
      'workout',
      'karate',
      'gymnastics',
      'ski',
      // FR
      'entraînement',
      'entrainement',
      'partie',
      'tournoi',
      'natation',
      'danse',
      'soccer',
    ],
  },
  {
    tag: 'school',
    words: [
      'school',
      'class',
      'homework',
      'exam',
      'test',
      'quiz',
      'project',
      'teacher',
      'pta',
      'assembly',
      'lecture',
      'tutor',
      'tutoring',
      'graduation',
      'recital',
      'library',
      // FR
      'école',
      'ecole',
      'classe',
      'devoirs',
      'examen',
      'cours',
      'projet',
      'bibliothèque',
    ],
  },
  {
    tag: 'work',
    words: [
      'work',
      'meeting',
      'shift',
      'office',
      'conference',
      'deadline',
      'interview',
      'standup',
      'sync',
      'review',
      'presentation',
      'client',
      // FR
      'travail',
      'réunion',
      'reunion',
      'bureau',
      'conférence',
      'entrevue',
      'quart',
    ],
  },
];

/** ISO datetime at UTC-noon for a day — mirrors AddEvent.isoForDay (DST-safe). */
function isoForDay(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d, 12, 0, 0)).toISOString();
}

/** Local calendar parts of a Date (never UTC — see the day-bucketing lesson). */
function localYmd(now: Date): Ymd {
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

/** Add `n` days to a Ymd via UTC math (correct across month/year rollover). */
function addDays(base: Ymd, n: number): Ymd {
  const d = new Date(Date.UTC(base.year, base.month, base.day + n, 12, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Weekday index (0=Sun) of a Ymd. */
function weekdayOf(ymd: Ymd): number {
  return new Date(Date.UTC(ymd.year, ymd.month, ymd.day, 12, 0, 0)).getUTCDay();
}

/** Is `a` strictly before `b` by calendar day? */
function isBefore(a: Ymd, b: Ymd): boolean {
  if (a.year !== b.year) return a.year < b.year;
  if (a.month !== b.month) return a.month < b.month;
  return a.day < b.day;
}

/** True when `d` is a real calendar day (rejects 02-30, 04-31, etc.). */
function isValidDay(y: number, m: number, d: number): boolean {
  if (m < 0 || m > 11 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m, d, 12, 0, 0));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m && probe.getUTCDate() === d;
}

interface DateMatch {
  ymd: Ymd;
  start: number;
  end: number;
}

/**
 * Find the first (highest-priority) date phrase in `lower`, resolving it
 * relative to `today`. Returns the resolved day + the [start,end) span to strip
 * from the title. null when no date phrase is present.
 */
function findDate(lower: string, today: Ymd): DateMatch | null {
  const monNames = Object.keys(MONTHS).join('|');
  const weekdayNames = Object.keys(WEEKDAYS).join('|');

  // 1. Month-name + day (+ optional year): "jan 5", "5 décembre 2027".
  const mNameDay = new RegExp(
    `\\b(${monNames})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th|er)?(?:,?\\s*(\\d{4}))?\\b`,
  );
  // 1b. Day + month-name: "5 jan", "5 juillet".
  const dayMName = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th|er)?\\s+(?:of\\s+|de\\s+)?(${monNames})\\b`,
  );
  // 2. Numeric M/D(/Y): "12/5", "12-05-2027".
  const numeric = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/;
  // 3. "in N days" / "dans N jours".
  const inNDays = /\b(?:in|dans)\s+(\d{1,2})\s+(?:days?|jours?)\b/;
  // 4. Relative words (EN + FR). Order the two-word FR forms before the single.
  const relative =
    /\b(apr[eè]s-demain|aujourd['’]hui|ce\s+soir|today|tonight|tomorrow|tmrw|tmr|demain)\b/;
  // 5. Weekday, optional "next/this/ce/cette" before OR "prochain(e)/next" after.
  const weekday = new RegExp(
    `\\b(?:(next|this|ce|cette)\\s+)?(${weekdayNames})(?:\\s+(prochaine?|next))?\\b`,
  );

  const resolveMonthDay = (month: number, day: number, yearRaw: string | undefined): Ymd | null => {
    let year: number;
    if (yearRaw !== undefined) {
      year = yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw);
    } else {
      year = today.year;
    }
    if (!isValidDay(year, month, day)) return null;
    let ymd: Ymd = { year, month, day };
    // No explicit year and the date already passed this year → assume next year.
    if (yearRaw === undefined && isBefore(ymd, today)) ymd = { ...ymd, year: year + 1 };
    return ymd;
  };

  let m: RegExpExecArray | null;

  if ((m = mNameDay.exec(lower)) !== null) {
    const month = MONTHS[m[1] as keyof typeof MONTHS] ?? 0;
    const ymd = resolveMonthDay(month, Number(m[2]), m[3]);
    if (ymd) return { ymd, start: m.index, end: m.index + m[0].length };
  }
  if ((m = dayMName.exec(lower)) !== null) {
    const month = MONTHS[m[2] as keyof typeof MONTHS] ?? 0;
    const ymd = resolveMonthDay(month, Number(m[1]), undefined);
    if (ymd) return { ymd, start: m.index, end: m.index + m[0].length };
  }
  if ((m = numeric.exec(lower)) !== null) {
    const ymd = resolveMonthDay(Number(m[1]) - 1, Number(m[2]), m[3]);
    if (ymd) return { ymd, start: m.index, end: m.index + m[0].length };
  }
  if ((m = inNDays.exec(lower)) !== null) {
    return { ymd: addDays(today, Number(m[1])), start: m.index, end: m.index + m[0].length };
  }
  if ((m = relative.exec(lower)) !== null) {
    const word = m[1] as string;
    let ymd: Ymd;
    if (/^apr[eè]s-demain$/.test(word)) ymd = addDays(today, 2);
    else if (word === 'tomorrow' || word === 'tmrw' || word === 'tmr' || word === 'demain') {
      ymd = addDays(today, 1);
    } else ymd = today; // today / tonight / aujourd'hui / ce soir
    return { ymd, start: m.index, end: m.index + m[0].length };
  }
  if ((m = weekday.exec(lower)) !== null) {
    const before = m[1];
    const after = m[3];
    const target = WEEKDAYS[m[2] as keyof typeof WEEKDAYS] ?? 0;
    const cur = weekdayOf(today);
    let delta = (target - cur + 7) % 7; // 0..6; 0 = today
    const isNext = before === 'next' || after !== undefined; // "next Fri" / "Fri prochain"
    if (isNext) delta += 7;
    return { ymd: addDays(today, delta), start: m.index, end: m.index + m[0].length };
  }
  return null;
}

function inferTag(lower: string): EventTag {
  for (const { tag, words } of TAG_KEYWORDS) {
    for (const w of words) {
      if (new RegExp(`\\b${w}\\b`).test(lower)) return tag;
    }
  }
  return 'family';
}

// Connector words trimmed from title ends (EN + FR).
const CONNECTORS = new Set([
  'on',
  'at',
  'this',
  'next',
  'the',
  'for',
  'a',
  'an',
  'of',
  'to',
  '-',
  '–',
  'le',
  'la',
  'de',
  'du',
  'ce',
  'cette',
  'à',
  'pour',
  'prochain',
  'prochaine',
]);

/** Trim connector words + punctuation from both ends; collapse inner whitespace. */
function cleanTitle(raw: string): string {
  let words = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .split(' ')
    .filter((w) => w.length > 0);
  while (words.length > 0 && CONNECTORS.has(words[0]!.toLowerCase())) words = words.slice(1);
  while (words.length > 0 && CONNECTORS.has(words[words.length - 1]!.toLowerCase())) {
    words = words.slice(0, -1);
  }
  const title = words.join(' ').trim();
  if (title.length === 0) return '';
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Parse a natural-language phrase into a structured event. Returns null when no
 * usable title remains (e.g. the input was ONLY a date, like "tomorrow"). When
 * no date phrase is present, defaults to today with `hadDate: false` so the
 * preview can flag it.
 *
 * `now` is injected for determinism (never reads the clock itself).
 */
export function parseNaturalEvent(input: string, now: Date): ParsedNaturalEvent | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  const today = localYmd(now);

  const dateMatch = findDate(lower, today);
  const ymd = dateMatch ? dateMatch.ymd : today;

  const titleSource = dateMatch
    ? trimmed.slice(0, dateMatch.start) + ' ' + trimmed.slice(dateMatch.end)
    : trimmed;
  const title = cleanTitle(titleSource);
  if (title.length === 0) return null;

  return {
    title,
    date: isoForDay(ymd.year, ymd.month, ymd.day),
    tag: inferTag(lower),
    hadDate: dateMatch !== null,
    ymd,
  };
}
