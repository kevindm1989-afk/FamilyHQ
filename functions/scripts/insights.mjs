#!/usr/bin/env node
/**
 * insights.mjs — operator-only telemetry readout.
 *
 * Reads the first-party `usageEvents` + `clientErrors` collections via the
 * Admin SDK (which BYPASSES the client deny-read rules — the collections stay
 * unreadable from any app client) and prints a Markdown funnel + top-errors
 * report. Aggregation is the pure, unit-tested `../lib/insights/aggregate.js`
 * (run `npm --prefix functions run build` first so `lib/` exists).
 *
 * This is an OPERATOR surface, not an in-app feature: usageEvents are app-wide
 * and anonymous (no familyId), so there is nothing family-scoped to show a
 * parent — this is for the app owner, run from CI (.github/workflows/insights.yml)
 * with the deploy service account.
 *
 * Env:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the service-account JSON (auth)
 *   FIREBASE_PROJECT_ID             target project id
 *   INSIGHTS_DAYS                   window size in days (default 30)
 *   GITHUB_STEP_SUMMARY             if set, the report is also appended here
 */
import { appendFileSync } from 'node:fs';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { aggregateUsage, aggregateErrors, renderMarkdown } from '../lib/insights/aggregate.js';

/** YYYY-MM-DD for `now` minus `daysAgo`, in UTC (coarse window; TZ-insensitive). */
function dayString(now, daysAgo) {
  const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

async function readCollection(db, name, since) {
  // `day` is a 'YYYY-MM-DD' string; lexicographic >= is a valid date range and
  // needs only the automatic single-field index. Cap defensively.
  const snap = await db.collection(name).where('day', '>=', since).limit(50000).get();
  return snap.docs.map((doc) => doc.data());
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set.');
  const days = Number.parseInt(process.env.INSIGHTS_DAYS ?? '30', 10);
  const windowDays = Number.isFinite(days) && days > 0 ? days : 30;

  const now = new Date();
  const since = dayString(now, windowDays - 1);
  const until = dayString(now, 0);

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const [usageDocs, errorDocs] = await Promise.all([
    readCollection(db, 'usageEvents', since),
    readCollection(db, 'clientErrors', since),
  ]);

  const md = renderMarkdown(aggregateUsage(usageDocs), aggregateErrors(errorDocs), {
    since,
    until,
  });

  process.stdout.write(md + '\n');
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, md + '\n');
}

main().catch((err) => {
  process.stderr.write(`insights: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
