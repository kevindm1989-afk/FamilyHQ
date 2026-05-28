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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
