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
  // PR D — six new categories. Each title carries the category only and
  // each body is a vague, PI-free instruction to open the app. M34's
  // forbidden vocabulary (name, wishlist, amount, balance, dollar, kid,
  // child, parent, email, title, body) is deliberately absent from every
  // string. The CI gate at
  // test/functions/notification-bodies-no-pi.test.ts re-scans these
  // values on every change.
  choreSubmitted: Object.freeze({
    title: 'Chore update',
    body: 'A chore is ready for review. Open Family HQ for details.',
  }),
  wishlistRequested: Object.freeze({
    title: 'New request',
    body: 'An item was requested. Open Family HQ for details.',
  }),
  wishlistResolved: Object.freeze({
    title: 'Request update',
    body: 'A request was updated. Open Family HQ for details.',
  }),
  familyBoardPost: Object.freeze({
    title: 'New family post',
    body: 'Someone in your family shared an update.',
  }),
  todoCreated: Object.freeze({
    title: 'New to-do',
    body: "Something was added to your family's to-do list.",
  }),
  todoCompleted: Object.freeze({
    title: 'To-do completed',
    body: "Something on your family's to-do list was finished.",
  }),
  // PR F — three new scheduled-push constants. Each is verbatim per
  // design §14.5 and threat-model M52. Vague-by-default: no event title,
  // no birthday name, no "turning N" age, no anniversary specifics. The
  // M34 forbidden-substring scan (name|wishlist|amount|balance|dollar|kid|
  // child|parent|email|title|body) is run against every value at CI time
  // (test/functions/notification-bodies-pr-f.test.ts F-T14 + the existing
  // test/functions/notification-bodies-no-pi.test.ts blanket scan). Each
  // body is < 80 chars to fit the lock-screen budget. The word "birthday"
  // and "anniversary" are generic category words (not PI — the PERSON
  // is never named).
  eventReminder: Object.freeze({
    title: 'Event reminder',
    body: 'An event is on your family calendar today. Open Family HQ.',
  }),
  birthdayToday: Object.freeze({
    title: 'Birthday today',
    body: 'Someone special has a birthday today. Open Family HQ.',
  }),
  anniversaryToday: Object.freeze({
    title: 'Anniversary today',
    body: 'There is an anniversary today. Open Family HQ.',
  }),
}) satisfies Readonly<Record<string, NotificationBody>>;

export type NotificationKind = keyof typeof NOTIFICATION_BODIES;

// Top-level named export so the dynamic-import contract test
// (test/functions/notification-bodies-no-pi.test.ts) can resolve either
// `mod.choreApproved` directly OR via `mod.NOTIFICATION_BODIES.choreApproved`.
// Both shapes are valid against the test's tolerance branch.
export const choreApproved = NOTIFICATION_BODIES.choreApproved;

// PR F top-level named exports — same dual-resolution shape as choreApproved
// above. The PR F constants-test (notification-bodies-pr-f.test.ts) probes
// both `mod.<key>` and `mod.NOTIFICATION_BODIES[<key>]`; pinning both makes
// either access pattern stable for the implementer tree downstream.
export const eventReminder = NOTIFICATION_BODIES.eventReminder;
export const birthdayToday = NOTIFICATION_BODIES.birthdayToday;
export const anniversaryToday = NOTIFICATION_BODIES.anniversaryToday;
