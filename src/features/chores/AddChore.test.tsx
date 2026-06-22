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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { AddChore, type AddChoreProps, type AddChoreValue } from './AddChore';
import { CHORE_ADD_SUCCESS } from './choresParentService';
import type { UserWithId } from '../../lib/types';

const EMPTY_MEMBERS: UserWithId[] = [];

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
  it('calls onAdd with {title (trimmed), assignedTo, date (ISO), pointValue, dollarValue (CENTS), isRecurring, recurrenceFrequency}', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onAdd });
    fireEvent.change(getTitleField(), { target: { value: '  Vacuum  ' } });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: /assign/i })).getByRole('radio', { name: /ben/i }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /point/i }), { target: { value: '8' } });
    // The dollar field is dollars-with-cents ("4" = $4.00); the form emits the
    // value in INTEGER CENTS (money is cents everywhere — second-opinion #4 /
    // Finding 7). "4" dollars -> dollarValue 400 cents.
    fireEvent.change(screen.getByRole('spinbutton', { name: /dollar|\$|reward/i }), {
      target: { value: '4' },
    });
    fireEvent.click(getSubmit());

    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const value = onAdd.mock.calls[0]![0] as AddChoreValue;
    expect(value.title).toBe('Vacuum');
    expect(value.assignedTo).toBe('uid-ben');
    expect(value.pointValue, 'points stay integer points').toBe(8);
    expect(value.dollarValue, '$4.00 must be emitted as 400 integer cents').toBe(400);
    expect(typeof value.isRecurring).toBe('boolean');
    expect(['none', 'weekly', 'biweekly']).toContain(value.recurrenceFrequency);
    expect(value.date, 'date must be an ISO datetime string').toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The value carries exactly the schema-relevant keys — no smuggled emoji/etc.
    expect(Object.keys(value).sort()).toEqual(
      ['assignedTo', 'date', 'dollarValue', 'isRecurring', 'pointValue', 'recurrenceFrequency', 'title'].sort(),
    );
  });

  it('a fractional-dollar entry ("3.50") is emitted as 350 integer cents (no float drift)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ onAdd });
    fireEvent.change(getTitleField(), { target: { value: 'Dishes' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /dollar|\$|reward/i }), {
      target: { value: '3.50' },
    });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    const value = onAdd.mock.calls[0]![0] as AddChoreValue;
    expect(value.dollarValue, '$3.50 must be 350 integer cents').toBe(350);
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

// =====================================================================
// Finding 6 (adversarial): Add Chore assignee validation. A chore must be
// assigned to a CURRENT active member. With no members the form cannot submit;
// when the previously-selected assignee leaves `members`, submit must be blocked
// (or the assignee re-defaulted to a valid current member).
// =====================================================================
describe('AddChore — Finding 6: assignee must be a current active member', () => {
  it('with NO active members, submit is disabled even with a valid title (cannot assign to nobody)', () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ members: EMPTY_MEMBERS, onAdd });
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    // A valid title alone is NOT enough — there is no valid assignee.
    expect(getSubmit()).toHaveAttribute('aria-disabled', 'true');
  });

  it('with NO active members, clicking submit NO-OPS (onAdd not called)', () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    renderSheet({ members: EMPTY_MEMBERS, onAdd });
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    fireEvent.click(getSubmit());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('when the selected assignee is REMOVED from members, submit is blocked OR the assignee re-defaults to a current member', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    // Start with Ben selectable + selected, then re-render with Ben gone.
    const { rerender } = render(
      <ToastProvider>
        <AddChore
          open
          onClose={vi.fn()}
          author={{ uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' }}
          members={MEMBERS}
          onAdd={onAdd}
          today={TODAY}
        />
      </ToastProvider>,
    );
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: /assign/i })).getByRole('radio', { name: /ben/i }),
    );
    // Ben (uid-ben) leaves the roster; only Maya remains.
    rerender(
      <ToastProvider>
        <AddChore
          open
          onClose={vi.fn()}
          author={{ uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' }}
          members={[MEMBERS[0]!]}
          onAdd={onAdd}
          today={TODAY}
        />
      </ToastProvider>,
    );
    // Wrap the submit + its async onAdd promise in act() so the post-submit
    // re-render (close-form / loading-clear) commits inside an act boundary.
    // Without the wrap that re-render lands after the assertions return and
    // React logs an "update to AddChore inside a test was not wrapped in
    // act(...)" warning.
    await act(async () => {
      fireEvent.click(getSubmit());
    });
    // Either the submit was blocked (no call) OR it re-defaulted to the remaining
    // current member (Maya) — it must NEVER submit the stale uid-ben assignee.
    if (onAdd.mock.calls.length > 0) {
      const value = onAdd.mock.calls[0]![0] as AddChoreValue;
      expect(value.assignedTo, 'must not submit a stale, no-longer-present assignee').not.toBe(
        'uid-ben',
      );
      expect(['uid-maya'], 'a submitted assignee must be a current member').toContain(
        value.assignedTo,
      );
    } else {
      expect(onAdd).not.toHaveBeenCalled();
    }
  });
});

