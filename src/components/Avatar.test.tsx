/**
 * Avatar + AvatarChip primitives — contract (Task 6, handoff §Avatar/AvatarChip,
 * design-tokens components.avatar).
 *
 * Asserts behavior/role/attributes (NOT pixels):
 *  - initials derived from the display name
 *  - production color rule: indigo bg for member, amber bg for parent
 *  - crown badge present ONLY for parents
 *  - AvatarChip is a tappable control meeting the 44px hit area
 *
 * Per style-guide §2 the four named demo hues are reference-only; production
 * derives indigo (member) / amber (parent). We assert the ROLE-based rule.
 *
 * FAILS today: Avatar/AvatarChip are declare-only contract stubs.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Avatar, AvatarChip } from './index';

describe('Avatar — initials', () => {
  it('derives two-letter initials from a two-word name', () => {
    render(<Avatar name="Maya Rivera" role="member" />);
    expect(screen.getByText('MR')).toBeInTheDocument();
  });

  it('derives a single initial from a one-word name', () => {
    render(<Avatar name="Ben" role="member" />);
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('uppercases initials regardless of input casing', () => {
    render(<Avatar name="sarah kim" role="parent" />);
    expect(screen.getByText('SK')).toBeInTheDocument();
  });
});

describe('Avatar — role-based color (production rule)', () => {
  it('member avatar uses an indigo background (bg-brand)', () => {
    const { container } = render(<Avatar name="Maya R" role="member" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/bg-brand\b/);
    expect(root.className).not.toMatch(/bg-accent\b/);
  });

  it('parent avatar uses an amber background (bg-accent)', () => {
    const { container } = render(<Avatar name="Sarah K" role="parent" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/bg-accent\b/);
  });
});

describe('Avatar — crown badge is parents-only', () => {
  it('parent avatar renders a crown badge', () => {
    render(<Avatar name="Sarah K" role="parent" />);
    expect(screen.getByTestId('avatar-crown')).toBeInTheDocument();
  });

  it('member avatar does NOT render a crown badge', () => {
    render(<Avatar name="Maya R" role="member" />);
    expect(screen.queryByTestId('avatar-crown')).not.toBeInTheDocument();
  });
});

describe('AvatarChip — tappable account-switcher trigger', () => {
  it('renders the person first name and is a button', () => {
    render(<AvatarChip name="Sarah Kim" role="parent" onClick={vi.fn()} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('Sarah');
  });

  it('fires onClick when tapped', () => {
    const onClick = vi.fn();
    render(<AvatarChip name="Sarah Kim" role="parent" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('meets the 44px hit area (visual 36px chip padded to tap target)', () => {
    render(<AvatarChip name="Sarah Kim" role="parent" onClick={vi.fn()} />);
    expect(screen.getByRole('button').className).toMatch(/min-h-tap/);
  });
});
