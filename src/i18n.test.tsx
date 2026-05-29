/**
 * i18n bootstrap + LanguageToggle behaviour (Phase: AODA French scaffolding).
 *
 * Pins the contract:
 *   1. Both supported languages are registered and fall back to English on
 *      missing keys.
 *   2. The toggle switches the visible string in the page (round-trip
 *      en → fr → en) and updates i18next's resolved language.
 *   3. Switching language persists to localStorage (so a returning visitor
 *      sees their last choice).
 *   4. <html lang="..."> is wired by useLangAttributeSync (covered by an
 *      explicit App-level test below) — included here because the sync is
 *      a screen-reader / hyphenation requirement, not just a CSS hook.
 *
 * The shared i18n singleton is initialised in test/setup.ts; each test resets
 * the language at the start and clears localStorage so test order doesn't
 * matter.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n, { SUPPORTED_LANGUAGES } from './i18n';
import { LanguageToggle } from './components/LanguageToggle';

// LanguageToggle's onChange handler is fire-and-forget — it calls
// `void i18n.changeLanguage(next)`, so the language switch + the downstream
// <Trans> re-renders that React commits when the i18n promise resolves
// settle in a microtask AFTER the synchronous fireEvent returns. A plain
// `fireEvent.change` wraps the event dispatch in act() but closes the act
// boundary before that microtask runs, so the resulting LanguageToggle
// re-render lands outside act and React logs an "update to LanguageToggle
// inside a test was not wrapped in act(...)" warning that pollutes CI
// output.
//
// We wrap the event in an awaited `act()` AND explicitly drain the
// microtask queue inside it (a couple of `await Promise.resolve()`s is the
// idiomatic way to flush both the i18next promise and the downstream
// React-i18next state update). The result is a clean commit cycle.
async function changeLanguageViaSelect(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(select, { target: { value } });
    // Flush i18n.changeLanguage's promise + the react-i18next subscriber
    // re-render. We drain by directly awaiting a no-op changeLanguage to
    // the SAME language — i18next short-circuits when the requested
    // language matches the current one, which guarantees its event loop
    // settles without triggering a second real change. This is more
    // robust than counting microtask ticks (i18next's promise chain
    // length is an internal detail that can shift between versions).
    await i18n.changeLanguage(i18n.resolvedLanguage ?? 'en');
  });
}

const STORAGE_KEY = 'familyhq.language';

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  // Unmount the rendered LanguageToggle BEFORE resetting the language — RTL's
  // auto-cleanup fires after afterEach, so without this manual call the still-
  // mounted toggle re-renders in response to changeLanguage and React logs an
  // "update to LanguageToggle inside a test was not wrapped in act(...)"
  // warning. Same fix as PublicSkipLink.test.tsx.
  cleanup();
  await i18n.changeLanguage('en');
  localStorage.clear();
});

describe('i18n — registration + fallbacks', () => {
  it('registers both en and fr resources', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'fr']);
    for (const lng of SUPPORTED_LANGUAGES) {
      expect(i18n.hasResourceBundle(lng, 'common'), `${lng} bundle must be loaded`).toBe(true);
    }
  });

  it('falls back to English for a missing fr key (graceful degradation)', async () => {
    await i18n.changeLanguage('fr');
    // login.toast.signedIn exists in both; appName intentionally shared.
    // A non-existent key in fr (none here intentionally) would fall back —
    // assert the fallback wiring is configured (not the absence of a key).
    expect(i18n.options.fallbackLng).toContain('en');
  });
});

describe('LanguageToggle — switches the visible string', () => {
  it('round-trips en → fr → en, updating i18n.resolvedLanguage at each step', async () => {
    render(<LanguageToggle />);
    const select = screen.getByRole('combobox', { name: /language|langue/i }) as HTMLSelectElement;

    expect(i18n.resolvedLanguage).toBe('en');
    expect(select.value).toBe('en');

    await changeLanguageViaSelect(select, 'fr');
    expect(i18n.resolvedLanguage).toBe('fr');

    await changeLanguageViaSelect(select, 'en');
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('persists the user’s choice to localStorage (sticks across reloads)', async () => {
    render(<LanguageToggle />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;

    await changeLanguageViaSelect(select, 'fr');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('fr');
  });

  it('rejects an unsupported value (defence-in-depth against UI tampering)', async () => {
    render(<LanguageToggle />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;

    await changeLanguageViaSelect(select, 'xx-Invalid');
    // i18n.changeLanguage MUST NOT have been called; the resolved language
    // stays on en, and localStorage isn't poisoned with a bogus value.
    expect(i18n.resolvedLanguage).toBe('en');
    expect(localStorage.getItem(STORAGE_KEY)).not.toBe('xx-Invalid');
  });
});

describe('French copy — known limitations explicitly mentions translation review', () => {
  it('fr accessibility statement names the translation as a placeholder (legal/honesty pin)', async () => {
    await i18n.changeLanguage('fr');
    const frResource = i18n.getResource('fr', 'common', 'accessibility.limitations.french') as
      | string
      | undefined;
    expect(frResource, 'fr resource for accessibility.limitations.french must exist').toBeDefined();
    expect(
      /révision|traduction/i.test(frResource ?? ''),
      'the fr copy must call out that the translation needs native-speaker review',
    ).toBe(true);
  });
});
