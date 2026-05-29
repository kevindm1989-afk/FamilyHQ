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
 * Each test uses a UNIQUE email so the emulator's auth store doesn't
 * collide across retries. The emulator is wiped between RUNS (we don't
 * persist its state) but not between TESTS within a run, so a stable
 * timestamp+random suffix is enough.
 *
 * Scope (this PR):
 *   - Founding-parent signup → land on the dashboard, see the
 *     personalised "Welcome, <name>" greeting.
 *
 * Out of scope (follow-ups):
 *   - Member invite flow (the founding parent invites a child).
 *   - Sign-in for a returning user (a separate test seeding the
 *     emulator with a pre-existing account would cover this).
 *   - Negative paths (sign-up with a taken email, reset password, etc).
 *   - Cross-device session resume.
 */
import { expect, test } from '@playwright/test';

function uniqueEmail(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `e2e-${stamp}-${rand}@familyhq.test`;
}

test.describe('Authed happy path — founding parent signup', () => {
  test('signing up lands on the dashboard with a personalised greeting', async ({ page }) => {
    await page.goto('/');

    // Enter the sign-up mode. The default tagline confirms we're on
    // signin; clicking "Create a family" swaps us into signup.
    await page.getByRole('button', { name: /create a family/i }).click();
    await expect(page.getByText(/create your family home base/i)).toBeVisible();

    const familyName = 'The Test Family';
    const userName = 'Founding Parent';
    const email = uniqueEmail();
    const password = 'test-password-1234';

    await page.getByLabel(/family name/i).fill(familyName);
    await page.getByLabel(/your name/i).fill(userName);
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);

    await page.getByRole('button', { name: /create family/i }).click();

    // The auth gate flips to the AuthedApp, which renders the dashboard.
    // The personalised greeting confirms (a) auth succeeded, (b) the
    // family doc was created, and (c) currentUser flowed through the
    // FamilyProvider into the DashboardScreen. Generous timeout because
    // the first dashboard render also has to fetch the AuthedApp +
    // DashboardRoute chunks AND wire up the Firestore listeners.
    await expect(
      page.getByRole('heading', { name: new RegExp(`welcome.*${userName}`, 'i') }),
    ).toBeVisible({ timeout: 15_000 });

    // The dashboard's primary CTA — the refresh control — proves the
    // AppShell chrome wired through to a live route (not just the auth
    // gate flipping a flag). Stable accessible name even across feature
    // additions to the surrounding chrome.
    await expect(page.getByRole('button', { name: /refresh dashboard/i })).toBeVisible();
  });
});
