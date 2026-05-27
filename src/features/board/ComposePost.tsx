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
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
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
  const hintId = useId();

  // Tracks whether the sheet is still open/mounted while a create is in flight.
  // If the sheet is dismissed (or unmounts) before onCreate resolves, the
  // success side effects (toast + onClose) must NOT fire — preventing a stale
  // success toast and a double onClose (Finding E1).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const trimmed = content.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = (): void => {
    // aria-disabled keeps the button focusable; guard the action here so an
    // unavailable click is a no-op (does not call onCreate).
    if (!canSubmit) return;
    setSubmitting(true);
    void onCreate(trimmed)
      .then(() => {
        // Suppress success effects if the sheet was dismissed/unmounted mid-flight.
        if (!mountedRef.current || !openRef.current) return;
        showToast(POST_CREATE_SUCCESS);
        setContent('');
        setSubmitting(false);
        onClose();
      })
      .catch(() => {
        if (!mountedRef.current || !openRef.current) return;
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
            aria-describedby={hintId}
            rows={4}
            className="w-full resize-none rounded-control border border-surface-line bg-surface-card px-14 py-12 text-body text-ink placeholder:text-ink-mute2 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          />
          <p id={hintId} className="text-meta text-ink-mute">
            Write a message to share it with your family.
          </p>
        </div>

        <button
          type="button"
          aria-disabled={!canSubmit}
          aria-busy={submitting || undefined}
          onClick={handleSubmit}
          className={`inline-flex min-h-tap items-center justify-center rounded-control bg-brand px-20 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus active:bg-brand-dark motion-reduce:transition-none ${!canSubmit ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          Post
        </button>

        {/* Announce the in-flight state to assistive tech (Finding E3). The
            button label stays "Post" so its accessible name is stable; the
            live region carries the progress message. */}
        <p aria-live="polite" className="sr-only">
          {submitting ? 'Posting…' : ''}
        </p>
      </div>

      {/* Declares the toast viewport so the sheet's toasts surface when it is
          rendered standalone. ToastViewport is a global singleton — if a shell/
          screen viewport is already mounted, this instance is inert, so the
          message is never announced twice (Finding F). */}
      <ToastViewport />
    </BottomSheet>
  );
}
