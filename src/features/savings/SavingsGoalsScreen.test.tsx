/**
 * SavingsGoalsScreen — focused contract.
 *
 * The screen is INJECTED-PROPS / NO Firebase, so we render it directly and
 * pin the user-visible behaviour:
 *   - Loading / error / empty branches each render the right state.
 *   - A member viewer sees the "+ New" affordance + Contribute on their
 *     own active goal; does NOT see parent-only Complete / Archive /
 *     Delete (UI gating is cosmetic — rules are authoritative).
 *   - A parent viewer sees the parent-only affordances + the owner-name
 *     row for each goal.
 *   - The progress fill width matches savingsGoalProgressPercent.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';
import { SavingsGoalsScreen } from './SavingsGoalsScreen';
import type { SavingsGoalWithId } from './savingsGoalsService';

const SARAH: UserWithId = {
  id: 'uid-parent-a',
  name: 'Sarah',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const MAYA: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 1000,
  theme: 'light',
};

function mkGoal(over: Partial<SavingsGoalWithId> & { id: string }): SavingsGoalWithId {
  const now = Date.now();
  return {
    familyId: 'fam-A',
    ownerUid: 'uid-member-a',
    title: 'New bike',
    targetAmount: 50000,
    currentAmount: 12500,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    ...over,
  };
}

function renderScreen(
  overrides: Partial<Parameters<typeof SavingsGoalsScreen>[0]> = {},
): ReturnType<typeof render> {
  const viewer: { uid: string; name: string; role: Role } = overrides.viewer ?? {
    uid: MAYA.id,
    name: MAYA.name,
    role: MAYA.role,
  };
  const members = overrides.members ?? [SARAH, MAYA];
  const feed = overrides.feed ?? {
    goals: [mkGoal({ id: 'g1' })],
    loading: false,
    error: null,
  };
  return render(
    <SavingsGoalsScreen viewer={viewer} members={members} feed={feed} {...overrides} />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SavingsGoalsScreen — state machine', () => {
  it('renders the Skeleton when loading', () => {
    renderScreen({ feed: { goals: [], loading: true, error: null } });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an inline error (NEVER a toast) when error is set', () => {
    renderScreen({
      feed: { goals: [], loading: false, error: 'We could not load savings goals.' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
  });

  it('renders the empty-state copy when no goals exist (member viewer gets the member copy)', () => {
    renderScreen({ feed: { goals: [], loading: false, error: null } });
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument();
  });
});

describe('SavingsGoalsScreen — member viewer affordances', () => {
  it('shows the "+ New savings goal" FAB when onCreate is provided', () => {
    renderScreen({ onCreate: vi.fn(async () => undefined) });
    expect(screen.getByRole('button', { name: /new savings goal/i })).toBeInTheDocument();
  });

  it('shows the per-goal "Add" (contribute) button on an active goal', () => {
    renderScreen({ onContribute: vi.fn(async () => undefined) });
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument();
  });

  it('hides the parent-only Complete / Archive / Delete affordances for a member viewer', () => {
    renderScreen({
      onContribute: vi.fn(async () => undefined),
      onComplete: vi.fn(async () => undefined),
      onArchive: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
    });
    expect(
      screen.queryByRole('button', { name: /mark complete/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^archive$/i })).not.toBeInTheDocument();
  });

  it('does NOT render the "Saving for {name}" owner line for a member viewer', () => {
    // Member sees only their own goals — the owner name is redundant.
    renderScreen();
    expect(screen.queryByText(/saving for/i)).not.toBeInTheDocument();
  });
});

describe('SavingsGoalsScreen — parent viewer affordances', () => {
  it('shows Complete + Archive on an active goal when those props are wired', () => {
    renderScreen({
      viewer: { uid: SARAH.id, name: SARAH.name, role: SARAH.role },
      onContribute: vi.fn(async () => undefined),
      onComplete: vi.fn(async () => undefined),
      onArchive: vi.fn(async () => undefined),
    });
    expect(screen.getByRole('button', { name: /mark complete/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument();
  });

  it('renders the "Saving for {name}" line so the parent sees whose goal it is', () => {
    renderScreen({
      viewer: { uid: SARAH.id, name: SARAH.name, role: SARAH.role },
    });
    expect(screen.getByText(/saving for maya/i)).toBeInTheDocument();
  });

  it('exposes the per-goal Delete on a COMPLETED goal when onDelete is wired', () => {
    renderScreen({
      viewer: { uid: SARAH.id, name: SARAH.name, role: SARAH.role },
      feed: {
        goals: [mkGoal({ id: 'g-done', status: 'completed', currentAmount: 50000 })],
        loading: false,
        error: null,
      },
      onDelete: vi.fn(async () => undefined),
    });
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });
});

describe('SavingsGoalsScreen — progress + grouping', () => {
  it('renders the progress fill width matching savingsGoalProgressPercent (25 / 100 = 25%)', () => {
    renderScreen({
      feed: {
        goals: [mkGoal({ id: 'g25', currentAmount: 12500, targetAmount: 50000 })],
        loading: false,
        error: null,
      },
    });
    const fill = screen.getByTestId('savings-progress-fill');
    expect((fill as HTMLElement).style.width).toBe('25%');
  });

  it('groups goals into Active / Completed / Archived sections', () => {
    renderScreen({
      viewer: { uid: SARAH.id, name: SARAH.name, role: SARAH.role },
      feed: {
        goals: [
          mkGoal({ id: 'a', title: 'A active' }),
          mkGoal({ id: 'b', title: 'B done', status: 'completed' }),
          mkGoal({ id: 'c', title: 'C cold', status: 'archived' }),
        ],
        loading: false,
        error: null,
      },
    });
    const activeList = screen.getByRole('list', { name: /active goals/i });
    expect(within(activeList).getByText(/A active/)).toBeInTheDocument();
    const completedList = screen.getByRole('list', { name: /^completed$/i });
    expect(within(completedList).getByText(/B done/)).toBeInTheDocument();
    const archivedList = screen.getByRole('list', { name: /^archived$/i });
    expect(within(archivedList).getByText(/C cold/)).toBeInTheDocument();
  });
});

describe('SavingsGoalsScreen — create + contribute sheets', () => {
  it('opens the create sheet when the FAB is tapped', () => {
    renderScreen({ onCreate: vi.fn(async () => undefined) });
    fireEvent.click(screen.getByRole('button', { name: /new savings goal/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/what are you saving for/i)).toBeInTheDocument();
  });

  it('opens the contribute sheet when "Add" is tapped on a goal', () => {
    renderScreen({ onContribute: vi.fn(async () => undefined) });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/how much to add/i)).toBeInTheDocument();
  });
});
