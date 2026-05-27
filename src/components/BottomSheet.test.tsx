/**
 * ACCESSIBILITY — BottomSheet focus management (AODA / WCAG 2.1 AA; review of
 * Phases 1-2, a11y findings). A modal dialog must:
 *  - TRAP focus while open (Tab from the last focusable cycles to the first;
 *    Shift+Tab from the first cycles to the last) — WCAG 2.4.3 / 2.1.2,
 *  - RESTORE focus to the element that opened it when it closes — WCAG 2.4.3,
 *  - close on Esc — WCAG 2.1.2 (no keyboard trap),
 *  - render the background INERT / aria-hidden so AT cannot reach it while the
 *    dialog is open — WCAG 4.1.2.
 *
 * Level: component (jsdom). No userEvent package is installed, so Tab handling
 * is exercised by dispatching keydown events at the document — which is exactly
 * the surface a focus trap must intercept. No real clock/network.
 *
 * FAILS today: BottomSheet does not trap focus, does not restore focus on
 * close, and does not make the background inert.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRef, useState, type ReactElement } from 'react';
import { BottomSheet } from './index';

/** A harness with a trigger button outside the sheet + sheet content with two
 *  focusable controls, so we can test focus trap + restore. */
function Harness(): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open sheet
      </button>
      <BottomSheet open={open} title="New post" onClose={() => setOpen(false)}>
        <button type="button">First field</button>
        <button type="button">Last field</button>
      </BottomSheet>
    </div>
  );
}

function getFocusable(): HTMLElement[] {
  const dialog = screen.getByRole('dialog');
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  );
}

describe('BottomSheet — focus trap', () => {
  it('Tab from the LAST focusable cycles back to the FIRST', () => {
    render(
      <BottomSheet open title="New post" onClose={vi.fn()}>
        <button type="button">First field</button>
        <button type="button">Last field</button>
      </BottomSheet>,
    );
    const focusables = getFocusable();
    const last = focusables[focusables.length - 1] as HTMLElement;
    const first = focusables[0] as HTMLElement;
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });

    expect(
      document.activeElement,
      'Tab from the last focusable must wrap to the first (focus trap)',
    ).toBe(first);
  });

  it('Shift+Tab from the FIRST focusable cycles to the LAST', () => {
    render(
      <BottomSheet open title="New post" onClose={vi.fn()}>
        <button type="button">First field</button>
        <button type="button">Last field</button>
      </BottomSheet>,
    );
    const focusables = getFocusable();
    const first = focusables[0] as HTMLElement;
    const last = focusables[focusables.length - 1] as HTMLElement;
    first.focus();

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: 'Tab',
      shiftKey: true,
    });

    expect(
      document.activeElement,
      'Shift+Tab from the first focusable must wrap to the last (focus trap)',
    ).toBe(last);
  });
});

describe('BottomSheet — focus restore on close', () => {
  it('returns focus to the trigger that opened it', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    // Dialog is now open; close it via Esc.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      document.activeElement,
      'focus must return to the element that was focused before the sheet opened',
    ).toBe(trigger);
  });
});

/**
 * Finding 4 (a11y) — focus-restore fallback. When the element that had focus
 * before the sheet opened is detached/unmounted by close time, restoring focus
 * to a now-disconnected node silently drops focus to document.body (WCAG 2.4.3
 * regression — keyboard/AT users are stranded at the top of the document). The
 * sheet must instead land focus on a sensible, IN-DOCUMENT fallback: the
 * provided fallbackFocusRef element if present, else the dialog heading.
 */
