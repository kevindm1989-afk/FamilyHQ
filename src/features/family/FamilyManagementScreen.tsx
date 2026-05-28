/**
 * Family Management screen (Phase 4 — parent-only at /family).
 *
 * SIGNATURE / SHELL ONLY. The implementer fills in the body. The component
 * test pins:
 *  - the page <h1>, the active / inactive <section>s with <h2>s and <ul>/<li>;
 *  - a Rename affordance per row (incl. the viewer's own row);
 *  - a Deactivate affordance for `role === 'member'` ONLY (never any parent,
 *    never the viewer's own row);
 *  - a Reactivate affordance per inactive member;
 *  - NO email text anywhere on screen (ADR-0008);
 *  - the rename BottomSheet flow (label + validation + Save/Cancel);
 *  - the deactivate confirm BottomSheet;
 *  - the loading / empty / error states (single toast viewport).
 *
 * Firebase is OUT of this screen — props inject the data and the action
 * callbacks (mirrors ChoresParentScreen / BoardScreen).
 */
import type { ReactElement } from 'react';
import type { UserWithId } from '../../lib/types';

export interface FamilyManagementScreenProps {
  /** The signed-in parent viewing the screen. */
  viewer: UserWithId;
  /** ALL in-family members (active + inactive). */
  members: UserWithId[];
  loading: boolean;
  error: string | null;
  onRename: (uid: string, name: string) => Promise<void>;
  onSetActive: (uid: string, isActive: boolean) => Promise<void>;
  onRefresh: () => void;
}

export function FamilyManagementScreen(_props: FamilyManagementScreenProps): ReactElement {
  throw new Error('not implemented');
}
