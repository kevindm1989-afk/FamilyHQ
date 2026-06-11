/**
 * Notification body constants (PR C3 / threat-model M34 + B10).
 *
 * EVERY string in this file is rendered VERBATIM on a lock screen by FCM
 * (M34 -- vague-by-default). No template substitution, no doc-field
 * interpolation, no kid name lookup -- the callables read these constants
 * literally. The lock screen is visible to anyone who can glance at the
 * device; PI here would be a notifiable breach (PIPEDA s.10.1, threat-
 * model B10).
 *
 * The CI gate at test/functions/notification-bodies-no-pi.test.ts scans
 * this file for forbidden substrings (case-insensitive) plus any JS / DSL
 * template-marker syntax. ALL strings here MUST pass that scan. Length
 * is capped at under 80 chars per body to fit the lock-screen budget.
 *
 * The word "chore" is allow-listed by the brief as a generic category
 * word (not PI) -- it appears in the v1 choreApproved body intentionally.
 *
 * PR C ships only choreApproved; the other 6 categories land in PR D
 * (per design 12). The empty placeholders are intentional -- the M34
 * scan only inspects non-empty values, so empty strings are safe and
 * preserve the shape for the PR D implementer to fill in.
 */

export interface NotificationBody {
  title: string;
  body: string;
}

export const NOTIFICATION_BODIES = Object.freeze({
  // PR C — shipped now. Title carries the category only ("Allowance
  // update"); body is vague and contains no PI (no kid name, no chore
  // title, no money amount). The word "chore" is the generic category
  // word and is allow-listed by the brief.
  choreApproved: Object.freeze({
    title: 'Allowance update',
    body: 'A chore was approved. Open Family HQ for details.',
  }),
  // PR D placeholders — implementer fills these in when each callable
  // ships. Empty strings deliberately bypass the M34 non-empty-value
  // forbidden-substring scan; the PR D test for the new callable will
  // pin the fresh wording at that time.
  choreSubmitted: Object.freeze({ title: '', body: '' }),
  wishlistRequested: Object.freeze({ title: '', body: '' }),
  wishlistResolved: Object.freeze({ title: '', body: '' }),
  familyBoardPost: Object.freeze({ title: '', body: '' }),
  todoCreated: Object.freeze({ title: '', body: '' }),
  todoCompleted: Object.freeze({ title: '', body: '' }),
}) satisfies Readonly<Record<string, NotificationBody>>;

export type NotificationKind = keyof typeof NOTIFICATION_BODIES;

// Top-level named export so the dynamic-import contract test
// (test/functions/notification-bodies-no-pi.test.ts) can resolve either
// `mod.choreApproved` directly OR via `mod.NOTIFICATION_BODIES.choreApproved`.
// Both shapes are valid against the test's tolerance branch.
export const choreApproved = NOTIFICATION_BODIES.choreApproved;
