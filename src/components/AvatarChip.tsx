import type { ReactElement } from 'react';
import type { Role } from '../lib/types';
import { Avatar } from './Avatar';

export interface AvatarChipProps {
  name: string;
  role: Role;
  onClick?: () => void;
}

/**
 * Tappable account-switcher trigger: a 36px visual pill padded to the 44px tap
 * target. Shows the person's first name only.
 */
export function AvatarChip(props: AvatarChipProps): ReactElement {
  const { name, role, onClick } = props;
  const firstName = name.trim().split(/\s+/)[0] ?? name;

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-tap items-center gap-8 rounded-full bg-surface-line2 py-4 pl-4 pr-10 text-body text-ink-2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
    >
      <Avatar name={name} role={role} size="chip" showRoleForA11y />
      <span className="font-bold">{firstName}</span>
    </button>
  );
}
