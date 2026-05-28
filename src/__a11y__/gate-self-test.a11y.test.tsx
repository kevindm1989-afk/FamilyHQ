/**
 * A11y gate self-test (Phase 4 / Task 17).
 *
 * Pins that the `toHaveNoViolations` matcher actually fails on a deliberately
 * broken DOM. Without this, an empty/silently-skipping matcher would be
 * indistinguishable from a passing gate — the previous placeholder masked the
 * gate's emptiness, and we don't want to ship a new placeholder with the same
 * shape. If this test starts passing in the SUCCESS branch (i.e. axe reports
 * no violations on a `<button></button>`), the gate has lost its teeth and
 * needs investigating.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axeA11y } from './fixtures';

describe('a11y gate — self-test', () => {
  it('detects a button with no accessible name (button-name rule)', async () => {
    // A `<button>` with no text, no aria-label, no aria-labelledby is the
    // textbook axe failure for the `button-name` rule. If axe reports zero
    // violations here, the matcher is silently no-op'ing.
    const { container } = render(<button type="button" />);
    const result = await axeA11y(container);
    expect(
      result.violations.some((v) => v.id === 'button-name'),
      'axe MUST flag an unlabeled <button> — if this fails, the gate is broken',
    ).toBe(true);
  });

  it('passes a properly-labeled button (positive control)', async () => {
    const { container } = render(<button type="button">Submit</button>);
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
