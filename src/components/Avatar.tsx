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
  /**
   * A11y finding: the avatar is decorative (aria-hidden) and the parent crown
   * is icon/color only. In a role-conveying context, set this so parent status
   * is exposed to assistive tech as visually-hidden TEXT ("Parent"), not via
   * the crown alone. Implementer renders a non-aria-hidden visually-hidden
   * label for parents when true.
   */
  showRoleForA11y?: boolean;
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
  const { name, role, size = 'default', ring = false, showRoleForA11y = false } = props;
  const isParent = role === 'parent';
  const initials = initialsFromName(name);

  const bg = isParent ? 'bg-accent' : 'bg-brand';
  const ringClass = ring ? 'ring-focus ring-brand ring-offset-focus' : '';

  // The avatar glyph + crown are decorative (color/icon only): the initials and
  // crown are aria-hidden. When the avatar conveys identity (showRoleForA11y),
  // parent status must reach assistive tech as TEXT, not via the crown alone
  // (WCAG 1.4.1 / 1.1.1) — render a visually-hidden, NON-aria-hidden "Parent"
  // label inside the avatar so it joins the accessible name.
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-bold text-ink-on-dark ${bg} ${SIZE_CLASS[size]} ${ringClass}`}
    >
      <span aria-hidden="true">{initials}</span>
      {isParent && (
        <span
          data-testid="avatar-crown"
          aria-hidden="true"
          className="absolute -right-4 -top-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent text-ink-on-dark"
        >
          <CrownIcon />
        </span>
      )}
      {showRoleForA11y && isParent && <span className="sr-only">Parent</span>}
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
