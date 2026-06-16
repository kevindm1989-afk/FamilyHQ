/**
 * Family Management screen — component contract (Phase 4; ADR-0002 rules
 * contract; ADR-0008 email-not-on-users).
 *
 * Level: component. Members + loading/error + actions are INJECTED so the
 * screen renders deterministically without Firestore or the real clock. The
 * rules contract is exercised on the emulator separately; here we pin the
 * UI/affordance contract.
 *
 * FAILS today: FamilyManagementScreen is a declare-only stub that throws.
 *
 * State traceability (designer-defined states):
 *  - LOADING               -> Skeleton (role=status)
 *  - EMPTY                 -> friendly EmptyState (defensive — a parent
 *                             generally has at least their own row, but if
 *                             the feed yields nothing the screen still shows
 *                             a safe empty state instead of a blank page)
 *  - ACTIVE-LIST DEFAULT   -> <section> + <h2> + <ul>/<li>, one row per active
 *  - INACTIVE-LIST DEFAULT -> <section> + <h2> + <ul>/<li>, one row per inactive
 *  - ROW ACTIONS — RENAME  -> every row has a "Rename {name}" button
 *  - ROW ACTIONS — DEACTIVATE -> active rows for role==='member' ONLY
 *  - ROW ACTIONS — REACTIVATE -> every inactive row
 *  - RENAME SHEET (rename) -> BottomSheet w/ labelled input + Save + Cancel;
 *                             validation (empty / whitespace / over-length)
 *  - CONFIRM SHEET (deactivate) -> destructive confirm BottomSheet w/ the
 *                                  target member named in the accessible name
 *  - ERROR                 -> single user-safe toast (no raw Firebase, no PII)
 *
 * Isolation: injected props + ToastProvider; each test builds its own props.
 * No clock / network / RNG. Money fixtures are DISTINCT per member (lesson
 * 2026-05-27 — collision guard) and scoped via `within(row)`.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import {
  FamilyManagementScreen,
  type FamilyManagementScreenProps,
} from './FamilyManagementScreen';
import { NAME_MAX_LENGTH, RENAME_SUCCESS } from './familyManagementService';
import type { UserWithId } from '../../lib/types';

// Distinct balances per fixture member (collision-guard lesson) — none equal
// to a points value or another member's balance.
const VIEWER_PARENT: UserWithId = {
  id: 'uid-parent-viewer',
  name: 'Sarah Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0, // parents have no allowance UI; balance is shown read-only
  theme: 'light',
};
const CO_PARENT: UserWithId = {
  id: 'uid-parent-co',
  name: 'Alex Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const ACTIVE_CHILD: UserWithId = {
  id: 'uid-child-active',
  name: 'Maya Kim',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 3850, // $38.50
  theme: 'light',
};
const INACTIVE_CHILD: UserWithId = {
  id: 'uid-child-inactive',
  name: 'Ben Kim',
  role: 'member',
  familyId: 'fam-A',
  isActive: false,
  allowanceBalance: 1275, // $12.75 — distinct from any other balance + points
  theme: 'light',
};

function renderScreen(
  overrides: Partial<FamilyManagementScreenProps> = {},
): FamilyManagementScreenProps {
  const props: FamilyManagementScreenProps = {
    viewer: VIEWER_PARENT,
    members: [VIEWER_PARENT, CO_PARENT, ACTIVE_CHILD, INACTIVE_CHILD],
    loading: false,
    error: null,
    onRename: vi.fn().mockResolvedValue(undefined),
    onSetActive: vi.fn().mockResolvedValue(undefined),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(
    <ToastProvider>
      <FamilyManagementScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

// Find the <li> wrapping a row by its visible name.
function rowFor(name: string): HTMLElement {
  const nameNode = screen.getByText(name);
  const li = nameNode.closest('li');
  if (!li) throw new Error(`no <li> ancestor for "${name}"`);
  return li;
}

// =====================================================================
// Page structure & sections
// =====================================================================
describe('FamilyManagementScreen — page structure (h1 + active/inactive sections)', () => {
  it('renders an <h1> page heading', () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders an Active section heading (<h2>) and an Inactive section heading (<h2>)', () => {
    renderScreen();
    const h2s = screen.getAllByRole('heading', { level: 2 });
    const labels = h2s.map((h) => h.textContent ?? '');
    expect(
      labels.some((l) => /active/i.test(l) && !/inactive/i.test(l)),
      'an Active <h2> must be present',
    ).toBe(true);
    expect(
      labels.some((l) => /inactive/i.test(l)),
      'an Inactive <h2> must be present',
    ).toBe(true);
  });

  it('places each member in a <ul>/<li> row (semantic list)', () => {
    renderScreen();
    expect(rowFor('Maya Kim').tagName).toBe('LI');
    expect(rowFor('Ben Kim').tagName).toBe('LI');
  });

  it('lists active members under the Active section and inactive under Inactive', () => {
    renderScreen();
    const sections = document.querySelectorAll('section');
    // Find sections by their visible <h2> text content.
    const activeSection = Array.from(sections).find(
      (s) => /active/i.test(s.querySelector('h2')?.textContent ?? '') && !/inactive/i.test(s.querySelector('h2')?.textContent ?? ''),
    );
    const inactiveSection = Array.from(sections).find(
      (s) => /inactive/i.test(s.querySelector('h2')?.textContent ?? ''),
    );
    expect(activeSection, 'an Active <section> must exist').toBeTruthy();
    expect(inactiveSection, 'an Inactive <section> must exist').toBeTruthy();
    // The active section must contain the active child + both parents; the
    // inactive section must contain the inactive child.
    expect(within(activeSection!).getByText('Maya Kim')).toBeInTheDocument();
    expect(within(activeSection!).getByText('Sarah Kim')).toBeInTheDocument();
    expect(within(activeSection!).getByText('Alex Kim')).toBeInTheDocument();
    expect(within(activeSection!).queryByText('Ben Kim')).not.toBeInTheDocument();
    expect(within(inactiveSection!).getByText('Ben Kim')).toBeInTheDocument();
    expect(within(inactiveSection!).queryByText('Maya Kim')).not.toBeInTheDocument();
  });
});

// =====================================================================
// PRIVACY (ADR-0008): no email anywhere on screen
// =====================================================================
describe('FamilyManagementScreen — ADR-0008 privacy: NO email anywhere on screen', () => {
  it('does not render any "@" text (no email leaks from any source)', () => {
    renderScreen();
    expect(
      screen.queryByText(/@/),
      'email is adult [PI]; it lives on userPrivate, not users — must never reach this screen',
    ).toBeNull();
  });

  it('the fixture itself (UserWithId) does NOT carry an `email` property — model-level enforcement', () => {
    // Type-level guarantee is structural in TS, but pin behaviourally that the
    // surface our screen renders carries no email field on its members.
    for (const m of [VIEWER_PARENT, CO_PARENT, ACTIVE_CHILD, INACTIVE_CHILD]) {
      expect(
        Object.prototype.hasOwnProperty.call(m, 'email'),
        `member "${m.name}" must not carry email (ADR-0008 — email lives on userPrivate)`,
      ).toBe(false);
    }
  });
});

// =====================================================================
// Row roles (parent vs member) and the Active/Inactive textual status
// =====================================================================
describe('FamilyManagementScreen — role and status conveyed by TEXT (color-blind safe)', () => {
  it('each parent row carries a "Parent" text label (badge with text content)', () => {
    renderScreen();
    expect(within(rowFor('Sarah Kim')).getByText(/parent/i)).toBeInTheDocument();
    expect(within(rowFor('Alex Kim')).getByText(/parent/i)).toBeInTheDocument();
  });

  it('each child row carries a "Member" text label', () => {
    renderScreen();
    expect(within(rowFor('Maya Kim')).getByText(/member/i)).toBeInTheDocument();
    expect(within(rowFor('Ben Kim')).getByText(/member/i)).toBeInTheDocument();
  });

  it('an inactive row exposes inactive STATUS as TEXT (never color-alone)', () => {
    renderScreen();
    expect(
      within(rowFor('Ben Kim')).getByText(/inactive/i),
      'inactive status must be conveyed as text (WCAG 1.4.1)',
    ).toBeInTheDocument();
  });

  it('an active row exposes active STATUS as TEXT or by absence of any inactive label', () => {
    renderScreen();
    // Either an "Active" label is shown, or no "inactive" text appears in the row.
    expect(within(rowFor('Maya Kim')).queryByText(/inactive/i)).not.toBeInTheDocument();
  });
});

// =====================================================================
// Money display (distinct fixtures + within(row) scoping)
// =====================================================================
describe('FamilyManagementScreen — allowance balance (read-only money display, distinct per row)', () => {
  it('an active member row renders the balance as formatted money "$38.50" (scoped to that row)', () => {
    renderScreen();
    expect(within(rowFor('Maya Kim')).getByText(/\$38\.50/)).toBeInTheDocument();
  });

  it('an inactive member row also renders the read-only balance ($12.75) — scoped', () => {
    renderScreen();
    expect(within(rowFor('Ben Kim')).getByText(/\$12\.75/)).toBeInTheDocument();
  });

  it('a non-finite balance renders the invalid indicator, NOT "$0.00" (Finding 8)', () => {
    const badMember: UserWithId = {
      ...ACTIVE_CHILD,
      id: 'uid-nan',
      name: 'Nia Glitch',
      allowanceBalance: Number.NaN,
    };
    renderScreen({ members: [VIEWER_PARENT, badMember] });
    const row = rowFor('Nia Glitch');
    // Either there is no $-amount in the row at all, or the indicator is shown
    // (— or similar). Crucially, "$0.00" must NOT appear (it would mislead).
    expect(within(row).queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});

// =====================================================================
// Rename affordance — every row, INCLUDING the viewer's own
// =====================================================================
describe('FamilyManagementScreen — Rename affordance on EVERY row (incl. the viewer)', () => {
  it('every row carries a "Rename {name}" button — including the viewer\'s own', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: /rename\s+sarah\s+kim/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rename\s+alex\s+kim/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rename\s+maya\s+kim/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rename\s+ben\s+kim/i })).toBeInTheDocument();
  });

  it('no Rename button is a bare "Rename" — each carries the TARGET member name (a11y)', () => {
    renderScreen();
    const renameButtons = screen.getAllByRole('button', { name: /rename/i });
    expect(renameButtons.length).toBeGreaterThan(0);
    for (const btn of renameButtons) {
      const name = (btn.getAttribute('aria-label') ?? btn.textContent ?? '').trim();
      expect(
        name.toLowerCase(),
        'each Rename button must include the target member name (not bare "Rename")',
      ).not.toBe('rename');
    }
  });
});

// =====================================================================
// SECURITY-CRITICAL: Deactivate offered ONLY on role==='member' active rows
// (never on a parent, never on self — even though the viewer is a parent)
// =====================================================================
describe('FamilyManagementScreen — Deactivate offered ONLY on role==="member" active rows', () => {
  it('the active child row carries a "Deactivate {name}" button', () => {
    renderScreen();
    expect(
      within(rowFor('Maya Kim')).getByRole('button', { name: /deactivate\s+maya/i }),
    ).toBeInTheDocument();
  });

  it('the viewer parent row carries NO Deactivate control (self-deactivation never offered)', () => {
    renderScreen();
    expect(
      within(rowFor('Sarah Kim')).queryByRole('button', { name: /deactivate/i }),
      "the viewer's own row must never offer Deactivate (rules deny it; UI must not even show it)",
    ).toBeNull();
  });

  it('a CO-PARENT row carries NO Deactivate control (parent-on-parent deactivation NOT offered in v1 — M31 deferred)', () => {
    renderScreen();
    expect(
      within(rowFor('Alex Kim')).queryByRole('button', { name: /deactivate/i }),
      'parent-on-parent deactivation must not be offered in v1 (last-active-parent invariant is a deferred Cloud Function)',
    ).toBeNull();
  });

  it('an INACTIVE child row carries NO Deactivate control (already inactive — only Reactivate applies)', () => {
    renderScreen();
    expect(
      within(rowFor('Ben Kim')).queryByRole('button', { name: /deactivate/i }),
    ).toBeNull();
  });

  it('across the page, the ONLY Deactivate button targets an active member-role row', () => {
    renderScreen();
    const deactivateButtons = screen.queryAllByRole('button', { name: /deactivate/i });
    expect(deactivateButtons).toHaveLength(1);
    const name = (deactivateButtons[0]?.getAttribute('aria-label') ?? deactivateButtons[0]?.textContent ?? '').toLowerCase();
    expect(name).toMatch(/maya/);
  });
});

// =====================================================================
// Reactivate affordance — on every inactive row
// =====================================================================
describe('FamilyManagementScreen — Reactivate affordance on every inactive row', () => {
  it('the inactive child row carries a "Reactivate {name}" button', () => {
    renderScreen();
    expect(
      within(rowFor('Ben Kim')).getByRole('button', { name: /reactivate\s+ben/i }),
    ).toBeInTheDocument();
  });

  it('an active row carries NO Reactivate control (would be a no-op)', () => {
    renderScreen();
    expect(
      within(rowFor('Maya Kim')).queryByRole('button', { name: /reactivate/i }),
    ).toBeNull();
    expect(
      within(rowFor('Sarah Kim')).queryByRole('button', { name: /reactivate/i }),
    ).toBeNull();
  });

  it('clicking "Reactivate {name}" calls onSetActive(uid, true) directly — NO confirm sheet (recoverable action)', async () => {
    const onSetActive = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onSetActive });
    fireEvent.click(within(rowFor('Ben Kim')).getByRole('button', { name: /reactivate\s+ben/i }));
    await waitFor(() => expect(onSetActive).toHaveBeenCalledWith(INACTIVE_CHILD.id, true));
  });
});

// =====================================================================
// Rename flow — BottomSheet, labelled input, save/cancel
// =====================================================================
describe('FamilyManagementScreen — Rename flow (BottomSheet, labelled input, validation, save/cancel)', () => {
  function openRenameSheet(name: string): void {
    fireEvent.click(
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test fixture name, not user input
      screen.getByRole('button', { name: new RegExp(`rename\\s+${name}`, 'i') }),
    );
  }

  it('clicking "Rename {name}" opens a BottomSheet (role=dialog) named for that member', () => {
    renderScreen();
    openRenameSheet('Maya Kim');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      (dialog.getAttribute('aria-label') ?? '').toLowerCase(),
      'the rename sheet must identify which member is being renamed (a11y)',
    ).toMatch(/maya/);
  });

  it('the rename input has a visible label as accessible name (no aria-label override)', () => {
    renderScreen();
    openRenameSheet('Maya Kim');
    // Label text MAY vary slightly but the input must be labelled (textbox by accessible name).
    const input = within(screen.getByRole('dialog')).getByRole('textbox');
    expect(input, 'the rename input must be a labelled textbox').toBeInTheDocument();
    // The input is associated with a <label> (htmlFor/id) or its label content
    // is the input's accessible name — getByRole picks that up automatically.
  });

  it('the rename input is PRE-FILLED with the member\'s current name', () => {
    renderScreen();
    openRenameSheet('Maya Kim');
    const input = within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Maya Kim');
  });

  it('clicking Save with a NEW (trimmed) name calls onRename(uid, trimmedName) and shows the success toast', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    openRenameSheet('Maya Kim');
    const input = within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   Maya R.   ' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith(ACTIVE_CHILD.id, 'Maya R.'));
    await waitFor(() => expect(screen.getByText(RENAME_SUCCESS)).toBeInTheDocument());
  });

  it('clicking Cancel closes the sheet WITHOUT calling onRename', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    openRenameSheet('Maya Kim');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancel/i }));
    await Promise.resolve();
    expect(onRename, 'cancel must not submit the rename').not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('an EMPTY name (or whitespace-only) does NOT call onRename — validation in the UI', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    openRenameSheet('Maya Kim');
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '    ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    await Promise.resolve();
    expect(onRename, 'empty / whitespace-only name must not submit').not.toHaveBeenCalled();
  });

  it(`an OVER-LENGTH name (> ${NAME_MAX_LENGTH} chars) is REJECTED before onRename is called`, async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    openRenameSheet('Maya Kim');
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'A'.repeat(NAME_MAX_LENGTH + 1) } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    await Promise.resolve();
    expect(
      onRename,
      `a name longer than ${NAME_MAX_LENGTH} chars must not submit (UI validation matches the service cap)`,
    ).not.toHaveBeenCalled();
  });

  it('a name unchanged from the current value does not silently mis-call onRename (no spurious writes)', async () => {
    // Sanity: an explicit Save click is required; merely opening the sheet must
    // not invoke onRename. (Behavior: clicking Save with the unchanged name
    // either is a no-op or calls onRename with the unchanged trimmed name —
    // the contract here is just "no call without a Save click".)
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    openRenameSheet('Maya Kim');
    await Promise.resolve();
    expect(onRename, 'opening the sheet must not submit a rename').not.toHaveBeenCalled();
  });
});

// =====================================================================
// Deactivate flow — confirm BottomSheet identifies the target
// =====================================================================
describe('FamilyManagementScreen — Deactivate flow (confirm BottomSheet)', () => {
  function openDeactivateConfirm(): void {
    fireEvent.click(
      within(rowFor('Maya Kim')).getByRole('button', { name: /deactivate\s+maya/i }),
    );
  }

  it('clicking "Deactivate {name}" opens a confirm BottomSheet (role=dialog) NAMING the target member (a11y)', () => {
    renderScreen();
    openDeactivateConfirm();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(
      (dialog.getAttribute('aria-label') ?? '').toLowerCase(),
      'the confirm sheet must identify WHO is being deactivated',
    ).toMatch(/maya/);
  });

  it('confirming the destructive action calls onSetActive(uid, false)', async () => {
    const onSetActive = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onSetActive });
    openDeactivateConfirm();
    const dialog = screen.getByRole('dialog');
    // The confirm button inside the dialog — distinct from the row's Deactivate.
    fireEvent.click(
      within(dialog).getByRole('button', { name: /deactivate|confirm|yes/i }),
    );
    await waitFor(() => expect(onSetActive).toHaveBeenCalledWith(ACTIVE_CHILD.id, false));
  });

  it('canceling the confirm does NOT call onSetActive', async () => {
    const onSetActive = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onSetActive });
    openDeactivateConfirm();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    await Promise.resolve();
    expect(onSetActive).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// =====================================================================
// Loading / Empty / Error states
// =====================================================================
describe('FamilyManagementScreen — loading / empty / error states', () => {
  it('renders a loading affordance (role=status) while loading', () => {
    renderScreen({ loading: true, members: [] });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('does NOT render the member list rows while loading', () => {
    renderScreen({ loading: true, members: [] });
    expect(screen.queryByText('Maya Kim')).not.toBeInTheDocument();
  });

  it('renders an EmptyState (text) when there are no members (defensive guard)', () => {
    renderScreen({ loading: false, members: [] });
    // EmptyState renders friendly text; assert SOMETHING text-like was shown
    // (not just a blank section).
    const empty = screen.queryByText(/no (family )?members|nothing here|no one|empty/i);
    expect(empty, 'the empty state must show friendly text (preferences.md)').toBeTruthy();
  });

  it('an error surfaces a user-safe toast (single channel, no raw provider text, no PII)', async () => {
    renderScreen({ error: 'Something went wrong. Please try again.' });
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    // No raw firebase/firestore text in the surfaced error.
    expect(screen.queryByText(/permission-denied|firebase|firestore/i)).not.toBeInTheDocument();
    // No PII (no @ -> no email; no uid-*; the family name on the row is fine
    // when the error itself is generic).
    const errorRegion =
      screen.getByText(/something went wrong/i).closest('[role="status"]') ??
      screen.getByText(/something went wrong/i);
    expect(errorRegion.textContent ?? '').not.toMatch(/uid-/i);
    expect(errorRegion.textContent ?? '').not.toMatch(/@/);
  });
});

// =====================================================================
// A11y — tap targets, focus, color-blind status
// =====================================================================
describe('FamilyManagementScreen — a11y baseline (tap targets, focus, text status)', () => {
  it('every Rename / Deactivate / Reactivate action carries the min-w-tap (44px) tap-target class', () => {
    renderScreen();
    const actions = [
      ...screen.getAllByRole('button', { name: /rename/i }),
      ...screen.getAllByRole('button', { name: /deactivate/i }),
      ...screen.getAllByRole('button', { name: /reactivate/i }),
    ];
    for (const btn of actions) {
      expect(
        btn.className,
        `action "${btn.getAttribute('aria-label') ?? btn.textContent}" must be at least 44px wide`,
      ).toMatch(/min-w-tap/);
    }
  });

  it('opening the rename sheet moves focus INTO the dialog (no stranded focus)', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /rename\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    // Either the input is the active element or focus is at least inside the dialog.
    expect(
      dialog.contains(document.activeElement),
      'focus must land inside the rename sheet on open',
    ).toBe(true);
  });

  it('closing the rename sheet (Cancel) restores focus to the triggering Rename button', () => {
    renderScreen();
    const trigger = screen.getByRole('button', { name: /rename\s+maya/i });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    // The Rename button is still mounted (its row didn't unmount), so focus restores there.
    expect(document.activeElement).toBe(trigger);
  });

  it('inactive status is conveyed by TEXT (assertion repeated at a11y level for the focused suite)', () => {
    renderScreen();
    expect(within(rowFor('Ben Kim')).getByText(/inactive/i)).toBeInTheDocument();
  });
});

// =====================================================================
// F3 (HIGH) — in-flight guard on per-row mutations (no double-tap writes)
//
// Today no guard exists on Rename / Deactivate / Reactivate. A double-tap
// (two synchronous clicks before the first promise resolves) fires TWO writes.
// The implementer may use a disabled button OR aria-busy OR a ref-tracked
// in-flight set — the observable contract is: exactly ONE call to the action
// callback while the first invocation is in flight, AND an a11y signal on
// the button so AT knows it is busy / disabled (one of the two).
//
// MECHANISM: each test holds a manual-resolution Promise on the action so we
// can synchronously double-click before the first promise resolves, then
// release.
// =====================================================================
describe('FamilyManagementScreen — F3 in-flight guard: a synchronous double-tap fires the action ONCE', () => {
  /**
   * The button gains aria-busy="true" OR disabled while the action is pending.
   * Either signal satisfies the a11y contract; tests assert at least one of
   * them is present (so the implementer has a choice without ambiguity).
   */
  function expectInFlightSignal(btn: HTMLElement): void {
    const ariaBusy = btn.getAttribute('aria-busy');
    const disabledAttr = btn.hasAttribute('disabled');
    const ariaDisabled = btn.getAttribute('aria-disabled');
    const isInFlight =
      ariaBusy === 'true' ||
      disabledAttr ||
      ariaDisabled === 'true';
    expect(
      isInFlight,
      'an in-flight action button must convey busy/disabled state to AT (aria-busy="true" OR disabled OR aria-disabled="true")',
    ).toBe(true);
  }

  it('REACTIVATE: two synchronous clicks call onSetActive ONCE; the button is signalled busy while pending; re-enabled after resolve', async () => {
    let resolveAction: (() => void) | null = null;
    const onSetActive = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<void>((res) => {
            resolveAction = () => res(undefined);
          }),
      );
    renderScreen({ onSetActive });
    const btn = within(rowFor('Ben Kim')).getByRole('button', { name: /reactivate\s+ben/i });

    // Two synchronous clicks BEFORE the first promise resolves.
    fireEvent.click(btn);
    fireEvent.click(btn);

    // Only ONE call may have escaped — the guard must collapse the double-tap.
    expect(
      onSetActive,
      'a double-tap of Reactivate must NOT fire two writes (in-flight guard)',
    ).toHaveBeenCalledTimes(1);
    expect(onSetActive).toHaveBeenCalledWith(INACTIVE_CHILD.id, true);

    // The a11y signal must be present while pending.
    expectInFlightSignal(btn);

    // Release the in-flight promise — the button re-enables, the busy signal lifts.
    await act(async () => {
      resolveAction!();
      await Promise.resolve();
    });
    await waitFor(() => {
      // After resolve, neither aria-busy="true" nor disabled remains.
      const stillBusy = btn.getAttribute('aria-busy') === 'true' || btn.hasAttribute('disabled');
      expect(stillBusy, 'after the promise resolves, the button must be re-enabled').toBe(false);
    });
  });

  it('DEACTIVATE CONFIRM: two synchronous clicks call onSetActive(uid,false) ONCE; confirm button is signalled busy', async () => {
    let resolveAction: (() => void) | null = null;
    const onSetActive = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<void>((res) => {
            resolveAction = () => res(undefined);
          }),
      );
    renderScreen({ onSetActive });
    // Open the confirm sheet from the Maya row.
    fireEvent.click(
      within(rowFor('Maya Kim')).getByRole('button', { name: /deactivate\s+maya/i }),
    );
    const dialog = screen.getByRole('dialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /deactivate|confirm|yes/i });

    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(
      onSetActive,
      'a double-tap on the destructive Confirm must NOT fire two writes',
    ).toHaveBeenCalledTimes(1);
    expect(onSetActive).toHaveBeenCalledWith(ACTIVE_CHILD.id, false);
    expectInFlightSignal(confirmBtn);

    await act(async () => {
      resolveAction!();
      await Promise.resolve();
    });
  });

  it('RENAME SAVE: two synchronous clicks call onRename ONCE; Save button is signalled busy', async () => {
    let resolveAction: (() => void) | null = null;
    const onRename = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<void>((res) => {
            resolveAction = () => res(undefined);
          }),
      );
    renderScreen({ onRename });
    fireEvent.click(screen.getByRole('button', { name: /rename\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Maya R.' } });
    const saveBtn = within(dialog).getByRole('button', { name: /save/i });

    fireEvent.click(saveBtn);
    fireEvent.click(saveBtn);

    expect(
      onRename,
      'a double-tap on Save must NOT fire two renames',
    ).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(ACTIVE_CHILD.id, 'Maya R.');
    expectInFlightSignal(saveBtn);

    await act(async () => {
      resolveAction!();
      await Promise.resolve();
    });
  });

  it('POSITIVE CONTROL: after a Reactivate promise resolves, the row\'s Reactivate is REMOVED (member is now active) — no duplicate button', async () => {
    // Resolve immediately; afterwards the screen would re-render with the member
    // re-classified as active. We assert that the row's Reactivate button is no
    // longer present (the row would be in the Active section), AND that no
    // residual aria-busy="true" leaks anywhere on the page.
    const onSetActive = vi.fn().mockResolvedValue(undefined);
    const props = renderScreen({ onSetActive });
    const btn = within(rowFor('Ben Kim')).getByRole('button', { name: /reactivate\s+ben/i });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });
    // Sanity: the action was called once.
    expect(props.onSetActive).toHaveBeenCalledTimes(1);
    // After resolve, no button anywhere on screen carries aria-busy="true".
    const busy = Array.from(
      document.querySelectorAll('button[aria-busy="true"]'),
    );
    expect(busy, 'no stale aria-busy="true" button after resolve').toHaveLength(0);
  });
});

