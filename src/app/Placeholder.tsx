/**
 * Shared placeholder for routes that resolve with no `currentUser` /
 * `familyId` yet (the auth + family providers are still resolving). Lives
 * here because every lazy-loaded *Route module needs it; keeping it inside
 * AppShell would force each route chunk to import the shell, creating a
 * circular module graph.
 */
import type { ReactElement } from 'react';
import { EmptyState } from '../components';

export function Placeholder(props: { title: string; note?: string }): ReactElement {
  return (
    <section className="px-16 pt-4">
      <h1 className="text-display font-display font-extrabold text-ink">{props.title}</h1>
      {props.note ? (
        <p className="mt-8 text-meta text-ink-mute">{props.note}</p>
      ) : (
        <EmptyState message="Coming soon — this section lands in the next phase." />
      )}
    </section>
  );
}
