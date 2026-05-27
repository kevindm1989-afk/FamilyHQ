/**
 * Compose Post sheet — component contract (Task 9; handoff #08 ComposeSheet,
 * preferences "toast-everything", "errors are user-safe").
 *
 * Level: component. The sheet owns its validation, the success/close behavior,
 * and the toast; the create ACTION is injected (resolve/reject) so we test
 * without Firestore. Server authority is covered by test/rules/posts.test.ts.
 *
 * FAILS today: ComposePost is a contract stub that throws on render.
 *
 * Isolation: injected onCreate (vi.fn); ToastProvider supplies the real toast
 * queue (its 1.8s timer is irrelevant — we assert the message appears). No
 * network/RNG; each test re-creates props.
 *
 * State traceability (designer states for the Post button + sheet):
 *  - empty/disabled: button disabled while content is whitespace-only
 *  - enabled: button enabled once there is non-whitespace content
 *  - success: submit -> onClose called + success toast
 *  - error: rejected submit -> error toast, sheet NOT closed
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { ComposePost, type ComposePostProps } from './ComposePost';
import { POST_CREATE_SUCCESS } from './boardService';

function renderSheet(overrides: Partial<ComposePostProps> = {}) {
  const props: ComposePostProps = {
    open: true,
    onClose: vi.fn(),
    author: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
    onCreate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <ToastProvider>
      <ComposePost {...props} />
    </ToastProvider>,
  );
  return props;
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('Share something with the family…') as HTMLTextAreaElement;
}
function getPostButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^post$/i }) as HTMLButtonElement;
}

describe('ComposePost — structure + a11y', () => {
  it('renders as a dialog titled "New post"', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/new post/i);
  });

  it('renders the textarea with the exact placeholder copy', () => {
    renderSheet();
    expect(getTextarea()).toBeInTheDocument();
  });

  it('the textarea has an associated accessible label (label-input association)', () => {
    renderSheet();
    // Must be reachable by an accessible name, not placeholder alone.
    expect(
      screen.getByRole('textbox', { name: /post|share|message/i }),
      'the compose textarea must have an accessible name for AT',
    ).toBeInTheDocument();
  });

  it('shows the author name and exposes a parent author’s role to AT (crown a11y)', () => {
    renderSheet({ author: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' } });
    expect(screen.getByText(/sarah/i)).toBeInTheDocument();
    expect(screen.getByText(/parent/i)).toBeInTheDocument();
  });

  it('does NOT expose a parent role label for a member author', () => {
    renderSheet({ author: { uid: 'uid-member-a', name: 'Maya Rivera', role: 'member' } });
    expect(screen.queryByText(/parent/i)).not.toBeInTheDocument();
  });
});

describe('ComposePost — non-empty validation (edge)', () => {
  it('disables the Post button when the textarea is empty', () => {
    renderSheet();
    expect(getPostButton()).toBeDisabled();
  });

  it('keeps the Post button disabled for whitespace-only input', () => {
    renderSheet();
    fireEvent.change(getTextarea(), { target: { value: '   \n\t  ' } });
    expect(getPostButton()).toBeDisabled();
  });

  it('enables the Post button once there is non-whitespace content', () => {
    renderSheet();
    fireEvent.change(getTextarea(), { target: { value: 'Pizza tonight' } });
    expect(getPostButton()).toBeEnabled();
  });
});

describe('ComposePost — submit (happy)', () => {
  it('calls onCreate with the trimmed content', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onCreate });
    fireEvent.change(getTextarea(), { target: { value: '  Movie night 🎬  ' } });
    fireEvent.click(getPostButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith('Movie night 🎬');
  });

  it('closes the sheet on a successful create', async () => {
    const onClose = vi.fn();
    renderSheet({ onClose, onCreate: vi.fn().mockResolvedValue(undefined) });
    fireEvent.change(getTextarea(), { target: { value: 'hello' } });
    fireEvent.click(getPostButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('fires the success toast on a successful create (toast-everything)', async () => {
    renderSheet({ onCreate: vi.fn().mockResolvedValue(undefined) });
    fireEvent.change(getTextarea(), { target: { value: 'hello' } });
    fireEvent.click(getPostButton());
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(POST_CREATE_SUCCESS),
    );
  });
});

describe('ComposePost — submit error (error path / privacy)', () => {
  it('shows a generic PII-free error toast when create rejects and does NOT close', async () => {
    const onClose = vi.fn();
    const onCreate = vi
      .fn()
      .mockRejectedValue(new Error('permission-denied: raw firebase, must not surface'));
    renderSheet({ onClose, onCreate });
    fireEvent.change(getTextarea(), { target: { value: 'hello' } });
    fireEvent.click(getPostButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const toast = await screen.findByRole('status');
    expect(toast.textContent ?? '').not.toMatch(/permission-denied/);
    expect(toast.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});
