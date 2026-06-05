/**
 * TodoListPanel — props-injected screen contract.
 *
 * Pins:
 *  - The four buckets render with their correct labels + EmptyState text.
 *  - A complete-state todo lands in "Recently completed" + reads
 *    line-through (the visible "done" signal).
 *  - The checkbox onChange fires onToggle with the new isCompleted flag.
 *  - The "+ New" FAB opens the create sheet; the sheet's submit calls
 *    onCreate with the trimmed title + only the optional fields the user
 *    actually filled in.
 *  - A member viewer + a parent viewer see the SAME affordances (UI is
 *    not role-gated; rules are the boundary).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';
import { TodoListPanel } from './TodoListPanel';
import type { TodoWithId } from './todosService';

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
  allowanceBalance: 0,
  theme: 'light',
};

function mkTodo(over: Partial<TodoWithId> & { id: string }): TodoWithId {
  return {
    familyId: 'fam-A',
    createdBy: MAYA.id,
    title: 'Walk the dog',
    isCompleted: false,
    createdAt: 1000,
    ...over,
  };
}

const NOW = new Date(2026, 5, 5, 12, 0, 0); // 2026-06-05 local noon

function renderPanel(
  overrides: Partial<Parameters<typeof TodoListPanel>[0]> = {},
): ReturnType<typeof render> {
  const viewer: { uid: string; name: string; role: Role } = overrides.viewer ?? {
    uid: MAYA.id,
    name: MAYA.name,
    role: MAYA.role,
  };
  const members = overrides.members ?? [SARAH, MAYA];
  const feed = overrides.feed ?? { todos: [], loading: false, error: null };
  return render(
    <TodoListPanel
      viewer={viewer}
      members={members}
      feed={feed}
      now={NOW}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('TodoListPanel — state machine', () => {
  it('renders the Skeleton when loading', () => {
    renderPanel({ feed: { todos: [], loading: true, error: null } });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an inline error (NEVER a toast) when the feed errored', () => {
    renderPanel({
      feed: { todos: [], loading: false, error: 'We could not load to-dos. Please try again.' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
  });

  it('renders the all-empty copy when there are zero todos', () => {
    renderPanel({ feed: { todos: [], loading: false, error: null } });
    expect(screen.getByText(/no to-dos yet/i)).toBeInTheDocument();
  });
});

describe('TodoListPanel — buckets', () => {
  it('routes a past dueDate todo into Overdue', () => {
    renderPanel({
      feed: {
        todos: [mkTodo({ id: 't-overdue', title: 'Pay bill', dueDate: '2026-06-01' })],
        loading: false,
        error: null,
      },
    });
    const overdue = screen.getByRole('region', { name: /^overdue$/i });
    expect(within(overdue).getByText(/pay bill/i)).toBeInTheDocument();
  });

  it('routes a today / future dueDate todo into "With deadlines"', () => {
    renderPanel({
      feed: {
        todos: [mkTodo({ id: 't-up', title: 'Soccer practice', dueDate: '2026-06-10' })],
        loading: false,
        error: null,
      },
    });
    const upcoming = screen.getByRole('region', { name: /with deadlines/i });
    expect(within(upcoming).getByText(/soccer practice/i)).toBeInTheDocument();
  });

  it('routes a no-dueDate todo into "Someday / No deadline"', () => {
    renderPanel({
      feed: {
        todos: [mkTodo({ id: 't-someday', title: 'Clean garage' })],
        loading: false,
        error: null,
      },
    });
    const someday = screen.getByRole('region', { name: /someday/i });
    expect(within(someday).getByText(/clean garage/i)).toBeInTheDocument();
  });

  it('routes a completed todo into "Recently completed" with the done styling', () => {
    renderPanel({
      feed: {
        todos: [
          mkTodo({ id: 't-done', title: 'Brush teeth', isCompleted: true, completedAt: 9999 }),
        ],
        loading: false,
        error: null,
      },
    });
    const done = screen.getByRole('region', { name: /recently completed/i });
    expect(within(done).getByText(/brush teeth/i).className).toMatch(/line-through/);
  });
});

describe('TodoListPanel — toggle', () => {
  it('fires onToggle(id, true) when an incomplete row is checked', () => {
    const onToggle = vi.fn(async () => undefined);
    renderPanel({
      feed: {
        todos: [mkTodo({ id: 't-1', title: 'Pack lunch' })],
        loading: false,
        error: null,
      },
      onToggle,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /mark pack lunch complete/i }));
    expect(onToggle).toHaveBeenCalledWith('t-1', true);
  });

  it('fires onToggle(id, false) when a complete row is unchecked', () => {
    const onToggle = vi.fn(async () => undefined);
    renderPanel({
      feed: {
        todos: [
          mkTodo({ id: 't-1', title: 'Pack lunch', isCompleted: true, completedAt: 1 }),
        ],
        loading: false,
        error: null,
      },
      onToggle,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /mark pack lunch incomplete/i }));
    expect(onToggle).toHaveBeenCalledWith('t-1', false);
  });
});

describe('TodoListPanel — create', () => {
  it('shows the "+ New to-do" FAB only when onCreate is provided', () => {
    const { rerender } = renderPanel({});
    expect(screen.queryByRole('button', { name: /new to-do/i })).not.toBeInTheDocument();
    rerender(
      <TodoListPanel
        viewer={{ uid: MAYA.id, name: MAYA.name, role: MAYA.role }}
        members={[SARAH, MAYA]}
        feed={{ todos: [], loading: false, error: null }}
        now={NOW}
        onCreate={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByRole('button', { name: /new to-do/i })).toBeInTheDocument();
  });

  it('opens the sheet on FAB tap and submits the trimmed title + only filled optional fields', async () => {
    const onCreate = vi.fn(async () => undefined);
    renderPanel({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /new to-do/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText(/what needs doing/i), {
      target: { value: '  Pick up groceries  ' },
    });
    fireEvent.submit(within(sheet).getByRole('button', { name: /add to-do/i }).closest('form')!);
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({ title: 'Pick up groceries' });
    });
  });

  it('shows an inline error when the title is empty (no onCreate call)', async () => {
    const onCreate = vi.fn(async () => undefined);
    renderPanel({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /new to-do/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.submit(within(sheet).getByRole('button', { name: /add to-do/i }).closest('form')!);
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/please enter a title/i);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('TodoListPanel — edit sheet', () => {
  it('opens the Edit sheet with the row pre-filled and submits only the changed patch', async () => {
    const onEdit = vi.fn(async () => undefined);
    renderPanel({
      feed: {
        todos: [
          mkTodo({
            id: 't-1',
            title: 'Walk the dog',
            description: 'around the block',
            dueDate: '2026-06-10',
          }),
        ],
        loading: false,
        error: null,
      },
      onEdit,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit walk the dog/i }));
    const sheet = await screen.findByRole('dialog');
    // Title input is pre-filled.
    const titleInput = within(sheet).getByLabelText(/what needs doing/i) as HTMLInputElement;
    expect(titleInput.value).toBe('Walk the dog');
    // Change only the title; everything else should be omitted from the patch.
    fireEvent.change(titleInput, { target: { value: 'Walk the dog twice' } });
    fireEvent.submit(within(sheet).getByRole('button', { name: /save changes/i }).closest('form')!);
    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledWith('t-1', { title: 'Walk the dog twice' });
    });
  });

  it('does NOT render the Edit button on a completed todo (only the checkbox + Delete)', () => {
    renderPanel({
      feed: {
        todos: [
          mkTodo({ id: 't-1', title: 'Done', isCompleted: true, completedAt: 1 }),
        ],
        loading: false,
        error: null,
      },
      onEdit: vi.fn(async () => undefined),
      onToggle: vi.fn(async () => undefined),
    });
    expect(screen.queryByRole('button', { name: /edit done/i })).not.toBeInTheDocument();
  });
});

describe('TodoListPanel — role parity (UI is not gated by role)', () => {
  it('a member viewer sees the create FAB + delete control', () => {
    renderPanel({
      viewer: { uid: MAYA.id, name: MAYA.name, role: MAYA.role },
      feed: {
        todos: [mkTodo({ id: 't-1', title: 'Walk the dog' })],
        loading: false,
        error: null,
      },
      onCreate: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
    });
    expect(screen.getByRole('button', { name: /new to-do/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete walk the dog/i }),
    ).toBeInTheDocument();
  });

  it('a parent viewer sees the SAME affordances (no extra parent-only ones)', () => {
    renderPanel({
      viewer: { uid: SARAH.id, name: SARAH.name, role: SARAH.role },
      feed: {
        todos: [mkTodo({ id: 't-1', title: 'Walk the dog' })],
        loading: false,
        error: null,
      },
      onCreate: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
    });
    expect(screen.getByRole('button', { name: /new to-do/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete walk the dog/i }),
    ).toBeInTheDocument();
  });
});
