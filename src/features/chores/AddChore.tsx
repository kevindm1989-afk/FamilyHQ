/**
 * Add Chore sheet/modal — CONTRACT STUB (Phase 3, Task 11; handoff #06
 * AddChoreScreen). SIGNATURES ONLY — the implementer builds the body.
 *
 * Renders inside a BottomSheet titled "Add Chore" (parent-only). Collects the
 * hardened-schema-relevant fields: title (autofocus, aria-required), assign-to
 * (a radiogroup populated from the ACTIVE family members — DYNAMIC, never
 * hardcoded), due date, point value, dollar value, recurring toggle + frequency
 * (none/weekly/biweekly). Submit is aria-disabled (focusable) while the trimmed
 * title is empty; a click while disabled is a no-op.
 *
 * On submit: calls the injected `onAdd` with the collected value; on success
 * closes + success toast; on failure a generic PII-free error toast, no close.
 */
import type { ReactElement } from 'react';
import type { RecurrenceFrequency, Role, UserWithId } from '../../lib/types';

export interface AddChoreValue {
  title: string;
  assignedTo: string;
  date: string;
  pointValue: number;
  dollarValue: number;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
}

export interface AddChoreProps {
  open: boolean;
  onClose: () => void;
  author: { uid: string; name: string; role: Role };
  /** Active members to populate the assign-to control (dynamic, not hardcoded). */
  members: UserWithId[];
  /** Injected create action (wired to choresParentService.addChore + toast). */
  onAdd: (value: AddChoreValue) => Promise<void>;
  /** The reference "today" so the Today/Tomorrow chips are deterministic. */
  today: { year: number; month: number; day: number };
}

export function AddChore(_props: AddChoreProps): ReactElement {
  throw new Error('not implemented');
}
