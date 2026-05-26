import type { ReactElement } from 'react';
import type { Role } from '../lib/types';
import { initialsFromName } from './avatarUtils';

export type AvatarSize = 'chip' | 'default' | 'switcher' | 'author';

export interface AvatarProps {
  /** Display name; initials are derived from it. */
  name: string;
  role: Role;
  size?: AvatarSize;
  ring?: boolean;
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  chip: 'h-avatar-chip w-avatar-chip text-caption',
  default: 'h-avatar-default w-avatar-default text-badge',
  switcher: 'h-avatar-switcher w-avatar-switcher text-body',
  author: 'h-avatar-author w-avatar-author text-title',
};

/**
 * Person identity avatar. Production color rule (preferences.md): indigo bg for
 * members, amber bg for parents; an amber crown badge marks parents only.
 * Initials are white-on-fill (onDark) — both fills pass AA for the glyph.
 */
export function Avatar(props: AvatarProps): ReactElement {
  const { name, role, size = 'default', ring = false } = props;
  const isParent = role === 'parent';
  const initials = initialsFromName(name);

  const bg = isParent ? 'bg-accent' : 'bg-brand';
  const ringClass = ring ? 'ring-2 ring-brand ring-offset-2' : '';

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-bold text-ink-on-dark ${bg} ${SIZE_CLASS[size]} ${ringClass}`}
      aria-hidden="true"
    >
      {initials}
      {isParent && (
        <span
          data-testid="avatar-crown"
          className="absolute -right-4 -top-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-ink-on-dark"
        >
          <CrownIcon />
        </span>
      )}
    </span>
  );
}

function CrownIcon(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="currentColor" aria-hidden="true">
      <path d="M3 7l4 4 5-6 5 6 4-4-2 12H5L3 7z" />
    </svg>
  );
}
