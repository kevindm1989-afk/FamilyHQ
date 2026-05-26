/**
 * Button primitive — contract (Task 6, handoff §Button, style-guide §Button,
 * design-tokens components.button).
 *
 * Asserts behavior/role/attributes (token-derived classes, NOT pixel literals):
 *  - renders all six variants and three sizes as a real <button>
 *  - the approved a11y override: amber + success use DARK INK text, never white
 *  - disabled is communicated (aria-disabled), loading sets aria-busy
 *  - meets 44px min tap target (min-h-tap), exposes focus-visible affordance
 *  - fires onClick when enabled; does not when disabled
 *
 * FAILS today: Button is a declare-only contract stub (render throws).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, type ButtonSize, type ButtonVariant } from './index';

const VARIANTS: ButtonVariant[] = [
  'primary',
  'amber',
  'soft',
  'ghost',
  'success',
  'danger',
];
const SIZES: ButtonSize[] = ['sm', 'md', 'lg'];

describe('Button — variants and sizes render', () => {
  for (const variant of VARIANTS) {
    it(`renders the ${variant} variant as a button with its label`, () => {
      render(<Button variant={variant}>Go</Button>);
      expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });
  }

  for (const size of SIZES) {
    it(`renders the ${size} size as a button`, () => {
      render(<Button size={size}>Go</Button>);
      expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    });
  }
});

describe('Button — a11y ink-on-accent override (style-guide §2)', () => {
  it('amber variant uses ink text (text-onAccent / text-ink), NEVER white', () => {
    render(<Button variant="amber">Approve</Button>);
    const btn = screen.getByRole('button', { name: 'Approve' });
    expect(btn.className).not.toMatch(/\btext-white\b/);
    expect(btn.className).toMatch(/text-(onAccent|ink)\b/);
  });

  it('success variant uses ink text (text-onAccent / text-ink), NEVER white', () => {
    render(<Button variant="success">Approve</Button>);
    const btn = screen.getByRole('button', { name: 'Approve' });
    expect(btn.className).not.toMatch(/\btext-white\b/);
    expect(btn.className).toMatch(/text-(onAccent|ink)\b/);
  });

  it('primary variant DOES use on-indigo (white) text — control for the override', () => {
    render(<Button variant="primary">Sign in</Button>);
    const btn = screen.getByRole('button', { name: 'Sign in' });
    // primary text is brand.onIndigo (#FFFFFF) — exposed as text-brand-on.
    expect(btn.className).toMatch(/text-(brand-on|white)\b/);
  });
});

describe('Button — tap target and focus', () => {
  for (const size of SIZES) {
    it(`${size} button meets the 44px min tap target (min-h-tap)`, () => {
      render(<Button size={size}>Go</Button>);
      const btn = screen.getByRole('button', { name: 'Go' });
      expect(btn.className).toMatch(/min-h-tap/);
    });
  }

  it('exposes a focus-visible ring affordance', () => {
    render(<Button>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn.className).toMatch(/focus-visible:/);
  });
});

describe('Button — disabled and loading states', () => {
  it('disabled button sets aria-disabled and stays in the accessibility tree (focusable)', () => {
    render(
      <Button disabled onClick={vi.fn()}>
        Go
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('disabled button does NOT fire onClick', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loading button sets aria-busy', () => {
    render(<Button loading>Saving</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Button — click behavior', () => {
  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
