/**
 * A11y gate — AccessibilityStatementScreen (AODA artifact, Phase 4).
 *
 * A page about accessibility that itself fails accessibility checks would be
 * a singularly bad look. Both mode variants are exercised.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AccessibilityStatementScreen } from '../features/accessibility/AccessibilityStatementScreen';
import { axeA11y } from './fixtures';

describe('a11y — AccessibilityStatementScreen', () => {
  it('public mode has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AccessibilityStatementScreen mode="public" />
      </MemoryRouter>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('in-app mode has no axe violations', async () => {
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AccessibilityStatementScreen mode="in-app" />
      </MemoryRouter>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
