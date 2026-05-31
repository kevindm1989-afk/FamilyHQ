/**
 * Authed e2e — founding-parent happy path.
 *
 * Wires the FULL signup flow against the LIVE Firebase emulator suite
 * (auth on :9099, firestore on :8080, started via
 * `firebase emulators:exec` around this run). Catches what the public
 * smoke suite cannot: the auth handshake, the family-document creation,
 * the auth-state listener firing in AppShell, and the dashboard render
 * with real user/family context.
 *
 * Per-test isolation: every test resets the emulator + the browser
 * context. See helpers.ts for the full rationale (Firebase Auth's
 * localStorage persistence + Firestore's IndexedDB cache mean that
 * without explicit cleanup, test N inherits test N-1's session).
 */
import { expect, test } from '@playwright/test';
import { isolatedAuthedTest, signUpFoundingParent, uniqueEmail } from './helpers';

test.describe('Authed happy path — founding parent signup', () => {
  isolatedAuthedTest(
    'signing up lands on the dashboard with a personalised greeting',
    async ({ page }) => {
      const userName = 'Founding Parent';
      await signUpFoundingParent(page, {
        familyName: 'The Test Family',
        userName,
        email: uniqueEmail(),
        password: 'test-password-1234',
      });

      // signUpFoundingParent already asserts the welcome heading appears.
      // The dashboard's refresh control proves the AppShell chrome wired
      // through to a live route (not just the auth gate flipping a flag).
      await expect(page.getByRole('button', { name: /refresh dashboard/i })).toBeVisible();
    },
  );
});
