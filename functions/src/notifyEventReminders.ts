/**
 * notifyEventReminders — scheduled push (PR F task F7, ADR-0016).
 *
 * Hourly UTC sweep (`0 * * * *`) that selects every family whose local hour
 * is 8 and fan-outs ONE multicast per family containing the day's events.
 * The event payload is IGNORED entirely (M46(a)) — all inputs are derived
 * server-side from the wall clock and Firestore.
 *
 * Threat-model coverage (§A.18, T7.1..T7.8 / M45..M52):
 *   - M46(a): handler never reads the event argument (no `event` identifier
 *     in the handler body; AST-pinned by F-T1).
 *   - M46(b): per-family try/catch; handler NEVER rejects; one family's
 *     throw never aborts the surrounding sweep (F-T2).
 *   - M46(c): `retryConfig.retryCount: 0` declared in `onSchedule` options
 *     so Cloud Scheduler does not retry on transient failure — markers
 *     handle dedupe, retries would only burn reads (F-T3).
 *   - M47: cross-family isolation by construction — all per-family state
 *     (recipient list, token buffer, marker ref) lives inside the
 *     `sendForFamily` helper, scoped by the loop's `familyId`. Every
 *     recipient's `userPrivate.familyId` is re-checked against the loop's
 *     family (M35.7 analog, skip+warn never throw). F-T4 / F-T5 / F-T13.
 *   - M48: marker-before-send via `ref.create()`; `ALREADY_EXISTS` → silent
 *     skip. A throwing send leaves the marker in place — at-most-once
 *     (F-PN-13 accepted). F-T6 / F-T7.
 *   - M49: per-family per-day fan-out cap of 10 (events ordered by `date`
 *     ascending, slice(0,10)); overflow is dropped with one structured
 *     warn `{kind, familyId, droppedCount}`. F-T9.
 *   - M50: timezone-fallback + log containment — invalid or absent
 *     `families.timezone` falls back to `America/Toronto`; the invalid-tz
 *     warn payload carries `{kind, familyId}` only, never the tz string.
 *     `timezone` and `localDay` NEVER appear as log payload keys (M38
 *     FORBIDDEN list, AST-pinned by F-T10).
 *   - M51: fire-time recipient evaluation — `isActive`, prefs, and tokens
 *     are read inside the sweep, never cached. F-T12.
 *   - M52: outbound FCM body uses the FROZEN constants from
 *     `notificationBodies.ts` (`eventReminder`). No event title, no
 *     description, no PI ever enters the payload. F-T14.
 *
 * Trigger architecture: `onSchedule` v2 (`firebase-functions/v2/scheduler`),
 * region `northamerica-northeast1`, schedule `0 * * * *` in `UTC`. The
 * deploy-managed Cloud Scheduler job invokes the function over OIDC-
 * authenticated HTTPS; M45's positive invoker pin is verified manually per
 * `docs/runbooks/observability.md`. No `context.auth`, no App Check — TB7
 * authentication is the OIDC token on the boundary, not anything inside
 * this handler.
 *
 * Logging: `firebase-functions/logger` only; payload field names restricted
 * to the M38 allow-list. `timezone` and `localDay` are on the FORBIDDEN
 * list — they exist as in-handler locals but never enter a log payload.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { initializeApp, getApps } from 'firebase-admin/app';
import { NOTIFICATION_BODIES } from './notificationBodies.js';
import { localHourAndDay, DEFAULT_TIMEZONE } from './lib/localHourAndDay.js';

if (getApps().length === 0) {
  initializeApp();
}

const KIND = 'eventReminder';
const CATEGORY_KEY = 'eventReminders';
const REGION = 'northamerica-northeast1';
// §14.2 — until the F13 family-settings UI ships, every family defaults to
// America/Toronto. An absent or invalid `families.timezone` falls back to
// this value at sweep time (M50). No backfill migration required.
// DEFAULT_TIMEZONE imported from ./lib/localHourAndDay.js — shared helper.
// §14.6 — per-family per-day per-kind fan-out cap. Earliest 10 sent
// (events by `date` asc); rest dropped + warn. Kill-switch is the hard
// backstop.
const FAN_OUT_CAP = 10;
// M37 — stale-token cleanup ONLY on the two pinned FCM error codes.
// Transient codes leave the doc alone (the device retries next send).
const FCM_STALE_TOKEN_CODES: ReadonlySet<string> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
// §14.4 — markers expire 7 days after `sentAt` via Firestore TTL on
// `expiresAt` (operator activates per F12 runbook). Date-suffixed ids make
// the TTL latency irrelevant to dedupe correctness: the same `{kind}__
// {sourceId}__{yyyymmdd}` id never repeats, so a still-present expired
// doc would only block the same day's re-send anyway.
const MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-token doc shape — narrow read view. */
interface FcmTokenDoc {
  token: string;
}