describe('BottomSheet — focus restore fallback when opener is detached', () => {
  /** Harness whose trigger is conditionally rendered: it unmounts the trigger
   *  while the sheet is open, so by close time the previously focused element
   *  is disconnected from the document. */
  function DetachingHarness(): ReactElement {
    const [open, setOpen] = useState(false);
    const fallbackRef = useRef<HTMLDivElement>(null);
    return (
      <div>
        <div ref={fallbackRef} tabIndex={-1} data-testid="fallback-anchor">
          App content
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)}>
            Open sheet
          </button>
        )}
        <BottomSheet
          open={open}
          title="New post"
          onClose={() => setOpen(false)}
          fallbackFocusRef={fallbackRef}
        >
          <button type="button">First field</button>
        </BottomSheet>
      </div>
    );
  }

  it('does NOT drop focus to document.body when the opener is gone at close time', () => {
    render(<DetachingHarness />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });
    trigger.focus();
    fireEvent.click(trigger); // opens the sheet AND unmounts the trigger

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      document.activeElement,
      'focus must not silently fall to document.body when the opener is detached',
    ).not.toBe(document.body);
  });

  it('restores focus to the provided fallbackFocusRef element when the opener is detached', () => {
    render(<DetachingHarness />);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    const fallback = screen.getByTestId('fallback-anchor');
    expect(
      document.activeElement,
      'focus must land on the designated fallback element when the opener is gone',
    ).toBe(fallback);
  });
});

/**
 * Finding 5 (a11y) — async/empty focusable content. When the sheet opens with
 * NO focusable BODY children (content arrives after an async load), initial
 * focus must still land INSIDE the dialog (never document.body), and after a
 * focusable child mounts the focus trap must keep focus inside the sheet. We
 * pin the robust invariant — focus is contained by the dialog — rather than a
 * specific node, because the dialog always carries its own Close control.
 */
describe('BottomSheet — empty / async focusable children', () => {
  it('keeps initial focus INSIDE the dialog (never document.body) when opened with no focusable body children', () => {
    render(
      <BottomSheet open title="New post" onClose={vi.fn()}>
        <span>Just text, nothing focusable</span>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog');
    const active = document.activeElement as HTMLElement | null;
    expect(active, 'focus must not be on document.body when the sheet is open').not.toBe(
      document.body,
    );
    expect(
      dialog.contains(active),
      'initial focus must be contained within the dialog',
    ).toBe(true);
  });

  it('keeps focus trapped inside the dialog after an async focusable child mounts', () => {
    // Open with NO focusable body child, then rerender with one (content
    // arriving after an async load). The focus trap must keep focus inside.
    const { rerender } = render(
      <BottomSheet open title="New post" onClose={vi.fn()}>
        <span>Loading…</span>
      </BottomSheet>,
    );
    rerender(
      <BottomSheet open title="New post" onClose={vi.fn()}>
        <button type="button">Async field</button>
      </BottomSheet>,
    );

    const dialog = screen.getByRole('dialog');
    const asyncField = screen.getByRole('button', { name: 'Async field' });
    asyncField.focus();

    // Tab from the LAST focusable (the async child) must wrap to the first
    // focusable inside the dialog — never escape to document.body.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });

    const active = document.activeElement as HTMLElement | null;
    expect(active, 'Tab must not drop focus to document.body').not.toBe(document.body);
    expect(
      dialog.contains(active),
      'the focus trap must keep focus inside the dialog after async content mounts',
    ).toBe(true);
  });
});

describe('BottomSheet — Esc and background inertness', () => {
  it('Esc closes the sheet', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="New post" onClose={onClose}>
        <span>Body</span>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('makes the background inert / aria-hidden while open', () => {
    render(
      <div>
        <main data-testid="app-bg">Behind the sheet</main>
        <BottomSheet open title="New post" onClose={vi.fn()}>
          <span>Body</span>
        </BottomSheet>
      </div>,
    );
    const bg = screen.getByTestId('app-bg');
    const inert =
      bg.hasAttribute('inert') || bg.getAttribute('aria-hidden') === 'true';
    expect(
      inert,
      'background content must be inert or aria-hidden while the modal is open',
    ).toBe(true);
  });
});
