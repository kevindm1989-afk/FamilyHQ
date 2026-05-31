/**
 * Authed e2e — returning user (sign up, sign out, sign back in).
 *
 * This is the test the previous attempt couldn't ship because it stresses
 * exactly the cross-test isolation bug: a SECOND signup/signin in the same
 * browser context. With helpers.ts's resetEmulators + freshStart in
 * beforeEach, the SDK boots clean every time and the flow works.
 *
 * Why this matters as its own file (not a third case in
 * founding-parent.spec.ts):
 *   This test exercises an end-to-end SIGN OUT in addition to sign-in, so
 *   it's structurally a different scenario. Keeping spec files focused
 *   per-scenario makes failure messages easier to attribute.
 */
import { expect } from '@playwright/test';
import {
  isolatedAuthedTest,
  signInExistingUser,
  signOutViaUI,
  signUpFoundingParent,
  uniqueEmail,
} from './helpers';

isolatedAuthedTest.describe('Authed — returning user signs back in', () => {
  isolatedAuthedTest(
    'sign up → sign out → sign back in lands on the dashboard',
    async ({ page }) => {
      const userName = 'Returning Parent';
      const email = uniqueEmail('returning');
      const password = 'returning-pass-1234';

      // 1. Sign up — creates the account + family doc + lands on dashboard.
      await signUpFoundingParent(page, {
        familyName: 'Returning Family',
        userName,
        email,
        password,
      });

      // 2. Sign out via the in-app affordance. After this we're back on
      //    the LoginScreen with cleared auth state.
      await signOutViaUI(page);

      // 3. Sign in again with the same credentials. The account is still
      //    in the emulator (we only reset between TESTS, not between
      //    actions within a test), and the family doc the signup wrote
      //    is still there too.
      await signInExistingUser(page, email, password);

      // 4. We're back on the dashboard with the same personalised
      //    greeting — proves the family doc is correctly fetched via the
      //    second sign-in, not just the first.
      await expect(
        page.getByRole('heading', { name: new RegExp(`welcome.*${userName}`, 'i') }),
      ).toBeVisible({ timeout: 15_000 });
    },
  );
});
