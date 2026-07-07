/**
 * First-party telemetry — anonymous usage counters + PI-scrubbed client
 * error reports. NO third-party SDK, by explicit decision (constraints.md:
 * "No behavioural tracking, ever, while children are users"; any third-party
 * analytics/error processor requires human review — this module avoids the
 * question entirely by keeping every byte on our own Firestore).
 *
 * Privacy invariants (enforced here AND at firestore.rules):
 *  - usageEvents docs carry EXACTLY {event, day}. No uid, no familyId, no
 *    device/session id — nothing links an event to a person or family, so
 *    counts are aggregate-anonymous and constraint-clean for ALL users,
 *    children included.
 *  - clientErrors docs carry a scrubbed error shape only: emails and long
 *    digit runs are masked, route params are collapsed to ':id', everything
 *    is length-capped (rules re-enforce the caps server-side).
 *  - Both collections are CREATE-ONLY for active users and unreadable from
 *    the client (review the data in the Firebase console).
 *
 * Reliability invariants:
 *  - trackUsage/reportClientError NEVER throw and NEVER reject — telemetry
 *    must not be able to break a feature. All Firebase access is via dynamic
 *    import so this module adds no SDK weight to any bundle that imports it
 *    (App.tsx and the login-adjacent services stay lean).
 *  - Error reports are capped per session (ERROR_REPORT_SESSION_CAP) so a
 *    render-loop crash cannot spam writes.
 */

/**
 * The event allowlist. MUST stay in lockstep with the `usageEvents` rules
 * block in firestore.rules — an event added here without a rules update is
 * silently dropped server-side (create denied), which the fire-and-forget
 * writer swallows.
 */
export type UsageEventName =
  | 'family_created'
  | 'invite_accepted'
  | 'child_created'
  | 'chore_created'
  | 'chore_approved'
  | 'wishlist_redeemed'
  | 'calendar_event_created';

export const ERROR_REPORT_SESSION_CAP = 5;

let errorReportsThisSession = 0;
let forceEnabledForTests = false;

/** Test-only: reset the per-session error-report counter. */
export function _resetErrorReportCountForTests(): void {
  errorReportsThisSession = 0;
}

/** Test-only: let telemetry's OWN tests exercise the write path. */
export function _forceEnableForTests(on: boolean): void {
  forceEnabledForTests = on;
}

/**
 * Telemetry is inert under vitest unless force-enabled: the writers fire
 * DETACHED async work, so in any feature test that mocks firebase/firestore
 * a stray usageEvents addDoc would land at an unpredictable microtask and
 * pollute precise mock-call assertions (the 2026-07-05 flake lesson's
 * cousin). Feature suites should never see telemetry side effects.
 */
function enabled(): boolean {
  if (forceEnabledForTests) return true;
  return !import.meta.env.VITEST;
}

/**
 * Firebase access, lazily imported ONCE and memoized. Every telemetry write
 * awaits this single shared promise rather than issuing its own dynamic
 * import — so N concurrent writes (a crash loop, a burst of ticks) trigger
 * exactly one import, not N. This keeps zero SDK weight on importers' bundles
 * AND sidesteps a vitest hang where multiple concurrent dynamic imports of a
 * mocked module never resolve.
 */
type FirebaseBits = {
  db: import('firebase/firestore').Firestore;
  addDoc: typeof import('firebase/firestore').addDoc;
  collection: typeof import('firebase/firestore').collection;
};
let firebaseBitsPromise: Promise<FirebaseBits> | null = null;
function loadFirebase(): Promise<FirebaseBits> {
  if (firebaseBitsPromise === null) {
    firebaseBitsPromise = Promise.all([
      import('../firebase/config'),
      import('firebase/firestore'),
    ]).then(([cfg, fs]) => ({ db: cfg.db, addDoc: fs.addDoc, collection: fs.collection }));
  }
  return firebaseBitsPromise;
}

/** Local calendar date as YYYY-MM-DD (the only time granularity we store). */
function localDay(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Scrub free text before it leaves the device: mask email-shaped substrings
 * and digit runs of 6+ (phone numbers, ids), then cap the length. The rules
 * layer re-enforces the caps; the masking can only happen client-side.
 */
export function scrubText(input: string, maxLength: number): string {
  return input
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\d{6,}/g, '[num]')
    .slice(0, maxLength);
}

/**
 * Reduce a pathname to a shape with no identifiers: any segment longer than
 * 12 characters (doc ids, invite codes, uids) collapses to ':id'. Query and
 * hash must be stripped by the caller (we only ever pass location.pathname).
 */
export function scrubRoute(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => (seg.length > 12 ? ':id' : seg))
    .join('/')
    .slice(0, 100);
}

/**
 * First app-code frame of a stack trace, origin stripped. Enough to locate
 * the crash without shipping the full stack (which can embed prop values on
 * some frameworks/browsers).
 */
export function stackHead(stack: string | undefined): string {
  const line = (stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') || l.includes('@'));
  if (!line) return '';
  return scrubText(line.replace(/https?:\/\/[^/]+/g, ''), 200);
}

/**
 * Record one anonymous usage tick. Fire-and-forget: returns immediately,
 * swallows every failure (offline, rules denial, missing config in tests).
 */
export function trackUsage(event: UsageEventName): void {
  if (!enabled()) return;
  void (async () => {
    const { db, addDoc, collection } = await loadFirebase();
    await addDoc(collection(db, 'usageEvents'), { event, day: localDay() });
  })().catch(() => {
    // Telemetry must never surface a failure. Intentionally silent.
  });
}

export interface ClientErrorInput {
  error: Error;
  componentStack?: string;
  /** location.pathname ONLY — never pass search/hash. */
  pathname?: string;
}

/**
 * Record a scrubbed client error (wired to the ErrorBoundary's reportError
 * seam). Same never-throw contract as trackUsage; additionally capped at
 * ERROR_REPORT_SESSION_CAP per session so a crash-loop cannot spam writes.
 */
export function reportClientError(input: ClientErrorInput): void {
  if (!enabled()) return;
  if (errorReportsThisSession >= ERROR_REPORT_SESSION_CAP) return;
  errorReportsThisSession += 1;
  const doc = {
    name: scrubText(input.error.name || 'Error', 60),
    message: scrubText(input.error.message || '', 300),
    stackHead: stackHead(input.error.stack ?? input.componentStack),
    route: scrubRoute(input.pathname ?? ''),
    day: localDay(),
  };
  void (async () => {
    const { db, addDoc, collection } = await loadFirebase();
    await addDoc(collection(db, 'clientErrors'), doc);
  })().catch(() => {
    // Intentionally silent — see trackUsage.
  });
}
