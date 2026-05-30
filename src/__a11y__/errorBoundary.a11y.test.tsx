/**
 * A11y gate — ErrorBoundary fallback.
 *
 * The crash screen is one of the most stressful surfaces a user can land on.
 * It MUST clear axe — failing accessibility on the error screen would
 * compound the bad experience.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../app/ErrorBoundary';
import { axeA11y } from './fixtures';

function Thrower(): never {
  throw new Error('boom for a11y test');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('a11y — ErrorBoundary fallback', () => {
  it('the default fallback has no axe violations', async () => {
    const { container } = render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
