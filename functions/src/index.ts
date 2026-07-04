/**
 * Entry point for the Cloud Functions deployment.
 *
 * `firebase deploy --only functions:<name>` resolves function names from
 * the `main` of `functions/package.json` (currently `lib/index.js` after
 * `tsc`). Every exported function symbol from this file is deployable
 * under its export name. Without this re-export `firebase deploy` would
 * either fail with "function not found in source" or — worse, on some
 * firebase-tools versions — succeed-with-zero-functions and leave the
 * kill-switch silently undeployed (second-opinion review #1).
 */
export { billingKillSwitch } from './billingKillSwitch.js';
// Managed (email-less) child accounts — parent-only callables (ADR-0003
// Option C; docs/specs/managed-child-accounts.md).
export { createManagedChild } from './createManagedChild.js';
export { resetManagedChildPassword } from './resetManagedChildPassword.js';
export { notifyChoreApproved } from './notifyChoreApproved.js';
export { notifyChoreSubmitted } from './notifyChoreSubmitted.js';
export { notifyWishlistRequested } from './notifyWishlistRequested.js';
export { notifyWishlistResolved } from './notifyWishlistResolved.js';
export { notifyBoardPost } from './notifyBoardPost.js';
export { notifyTodoCreated } from './notifyTodoCreated.js';
export { notifyTodoCompleted } from './notifyTodoCompleted.js';
// PR F — onSchedule v2 scheduled-push functions (ADR-0016). Both
// `notify*` names ride the existing `^notify` Cloud Monitoring filter
// (docs/runbooks/observability.md) for zero-dashboard-change deploy.
export { notifyEventReminders } from './notifyEventReminders.js';
export { notifyBirthdays } from './notifyBirthdays.js';