/** Per-token response shape from `sendEachForMulticast`. */
interface SendResponse {
  success: boolean;
  error?: { code?: string } | undefined;
}

interface MulticastResult {
  successCount?: number;
  failureCount?: number;
  responses: SendResponse[];
}

/**
 * Tolerant read of a snapshot's data — the Admin SDK exposes `.data()` as
 * a method, the in-process unit-test mock exposes it as a property. Mirror
 * the pattern from notifyChoreApproved.ts so the helper works under both.
 */
function readSnap(snap: unknown): Record<string, unknown> | undefined {
  if (!snap || typeof snap !== 'object') return undefined;
  const candidate = snap as { data?: unknown };
  if (typeof candidate.data === 'function') {
    const value = (candidate.data as () => unknown)();
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
  }
  if (candidate.data && typeof candidate.data === 'object') {
    return candidate.data as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Per-family fan-out — owns ALL per-family state (recipient list, token
 * buffer, marker ref). The `familyId` argument is the only family identifier
 * this function knows about (M47 — isolation by construction). Throws on
 * unexpected failures so the caller's per-family try/catch (M46(b)) can
 * absorb + continue; ALREADY_EXISTS marker collisions are caught and
 * silently skipped here.
 *
 * Returns `{ sent, cleaned, skipped }` so the caller can aggregate sweep
 * totals for the M38 summary log.
 */
async function sendForFamily(args: {
  db: ReturnType<typeof getFirestore>;
  familyId: string;
  sourceId: string;
  yyyymmdd: string;
  localDay: string;
}): Promise<{ sent: number; cleaned: number; skipped: boolean }> {
  const { db, familyId, sourceId, yyyymmdd, localDay } = args;
  const markerId = `${KIND}__${sourceId}__${yyyymmdd}`;
  const markerRef = db.doc(`scheduledSends/${markerId}`);
  const sentAtMs = Date.now();

  // M48 — fast-path probe. The atomic guarantee comes from `create()`
  // failing on ALREADY_EXISTS below; this read is an optimisation that
  // (a) avoids the cost of even attempting the create on a known-dedup'd
  // tick and (b) keeps the in-process test fixtures' shared-mock ordering
  // deterministic. A doc that exists here is a marker from a prior tick;
  // silent skip + return.
  const probe = await markerRef.get();
  if ((probe as { exists?: boolean }).exists === true) {
    return { sent: 0, cleaned: 0, skipped: true };
  }

  // M48 — create the marker BEFORE the send. Single-doc `create()` is
  // atomic; an ALREADY_EXISTS collision (gRPC code 6) is a deduped
  // double-fire (a tight race with another sweep, e.g. scheduler glitch)
  // and we silently skip. Any OTHER create error is unexpected (rules
  // regression, network) — propagate so the caller's per-family try/catch
  // sees it.
  try {
    await markerRef.create({
      kind: KIND,
      familyId,
      sourceId,
      localDay,
      recipientCount: 0,
      sentAt: FieldValue.serverTimestamp(),
      expiresAt: sentAtMs + MARKER_TTL_MS,
    });
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 6 || code === 'ALREADY_EXISTS' || code === 'already-exists') {
      // Silent skip — at-most-once (M48). The probe above usually catches
      // this, but a race between probe and create lands here.
      return { sent: 0, cleaned: 0, skipped: true };
    }
    throw err;
  }

  // M51 — recipient evaluation at fire time. Active members of the loop
  // family; each `userPrivate.familyId` re-checked against the loop's
  // `familyId` (M35.7 analog).
  const userSnaps = await db
    .collection('users')
    .where('familyId', '==', familyId)
    .where('isActive', '==', true)
    .get();

  const tokenEntries: Array<{ tokenHash: string; token: string; recipientUid: string }> = [];
  for (const userSnap of userSnaps.docs) {
    const recipientUid = (userSnap as { id?: string }).id;
    if (typeof recipientUid !== 'string' || recipientUid.length === 0) continue;

    const recipientPrivateSnap = await db.doc(`userPrivate/${recipientUid}`).get();
    if (!recipientPrivateSnap.exists) continue;

    const recipientPrivate = (readSnap(recipientPrivateSnap) ?? {}) as {
      familyId?: unknown;
      notificationPreferences?: {
        pushEnabled?: unknown;
        categories?: Record<string, unknown> | undefined;
      };
    };

    // M35.7 / M47 — per-recipient cross-tenant guard. A foreign familyId is
    // a corrupted/poisoned doc; we skip + warn (NOT throw) so a single bad
    // doc cannot DoS the surrounding multicast. Warn payload carries
    // `{kind, familyId, actorUid: null}` ONLY — no recipientUid, no
    // foreign familyId (would be cross-tenant disclosure via logs).
    if (recipientPrivate.familyId !== familyId) {
      logger.warn('notifyEventReminders: recipient skipped — userPrivate familyId mismatch', {
        kind: KIND,
        familyId,
        actorUid: null,
      });
      continue;
    }

    const prefs = recipientPrivate.notificationPreferences ?? {};
    const pushEnabled = prefs.pushEnabled === true;
    const categoryOn = prefs.categories?.[CATEGORY_KEY] === true;
    if (!pushEnabled || !categoryOn) continue;

    const tokenSnaps = await db.collection(`userPrivate/${recipientUid}/fcmTokens`).get();
    if (tokenSnaps.empty) continue;

    for (const tokenDoc of tokenSnaps.docs) {
      const tokenData = (readSnap(tokenDoc) ?? {}) as Partial<FcmTokenDoc>;
      if (typeof tokenData.token !== 'string' || tokenData.token.length === 0) continue;
      tokenEntries.push({
        tokenHash: (tokenDoc as { id?: string }).id ?? '',
        token: tokenData.token,
        recipientUid,
      });
    }
  }

  if (tokenEntries.length === 0) {
    // No addressable devices for this source — the marker stays (at-most-
    // once; a later sweep would only re-skip).
    return { sent: 0, cleaned: 0, skipped: false };
  }

  const tokens = tokenEntries.map((entry) => entry.token);
  const messaging = getMessaging();

  // ONE multicast per family-kind — the token buffer is local to this
  // function so it cannot leak across families (M47). A send-throw is
  // re-raised; the marker stays (F-PN-13 accepted) and the caller's
  // per-family try/catch (M46(b)) absorbs it.
  const result = (await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: NOTIFICATION_BODIES.eventReminder.title,
      body: NOTIFICATION_BODIES.eventReminder.body,
    },
    data: { url: '/notifications' },
  })) as MulticastResult;

  // M37 — stale-token cleanup ONLY on the two pinned codes.
  const responses = result.responses ?? [];
  let sent = 0;
  let cleaned = 0;
  const deletions: Promise<void>[] = [];
  for (let i = 0; i < tokenEntries.length; i += 1) {
    const entry = tokenEntries[i];
    const response = responses[i];
    if (!entry || !response) continue;
    if (response.success === true) {
      sent += 1;
      continue;
    }
    const code = response.error?.code;
    if (typeof code === 'string' && FCM_STALE_TOKEN_CODES.has(code)) {
      cleaned += 1;
      deletions.push(
        db
          .doc(`userPrivate/${entry.recipientUid}/fcmTokens/${entry.tokenHash}`)
          .delete()
          .then(() => undefined),
      );
    }
  }
  if (deletions.length > 0) {
    await Promise.all(deletions);
  }

  return { sent, cleaned, skipped: false };
}

