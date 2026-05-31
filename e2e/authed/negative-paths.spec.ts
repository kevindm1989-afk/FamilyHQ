/**
 * Authed e2e — negative paths.
 *
 * Pins the user-visible behaviour for the two most common authed failure
 * modes:
 *   1. Signing up with an email that's already taken — must NOT silently
 *      succeed; the form stays on the signup surface and a user-safe toast
 *      surfaces.
 *   2. Signing in with the wrong password — must NOT advance to the
 *      dashboard; the form stays on signin and a user-safe toast surfaces.
 *
 * Both messages MUST be user-safe (no raw Firebase error codes, no PI).
 * The login flow's auth-service mapper converts Firebase's
 * auth/email-already-in-use and auth/wrong-password / auth/invalid-credential
 * into the same generic "Something went wrong" or "Wrong email or password"
 * we ship in i18n. We don't pin the exact wording here — only that
 * something user-readable surfaces AND that we did NOT advance.
 */
import { expect } from '@playwright/test';
import {
  ephemeralCredential,
  isolatedAuthedTest,
  signInExistingUser,
  signOutViaUI,
  signUpFoundingParent,
  uniqueEmail,
} from './helpers';

isolatedAuthedTest.describe('Authed negative paths', () => {
  isolatedAuthedTest(
    'signing up with an EXISTING email surfaces a toast and stays on signup',
    async ({ page }) => {
      const email = uniqueEmail('taken');
      const password = ephemeralCredential();

      // First signup succeeds.
      await signUpFoundingParent(page, {
        familyName: 'First Family',
        userName: 'First Parent',
        email,
        password,
      });

      // Sign out so the next attempt re-enters the signup flow cleanly.
      // (Going through the UI catches sign-out regressions for free.)
      await signOutViaUI(page);

      // Second signup with the SAME email — must fail user-safely.
      await page.getByRole('button', { name: /create a family/i }).click();
      await page.getByLabel(/family name/i).fill('Second Family');
      await page.getByLabel(/your name/i).fill('Second Parent');
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(ephemeralCredential());
      await page.getByRole('button', { name: /create family/i }).click();

      // We did NOT advance to the dashboard.
      await expect(page.getByRole('heading', { name: /welcome/i })).not.toBeVisible({
        timeout: 5_000,
      });
      // The signup form is still visible — the user can correct the email.
      await expect(page.getByLabel(/family name/i)).toBeVisible();
      // SOME user-visible feedback fires (toast region is role=status; the
      // exact wording is tunable in i18n without breaking this test).
      await expect(page.getByRole('status').first()).toBeVisible({ timeout: 10_000 });
    },
  );

  isolatedAuthedTest(
    'signing in with the WRONG password surfaces a toast and stays on signin',
    async ({ page }) => {
      const email = uniqueEmail('wrongpw');
      const correctPassword = ephemeralCredential();

      // Seed: sign up so the account exists in the emulator.
      await signUpFoundingParent(page, {
        familyName: 'Existing Family',
        userName: 'Existing Parent',
        email,
        password: correctPassword,
      });
      // Sign out so we can try a fresh sign-in.
      await signOutViaUI(page);

      // Wrong password — auth must reject. Use a fresh credential
      // (won't match the stored one with overwhelming probability).
      await signInExistingUser(page, email, ephemeralCredential());

      // We stay on signin (no dashboard).
      await expect(page.getByRole('heading', { name: /welcome/i })).not.toBeVisible({
        timeout: 5_000,
      });
      // Form still visible for retry.
      await expect(page.getByLabel(/email/i)).toBeVisible();
      // User-safe feedback surfaces.
      await expect(page.getByRole('status').first()).toBeVisible({ timeout: 10_000 });
    },
  );
});
