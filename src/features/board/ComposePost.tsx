/**
 * Compose Post sheet (Phase 3, Task 9; handoff #08 ComposeSheet).
 *
 * Renders inside a BottomSheet titled "New post". Author row shows the current
 * user's avatar + name; a parent author exposes the role to AT (crown +
 * visually-hidden "Parent"). A multi-line textarea (placeholder "Share
 * something with the family…") associated with an accessible label. The Post
 * button is DISABLED while the trimmed content is empty/whitespace-only.
 *
 * On submit: calls the injected `onCreate` with the trimmed content, then on
 * success closes the sheet and fires a success toast; on failure fires a
 * generic PII-free error toast and does NOT close (preferences "toast-
 * everything", "errors are user-safe").
 *
 * DATA-MODEL NOTE: no read/unread field — composing a post never sets one.
 */
import { useId, useState, type ReactElement } from 'react';
import { Avatar, BottomSheet } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { Role } from '../../lib/types';
import { POST_CREATE_SUCCESS, POST_GENERIC_ERROR } from './boardService';

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

export function ComposePost(props: ComposePostProps): ReactElement {
  const { open, onClose, author, onCreate } = props;
  const { showToast } = useToast();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaId = useId();

  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    setSubmitting(true);
    void onCreate(trimmed)
      .then(() => {
        showToast(POST_CREATE_SUCCESS);
        setContent('');
        setSubmitting(false);
        onClose();
      })
      .catch(() => {
        // Never surface a raw Firebase code / PII — generic copy only.
        showToast(POST_GENERIC_ERROR);
        setSubmitting(false);
      });
  };

  return (
    <BottomSheet open={open} title="New post" onClose={onClose}>
      <div className="flex flex-col gap-16">
        <div className="flex items-center gap-12">
          <Avatar name={author.name} role={author.role} size="default" showRoleForA11y />
          <span className="text-body font-semibold text-ink">{author.name}</span>
        </div>

        <div className="flex flex-col gap-6">
          <label htmlFor={textareaId} className="text-label font-semibold text-ink-2">
            Share a post with the family
          </label>
          <textarea
            id={textareaId}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share something with the family…"
            rows={4}
            className="w-full resize-none rounded-control border border-surface-line bg-surface-card px-14 py-12 text-body text-ink placeholder:text-ink-mute2 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          />
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          aria-busy={submitting || undefined}
          onClick={handleSubmit}
          className="inline-flex min-h-tap items-center justify-center rounded-control bg-brand px-20 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus active:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        >
          Post
        </button>
      </div>
      <ToastViewport />
    </BottomSheet>
  );
}
