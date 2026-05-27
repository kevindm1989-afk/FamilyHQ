/**
 * Add Event sheet — component contract (Task 13; handoff #07 AddEventScreen;
 * preferences "toast-everything", "errors are user-safe").
 *
 * Level: component. The sheet owns its validation, the success/close behaviour,
 * and the toast; the create ACTION is injected (resolve/reject) so we test
 * without Firestore. Server authority is covered by test/rules/events.test.ts.
 *
 * FAILS today: AddEvent is a contract stub that throws on render.
 *
 * State traceability (designer states for the Add-event submit + form):
 *  - empty/disabled: submit aria-disabled (focusable) while title is whitespace-only
 *  - enabled: submit enabled once there is a non-whitespace title
 *  - category: a segmented control with School / Sports / Family / Work, each a dot
 *  - date: chip row Today / Tomorrow / Pick date
 *  - success: submit -> onClose + success toast
 *  - error: rejected submit -> error toast, sheet NOT closed
 *
 * DATA-MODEL GAP: the handoff also shows start/end time, "who's it for", and
 * location. The locked 7-field schema has none of these — this form must NOT
 * collect or submit them (asserted below).
 *
 * Isolation: injected onCreate (vi.fn); ToastProvider supplies the toast queue;
 * the reference "today" is injected so the Today/Tomorrow chips are
 * deterministic. No network/RNG; each test re-creates props.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { AddEvent, type AddEventProps, type AddEventValue } from './AddEvent';
import { EVENT_CREATE_SUCCESS } from './calendarService';

const TODAY = { year: 2026, month: 4, day: 27 }; // May 27 2026

function renderSheet(overrides: Partial<AddEventProps> = {}) {
  const props: AddEventProps = {
    open: true,
    onClose: vi.fn(),
    author: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
    onCreate: vi.fn().mockResolvedValue(undefined),
    today: TODAY,
    ...overrides,
  };
  render(
    <ToastProvider>
      <AddEvent {...props} />
    </ToastProvider>,
  );
  return props;
}

function getTitleField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: /title|event/i }) as HTMLInputElement;
}
function getSubmit(): HTMLButtonElement {
  return screen.getByRole('button', { name: /add event/i }) as HTMLButtonElement;
}

describe('AddEvent — structure + a11y', () => {
  it('renders as a dialog titled "Add Event"', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/add event/i);
  });

  it('the title field has an associated accessible label (label-input association)', () => {
    renderSheet();
    expect(
      getTitleField(),
      'the title input must have an accessible name for AT',
    ).toBeInTheDocument();
  });

  it('renders a category control with all four options (School / Sports / Family / Work)', () => {
    renderSheet();
    for (const label of [/school/i, /sports/i, /family/i, /work/i]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the date chip row (Today / Tomorrow / Pick date)', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tomorrow/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pick date/i })).toBeInTheDocument();
  });
});

describe('AddEvent — does NOT collect handoff-only fields outside the schema (data-model gap)', () => {
  it('renders NO start/end time, "who", or location fields', () => {
    renderSheet();
    expect(screen.queryByRole('textbox', { name: /location/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /start time|end time/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/who'?s it for/i)).not.toBeInTheDocument();
  });
});

describe('AddEvent — non-empty title validation (edge; aria-disabled focusable submit)', () => {
  it('marks the submit aria-disabled (NOT native disabled) while the title is empty', () => {
    renderSheet();
    const btn = getSubmit();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn, 'must stay focusable for AT — no native disabled attribute').not.toBeDisabled();
  });

  it('keeps the submit aria-disabled for whitespace-only title', () => {
    renderSheet();
    fireEvent.change(getTitleField(), { target: { value: '   \n\t  ' } });
    const btn = getSubmit();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
  });

  it('clears aria-disabled once there is a non-whitespace title', () => {
    renderSheet();
    fireEvent.change(getTitleField(), { target: { value: 'Recital' } });
    const btn = getSubmit();
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
    expect(btn).not.toBeDisabled();
  });

  it('clicking the aria-disabled submit NO-OPS (does not call onCreate)', () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onCreate });
    fireEvent.click(getSubmit());
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('AddEvent — submit (happy): builds EXACTLY the schema-relevant value', () => {
  it('calls onCreate with {title (trimmed), description, date (ISO), tag} and nothing else', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onCreate });
    fireEvent.change(getTitleField(), { target: { value: '  Recital  ' } });
    fireEvent.click(screen.getByRole('button', { name: /sports/i }));
    fireEvent.click(screen.getByRole('button', { name: /tomorrow/i }));
    fireEvent.click(getSubmit());

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const value = onCreate.mock.calls[0]![0] as AddEventValue;
    expect(value.title).toBe('Recital');
    expect(value.tag).toBe('sports');
    expect(typeof value.description).toBe('string');
    // date is an ISO datetime string for the chosen day (Tomorrow = May 28 2026).
    expect(value.date, 'date must be an ISO datetime string').toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(value.date).toContain('2026-05-28');
    // No who/location/time keys smuggled onto the value.
    expect(Object.keys(value).sort()).toEqual(['date', 'description', 'tag', 'title'].sort());
  });

  it('Today chip produces the injected reference day (deterministic, no real clock)', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onCreate });
    fireEvent.change(getTitleField(), { target: { value: 'Standup' } });
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const value = onCreate.mock.calls[0]![0] as AddEventValue;
    expect(value.date).toContain('2026-05-27');
  });

  it('closes the sheet and fires the success toast on a successful create (toast-everything)', async () => {
    const onClose = vi.fn();
    renderSheet({ onClose, onCreate: vi.fn().mockResolvedValue(undefined) });
    fireEvent.change(getTitleField(), { target: { value: 'Recital' } });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(EVENT_CREATE_SUCCESS),
    );
  });
});

describe('AddEvent — submit error (error path / privacy)', () => {
  it('shows a generic PII-free error toast when create rejects and does NOT close', async () => {
    const onClose = vi.fn();
    const onCreate = vi
      .fn()
      .mockRejectedValue(new Error('permission-denied: raw firebase, must not surface'));
    renderSheet({ onClose, onCreate });
    fireEvent.change(getTitleField(), { target: { value: 'Recital' } });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const toast = await screen.findByRole('status');
    expect(toast.textContent ?? '').not.toMatch(/permission-denied/);
    expect(toast.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AddEvent — single ToastViewport (a11y serious; mirrors ComposePost Finding F)', () => {
  it('does NOT mount its own duplicate ToastViewport — a fired toast appears exactly once', async () => {
    const props: AddEventProps = {
      open: true,
      onClose: vi.fn(),
      author: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
      onCreate: vi.fn().mockResolvedValue(undefined),
      today: TODAY,
    };
    render(
      <ToastProvider>
        <AddEvent {...props} />
      </ToastProvider>,
    );
    fireEvent.change(getTitleField(), { target: { value: 'Recital' } });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(screen.getAllByText(EVENT_CREATE_SUCCESS).length).toBeGreaterThan(0));
    expect(
      screen.getAllByText(EVENT_CREATE_SUCCESS).length,
      'the success toast must appear exactly once',
    ).toBe(1);
  });
});
