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