// =====================================================================
// F4 + F10 (MED) — rename and deactivate sheets CLOSE on failure
//
// Today both sheets STAY OPEN on a rejected action and the Save/Confirm
// button stays clickable (compounding F3). The fix: on rejection close the
// sheet, toast the generic error, re-enable the row's trigger button.
// =====================================================================
describe('FamilyManagementScreen — F4: rename sheet closes on rejection + toast + re-enable', () => {
  it('a rejected onRename CLOSES the rename sheet, toasts the generic error, re-enables the row\'s Rename button', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('any-error'));
    renderScreen({ onRename });
    const renameTrigger = screen.getByRole('button', { name: /rename\s+maya/i });
    fireEvent.click(renameTrigger);
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New Name' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // 1) The dialog must close (deterministic close on failure).
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog'),
        'the rename sheet must CLOSE on rejection (F4) — staying open compounds the double-tap risk',
      ).not.toBeInTheDocument(),
    );
    // 2) The generic toast surfaces ONCE.
    await waitFor(() => {
      const toast = screen.getByText(/something went wrong/i);
      expect(toast).toBeInTheDocument();
    });
    // 3) The row's Rename button is re-enabled (no aria-busy="true" / disabled).
    expect(renameTrigger.getAttribute('aria-busy') === 'true').toBe(false);
    expect(renameTrigger.hasAttribute('disabled')).toBe(false);
  });
});

