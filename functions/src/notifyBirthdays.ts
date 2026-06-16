/**
 * notifyBirthdays — scheduled push (PR F task F8, ADR-0016).
 *
 * Mirror of notifyEventReminders structurally — the same M46/M47/M48/M49/
 * M50/M51 contract applies (see that file's header for the long-form
 * threat-model coverage). Two birthday-specific shapes:
 *
 *   1. Source collection is `birthdays`, queried by
 *      `familyId == X && monthDay == 'MM-DD'` equality. The Feb-29 policy
 *      (§14.2) folds `02-29` onto Feb-28 in non-leap years; the marker id
 *      always uses the actual SWEEP `yyyymmdd` so a leap-year Feb 28 + 29
 *      double-pass never fires twice.
 *   2. `birthdays/{id}.type` discriminates `'birthday'` vs `'anniversary'`.
 *      Anniversaries fire under the SAME sweep + category key (§14.3 scope
 *      note) but use the `anniversaryToday` body constant. Birthday docs
 *      use `birthdayToday`. The body NEVER includes the person's name —
 *      "Someone special" / "There is an anniversary" — so a Grandma-Helen
 *      birthday on a non-member's screen carries zero PI (T7.7 / M52).
 *
 * Marker id stem: `birthday` (NOT `birthdayToday` — the body constant key
 * is the BODY's identity; the marker stem discriminates the SWEEP kind).
 * One marker per `birthdays/{id}` per `yyyymmdd`. The same stem covers
 * anniversaries (the design folded them under the birthdays sweep, §14.2
 * scope-note; the doc's own `type` field selects the body constant).
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

const KIND = 'birthday';
const CATEGORY_KEY = 'birthdays';
const REGION = 'northamerica-northeast1';
// DEFAULT_TIMEZONE imported from ./lib/localHourAndDay.js — shared helper.
const FAN_OUT_CAP = 10;
const FCM_STALE_TOKEN_CODES: ReadonlySet<string> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
const MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface FcmTokenDoc {
  token: string;
}

interface SendResponse {
  success: boolean;
  error?: { code?: string } | undefined;
}

interface MulticastResult {
  successCount?: number;
  failureCount?: number;
  responses: SendResponse[];
}

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
 * Per-family fan-out — owns ALL per-family state (M47). Pre-resolved
 * source doc is passed in so the per-doc body-constant selection
 * (`birthdayToday` vs `anniversaryToday`) is done here, not in the sweep.
 *
 * Returns `{ sent, cleaned, skipped }` for sweep aggregation.
 */
