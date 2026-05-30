/**
 * LegalScreen — unit contract (Privacy + Terms launch-gate items).
 *
 * Pins the structural commitments the page must keep:
 *   1. There's a single H1 naming the document in scope.
 *   2. A draft badge is present — removing the badge is a legal-review
 *      gate, not a cosmetic edit, so the test fails if it disappears.
 *   3. A machine-readable last-reviewed <time> matches the exported
 *      constant.
 *   4. All six expected section headings render (scope, data, sharing,
 *      retention, rights, changes).
 *   5. A `mailto:` contact link to the published address is present —
 *      the address must also be the visible text so a user with no mail
 *      client still gets it.
 *   6. The public variant exposes a "Back to sign in" link; the in-app
 *      variant does NOT (AppShell chrome provides navigation).
 *   7. Cross-link to the sibling document (privacy ↔ terms) is present.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_REVIEWED_ISO,
  LegalScreen,
  type LegalVariant,
} from './LegalScreen';

function renderScreen(variant: LegalVariant, mode: 'public' | 'in-app') {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LegalScreen variant={variant} mode={mode} />
    </MemoryRouter>,
  );
}

describe.each<{ variant: LegalVariant; titlePattern: RegExp }>([
  { variant: 'privacy', titlePattern: /privacy policy/i },
  { variant: 'terms', titlePattern: /terms of service/i },
])('LegalScreen — required structure ($variant)', ({ variant, titlePattern }) => {
  it('exposes a single H1 naming the document', () => {
    renderScreen(variant, 'in-app');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent ?? '').toMatch(titlePattern);
  });

  it('shows a "draft — pending legal review" badge so the document is honest about its state', () => {
    renderScreen(variant, 'in-app');
    expect(screen.getByText(/draft.*pending legal review/i)).toBeInTheDocument();
  });

  it('publishes a machine-readable last-reviewed date matching the exported constant', () => {
    renderScreen(variant, 'in-app');
    const time = screen.getByText(LEGAL_LAST_REVIEWED_ISO);
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('datetime')).toBe(LEGAL_LAST_REVIEWED_ISO);
  });

  it('renders all six expected section headings', () => {
    renderScreen(variant, 'in-app');
    // We pin the structural promise — every section exists. Content text
    // can be tuned by legal review without touching this test.
    for (const expected of [
      /what this (policy|agreement) covers/i, // scope
      /what we collect|your account/i, // data
      /who we share|acceptable use/i, // sharing
      /how long we keep|service availability/i, // retention
      /your rights|liability and warranties/i, // rights
      /changes to this|governing law/i, // changes
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: expected })).toBeInTheDocument();
    }
  });

  it('publishes a mailto: contact link whose visible text is the email address', () => {
    renderScreen(variant, 'in-app');
    const link = screen.getByRole('link', { name: LEGAL_CONTACT_EMAIL });
    const href = link.getAttribute('href') ?? '';
    expect(
      href.startsWith(`mailto:${LEGAL_CONTACT_EMAIL}`),
      'contact must be a mailto: — the user must be able to act on it',
    ).toBe(true);
    expect(link.textContent).toBe(LEGAL_CONTACT_EMAIL);
  });
});

describe('LegalScreen — mode variants', () => {
  it('public mode exposes a "Back to sign in" link (no in-app chrome)', () => {
    renderScreen('privacy', 'public');
    const back = screen.getByRole('link', { name: /back to sign in/i });
    expect(back.getAttribute('href')).toBe('/');
  });

  it('in-app mode does NOT duplicate the back link (AppShell provides chrome)', () => {
    renderScreen('privacy', 'in-app');
    expect(screen.queryByRole('link', { name: /back to sign in/i })).toBeNull();
  });
});

describe('LegalScreen — cross-linking', () => {
  it('privacy links to /terms (sibling document)', () => {
    renderScreen('privacy', 'in-app');
    const link = screen.getByRole('link', { name: /terms of service/i });
    expect(link.getAttribute('href')).toBe('/terms');
  });

  it('terms links to /privacy (sibling document)', () => {
    renderScreen('terms', 'in-app');
    const link = screen.getByRole('link', { name: /privacy policy/i });
    expect(link.getAttribute('href')).toBe('/privacy');
  });

  it('both variants link to the accessibility statement', () => {
    for (const variant of ['privacy', 'terms'] as const) {
      const { unmount } = renderScreen(variant, 'in-app');
      const link = screen.getByRole('link', { name: /accessibility statement/i });
      expect(link.getAttribute('href')).toBe('/accessibility');
      unmount();
    }
  });
});