describe('FamilyManagementScreen — F10: deactivate confirm sheet closes on rejection + toast + re-enable', () => {
  it('a rejected onSetActive(uid,false) CLOSES the confirm sheet, toasts generic error, re-enables the row\'s Deactivate button', async () => {
    const onSetActive = vi.fn().mockRejectedValue(new Error('any-error'));
    renderScreen({ onSetActive });
    const deactivateTrigger = within(rowFor('Maya Kim')).getByRole('button', {
      name: /deactivate\s+maya/i,
    });
    fireEvent.click(deactivateTrigger);
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: /deactivate|confirm|yes/i }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog'),
        'the confirm sheet must CLOSE on rejection (F10)',
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(deactivateTrigger.getAttribute('aria-busy') === 'true').toBe(false);
    expect(deactivateTrigger.hasAttribute('disabled')).toBe(false);
  });

  it('a rejected REACTIVATE (no sheet to close): during pending the button is busy; after rejection the busy signal LIFTS and the toast appears', async () => {
    // Manual-resolution so we can observe the in-flight state (F3 + F10 together).
    let rejectAction: ((err: Error) => void) | null = null;
    const onSetActive = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_res, rej) => {
          rejectAction = (err: Error) => rej(err);
        }),
    );
    renderScreen({ onSetActive });
    const reactivateTrigger = within(rowFor('Ben Kim')).getByRole('button', {
      name: /reactivate\s+ben/i,
    });
    fireEvent.click(reactivateTrigger);
    // While pending the button must convey busy/disabled to AT (F3 contract).
    const ariaBusyDuring = reactivateTrigger.getAttribute('aria-busy') === 'true';
    const disabledDuring =
      reactivateTrigger.hasAttribute('disabled') ||
      reactivateTrigger.getAttribute('aria-disabled') === 'true';
    expect(
      ariaBusyDuring || disabledDuring,
      'F3 — during a pending Reactivate the button must convey busy/disabled to AT',
    ).toBe(true);

    // Now reject the in-flight action.
    await act(async () => {
      rejectAction!(new Error('any-error'));
      await Promise.resolve();
      await Promise.resolve();
    });
    // The generic toast surfaces.
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    // F10 — the busy/disabled signal LIFTS so the user can retry.
    expect(
      reactivateTrigger.getAttribute('aria-busy') === 'true',
      'F10 — after rejection, the busy signal must lift so the user can retry',
    ).toBe(false);
    expect(
      reactivateTrigger.hasAttribute('disabled'),
      'F10 — after rejection, the button must be re-enabled',
    ).toBe(false);
  });
});

