/**
 * PwaUpdatePrompt — unit contract (Phase 4 / Task 16; ADR-0005).
 *
 * Pins the user-controlled SW update flow:
 *   - When the SW reports `needRefresh=false` the banner does NOT render
 *     (clean baseline; no visual noise).
 *   - When it flips to true, the banner renders with the accessible role +
 *     live-region attrs (status / polite) so AT announces it.
 *   - Clicking Update calls `updateServiceWorker(true)` — that's the only
 *     path that reloads the page, so it MUST be wired to that button.
 *   - Clicking Dismiss sets `needRefresh=false` (the banner disappears) but
 *     does NOT call `updateServiceWorker`. Dismiss is a defer, not an
 *     update — a mid-task parent who's still in a sheet picks Dismiss and
 *     keeps working until they're ready.
 *
 * The `virtual:pwa-register/react` module is provided at build time by
 * vite-plugin-pwa; under test we replace it with a controllable mock so
 * we can drive `needRefresh` and observe the `updateServiceWorker` call.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockState {
  needRefresh: boolean;
  setNeedRefreshCalls: boolean[];
  updateCalls: Array<boolean | undefined>;
}
let mock: MockState;

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [
      mock.needRefresh,
      (next: boolean) => {
        mock.setNeedRefreshCalls.push(next);
      },
    ],
    offlineReady: [false, () => {}],
    updateServiceWorker: async (reload?: boolean) => {
      mock.updateCalls.push(reload);
    },
  }),
}));

import { PwaUpdatePrompt } from './PwaUpdatePrompt';

beforeEach(() => {
  mock = { needRefresh: false, setNeedRefreshCalls: [], updateCalls: [] };
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('PwaUpdatePrompt — rendering', () => {
  it('renders NOTHING when no SW update is available (needRefresh=false)', () => {
    mock.needRefresh = false;
    const { container } = render(<PwaUpdatePrompt />);
    expect(
      container.firstChild,
      'no SW update -> no banner — the user must not see chrome that does nothing',
    ).toBeNull();
  });

  it('renders the banner with status live-region a11y when an update is available', () => {
    mock.needRefresh = true;
    render(<PwaUpdatePrompt />);
    const banner = screen.getByTestId('pwa-update-prompt');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });
});

describe('PwaUpdatePrompt — user actions', () => {
  it('Update click calls updateServiceWorker(true) — and ONLY that', () => {
    mock.needRefresh = true;
    render(<PwaUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: /update/i }));
    expect(
      mock.updateCalls,
      'Update MUST call updateServiceWorker(true) — that is the reload path',
    ).toEqual([true]);
    expect(
      mock.setNeedRefreshCalls,
      'Update must NOT silently dismiss without applying — only the SW callback can clear the flag',
    ).toEqual([]);
  });

  it('Dismiss click defers (setNeedRefresh(false)) and does NOT trigger an update', () => {
    mock.needRefresh = true;
    render(<PwaUpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(
      mock.setNeedRefreshCalls,
      'Dismiss MUST clear the needRefresh flag so the banner disappears',
    ).toEqual([false]);
    expect(
      mock.updateCalls,
      'Dismiss MUST NOT reload — it is a defer, not an update',
    ).toEqual([]);
  });
});
