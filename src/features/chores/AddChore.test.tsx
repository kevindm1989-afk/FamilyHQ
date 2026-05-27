/**
 * Add Chore sheet — component contract (Task 11; handoff #06 AddChoreScreen;
 * preferences "toast-everything", "errors are user-safe", "dynamic family").
 *
 * Level: component. The sheet owns its validation, the success/close behaviour,
 * and the toast; the create ACTION is injected (resolve/reject) so we test
 * without Firestore. Server authority + the hardened shape lock are covered by
 * test/rules/chores-create-hardening.test.ts; the service shape by
 * choresParentService.test.ts.
 *
 * FAILS today: AddChore is a contract stub that throws on render.
 *
 * State traceability (designer states for the Add-chore submit + form):
 *  - empty/disabled: submit aria-disabled (focusable) while title is whitespace-only
 *  - enabled: submit enabled once there is a non-whitespace title
 *  - assign-to: a radiogroup populated DYNAMICALLY from active members (not hardcoded)
 *  - due: chip row Today / Tomorrow / Pick date
 *  - reward: point value + dollar value number inputs
 *  - recurring: toggle + frequency (none/weekly/biweekly)
 *  - success: submit -> onClose + success toast
 *  - error: rejected submit -> error toast, sheet NOT closed
 *
 * Isolation: injected onAdd (vi.fn); ToastProvider supplies the toast queue;
 * the reference "today" is injected so the Today/Tomorrow chips are
 * deterministic. No network/RNG; each test re-creates props.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { AddChore, type AddChoreProps, type AddChoreValue } from './AddChore';
import { CHORE_ADD_SUCCESS } from './choresParentService';
import type { UserWithId } from '../../lib/types';

const TODAY = { year: 2026, month: 4, day: 27 }; // May 27 2026

const MEMBERS: UserWithId[] = [
  {
    id: 'uid-maya',
    name: 'Maya',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  },
  {
    id: 'uid-ben',
    name: 'Ben',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  },
];

function renderSheet(overrides: Partial<AddChoreProps> = {}) {
  const props: AddChoreProps = {
    open: true,
    onClose: vi.fn(),
    author: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
    members: MEMBERS,
    onAdd: vi.fn().mockResolvedValue(undefined),
    today: TODAY,
    ...overrides,
  };
  render(
    <ToastProvider>
      <AddChore {...props} />
    </ToastProvider>,
  );
  return props;
}

function getTitleField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: /title|chore|what needs/i }) as HTMLInputElement;
}
function getSubmit(): HTMLButtonElement {
  return screen.getByRole('button', { name: /add chore/i }) as HTMLButtonElement;
}

describe('AddChore — structure + a11y', () => {
  it('renders as a dialog titled "Add Chore"', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/add chore/i);
  });

  it('the title field is present and aria-required', () => {
    renderSheet();
    expect(getTitleField()).toHaveAttribute('aria-required', 'true');
  });
});

describe('AddChore — assign-to is DYNAMIC from active members (not hardcoded Maya/Ben)', () => {
  it('renders an assign-to option for EACH active member', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /assign/i });
    expect(within(group).getByRole('radio', { name: /maya/i })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: /ben/i })).toBeInTheDocument();
  });

  it('reflects a DIFFERENT roster (proves the options are derived, not hardcoded)', () => {
    renderSheet({
      members: [
        {
          id: 'uid-zoe',
          name: 'Zoe',
          role: 'member',
          familyId: 'fam-A',
          isActive: true,
          allowanceBalance: 0,
          theme: 'light',
        },
      ],
    });
    const group = screen.getByRole('radiogroup', { name: /assign/i });
    expect(within(group).getByRole('radio', { name: /zoe/i })).toBeInTheDocument();
    expect(within(group).queryByRole('radio', { name: /maya|ben/i })).not.toBeInTheDocument();
  });
});

describe('AddChore — reward + recurrence controls', () => {
  it('renders a point value and a dollar value number input', () => {
    renderSheet();
    expect(screen.getByRole('spinbutton', { name: /point/i })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /dollar|\$|reward/i })).toBeInTheDocument();
  });

  it('renders a recurring toggle (switch or checkbox)', () => {
    renderSheet();
    // The recurring toggle is a switch OR a checkbox — accept either role.
    const toggle =
      screen.queryByRole('switch', { name: /recurr|repeat/i }) ??
      screen.queryByRole('checkbox', { name: /recurr|repeat/i });
    expect(toggle, 'a recurring switch/checkbox must exist').not.toBeNull();
  });

  it('renders a recurrence-frequency control with the allowed options (none/weekly/biweekly)', () => {
    renderSheet();
    // The frequency options are exposed once recurrence is relevant. Accept a
    // radiogroup or a select; the option labels must cover weekly + biweekly.
    expect(screen.getByText(/weekly/i)).toBeInTheDocument();
    expect(screen.getByText(/biweekly|bi-weekly|every other/i)).toBeInTheDocument();
  });
});

describe('AddChore — non-empty title validation (aria-disabled focusable submit)', () => {
  it('marks the submit aria-disabled (NOT native disabled) while the title is empty', () => {
    renderSheet();
    const btn = getSubmit();
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn, 'must stay focusable for AT — no native disabled attribute').not.toBeDisabled();
  });

  it('keeps the submit aria-disabled for a whitespace-only title', () => {
    renderSheet();
    fireEvent.change(getTitleField(), { target: { value: '   \n\t  ' } });
    expect(getSubmit()).toHaveAttribute('aria-disabled', 'true');
  });

  it('clears aria-disabled once there is a non-whitespace title', () => {
    renderSheet();
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    expect(getSubmit().getAttribute('aria-disabled')).not.toBe('true');
  });

  it('clicking the aria-disabled submit NO-OPS (does not call onAdd)', () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onAdd });
    fireEvent.click(getSubmit());
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('AddChore — submit (happy): builds the schema-relevant value', () => {
  it('calls onAdd with {title (trimmed), assignedTo, date (ISO), pointValue, dollarValue, isRecurring, recurrenceFrequency}', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onAdd });
    fireEvent.change(getTitleField(), { target: { value: '  Vacuum  ' } });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: /assign/i })).getByRole('radio', { name: /ben/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /point/i }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /dollar|\$|reward/i }), {
      target: { value: '4' },
    });
    fireEvent.click(getSubmit());

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const value = onAdd.mock.calls[0]![0] as AddChoreValue;
    expect(value.title).toBe('Vacuum');
    expect(value.assignedTo).toBe('uid-ben');
    expect(value.pointValue).toBe(8);
    expect(value.dollarValue).toBe(4);
    expect(typeof value.isRecurring).toBe('boolean');
    expect(['none', 'weekly', 'biweekly']).toContain(value.recurrenceFrequency);
    expect(value.date, 'date must be an ISO datetime string').toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The value carries exactly the schema-relevant keys — no smuggled emoji/etc.
    expect(Object.keys(value).sort()).toEqual(
      ['assignedTo', 'date', 'dollarValue', 'isRecurring', 'pointValue', 'recurrenceFrequency', 'title'].sort(),
    );
  });

  it('Today chip produces the injected reference day (deterministic, no real clock)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onAdd });
    fireEvent.change(getTitleField(), { target: { value: 'Dishes' } });
    fireEvent.click(screen.getByRole('radio', { name: /today/i }));
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const value = onAdd.mock.calls[0]![0] as AddChoreValue;
    expect(value.date).toContain('2026-05-27');
  });

  it('closes the sheet and fires the success toast on a successful add (toast-everything)', async () => {
    const onClose = vi.fn();
    renderSheet({ onClose, onAdd: vi.fn().mockResolvedValue(undefined) });
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(CHORE_ADD_SUCCESS)).toBeInTheDocument());
  });
});

describe('AddChore — submit error (error path / privacy)', () => {
  it('shows a generic PII-free error toast when add rejects and does NOT close', async () => {
    const onClose = vi.fn();
    const onAdd = vi
      .fn()
      .mockRejectedValue(new Error('permission-denied: raw firebase, must not surface'));
    renderSheet({ onClose, onAdd });
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    const toast = await screen.findByRole('status');
    expect(toast.textContent ?? '').not.toMatch(/permission-denied/);
    expect((toast.textContent ?? '').length).toBeGreaterThan(0);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AddChore — does NOT submit a forged status/createdBy/familyId (server-set fields)', () => {
  it('the emitted value has NO status/createdBy/familyId keys (the service fixes those)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onAdd });
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const value = onAdd.mock.calls[0]![0] as Record<string, unknown>;
    expect('status' in value, 'status is fixed to pending by the service, not the form').toBe(false);
    expect('createdBy' in value, 'createdBy is bound to the author by the service').toBe(false);
    expect('familyId' in value, 'familyId is bound by the service').toBe(false);
  });
});