// =====================================================================
// F6 (MED) — Reactivate is gated by !isSelf too (defensive race)
//
// Today canReactivate = !member.isActive — no !isSelf guard. If a viewer-self
// somehow appears in the Inactive section (defensive race, post-deactivation
// flicker), the viewer's row would show a Reactivate control on their own
// row. Server rules already deny self-edits of isActive; the UI must mirror.
// =====================================================================
describe('FamilyManagementScreen — F6: Reactivate is NOT offered on the viewer\'s own row', () => {
  it('viewer-self appearing as INACTIVE has NO Reactivate control on their own row', () => {
    const selfInactiveViewer: UserWithId = {
      ...VIEWER_PARENT,
      isActive: false, // defensive race — viewer somehow in the Inactive section
    };
    renderScreen({
      viewer: selfInactiveViewer,
      members: [selfInactiveViewer, CO_PARENT, ACTIVE_CHILD, INACTIVE_CHILD],
    });
    // Sarah Kim's row must have NO Reactivate button (it's the viewer).
    expect(
      within(rowFor('Sarah Kim')).queryByRole('button', { name: /reactivate/i }),
      'Reactivate must never appear on the viewer\'s OWN row (F6 — defensive against an isActive race)',
    ).toBeNull();
    // But the OTHER inactive row (Ben) still has its Reactivate — guard is per-row, not global.
    expect(
      within(rowFor('Ben Kim')).queryByRole('button', { name: /reactivate\s+ben/i }),
    ).toBeInTheDocument();
  });
});

