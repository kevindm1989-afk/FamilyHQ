/**
 * A11y gate — LegalScreen (Privacy + Terms launch-gate items).
 *
 * Both variants × both modes are exercised. Pages users read carefully
 * (privacy + terms) must clear axe — a violation here is a launch blocker.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { LegalScreen, type LegalVariant } from '../features/legal/LegalScreen';
import { axeA11y } from './fixtures';

function renderScreen(variant: LegalVariant, mode: 'public' | 'in-app') {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LegalScreen variant={variant} mode={mode} />
    </MemoryRouter>,
  );
}

describe.each<{ variant: LegalVariant }>([{ variant: 'privacy' }, { variant: 'terms' }])(
  'a11y — LegalScreen ($variant)',
  ({ variant }) => {
    it(`${variant} public mode has no axe violations`, async () => {
      const { container } = renderScreen(variant, 'public');
      expect(await axeA11y(container)).toHaveNoViolations();
    });

    it(`${variant} in-app mode has no axe violations`, async () => {
      const { container } = renderScreen(variant, 'in-app');
      expect(await axeA11y(container)).toHaveNoViolations();
    });
  },
);

describe('a11y — LegalScreen (fr)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr');
  });
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('privacy in-app French has no axe violations', async () => {
    const { container } = renderScreen('privacy', 'in-app');
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('terms in-app French has no axe violations', async () => {
    const { container } = renderScreen('terms', 'in-app');
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
