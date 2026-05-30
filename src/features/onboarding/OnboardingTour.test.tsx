/**
 * OnboardingTour — unit contract.
 *
 * Pins:
 *   1. Renders a role="dialog" labelled by the current step's heading.
 *   2. Step counter reflects current/total and updates with Next/Back.
 *   3. Back is disabled on the first step.
 *   4. Last step shows "Get started" (Done); pressing it calls onClose.
 *   5. Skip from any step calls onClose.
 *   6. Esc calls onClose.
 *   7. Parent sees the family-management step; member does NOT.
 *   8. hasSeenTour / markTourSeen / resetTour round-trip through
 *      localStorage with the versioned key.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingTour } from './OnboardingTour';
import {
  hasSeenTour,
  markTourSeen,
  resetTour,
  TOUR_STORAGE_KEY,
  stepsForRole,
} from './tourStorage';

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('OnboardingTour — dialog basics', () => {
  it('exposes a role="dialog" labelled by the current step heading', () => {
    render(<OnboardingTour role="parent" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.getAttribute('id'));
  });

  it('shows the step counter "1 of N" on first mount', () => {
    render(<OnboardingTour role="parent" onClose={vi.fn()} />);
    const total = stepsForRole('parent').length;
    expect(screen.getByText(new RegExp(`step\\s*1.*of.*${total}`, 'i'))).toBeInTheDocument();
  });

  it('Back is disabled on the first step', () => {
    render(<OnboardingTour role="parent" onClose={vi.fn()} />);
    const back = screen.getByRole('button', { name: /back/i });
    expect((back as HTMLButtonElement).disabled).toBe(true);
  });

  it('Next advances the counter; Back returns it', () => {
    render(<OnboardingTour role="parent" onClose={vi.fn()} />);
    const total = stepsForRole('parent').length;
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(new RegExp(`step\\s*2.*of.*${total}`, 'i'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText(new RegExp(`step\\s*1.*of.*${total}`, 'i'))).toBeInTheDocument();
  });
});

describe('OnboardingTour — completion', () => {
  it('the last step shows "Get started" and pressing it calls onClose', () => {
    const onClose = vi.fn();
    render(<OnboardingTour role="parent" onClose={onClose} />);
    const total = stepsForRole('parent').length;
    for (let i = 0; i < total - 1; i++) {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    }
    const done = screen.getByRole('button', { name: /get started/i });
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Skip from any step calls onClose', () => {
    const onClose = vi.fn();
    render(<OnboardingTour role="member" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /skip tour/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc calls onClose', () => {
    const onClose = vi.fn();
    render(<OnboardingTour role="member" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingTour — role-scoped steps', () => {
  it('parents see strictly MORE steps than members (family-management is parent-only)', () => {
    expect(stepsForRole('parent').length).toBeGreaterThan(stepsForRole('member').length);
  });

  it('member tour does NOT include the family-management step', () => {
    const ids = stepsForRole('member').map((s) => s.id);
    expect(ids).not.toContain('family');
  });

  it('parent tour DOES include the family-management step', () => {
    const ids = stepsForRole('parent').map((s) => s.id);
    expect(ids).toContain('family');
  });
});

describe('OnboardingTour — storage round-trip', () => {
  it('hasSeenTour() is false when storage is empty', () => {
    expect(hasSeenTour()).toBe(false);
  });

  it('markTourSeen() writes the versioned key', () => {
    markTourSeen();
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
    expect(hasSeenTour()).toBe(true);
  });

  it('resetTour() clears the key so the tour re-shows', () => {
    markTourSeen();
    resetTour();
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
    expect(hasSeenTour()).toBe(false);
  });

  it('hasSeenTour() defaults to true when localStorage throws (safety: never spam the modal)', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('quota');
    }) as never;
    expect(hasSeenTour()).toBe(true);
    Storage.prototype.getItem = original;
  });
});
