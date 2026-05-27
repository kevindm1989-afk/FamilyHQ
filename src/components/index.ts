/**
 * Shared primitives barrel (Task 6, handoff §Shared Components + style-guide §4
 * + design-tokens.json components.*).
 *
 * Styling values come from tokens (the Tailwind theme); components assert
 * behaviour/roles/attributes. Accessibility non-negotiables (style-guide §2):
 * `amber`/`success` buttons use DARK INK text (never white); every interactive
 * primitive meets the 44px tap target and exposes a visible focus ring.
 */
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export { AvatarChip, type AvatarChipProps } from './AvatarChip';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Card, type CardProps } from './Card';
export { TextField, type TextFieldProps } from './TextField';
export { TopBar, type TopBarProps } from './TopBar';
export { BottomNav, type BottomNavProps, type NavTab } from './BottomNav';
export { Fab, type FabProps } from './Fab';
export { Toast, type ToastProps } from './Toast';
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Skeleton, type SkeletonProps } from './Skeleton';
