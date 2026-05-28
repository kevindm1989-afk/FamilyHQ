/**
 * A11y gate — PwaUpdatePrompt (Phase 4 / Task 16).
 *
 * The prompt only renders when a SW update is available; we mock the
 * `virtual:pwa-register/react` hook to force `needRefresh=true` so the
 * banner mounts and axe can check the rendered surface.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [true, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));

import { PwaUpdatePrompt } from '../app/PwaUpdatePrompt';
import { axeA11y } from './fixtures';

describe('a11y — PwaUpdatePrompt', () => {
  it('banner (needRefresh=true) has no axe violations', async () => {
    const { container } = render(<PwaUpdatePrompt />);
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
