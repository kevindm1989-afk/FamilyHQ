import type { ReactElement } from 'react';

export interface EmptyStateProps {
  message: string;
}

/**
 * Friendly empty state — required on every list section (preferences.md). Text,
 * never illustration-only.
 */
export function EmptyState(props: EmptyStateProps): ReactElement {
  return <p className="px-16 py-24 text-center text-meta text-ink-mute">{props.message}</p>;
}