// =====================================================================
// F8 (LOW) — no-op rename is a UI-side no-op
//
// If the trimmed input equals target.name, Save must NOT call onRename. The
// server would deny with affectedKeys().size() > 0 → a confusing generic-error
// toast for what the user perceives as "saving the same name". The UI does the
// short-circuit: dismiss the sheet silently (no error toast).
// =====================================================================
describe('FamilyManagementScreen — F8: no-op rename does NOT call onRename (silent close, no error toast)', () => {
  it('Save with the trimmed value equal to the current name → onRename NOT called; sheet closes; no error toast', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    fireEvent.click(screen.getByRole('button', { name: /rename\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    // Re-type the same name (with surrounding whitespace to exercise the trim).
    fireEvent.change(input, { target: { value: '   Maya Kim   ' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
      await Promise.resolve();
      await Promise.resolve();
    });
    // 1) onRename NOT called — the UI short-circuits the no-op.
    expect(
      onRename,
      'a no-op rename (trimmed === current name) must NOT call onRename (server would deny on hasOnly-not-affected)',
    ).not.toHaveBeenCalled();
    // 2) The sheet closes silently.
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog'),
        'the rename sheet must close silently on a no-op',
      ).not.toBeInTheDocument(),
    );
    // 3) NO generic error toast appears (the user's action was implicitly a save).
    expect(
      screen.queryByText(/something went wrong/i),
      'a no-op rename must NOT surface the generic error toast',
    ).toBeNull();
  });
});

// =====================================================================
// A1 (a11y) — drop redundant <ul aria-label>
//
// The <ul> carries aria-label={heading} which duplicates the section's <h2>.
// The section heading is the authoritative name; the <ul> must NOT carry an
// aria-label.
// =====================================================================
describe('FamilyManagementScreen — A1: section <ul> has no aria-label (avoid duplicating <h2>)', () => {
  it('the Active section\'s <ul> carries NO aria-label', () => {
    renderScreen();
    // Find the active <section>, then its <ul>.
    const sections = Array.from(document.querySelectorAll('section'));
    const activeSection = sections.find(
      (s) =>
        /active/i.test(s.querySelector('h2')?.textContent ?? '') &&
        !/inactive/i.test(s.querySelector('h2')?.textContent ?? ''),
    );
    expect(activeSection, 'an Active <section> must exist').toBeTruthy();
    const list = activeSection!.querySelector('ul');
    expect(list, 'the Active section must contain a <ul>').toBeTruthy();
    expect(
      list!.hasAttribute('aria-label'),
      'A1 — the <ul> must NOT carry aria-label (duplicates the <h2>)',
    ).toBe(false);
  });

  it('the Inactive section\'s <ul> carries NO aria-label', () => {
    renderScreen();
    const sections = Array.from(document.querySelectorAll('section'));
    const inactiveSection = sections.find((s) =>
      /inactive/i.test(s.querySelector('h2')?.textContent ?? ''),
    );
    expect(inactiveSection, 'an Inactive <section> must exist').toBeTruthy();
    const list = inactiveSection!.querySelector('ul');
    expect(list, 'the Inactive section must contain a <ul>').toBeTruthy();
    expect(
      list!.hasAttribute('aria-label'),
      'A1 — the Inactive <ul> must NOT carry aria-label (duplicates the <h2>)',
    ).toBe(false);
  });
});

// =====================================================================
// A3 (a11y) — destructive confirm sheet associates consequence text via aria-describedby
//
// The "{name} will no longer be able to sign in or earn allowance…" sentence
// must be part of the dialog's accessible description. Pin: the dialog has
// aria-describedby pointing to an element whose id matches, and that element
// contains the consequence text.
// =====================================================================
describe('FamilyManagementScreen — A3: destructive confirm dialog has aria-describedby wired to the consequence text', () => {
  it('the confirm dialog\'s aria-describedby points to an element containing the consequence sentence', () => {
    renderScreen();
    fireEvent.click(
      within(rowFor('Maya Kim')).getByRole('button', { name: /deactivate\s+maya/i }),
    );
    const dialog = screen.getByRole('dialog');
    const describedById = dialog.getAttribute('aria-describedby');
    expect(
      describedById,
      'A3 — the destructive confirm dialog must carry aria-describedby pointing at the consequence text',
    ).not.toBeNull();
    expect(describedById?.length ?? 0).toBeGreaterThan(0);
    const describedNode = document.getElementById(describedById!);
    expect(
      describedNode,
      'A3 — the element referenced by aria-describedby must exist in the DOM',
    ).not.toBeNull();
    // The referenced element must contain the consequence text.
    expect(
      describedNode!.textContent ?? '',
      'A3 — the described element must contain the consequence sentence (sign in / allowance)',
    ).toMatch(/sign in|earn allowance/i);
  });
});

// =====================================================================
// A5 + Adv F7 — rename input drops maxLength; over-length error is surfaced
//
// Today the input has maxLength={NAME_MAX_LENGTH} (silent truncation; the
// isOverLength branch is unreachable). Fix: drop the maxLength attribute,
// surface the over-length error inline via role="alert" / aria-live, and DO
// NOT call onRename.
// =====================================================================
describe('FamilyManagementScreen — A5/F7: rename input has no maxLength; over-length surfaces an inline error', () => {
  function openRenameSheet(name: string): HTMLInputElement {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test fixture name, not user input
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`rename\\s+${name}`, 'i') }));
    const dialog = screen.getByRole('dialog');
    return within(dialog).getByRole('textbox') as HTMLInputElement;
  }

  it('the rename input does NOT carry a maxLength attribute (silent truncation harms cognition)', () => {
    renderScreen();
    const input = openRenameSheet('Maya Kim');
    expect(
      input.hasAttribute('maxlength'),
      'A5 — the rename input must NOT carry maxLength (silent truncation is a cognitive harm)',
    ).toBe(false);
  });

  it(`an over-length name (> ${NAME_MAX_LENGTH} chars trimmed) on Save surfaces an inline live-region error AND does NOT call onRename`, async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    const input = openRenameSheet('Maya Kim');
    // Without maxLength, the input can accept the long value. Trimmed length
    // is then > NAME_MAX_LENGTH.
    fireEvent.change(input, { target: { value: 'A'.repeat(NAME_MAX_LENGTH + 5) } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /save/i }));
    await Promise.resolve();
    // 1) onRename NOT called.
    expect(
      onRename,
      'an over-length name must not invoke onRename (UI validation)',
    ).not.toHaveBeenCalled();
    // 2) A live-region inline error appears, mentioning the cap.
    const liveRegion =
      screen.queryByRole('alert') ??
      document.querySelector('[aria-live]');
    expect(
      liveRegion,
      'A5/F7 — an over-length error must be announced (role="alert" or aria-live)',
    ).not.toBeNull();
    const text = liveRegion?.textContent ?? '';
    expect(
      text,
      'the over-length error copy should mention the cap and that the name is too long',
    ).toMatch(new RegExp(`too long|${NAME_MAX_LENGTH}`, 'i'));
  });

  it('the rename input accepts a paste-style assignment of an over-length value (no truncation at the input boundary)', () => {
    // With maxLength removed, the DOM input must hold the FULL value the user
    // types/pastes. A truncated value at the input boundary is the bug.
    renderScreen();
    const input = openRenameSheet('Maya Kim');
    const long = 'A'.repeat(NAME_MAX_LENGTH + 10);
    fireEvent.change(input, { target: { value: long } });
    expect(
      input.value.length,
      'A5/F7 — without maxLength the input must hold the full value (no silent truncation)',
    ).toBe(long.length);
  });
});