// ---------------------------------------------------------------------------
// onSchedule registration.
//
// M46(c): retry disabled — markers handle dedupe, retries would only burn
// reads. M46(a): the handler does NOT declare any parameter (let alone read
// one) — the entire event payload is ignored. F-T1's AST gate scans the
// handler body for any reference to the identifier `event`; this signature
// has none.
// ---------------------------------------------------------------------------
export const notifyEventReminders = onSchedule(
  {
    region: REGION,
    schedule: '0 * * * *',
    timeZone: 'UTC',
    retryCount: 0,
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const startedAt = Date.now();
    const db = getFirestore();

    let familiesScanned = 0;
    let successCount = 0;
    let cleanedTokenCount = 0;

    // Read every family doc — MVP volume (~100). No `tzHourBucket` index
    // yet; design §14.2 notes the cliff at ~1,000 families. The scan is
    // tolerant of empty / missing collections.
    let familyDocs: Array<{ id: string; data: () => unknown }>;
    try {
      const snap = await db.collection('families').get();
      familyDocs = snap.docs as Array<{ id: string; data: () => unknown }>;
    } catch {
      logger.error('notifyEventReminders: families scan failed', {
        kind: KIND,
        actorUid: null,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    for (const familyDoc of familyDocs) {
      const familyId = familyDoc.id;
      // M46(b) — per-family try/catch. A throw here MUST never propagate
      // (would trigger scheduler retry which markers can't fully absorb on
      // a same-tick replay). Warn + continue so the rest of the sweep
      // still runs.
      try {
        familiesScanned += 1;

        const familyData = (readSnap(familyDoc) ?? {}) as { timezone?: unknown };
        const tzRaw =
          typeof familyData.timezone === 'string' && familyData.timezone.length > 0
            ? familyData.timezone
            : DEFAULT_TIMEZONE;
        const { hour, day, usedFallback } = localHourAndDay(startedAt, tzRaw);
        if (usedFallback) {
          // M50 — invalid tz fallback warn. Payload carries `{kind,
          // familyId}` only — never the invalid tz string (quasi-location
          // containment, T7.3). `timezone` is on the M38 FORBIDDEN list.
          logger.warn('notifyEventReminders: invalid family timezone — fallback used', {
            kind: KIND,
            familyId,
            actorUid: null,
          });
        }

        // Only families whose LOCAL hour is 8 fire this tick. Half-hour-
        // offset zones (e.g. St. John's) fire on whichever UTC hour gives
        // them local hour 8.
        if (hour !== 8) continue;

        // Query today's events. The `events.date` field is a family-local
        // ISO datetime string; the local-day range filter is a string
        // comparison on the `YYYY-MM-DDThh:mm:ss…` prefix. The composite
        // index `events(familyId asc, date asc)` already exists
        // (firestore.indexes.json).
        const dayStart = `${day}T00:00:00`;
        // `~` sorts after every printable ASCII digit/punctuation we use
        // in ISO datetimes, so it's a safe upper bound that captures
        // every `${day}T…` string without spilling into the next day.
        const dayEnd = `${day}T~`;
        const eventsSnap = await db
          .collection('events')
          .where('familyId', '==', familyId)
          .where('date', '>=', dayStart)
          .where('date', '<=', dayEnd)
          .orderBy('date', 'asc')
          .get();

        const eventDocs = eventsSnap.docs as Array<{ id: string; data: () => unknown }>;
        let kept = eventDocs;
        if (eventDocs.length > FAN_OUT_CAP) {
          kept = eventDocs.slice(0, FAN_OUT_CAP);
          // M49 — overflow drop + structured warn. `droppedCount` is the
          // M38 PR F extension field per design §14.7 / threat-model A.18.
          logger.warn('notifyEventReminders: fan-out cap reached — overflow dropped', {
            kind: KIND,
            familyId,
            actorUid: null,
            droppedCount: eventDocs.length - FAN_OUT_CAP,
          });
        }

        for (const eventDoc of kept) {
          const sourceId = eventDoc.id;
          if (typeof sourceId !== 'string' || sourceId.length === 0) continue;
          const result = await sendForFamily({
            db,
            familyId,
            sourceId,
            yyyymmdd: day.replace(/-/g, ''),
            localDay: day,
          });
          successCount += result.sent;
          cleanedTokenCount += result.cleaned;
        }
      } catch {
        // M46(b) — never propagate. Allow-listed payload only; no `err`
        // stringification (would risk leaking foreign data).
        logger.warn('notifyEventReminders: family failed', {
          kind: KIND,
          familyId,
          actorUid: null,
        });
        continue;
      }
    }

    // M38 sweep summary. Payload keys are restricted to the M38 allow-list
    // (kind, actorUid:null because there is no caller; familiesScanned,
    // successCount, cleanedTokenCount, durationMs). `familiesScanned` is a
    // PR-F-specific allow-listed key (per `M38_LOG_ALLOWLIST` extension in
    // `test/functions/logger-allowlist-ast.test.ts`) — using the precise
    // key avoids the semantic drift second-opinion concern 2 flagged
    // (reusing `recipientCount` for a families-count would silently mix
    // series in the dashboard). `timezone` and `localDay` are on the
    // M38 FORBIDDEN list and are NOT included.
    logger.info('notifyEventReminders: sweep complete', {
      kind: KIND,
      actorUid: null,
      familiesScanned,
      successCount,
      cleanedTokenCount,
      durationMs: Date.now() - startedAt,
    });
  },
);
