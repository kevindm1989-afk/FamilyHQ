/**
 * CONTRACT STUB — Compose Post sheet (Phase 3, Task 9; handoff #08 ComposeSheet).
 *
 * Signature only, no implementation. The implementer writes the body to satisfy
 * ComposePost.test.tsx. This throws on render so the component tests FAIL for the
 * right reason (the component is not built yet) rather than passing vacuously.
 *
 * Contract (handoff #08 + preferences "toast-everything", "errors are
 * user-safe"):
 *  - Renders inside a BottomSheet titled "New post".
 *  - Author row shows the current user's avatar + name; a parent author shows
 *    the crown/role affordance (Avatar showRoleForA11y).
 *  - A multi-line textarea with placeholder "Share something with the family…",
 *    associated with an accessible label.
 *  - The "Post" button is DISABLED while the trimmed content is empty.
 *  - On submit: calls the injected `onCreate` with the trimmed content, then on
 *    success closes the sheet and fires a success toast; on failure fires a
 *    generic PII-free error toast and does NOT close.
 *
 * DATA-MODEL NOTE: no read/unread field — composing a post never sets one.
 */
import type { ReactElement } from 'react';
import type { Role } from '../../lib/types';

export interface ComposePostProps {
  open: boolean;
  onClose: () => void;
  /** Current user identity used for the author row + the created post. */
  author: { uid: string; name: string; role: Role };
  /**
   * Injected create action (the screen wires this to boardService.createPost +
   * useToast). Receives the trimmed content. Resolves on success, rejects on
   * failure. Injected so the sheet is unit-testable without Firestore.
   */
  onCreate: (content: string) => Promise<void>;
}

export function ComposePost(_props: ComposePostProps): ReactElement {
  throw new Error('ComposePost not implemented (contract stub — Task 9)');
}
