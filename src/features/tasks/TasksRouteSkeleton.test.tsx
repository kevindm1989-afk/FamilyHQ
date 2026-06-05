/**
 * Smoke test for the Suspense fallback skeleton — pins the live-region
 * aria-busy + the loading label so AT users hear the chunk swap.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TasksRouteSkeleton } from './TasksRouteSkeleton';

describe('TasksRouteSkeleton', () => {
  it('renders a live-region status block with the common loading label', () => {
    render(<TasksRouteSkeleton />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-label', expect.stringMatching(/loading/i));
  });
});