// =====================================================================
// A11y BLOCKER — composite radiogroups (assign-to / due / frequency) must be
// arrow-key operable with roving tabindex (the calendar AddEvent pattern):
// only the selected radio is tabbable (tabIndex 0), the rest are tabIndex -1,
// and ArrowRight/ArrowDown / ArrowLeft/ArrowUp move the selection.
// =====================================================================
describe('AddChore — a11y BLOCKER: assign-to radiogroup is arrow-key operable (roving tabindex)', () => {
  it('only the SELECTED assign-to radio is tabbable (tabIndex 0); the rest are -1', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /assign/i });
    const radios = within(group).getAllByRole('radio');
    const tabbable = radios.filter((r) => r.getAttribute('tabindex') === '0');
    expect(tabbable, 'exactly one assign-to radio is tabbable (roving tabindex)').toHaveLength(1);
    // The tabbable one is the checked one.
    expect(tabbable[0]).toHaveAttribute('aria-checked', 'true');
    radios
      .filter((r) => r.getAttribute('aria-checked') !== 'true')
      .forEach((r) => expect(r).toHaveAttribute('tabindex', '-1'));
  });

  it('ArrowRight moves the assign-to selection to the next member (keyboard operable)', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /assign/i });
    // Default selection is the first member (Maya). ArrowRight selects Ben.
    const maya = within(group).getByRole('radio', { name: /maya/i });
    fireEvent.keyDown(maya, { key: 'ArrowRight' });
    expect(within(group).getByRole('radio', { name: /ben/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(group).getByRole('radio', { name: /maya/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('ArrowLeft wraps the assign-to selection back to the previous member', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /assign/i });
    const maya = within(group).getByRole('radio', { name: /maya/i });
    // From the first option, ArrowLeft wraps to the last (Ben).
    fireEvent.keyDown(maya, { key: 'ArrowLeft' });
    expect(within(group).getByRole('radio', { name: /ben/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('AddChore — a11y BLOCKER: due radiogroup is arrow-key operable (roving tabindex)', () => {
  it('only the SELECTED due radio is tabbable; ArrowRight moves the selection', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /due/i });
    const radios = within(group).getAllByRole('radio');
    expect(radios.filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
    const today = within(group).getByRole('radio', { name: /today/i });
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(within(group).getByRole('radio', { name: /tomorrow/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('AddChore — a11y: tap targets (min-w-tap on radios + submit)', () => {
  it('every assign-to radio carries min-w-tap', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /assign/i });
    within(group)
      .getAllByRole('radio')
      .forEach((r) => expect(r.className).toMatch(/min-w-tap/));
  });

  it('the submit button carries min-w-tap', () => {
    renderSheet();
    expect(getSubmit().className).toMatch(/min-w-tap/);
  });
});

// =====================================================================
// A11y — label overrides removed: title/points/dollars use their visible
// <label> as the accessible name (no redundant aria-label); the date input has
// a visible label; inputmode hints are correct.
// =====================================================================
describe('AddChore — a11y: visible labels (no aria-label override) + inputmode', () => {
  it('the title input uses its visible label as the accessible name (no aria-label override)', () => {
    renderSheet();
    const title = screen.getByRole('textbox', { name: /what needs doing/i });
    expect(title).not.toHaveAttribute('aria-label');
  });

  it('the point value input uses its visible label as the accessible name (no aria-label override)', () => {
    renderSheet();
    const points = screen.getByRole('spinbutton', { name: /point value/i });
    expect(points).not.toHaveAttribute('aria-label');
  });

  it('the dollar reward input uses its visible label as the accessible name (no aria-label override)', () => {
    renderSheet();
    const dollars = screen.getByRole('spinbutton', { name: /dollar reward/i });
    expect(dollars).not.toHaveAttribute('aria-label');
  });

  it('the point value input has inputMode="numeric"', () => {
    renderSheet();
    expect(screen.getByRole('spinbutton', { name: /point/i })).toHaveAttribute(
      'inputmode',
      'numeric',
    );
  });

  it('the dollar reward input has inputMode="decimal"', () => {
    renderSheet();
    expect(screen.getByRole('spinbutton', { name: /dollar|reward/i })).toHaveAttribute(
      'inputmode',
      'decimal',
    );
  });

  it('the "Pick date" native date input has a VISIBLE label (associated, not aria-label only)', () => {
    renderSheet();
    // Reveal the date input via the "Pick date" radio.
    fireEvent.click(screen.getByRole('radio', { name: /pick date/i }));
    // The date input must be reachable by a visible label association.
    const dateInput = screen.getByLabelText(/due date|pick a date|date/i);
    expect(dateInput).toBeInTheDocument();
    expect(dateInput).not.toHaveAttribute('aria-label');
  });
});

// =====================================================================
// A11y — frequency group intended behavior. The group must NOT misapply
// aria-disabled while its child radios stay operable (a contradictory state).
// We pin the ALWAYS-OPERABLE choice: the radiogroup is never aria-disabled, and
// selecting a frequency turns recurrence on.
// =====================================================================
describe('AddChore — a11y: frequency group is not contradictorily aria-disabled', () => {
  it('the frequency radiogroup is NOT marked aria-disabled while its radios remain operable', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /how often|frequency/i });
    // It must not claim aria-disabled while children are still clickable/operable
    // (that contradictory state is the finding). Either truly gated (children not
    // operable) OR always operable + not aria-disabled — we assert the latter.
    expect(group).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('selecting a frequency option turns recurrence on and checks that option', () => {
    renderSheet();
    const group = screen.getByRole('radiogroup', { name: /how often|frequency/i });
    fireEvent.click(within(group).getByRole('radio', { name: /every other|biweekly/i }));
    expect(within(group).getByRole('radio', { name: /every other|biweekly/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

// =====================================================================
// A11y — aria-busy on submit while the add action is in flight.
// =====================================================================
describe('AddChore — a11y: submit carries aria-busy while adding', () => {
  it('submit reflects aria-busy while onAdd is pending, then clears', async () => {
    let resolve!: () => void;
    const onAdd = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    renderSheet({ onAdd });
    fireEvent.change(getTitleField(), { target: { value: 'Vacuum' } });
    fireEvent.click(getSubmit());
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    await waitFor(() => expect(getSubmit()).toHaveAttribute('aria-busy', 'true'));
    resolve();
    await waitFor(() => expect(getSubmit()).not.toHaveAttribute('aria-busy', 'true'));
  });
});

// ===========================================================================
// EDIT MODE — the shared sheet pre-fills from `initial` and submits via
// `onUpdate(id, value)`. Sheet title + submit copy flip to the edit variants.
// ===========================================================================

const EDIT_INITIAL = {
  id: 'chore-42',
  value: {
    title: 'Take out the trash',
    assignedTo: 'uid-maya',
    date: new Date(Date.UTC(2026, 6, 1, 12, 0, 0)).toISOString(), // 2026-07-01
    pointValue: 8,
    dollarValue: 700, // cents — $7.00
    isRecurring: true,
    recurrenceFrequency: 'weekly' as const,
  },
};

function getEditSubmit(): HTMLButtonElement {
  return screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
}

describe('AddChore — edit mode: sheet title + submit copy flip', () => {
  it('shows the edit-mode sheet title when `initial` is passed', () => {
    renderSheet({ initial: EDIT_INITIAL, onUpdate: vi.fn().mockResolvedValue(undefined) });
    expect(screen.getByText(/edit chore/i)).toBeInTheDocument();
    expect(screen.queryByText(/add chore/i)).toBeNull();
  });

  it('shows the "Save changes" submit label instead of "Add chore" when `initial` is passed', () => {
    renderSheet({ initial: EDIT_INITIAL, onUpdate: vi.fn().mockResolvedValue(undefined) });
    expect(getEditSubmit()).toBeInTheDocument();
  });
});

describe('AddChore — edit mode: pre-fills the form fields from `initial.value`', () => {
  it('prefills the title input from initial.value.title', () => {
    renderSheet({ initial: EDIT_INITIAL, onUpdate: vi.fn().mockResolvedValue(undefined) });
    const titleInput = screen.getByLabelText(/what/i) as HTMLInputElement;
    expect(titleInput.value).toBe('Take out the trash');
  });

  it('prefills the dollar input as a 2-decimal string (cents -> dollars)', () => {
    renderSheet({ initial: EDIT_INITIAL, onUpdate: vi.fn().mockResolvedValue(undefined) });
    // The dollar input shows formatted dollars, e.g. "7.00" for 700 cents.
    expect(screen.getByDisplayValue('7.00')).toBeInTheDocument();
  });

  it('prefills the points input from initial.value.pointValue', () => {
    renderSheet({ initial: EDIT_INITIAL, onUpdate: vi.fn().mockResolvedValue(undefined) });
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();
  });
});

describe('AddChore — edit mode: submit invokes onUpdate(id, value) and toasts the edit copy', () => {
  it('submits via onUpdate with the chore id + AddChoreValue (NOT onAdd)', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ initial: EDIT_INITIAL, onAdd, onUpdate });
    // Edit the title slightly then save.
    const titleInput = screen.getByLabelText(/what/i) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Take out trash (clearer)' } });
    fireEvent.click(getEditSubmit());
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onAdd).not.toHaveBeenCalled();
    const [id, value] = onUpdate.mock.calls[0]!;
    expect(id).toBe('chore-42');
    expect((value as { title: string }).title).toBe('Take out trash (clearer)');
  });

  it('toasts the edit-success copy on a successful onUpdate', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderSheet({ initial: EDIT_INITIAL, onUpdate });
    fireEvent.click(getEditSubmit());
    await waitFor(() => expect(screen.getByText(/chore updated/i)).toBeInTheDocument());
  });

  it('on onUpdate rejection: surfaces the generic toast (no raw error)', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('emulated-firestore-raw'));
    renderSheet({ initial: EDIT_INITIAL, onUpdate });
    fireEvent.click(getEditSubmit());
    await waitFor(() =>
      expect(screen.getByText(/something went wrong|please try again/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/emulated-firestore-raw/)).toBeNull();
  });
});
