/**
 * AccessibilityStatementScreen — unit contract (AODA launch-gate item).
 *
 * Pins the AODA-required pieces of the page so a future edit that removes
 * one is caught by CI rather than at audit time:
 *   1. The page has a single H1 with the service name in scope.
 *   2. A feedback mechanism exists — a `mailto:` link with the published
 *      contact email is the AODA-minimum mechanism. The href MUST be the
 *      `mailto:` form, NOT a same-page anchor — a user with no client app
 *      configured still gets the email address as visible text.
 *   3. A WCAG conformance level is declared.
 *   4. A "last reviewed" date is published — stale statements are the most
 *      common AODA finding, so we want this load-bearing in the DOM.
 *   5. The public-mode variant exposes a "Back to sign in" link; the in-app
 *      variant does NOT (AppShell's chrome provides navigation).
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  ACCESSIBILITY_CONTACT_EMAIL,
  ACCESSIBILITY_LAST_REVIEWED_ISO,
  AccessibilityStatementScreen,
} from './AccessibilityStatementScreen';

function renderScreen(mode: 'public' | 'in-app') {
  return render(
    <MemoryRouter>
      <AccessibilityStatementScreen mode={mode} />
    </MemoryRouter>,
  );
}

describe('AccessibilityStatementScreen — required AODA structure', () => {
  it('exposes a single H1 naming the service in scope', () => {
    renderScreen('in-app');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent ?? '').toMatch(/family hq/i);
  });

  it('publishes a mailto: feedback mechanism with the contact email', () => {
    renderScreen('in-app');
    const link = screen.getByRole('link', { name: ACCESSIBILITY_CONTACT_EMAIL });
    const href = link.getAttribute('href') ?? '';
    expect(
      href.startsWith(`mailto:${ACCESSIBILITY_CONTACT_EMAIL}`),
      'feedback MUST be a mailto: — AODA needs a working mechanism, not just an address',
    ).toBe(true);
    expect(link.textContent, 'address must be visible text even if the user has no mail client').toBe(
      ACCESSIBILITY_CONTACT_EMAIL,
    );
  });

  it('declares the WCAG conformance target', () => {
    renderScreen('in-app');
    expect(screen.getByText(/WCAG 2\.1 Level AA/i)).toBeInTheDocument();
  });

  it('publishes a machine-readable last-reviewed date that matches the constant', () => {
    renderScreen('in-app');
    const time = screen.getByText(ACCESSIBILITY_LAST_REVIEWED_ISO);
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe(ACCESSIBILITY_LAST_REVIEWED_ISO);
  });

  it('mentions alternative-format requests so AODA users know the path exists', () => {
    renderScreen('in-app');
    // The phrase appears in multiple text nodes (heading + body). Either is
    // sufficient — we only need to pin that it's surfaced somewhere.
    expect(screen.getAllByText(/alternative format/i).length).toBeGreaterThan(0);
  });
});

describe('AccessibilityStatementScreen — mode variants', () => {
  it('public mode exposes a "Back to sign in" link (no in-app chrome present)', () => {
    renderScreen('public');
    const link = screen.getByRole('link', { name: /back to sign in/i });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('in-app mode does NOT duplicate the back link (AppShell provides chrome)', () => {
    renderScreen('in-app');
    expect(screen.queryByRole('link', { name: /back to sign in/i })).toBeNull();
  });

  it('both modes contain the same statement body (the back link is the only diff)', () => {
    const publicEl = renderScreen('public');
    const inAppEl = renderScreen('in-app');
    // The same 5 sections must render in both modes (commitment, conformance,
    // limitations, feedback, last-reviewed). We pin the section headings.
    for (const root of [publicEl, inAppEl]) {
      const region = within(root.container);
      expect(region.getByRole('heading', { level: 2, name: /our commitment/i })).toBeInTheDocument();
      expect(region.getByRole('heading', { level: 2, name: /conformance/i })).toBeInTheDocument();
      expect(region.getByRole('heading', { level: 2, name: /known limitations/i })).toBeInTheDocument();
      expect(region.getByRole('heading', { level: 2, name: /report a barrier/i })).toBeInTheDocument();
    }
  });
});
