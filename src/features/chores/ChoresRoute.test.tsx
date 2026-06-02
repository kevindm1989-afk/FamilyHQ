/**
 * ChoresRoute — focused contract for the lazy route shell.
 *
 * The two inner screens (ChoresParentScreen / ChoresMemberScreen) and the
 * AddChore sheet have their own unit + a11y tests. This file pins the
 * SHELL wiring:
 *   - Role split: parent → parent screen + AddChore; member → member screen.
 *   - Placeholder branch (no currentUser / no familyId).
 *   - /chores/new opens the AddChore sheet over the parent screen.
 *   - Service callbacks (markComplete / approve / reject / addChore) wire
 *     to the shell-level handlers with the right arguments.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';

const sarah: UserWithId = {
  id: 'uid-parent',
  name: 'Sarah',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const maya: UserWithId = {
  id: 'uid-member',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 100,
  theme: 'light',
};

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
};

vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => familyState,
}));

vi.mock('./useMyChores', () => ({
  useMyChores: () => ({ chores: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('./useFamilyChores', () => ({
  useFamilyChores: () => ({ chores: [], loading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

const markCompleteMock = vi.fn();
vi.mock('./choresMemberService', () => ({
  markComplete: (...a: unknown[]) => markCompleteMock(...a),
}));
const approveMock = vi.fn();
const rejectMock = vi.fn();
const addChoreMock = vi.fn();
vi.mock('./choresParentService', () => ({
  approveChore: (...a: unknown[]) => approveMock(...a),
  rejectChore: (...a: unknown[]) => rejectMock(...a),
  addChore: (...a: unknown[]) => addChoreMock(...a),
}));

// Mock the screens + sheet so we can assert wiring without their internals.
vi.mock('./ChoresParentScreen', () => ({
  ChoresParentScreen: (props: {
    onApprove?: (id: string) => Promise<void>;
    onReject?: (id: string, reason: string) => Promise<void>;
    onAddChore?: () => void;
    viewer?: { uid: string };
  }) => (
    <div data-testid="parent-screen" data-viewer={props.viewer?.uid ?? ''}>
      <button type="button" onClick={() => void props.onApprove?.('chore-1')}>
        approve
      </button>
      <button type="button" onClick={() => void props.onReject?.('chore-1', 'too messy')}>
        reject
      </button>
      <button type="button" onClick={() => props.onAddChore?.()}>
        add
      </button>
    </div>
  ),
}));
vi.mock('./ChoresMemberScreen', () => ({
  ChoresMemberScreen: (props: {
    onMarkComplete?: (id: string) => Promise<void>;
    viewer?: { uid: string; allowanceBalance: number };
  }) => (
    <div
      data-testid="member-screen"
      data-viewer={props.viewer?.uid ?? ''}
      data-balance={String(props.viewer?.allowanceBalance ?? '')}
    >
      <button type="button" onClick={() => void props.onMarkComplete?.('chore-2')}>
        complete
      </button>
    </div>
  ),
}));
vi.mock('./AddChore', () => ({
  AddChore: (props: {
    open: boolean;
    onClose: () => void;
    onAdd: (v: {
      title: string;
      assignedTo: string;
      date: string;
      pointValue: number;
      dollarValue: number;
      isRecurring: boolean;
      recurrenceFrequency?: 'daily' | 'weekly';
    }) => Promise<void>;
  }) => (
    <div data-testid="add-chore" data-open={String(props.open)}>
      <button type="button" onClick={() => props.onClose()}>
        close
      </button>
      <button
        type="button"
        onClick={() =>
          void props.onAdd({
            title: 'Trash',
            assignedTo: 'uid-member',
            date: '2026-06-02',
            pointValue: 10,
            dollarValue: 3,
            isRecurring: false,
          })
        }
      >
        submit
      </button>
    </div>
  ),
}));

import ChoresRoute from './ChoresRoute';

function mountAt(path: string) {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={[path]}
    >
      <Routes>
        <Route path="/chores" element={<ChoresRoute />} />
        <Route path="/chores/new" element={<ChoresRoute />} />
        <Route path="/allowance" element={<div data-testid="allowance-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  markCompleteMock.mockReset().mockResolvedValue(undefined);
  approveMock.mockReset().mockResolvedValue(undefined);
  rejectMock.mockReset().mockResolvedValue(undefined);
  addChoreMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('ChoresRoute — role split', () => {
  it('a PARENT viewer renders ChoresParentScreen (+ AddChore sheet closed at /chores)', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah, maya],
      loading: false,
    };
    const r = mountAt('/chores');
    expect(r.getByTestId('parent-screen')).toBeInTheDocument();
    expect(r.getByTestId('add-chore').dataset.open).toBe('false');
    expect(r.queryByTestId('member-screen')).not.toBeInTheDocument();
  });

  it('a MEMBER viewer renders ChoresMemberScreen with the viewer balance threaded through', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: maya,
      members: [sarah, maya],
      loading: false,
    };
    const r = mountAt('/chores');
    const screen = r.getByTestId('member-screen');
    expect(screen.dataset.viewer).toBe('uid-member');
    expect(screen.dataset.balance).toBe('100');
    expect(r.queryByTestId('parent-screen')).not.toBeInTheDocument();
  });

  it('renders the Placeholder when currentUser is null (post-auth pre-bootstrap)', () => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: null,
      members: [],
      loading: false,
    };
    const r = mountAt('/chores');
    expect(r.queryByTestId('parent-screen')).not.toBeInTheDocument();
    expect(r.queryByTestId('member-screen')).not.toBeInTheDocument();
  });
});

describe('ChoresRoute — parent: /chores/new opens AddChore', () => {
  beforeEach(() => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah, maya],
      loading: false,
    };
  });

  it('AddChore is open when the route is /chores/new', () => {
    const r = mountAt('/chores/new');
    expect(r.getByTestId('add-chore').dataset.open).toBe('true');
  });

  it('handleAdd delegates to choresParentService.addChore with the input + familyId + createdBy', async () => {
    const r = mountAt('/chores/new');
    await act(async () => {
      fireEvent.click(r.getByText('submit'));
    });
    expect(addChoreMock).toHaveBeenCalledTimes(1);
    const [, input] = addChoreMock.mock.calls[0]!;
    const i = input as Record<string, unknown>;
    expect(i.title).toBe('Trash');
    expect(i.familyId).toBe('fam-A');
    expect(i.createdBy).toBe('uid-parent');
    expect(i.dueDate).toBe('2026-06-02');
  });
});

describe('ChoresRoute — parent service wiring', () => {
  beforeEach(() => {
    familyState = {
      familyId: 'fam-A',
      role: 'parent',
      currentUser: sarah,
      members: [sarah, maya],
      loading: false,
    };
  });

  it('approve delegates to choresParentService.approveChore(db, choreId)', async () => {
    const r = mountAt('/chores');
    await act(async () => {
      fireEvent.click(r.getByText('approve'));
    });
    expect(approveMock).toHaveBeenCalledWith({ db: { __db: true } }, 'chore-1');
  });

  it('reject delegates to choresParentService.rejectChore(db, choreId, reason)', async () => {
    const r = mountAt('/chores');
    await act(async () => {
      fireEvent.click(r.getByText('reject'));
    });
    expect(rejectMock).toHaveBeenCalledWith({ db: { __db: true } }, 'chore-1', 'too messy');
  });
});

describe('ChoresRoute — member service wiring', () => {
  it('markComplete delegates to choresMemberService.markComplete(db, choreId)', async () => {
    familyState = {
      familyId: 'fam-A',
      role: 'member',
      currentUser: maya,
      members: [sarah, maya],
      loading: false,
    };
    const r = mountAt('/chores');
    await act(async () => {
      fireEvent.click(r.getByText('complete'));
    });
    expect(markCompleteMock).toHaveBeenCalledWith({ db: { __db: true } }, 'chore-2');
  });
});
