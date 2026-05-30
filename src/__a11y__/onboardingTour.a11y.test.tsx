/**
 * A11y gate — OnboardingTour.
 *
 * Both role variants exercised. A welcome modal that fails accessibility
 * sets the wrong tone for the entire app.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingTour } from '../features/onboarding/OnboardingTour';
import { axeA11y } from './fixtures';

describe('a11y — OnboardingTour', () => {
  it('parent mode (longest step list) has no axe violations', async () => {
    const { container } = render(<OnboardingTour role="parent" onClose={vi.fn()} />);
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('member mode has no axe violations', async () => {
    const { container } = render(<OnboardingTour role="member" onClose={vi.fn()} />);
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
