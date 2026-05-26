/**
 * CONTRACT — shared primitives (Task 6, handoff §Shared Components +
 * style-guide §4 + design-tokens.json components.*).
 *
 * Props/signatures only; the implementer writes the component bodies. The tests
 * (./*.test.tsx) import these to pin the public contract. Styling values come
 * from tokens (Tailwind theme) — tests assert behavior/roles/attributes, never
 * pixel literals.
 *
 * Accessibility overrides that are NON-NEGOTIABLE (style-guide §2, design-tokens
 * components.button): `amber` and `success` buttons use DARK INK text, never
 * white (white-on-amber 2.1:1 / white-on-green 1.9:1 fail AA). Every interactive
 * primitive meets the 44px min tap target and exposes a visible focus ring.
 */
import type { ReactElement, ReactNode } from 'react';
import type { Role } from '../lib/types';

export type ButtonVariant =
  | 'primary'
  | 'amber'
  | 'soft'
  | 'ghost'
  | 'success'
  | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  children: ReactNode;
}
export declare function Button(props: ButtonProps): ReactElement;

export type BadgeTone =
  | 'mute'
  | 'indigo'
  | 'amber'
  | 'ok'
  | 'info'
  | 'danger'
  | 'school'
  | 'sports'
  | 'family'
  | 'work';
export interface BadgeProps {
  tone: BadgeTone;
  size?: 'sm' | 'md';
  children: ReactNode;
}
export declare function Badge(props: BadgeProps): ReactElement;

export type AvatarSize = 'chip' | 'default' | 'switcher' | 'author';
export interface AvatarProps {
  /** Display name; initials are derived from it. */
  name: string;
  role: Role;
  size?: AvatarSize;
  ring?: boolean;
}
export declare function Avatar(props: AvatarProps): ReactElement;

export interface AvatarChipProps {
  name: string;
  role: Role;
  onClick?: () => void;
}
export declare function AvatarChip(props: AvatarChipProps): ReactElement;

export interface CardProps {
  onClick?: () => void;
  children: ReactNode;
}
export declare function Card(props: CardProps): ReactElement;

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}
export declare function TextField(props: TextFieldProps): ReactElement;

export interface TopBarProps {
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
}
export declare function TopBar(props: TopBarProps): ReactElement;

export type NavTab = 'dashboard' | 'calendar' | 'board' | 'chores';
export interface BottomNavProps {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
}
export declare function BottomNav(props: BottomNavProps): ReactElement;

export interface FabProps {
  label: string; // accessible label (aria-label)
  onClick: () => void;
}
export declare function Fab(props: FabProps): ReactElement;

export interface ToastProps {
  message: string;
}
export declare function Toast(props: ToastProps): ReactElement;

export interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}
export declare function BottomSheet(props: BottomSheetProps): ReactElement;

export interface EmptyStateProps {
  message: string;
}
export declare function EmptyState(props: EmptyStateProps): ReactElement;

export interface SkeletonProps {
  label?: string;
}
export declare function Skeleton(props: SkeletonProps): ReactElement;
