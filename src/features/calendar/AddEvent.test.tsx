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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // Finding E: the category control is a radiogroup, so its options are radios
    // (REPLACES the prior aria-pressed-button query).
    renderSheet();
    for (const label of [/school/i, /sports/i, /family/i, /work/i]) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('renders the date chips (Today / Tomorrow as radios) + a Pick date button', () => {
    renderSheet();
    // Today/Tomorrow are radios in the date radiogroup; Pick date is NOT.
    expect(screen.getByRole('radio', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /tomorrow/i })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('radio', { name: /sports/i }));
    fireEvent.click(screen.getByRole('radio', { name: /tomorrow/i }));
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
    fireEvent.click(screen.getByRole('radio', { name: /today/i }));
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

describe('AddEvent — Category + Date are radiogroups (Finding E a11y)', () => {
  it('the Category control is a role=radiogroup named by its legend', () => {
    renderSheet();
    expect(screen.getByRole('radiogroup', { name: /category/i })).toBeInTheDocument();
  });

  it('the Date control is a role=radiogroup named by its legend', () => {
    renderSheet();
    expect(screen.getByRole('radiogroup', { name: /date/i })).toBeInTheDocument();
  });

  it('category options use role=radio + aria-checked, mutually exclusive (one checked at a time)', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /category/i });
    const radios = within(group).getAllByRole('radio');
    expect(radios.length, 'School/Sports/Family/Work').toBe(4);
    fireEvent.click(screen.getByRole('radio', { name: /sports/i }));
    const checked = within(group)
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked, 'exactly one category radio is checked').toHaveLength(1);
    expect(checked[0]!).toHaveAccessibleName(/sports/i);
  });

  it('date options use role=radio + aria-checked, mutually exclusive (Today vs Tomorrow)', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /date/i });
    fireEvent.click(screen.getByRole('radio', { name: /tomorrow/i }));
    const checked = within(group)
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked, 'exactly one date radio is checked').toHaveLength(1);
    expect(checked[0]!).toHaveAccessibleName(/tomorrow/i);
  });

  it('"Pick date" is NOT inside the date radiogroup', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /date/i });
    expect(
      within(group).queryByRole('button', { name: /pick date/i }),
      'Pick date is a placeholder affordance, not a radio option',
    ).not.toBeInTheDocument();
    expect(within(group).queryByText(/pick date/i)).not.toBeInTheDocument();
  });

  it('"Pick date" is aria-disabled (no real picker yet)', () => {
    renderSheet();
    const pick = screen.getByRole('button', { name: /pick date/i });
    expect(pick).toHaveAttribute('aria-disabled', 'true');
  });

  it('clicking "Pick date" does NOT silently change the selected day (dayChoice unchanged)', async () => {
    // The default selected day is Today (the reference). Clicking the disabled
    // Pick date must NOT mutate the choice — proven by the submitted ISO day
    // staying on Today, not jumping to anything else.
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onCreate });
    fireEvent.change(getTitleField(), { target: { value: 'Standup' } });
    fireEvent.click(screen.getByRole('button', { name: /pick date/i }));
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const value = onCreate.mock.calls[0]![0] as AddEventValue;
    expect(
      value.date,
      'Pick date must leave the selected day on Today (2026-05-27), not change it',
    ).toContain('2026-05-27');
    // And the Today radio is still the checked one.
    const dateGroup = screen.getByRole('radiogroup', { name: /date/i });
    const checked = within(dateGroup)
      .getAllByRole('radio')
      .filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked[0]!).toHaveAccessibleName(/today/i);
  });
});

describe('AddEvent — title field validation a11y (Finding E)', () => {
  it('the title field is aria-required', () => {
    renderSheet();
    expect(getTitleField()).toHaveAttribute('aria-required', 'true');
  });

  it('a submit attempt with an EMPTY title marks the title aria-invalid and shows associated error text', () => {
    renderSheet();
    // Title is empty; activating the (aria-disabled) submit is a validation
    // attempt and must surface an accessible error on the field.
    fireEvent.click(getSubmit());
    const title = getTitleField();
    expect(title, 'empty title must be flagged invalid for AT').toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const describedBy = title.getAttribute('aria-describedby');
    expect(describedBy, 'the title must point at its error/help text via aria-describedby').toBeTruthy();
    const errorEl = document.getElementById(describedBy!.split(/\s+/)[0]!);
    expect(errorEl, 'the aria-describedby target must exist in the DOM').not.toBeNull();
    expect((errorEl?.textContent ?? '').length, 'the error text must be non-empty').toBeGreaterThan(0);
  });

  it('a valid title is NOT marked aria-invalid', () => {
    renderSheet();
    fireEvent.change(getTitleField(), { target: { value: 'Recital' } });
    const title = getTitleField();
    expect(title.getAttribute('aria-invalid')).not.toBe('true');
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
