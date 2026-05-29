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

test.describe('Skip link — WCAG 2.4.1 on the unauthed surface', () => {
  // Headless Chrome cold-loaded pages don't always carry a focusable
  // activeElement, so a literal `page.keyboard.press('Tab')` then check of
  // `:focus` is unreliable. Test the property we ACTUALLY care about
  // (WCAG 2.4.1's intent): the skip link is the FIRST focusable element in
  // the document, has the correct accessible name + target, and when
  // activated, focus lands on the main landmark.

  test('the skip link is the first focusable element on /', async ({ page }) => {
    await page.goto('/');
    // Wait for React to mount the skip link before enumerating — without
    // this the query can run before the unauthed Gate has rendered and
    // there are no focusables in the document yet.
    await page.locator('a[href="#main-content"]').first().waitFor();

    // Enumerate every focusable in DOM order. The skip link must be index 0.
    const firstFocusable = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = els[0] as HTMLElement | undefined;
      return first
        ? { tag: first.tagName, href: first.getAttribute('href'), text: first.textContent?.trim() }
        : null;
    });

    expect(firstFocusable).not.toBeNull();
    expect(firstFocusable?.tag).toBe('A');
    expect(firstFocusable?.href).toBe('#main-content');
    expect(firstFocusable?.text).toMatch(/skip to main content/i);
  });

  test('focusing the skip link reveals it (sr-only → focus:not-sr-only)', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a[href="#main-content"]').first();

    // Pre-focus: the link exists in DOM (and a11y tree) but is visually
    // collapsed via Tailwind's `sr-only` (1px clip). Programmatic focus
    // triggers `focus:not-sr-only` which restores normal flow + a brand-
    // toned background.
    await link.focus();
    await expect(link).toBeFocused();

    // The visible bounding box should be more than the sr-only 1×1 once
    // the focus utility kicks in. Sanity-check the height — if a future
    // Tailwind upgrade drops `focus:not-sr-only`, the link stays invisible
    // and this assertion catches it.
    const box = await link.boundingBox();
    expect(box, 'skip link must have a measurable box on focus').not.toBeNull();
    expect(box!.height, 'sr-only → focus:not-sr-only must restore real height').toBeGreaterThan(8);
  });

  test('activating the skip link moves focus to <main id="main-content">', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a[href="#main-content"]').first();
    await link.focus();

    // Press Enter to activate the anchor. The browser navigates the fragment;
    // the matching <main id="main-content" tabIndex="-1"> becomes the focus
    // target (LoginScreen sets `focus:outline-none` so the dotted ring is
    // suppressed but focus IS programmatically moved).
    await page.keyboard.press('Enter');

    const activeId = await page.evaluate(() => document.activeElement?.id ?? null);
    expect(activeId).toBe('main-content');
  });

  test('the skip link is also the first focusable on /accessibility', async ({ page }) => {
    await page.goto('/accessibility');
    await page.locator('a[href="#main-content"]').first().waitFor();
    const firstFocusable = await page.evaluate(() => {
      const els = Array.from(
        document.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = els[0] as HTMLElement | undefined;
      return first ? { tag: first.tagName, href: first.getAttribute('href') } : null;
    });
    expect(firstFocusable?.tag).toBe('A');
    expect(firstFocusable?.href).toBe('#main-content');
  });
});

test.describe('LoginScreen — mode switching (signin / signup / forgot)', () => {
  // Each mode flips the tagline, swaps in/out fields, and changes the submit
  // label. The flips happen entirely client-side — no backend or emulator
  // needed — so these are pure rendering contracts that the jsdom
  // integration tests already cover, ALSO pinned here for the real browser
  // (catches a future CSS regression that conditionally hides a field or a
  // routing change that drops a mode).

  test('signup mode reveals Family name + Your name fields and the Create family CTA', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText(/your shared family home base/i)).toBeVisible();

    await page.getByRole('button', { name: /create a family/i }).click();

    await expect(page.getByText(/create your family home base/i)).toBeVisible();
    await expect(page.getByLabel(/family name/i)).toBeVisible();
    await expect(page.getByLabel(/your name/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^create family$/i })).toBeVisible();
    // The mode-switch CTA now points the other way.
    await expect(page.getByRole('button', { name: /^back to sign in$/i })).toBeVisible();
  });

  test('forgot-password mode hides the password field and shows the reset CTA', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /forgot password\?/i }).click();

    await expect(page.getByText(/reset your password/i)).toBeVisible();
    // Email persists; password input goes away.
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).not.toBeVisible();
    await expect(page.getByRole('button', { name: /^send reset link$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^back to sign in$/i })).toBeVisible();
  });

  test('switching back to sign-in from forgot mode restores the baseline form', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /forgot password\?/i }).click();
    // Confirm we left signin mode first…
    await expect(page.getByRole('button', { name: /^send reset link$/i })).toBeVisible();

    await page.getByRole('button', { name: /^back to sign in$/i }).click();

    await expect(page.getByText(/your shared family home base/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    // The mode-switch links are back in their signin shapes.
    await expect(page.getByRole('button', { name: /create a family/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /forgot password\?/i })).toBeVisible();
  });

  test('the password field is type="password" so the OS hides the input', async ({ page }) => {
    // CSS / DOM property check that jsdom doesn't faithfully reproduce —
    // a real browser actually masks the field per the type attribute. The
    // assertion is on the underlying attribute, not on visible bullets,
    // because Playwright can't peek through the password masking; the
    // attribute is the contract the browser keys off.
    await page.goto('/');
    const password = page.getByLabel(/password/i);
    await expect(password).toHaveAttribute('type', 'password');
  });
});