async function sendForFamily(args: {
  db: ReturnType<typeof getFirestore>;
  familyId: string;
  sourceId: string;
  yyyymmdd: string;
  localDay: string;
  bodyKey: 'birthdayToday' | 'anniversaryToday';
}): Promise<{ sent: number; cleaned: number; skipped: boolean }> {
  const { db, familyId, sourceId, yyyymmdd, localDay, bodyKey } = args;
  const markerId = `${KIND}__${sourceId}__${yyyymmdd}`;
  const markerRef = db.doc(`scheduledSends/${markerId}`);
  const sentAtMs = Date.now();

  // M48 fast-path probe — see notifyEventReminders.ts for the full
  // rationale; same shape applies here.
  const probe = await markerRef.get();
  if ((probe as { exists?: boolean }).exists === true) {
    return { sent: 0, cleaned: 0, skipped: true };
  }

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
      return { sent: 0, cleaned: 0, skipped: true };
    }
    throw err;
  }

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

    if (recipientPrivate.familyId !== familyId) {
      logger.warn('notifyBirthdays: recipient skipped — userPrivate familyId mismatch', {
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
    return { sent: 0, cleaned: 0, skipped: false };
  }

  const tokens = tokenEntries.map((entry) => entry.token);
  const messaging = getMessaging();
  const bodyConstant = NOTIFICATION_BODIES[bodyKey];

  const result = (await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: bodyConstant.title,
      body: bodyConstant.body,
    },
    data: { url: '/notifications' },
  })) as MulticastResult;

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
// onSchedule — same `0 * * * *` UTC cron + region as notifyEventReminders.
// M46(c): retry disabled. M46(a): no parameter; the AST gate confirms the
// handler body never reads the identifier `event`.
// ---------------------------------------------------------------------------
export const notifyBirthdays = onSchedule(
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

    let familyDocs: Array<{ id: string; data: () => unknown }>;
    try {
      const snap = await db.collection('families').get();
      familyDocs = snap.docs as Array<{ id: string; data: () => unknown }>;
    } catch {
      logger.error('notifyBirthdays: families scan failed', {
        kind: KIND,
        actorUid: null,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    for (const familyDoc of familyDocs) {
      const familyId = familyDoc.id;
      try {
        familiesScanned += 1;

        const familyData = (readSnap(familyDoc) ?? {}) as { timezone?: unknown };
        const tzRaw =
          typeof familyData.timezone === 'string' && familyData.timezone.length > 0
            ? familyData.timezone
            : DEFAULT_TIMEZONE;
        const { hour, day, usedFallback } = localHourAndDay(startedAt, tzRaw);
        if (usedFallback) {
          logger.warn('notifyBirthdays: invalid family timezone — fallback used', {
            kind: KIND,
            familyId,
            actorUid: null,
          });
        }

        if (hour !== 8) continue;

        // Day-of matching: equality on `monthDay == 'MM-DD'`. The Feb-29
        // policy: in a non-leap year, the Feb-28 sweep ALSO matches docs
        // with `monthDay == '02-29'`. The marker id uses the actual sweep
        // `yyyymmdd` ("20260228"), NOT the doc's stored monthDay, so a
        // leap-year Feb 28 + Feb 29 pass produces TWO distinct marker ids
        // (no false double-fire) and a non-leap-year Feb 28 pass produces
        // ONE marker per `02-29` doc folded under that sweep.
        const [, mm, dd] = day.split('-');
        const monthDay = `${mm}-${dd}`;
        const monthDays: string[] = [monthDay];
        if (monthDay === '02-28' && !isLeapYear(day)) {
          monthDays.push('02-29');
        }

        // Gather candidate docs for every monthDay in `monthDays`. We
        // accumulate, dedupe by id (no overlap in practice — a single doc
        // can only carry one `monthDay`), and sort by `createdAt` asc for
        // the deterministic cap (M49 / §14.6).
        const candidateMap = new Map<
          string,
          { id: string; data: () => unknown; createdAt: number }
        >();
        for (const md of monthDays) {
          const snap = await db
            .collection('birthdays')
            .where('familyId', '==', familyId)
            .where('monthDay', '==', md)
            .get();
          for (const docSnap of snap.docs) {
            const id = (docSnap as { id?: string }).id;
            if (typeof id !== 'string' || id.length === 0) continue;
            const dataObj = (readSnap(docSnap) ?? {}) as { createdAt?: unknown };
            const createdAtNum = typeof dataObj.createdAt === 'number' ? dataObj.createdAt : 0;
            candidateMap.set(id, {
              id,
              data: () => dataObj,
              createdAt: createdAtNum,
            });
          }
        }
        const candidates = Array.from(candidateMap.values()).sort(
          (a, b) => a.createdAt - b.createdAt,
        );

        let kept = candidates;
        if (candidates.length > FAN_OUT_CAP) {
          kept = candidates.slice(0, FAN_OUT_CAP);
          logger.warn('notifyBirthdays: fan-out cap reached — overflow dropped', {
            kind: KIND,
            familyId,
            actorUid: null,
            droppedCount: candidates.length - FAN_OUT_CAP,
          });
        }

        for (const candidate of kept) {
          const sourceId = candidate.id;
          if (typeof sourceId !== 'string' || sourceId.length === 0) continue;
          const doc = candidate.data() as { type?: unknown };
          const bodyKey: 'birthdayToday' | 'anniversaryToday' =
            doc.type === 'anniversary' ? 'anniversaryToday' : 'birthdayToday';
          const result = await sendForFamily({
            db,
            familyId,
            sourceId,
            yyyymmdd: day.replace(/-/g, ''),
            localDay: day,
            bodyKey,
          });
          successCount += result.sent;
          cleanedTokenCount += result.cleaned;
        }
      } catch {
        logger.warn('notifyBirthdays: family failed', {
          kind: KIND,
          familyId,
          actorUid: null,
        });
        continue;
      }
    }

    // M38 sweep summary — use `familiesScanned` (PR F allow-list addition)
    // not `recipientCount`. Avoids the semantic-drift the reviewer flagged
    // (concern 2): reusing recipientCount for a families-count silently
    // mixes dashboard series.
    logger.info('notifyBirthdays: sweep complete', {
      kind: KIND,
      actorUid: null,
      familiesScanned,
      successCount,
      cleanedTokenCount,
      durationMs: Date.now() - startedAt,
    });
  },
);

/**
 * Leap-year predicate over the sweep's local-day string (`YYYY-MM-DD`).
 * Centralised here to keep the Feb-29 Pin (§14.2 + F-T15) testable from a
 * single function and to avoid pulling Date() into the equality logic
 * (which would interact with the fake-timers fixture).
 */
function isLeapYear(localDay: string): boolean {
  const yearStr = localDay.split('-')[0] ?? '1970';
  const year = Number.parseInt(yearStr, 10);
  if (Number.isNaN(year)) return false;
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}
