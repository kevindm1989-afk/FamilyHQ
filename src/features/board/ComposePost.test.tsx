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
import { ToastViewport as ShellToastViewport } from '../../app/ToastViewport';
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
  // Finding E2: the project Button contract marks an unavailable action with
  // aria-disabled="true" and keeps it FOCUSABLE (WCAG 1.4.11 / SR discovery) —
  // it must NOT use the native `disabled` attribute (which removes it from the
  // a11y tree). These assertions are tightened from the prior toBeDisabled()/
  // toBeEnabled() checks, which (a) demanded native disabled and (b) would pass
  // against a button removed from the tree. The behavior pinned is the same
  // ("can't post empty") with the correct a11y mechanism.
  it('marks the Post button aria-disabled (NOT native disabled) when the textarea is empty', () => {
    renderSheet();
    const btn = getPostButton();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn, 'must stay focusable for AT — no native disabled attribute').not.toBeDisabled();
  });

  it('keeps the Post button aria-disabled for whitespace-only input', () => {
    renderSheet();
    fireEvent.change(getTextarea(), { target: { value: '   \n\t  ' } });
    const btn = getPostButton();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
  });

  it('clears aria-disabled once there is non-whitespace content', () => {
    renderSheet();
    fireEvent.change(getTextarea(), { target: { value: 'Pizza tonight' } });
    const btn = getPostButton();
    // aria-disabled absent OR explicitly "false" — either way, enabled.
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
    expect(btn).not.toBeDisabled();
  });

  it('clicking the aria-disabled Post button NO-OPS (does not call onCreate)', () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onCreate });
    // empty -> aria-disabled; an aria-disabled control must not trigger its action
    fireEvent.click(getPostButton());
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('ComposePost — submitting announcement (Finding E3, a11y)', () => {
  it('announces a busy status while submitting (aria-busy AND a live "Posting…" status)', async () => {
    // Hold onCreate pending so we can observe the in-flight UI.
    let resolveCreate: () => void = () => {};
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderSheet({ onCreate });
    fireEvent.change(getTextarea(), { target: { value: 'hello' } });
    fireEvent.click(getPostButton());

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(getPostButton()).toHaveAttribute('aria-busy', 'true');
    // A submit progress message is announced to AT (live region / busy text),
    // not only the aria-busy flag.
    expect(
      screen.getByText(/posting|posting…|submitting|sending/i),
      'a submit-in-progress status must be announced (aria-live), not only aria-busy',
    ).toBeInTheDocument();

    // Resolve so the test ends cleanly (no dangling pending promise).
    await waitFor(() => expect(getPostButton()).toBeInTheDocument());
    resolveCreate();
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });
});

describe('ComposePost — cancel mid-flight (Finding E1: stale success after dismiss)', () => {
  it('does NOT fire a success toast or re-call onClose when the sheet is dismissed before onCreate resolves', async () => {
    let resolveCreate: () => void = () => {};
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const onClose = vi.fn();
    const props: ComposePostProps = {
      open: true,
      onClose,
      author: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
      onCreate,
    };
    const { rerender } = render(
      <ToastProvider>
        <ComposePost {...props} />
      </ToastProvider>,
    );
    fireEvent.change(getTextarea(), { target: { value: 'hello' } });
    fireEvent.click(getPostButton());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    // User dismisses the sheet (open -> false) WHILE the create is in flight.
    rerender(
      <ToastProvider>
        <ComposePost {...props} open={false} />
      </ToastProvider>,
    );

    // Now the in-flight create resolves. A cancellation flag must suppress the
    // success side effects: no success toast, and onClose is not called again.
    const onCloseCallsAtDismiss = onClose.mock.calls.length;
    resolveCreate();
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));

    expect(
      screen.queryByRole('status'),
      'a create that resolves after dismissal must not raise a success toast',
    ).not.toBeInTheDocument();
    expect(
      onClose.mock.calls.length,
      'onClose must not be called a second time by a resolved-after-dismiss create',
    ).toBe(onCloseCallsAtDismiss);
  });
});

describe('ComposePost — single ToastViewport (Finding F, a11y serious)', () => {
  it('does NOT mount its own ToastViewport — only ONE live region exists when a toast fires', async () => {
    // Two ToastViewport live regions on screen = duplicate role="status" regions
    // reading the same queue (a serious a11y defect: the message is announced
    // twice). The single instance lives at the app shell. Here we provide the
    // shell's single viewport alongside ComposePost; if ComposePost also mounts
    // one, a fired toast yields TWO role="status" nodes.
    const props: ComposePostProps = {
      open: true,
      onClose: vi.fn(),
      author: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
      onCreate: vi.fn().mockResolvedValue(undefined),
    };
    render(
      <ToastProvider>
        <ComposePost {...props} />
        <ShellToastViewport />
      </ToastProvider>,
    );
    fireEvent.change(getTextarea(), { target: { value: 'hello' } });
    fireEvent.click(getPostButton());
    await waitFor(() => expect(screen.getAllByText(POST_CREATE_SUCCESS).length).toBeGreaterThan(0));
    expect(
      screen.getAllByText(POST_CREATE_SUCCESS).length,
      'the success toast must appear exactly once — ComposePost must not render a second ToastViewport',
    ).toBe(1);
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