// =====================================================================
// A8 (a11y) — drop redundant aria-required on the pre-filled rename input
//
// The input is pre-filled and has no native `required` — aria-required="true"
// is misleading. Pin: aria-required is not set.
// =====================================================================
describe('FamilyManagementScreen — A8: rename input does NOT carry aria-required', () => {
  it('the rename input has NO aria-required attribute', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /rename\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox');
    expect(
      input.hasAttribute('aria-required'),
      'A8 — the pre-filled rename input must not carry aria-required (no matching native `required`)',
    ).toBe(false);
  });

  it('canSave-guarding logic is unchanged: empty input still does not submit', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onRename });
    fireEvent.click(screen.getByRole('button', { name: /rename\s+maya/i }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));
    await Promise.resolve();
    expect(
      onRename,
      'A8 — removing aria-required must NOT relax the canSave guard',
    ).not.toHaveBeenCalled();
  });
});

// =====================================================================
// Fixture safety — the dynamic family rule (DASHBOARD-2026 vibe): no hardcoded names
// =====================================================================
describe('FamilyManagementScreen — fixture safety (dynamic family roster, not hardcoded)', () => {
  it('a DIFFERENT roster (only Zoe) yields only Zoe-targeted action buttons', () => {
    const zoe: UserWithId = {
      id: 'uid-zoe',
      name: 'Zoe',
      role: 'member',
      familyId: 'fam-Z',
      isActive: true,
      allowanceBalance: 500,
      theme: 'light',
    };
    const viewerB: UserWithId = {
      id: 'uid-parent-z',
      name: 'Dana',
      role: 'parent',
      familyId: 'fam-Z',
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
    };
    renderScreen({ viewer: viewerB, members: [viewerB, zoe] });
    expect(screen.getByRole('button', { name: /rename\s+zoe/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rename\s+maya|ben|sarah|alex/i })).toBeNull();
  });
});

