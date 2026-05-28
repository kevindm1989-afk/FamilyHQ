/**
 * A11y gate — AccessibilityStatementScreen in French (Phase: AODA French
 * scaffolding).
 *
 * The English variant is already covered by accessibilityStatement.a11y.test.tsx.
 * This file additionally pins that the French copy renders WITHOUT violations
 * — because Trans interpolations + line-wrapping in French can produce
 * structurally different DOM (e.g. stray spaces, punctuation differences),
 * and a tilt that breaks axe in fr but not en would otherwise slip through.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { AccessibilityStatementScreen } from '../features/accessibility/AccessibilityStatementScreen';
import { axeA11y } from './fixtures';

beforeEach(async () => {
  await i18n.changeLanguage('fr');
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('a11y — AccessibilityStatementScreen (fr)', () => {
  it('public mode has no axe violations in French', async () => {
    const { container } = render(
      <MemoryRouter>
        <AccessibilityStatementScreen mode="public" />
      </MemoryRouter>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('in-app mode has no axe violations in French', async () => {
    const { container } = render(
      <MemoryRouter>
        <AccessibilityStatementScreen mode="in-app" />
      </MemoryRouter>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