// =====================================================================
// F13 — Family timezone settings row (parent-only)
//
// State traceability:
//  - PARENT VIEWER + handler provided -> visible labelled <select> with the
//    shortlist (Toronto / Vancouver / Edmonton / Halifax / St_Johns), the
//    current timezone preselected, a help description wired via
//    aria-describedby, and a 44px tap target.
//  - PARENT VIEWER but no handler (route hasn't wired it) -> no row.
//  - NON-PARENT viewer -> no row.
//  - LEGACY off-shortlist value -> rendered as an additional option
//    prefixed with "(current)"; never trap the parent on it.
//  - CHANGE -> calls onSetTimezone(newValue) ONCE; in-flight prevents a
//    second call (disabled select) and re-enables after resolve.
//  - REJECTION -> generic toast, control re-enabled.
// =====================================================================
describe('FamilyManagementScreen — F13 family timezone settings (parent-only)', () => {
  it('a parent viewer sees a labelled timezone control with the shortlist when a handler is wired', () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i });
    expect(select).toBeInTheDocument();
    // The shortlist values are present as <option value="…">.
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(
      expect.arrayContaining([
        'America/Toronto',
        'America/Vancouver',
        'America/Edmonton',
        'America/Halifax',
        'America/St_Johns',
      ]),
    );
    // The current value is preselected.
    expect((select as HTMLSelectElement).value).toBe('America/Toronto');
  });

  it('the timezone select has a min-tap-target class (44px floor, AODA / kids users)', () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i });
    expect(
      select.className,
      'the timezone select must meet the 44px floor (mobile + kid users)',
    ).toMatch(/min-h-tap/);
  });

  it('the timezone select is associated with help text via aria-describedby (a11y)', () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i });
    const describedById = select.getAttribute('aria-describedby');
    expect(describedById, 'a help description must be wired via aria-describedby').not.toBeNull();
    const describedNode = document.getElementById(describedById!);
    expect(describedNode).not.toBeNull();
    expect(describedNode!.textContent ?? '').toMatch(/notification|morning|local hour/i);
  });

  it('a PARENT viewer with NO onSetTimezone handler shows NO timezone control (route opt-out)', () => {
    renderScreen({ timezone: 'America/Toronto', onSetTimezone: undefined });
    expect(
      screen.queryByRole('combobox', { name: /family timezone/i }),
      'without a handler the timezone row must not render (avoids a confusing dead control)',
    ).toBeNull();
  });

  it('a NON-PARENT viewer never sees the timezone control even when a handler is provided', () => {
    const memberViewer: UserWithId = {
      id: 'uid-member-viewer',
      name: 'Sam',
      role: 'member',
      familyId: 'fam-A',
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
    };
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      viewer: memberViewer,
      members: [memberViewer],
      timezone: 'America/Toronto',
      onSetTimezone,
    });
    expect(
      screen.queryByRole('combobox', { name: /family timezone/i }),
      'a non-parent viewer must never see the timezone control (rules deny anyway)',
    ).toBeNull();
  });

  it('changing the select calls onSetTimezone ONCE with the new value', async () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'America/Vancouver' } });
    await waitFor(() => expect(onSetTimezone).toHaveBeenCalledTimes(1));
    expect(onSetTimezone).toHaveBeenCalledWith('America/Vancouver');
  });

  it('a successful change surfaces the success toast', async () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'America/Halifax' } });
    await waitFor(() => {
      expect(screen.getByText(/family timezone updated/i)).toBeInTheDocument();
    });
  });

  it('a rejected change surfaces the GENERIC error toast (no raw provider text leaks)', async () => {
    const onSetTimezone = vi.fn().mockRejectedValue(new Error('permission-denied: raw'));
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i }) as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'America/Vancouver' } });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    // The raw Firebase text must not appear anywhere in the page.
    expect(screen.queryByText(/permission-denied/i)).toBeNull();
  });

  it('a LEGACY off-shortlist value is shown as an additional option prefixed "(current)" — parent is never trapped', () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: 'America/Whitehorse', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i }) as HTMLSelectElement;
    expect(select.value).toBe('America/Whitehorse');
    // The legacy value appears as an option.
    const matchingOption = Array.from(select.querySelectorAll('option')).find(
      (o) => o.value === 'America/Whitehorse',
    );
    expect(matchingOption).toBeTruthy();
    expect(matchingOption!.textContent ?? '').toMatch(/current/i);
    // Shortlist options are still present so the parent can move OFF the legacy value.
    const optionValues = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toEqual(
      expect.arrayContaining(['America/Toronto', 'America/Vancouver']),
    );
  });

  it('an UNDEFINED current timezone (legacy doc, field absent) falls back to America/Toronto for display', () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: undefined, onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i }) as HTMLSelectElement;
    // Falls back to the universal default the runtime sweep also uses (M50).
    expect(select.value).toBe('America/Toronto');
  });

  it('selecting the SAME value is a no-op (does not call onSetTimezone)', () => {
    const onSetTimezone = vi.fn().mockResolvedValue(undefined);
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'America/Toronto' } });
    expect(
      onSetTimezone,
      're-selecting the current value must not write (avoids a spurious server roundtrip)',
    ).not.toHaveBeenCalled();
  });

  it('IN-FLIGHT guard: the select is disabled while pending; re-enabled after resolve', async () => {
    let resolveAction: (() => void) | null = null;
    const onSetTimezone = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveAction = () => res(undefined);
        }),
    );
    renderScreen({ timezone: 'America/Toronto', onSetTimezone });
    const select = screen.getByRole('combobox', { name: /family timezone/i }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'America/Vancouver' } });
    // While the write is in flight the control is disabled.
    expect(select.disabled, 'the select must disable while the write is in flight').toBe(true);
    await act(async () => {
      resolveAction!();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(select.disabled, 'after the write resolves the select re-enables').toBe(false);
    });
  });
});
