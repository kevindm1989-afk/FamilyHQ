/**
 * TasksRoute — integration contract.
 *
 * Pins the two-tab shell wiring (To-Do List + Routine Checklists) and the
 * Placeholder content for the Routines tab (PR C swaps it for the real
 * editor).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';

const memberUser: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
} = {
  familyId: memberUser.familyId,
  role: memberUser.role,
  currentUser: memberUser,
  members: [memberUser],
  loading: false,
};

vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => familyState,
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock the live feed so no Firebase is touched.
let mockFeed: { todos: unknown[]; loading: boolean; error: string | null } = {
  todos: [],
  loading: false,
  error: null,
};
vi.mock('./useFamilyTodos', () => ({
  useFamilyTodos: () => mockFeed,
}));

// Stub the routines feeds — PR C wires them, but the To-Do tab is the default
// surface these tests exercise. Tests that switch to the Routines tab assert
// the empty / wired states from these fixtures.
let mockTemplatesFeed: {
  templates: unknown[];
  loading: boolean;
  error: string | null;
} = { templates: [], loading: false, error: null };
let mockInstancesFeed: {
  instances: unknown[];
  loading: boolean;
  error: string | null;
} = { instances: [], loading: false, error: null };
vi.mock('./useFamilyChecklistTemplates', () => ({
  useFamilyChecklistTemplates: () => mockTemplatesFeed,
}));
vi.mock('./useFamilyChecklistInstances', () => ({
  useFamilyChecklistInstances: () => mockInstancesFeed,
}));

// Mock firebase/config so the route's lazy resolveDb() never touches Firebase.
vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

// Spy on the services so we can assert call shape without hitting Firestore.
const createTodoMock = vi.fn(async (..._args: unknown[]) => 'new-id');
const updateTodoMock = vi.fn(async (..._args: unknown[]) => undefined);
const setTodoCompletionMock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteTodoMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('./todosService', async () => {
  const actual = await vi.importActual<typeof import('./todosService')>('./todosService');
  return {
    ...actual,
    createTodo: (a: unknown, b: unknown) => createTodoMock(a, b),
    updateTodo: (a: unknown, b: unknown, c: unknown) => updateTodoMock(a, b, c),
    setTodoCompletion: (a: unknown, b: unknown, c: unknown) => setTodoCompletionMock(a, b, c),
    deleteTodo: (a: unknown, b: unknown) => deleteTodoMock(a, b),
  };
});

// Spy on the checklist services. These cover the Routines tab dispatch.
const createTemplateMock = vi.fn(async (..._args: unknown[]) => 'tpl-new');
const updateTemplateMock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteTemplateMock = vi.fn(async (..._args: unknown[]) => undefined);
const startInstanceMock = vi.fn(async (..._args: unknown[]) => 'inst-new');
const setInstanceItemProgressMock = vi.fn(async (..._args: unknown[]) => undefined);
const setInstanceCompletionMock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteInstanceMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('./checklistsService', async () => {
  const actual = await vi.importActual<typeof import('./checklistsService')>(
    './checklistsService',
  );
  return {
    ...actual,
    createTemplate: (a: unknown, b: unknown) => createTemplateMock(a, b),
    updateTemplate: (a: unknown, b: unknown, c: unknown) => updateTemplateMock(a, b, c),
    deleteTemplate: (a: unknown, b: unknown) => deleteTemplateMock(a, b),
    startInstance: (a: unknown, b: unknown) => startInstanceMock(a, b),
    setInstanceItemProgress: (a: unknown, b: unknown, c: unknown, d: unknown) =>
      setInstanceItemProgressMock(a, b, c, d),
    setInstanceCompletion: (a: unknown, b: unknown, c: unknown) =>
      setInstanceCompletionMock(a, b, c),
    deleteInstance: (a: unknown, b: unknown) => deleteInstanceMock(a, b),
  };
});

import TasksRoute from './TasksRoute';

afterEach(() => {
  vi.clearAllMocks();
  mockFeed = { todos: [], loading: false, error: null };
  mockTemplatesFeed = { templates: [], loading: false, error: null };
  mockInstancesFeed = { instances: [], loading: false, error: null };
});

function renderRoute() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/tasks']}
    >
      <TasksRoute />
    </MemoryRouter>,
  );
}

describe('TasksRoute', () => {
  it('renders the screen heading', () => {
    renderRoute();
    expect(screen.getByRole('heading', { level: 1, name: /^tasks$/i })).toBeInTheDocument();
  });

  it('renders both tabs in a role=tablist, To-Do selected by default', () => {
    renderRoute();
    const tablist = screen.getByRole('tablist');
    const todos = screen.getByRole('tab', { name: /to-do list/i });
    const routines = screen.getByRole('tab', { name: /routine checklists/i });
    expect(tablist).toContainElement(todos);
    expect(tablist).toContainElement(routines);
    expect(todos).toHaveAttribute('aria-selected', 'true');
    expect(routines).toHaveAttribute('aria-selected', 'false');
  });

  it('renders the To-Do panel on the default tab', () => {
    renderRoute();
    expect(screen.getByRole('region', { name: /family to-do list/i })).toBeInTheDocument();
  });

  it('switches to the Routines tab and renders the RoutinesPanel', () => {
    renderRoute();
    fireEvent.click(screen.getByRole('tab', { name: /routine checklists/i }));
    expect(screen.getByRole('tab', { name: /routine checklists/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('region', { name: /routine checklists/i })).toBeInTheDocument();
    // The To-Do panel must not also be rendered (single-tab visible at a time).
    expect(screen.queryByRole('region', { name: /family to-do list/i })).not.toBeInTheDocument();
  });

  it('falls back to a Placeholder when no familyId / currentUser is loaded yet', () => {
    familyState = {
      familyId: null,
      role: null,
      currentUser: null,
      members: [],
      loading: false,
    };
    renderRoute();
    expect(screen.getByRole('heading', { level: 1, name: /^tasks$/i })).toBeInTheDocument();
    // Restore for the next test.
    familyState = {
      familyId: memberUser.familyId,
      role: memberUser.role,
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
  });
});

describe('TasksRoute — wired actions', () => {
  it('calls createTodo with familyId + createdBy bound to the viewer when the FAB sheet is submitted', async () => {
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: /new to-do/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText(/what needs doing/i), {
      target: { value: 'Buy bread' },
    });
    fireEvent.submit(within(sheet).getByRole('button', { name: /add to-do/i }).closest('form')!);
    await waitFor(() => {
      expect(createTodoMock).toHaveBeenCalledWith(
        { db: { __db: true } },
        {
          familyId: memberUser.familyId,
          createdBy: memberUser.id,
          title: 'Buy bread',
        },
      );
    });
  });

  it('calls setTodoCompletion when a checkbox is toggled', async () => {
    mockFeed = {
      todos: [
        {
          id: 't-1',
          familyId: memberUser.familyId,
          createdBy: memberUser.id,
          title: 'Pack lunch',
          isCompleted: false,
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    renderRoute();
    fireEvent.click(screen.getByRole('checkbox', { name: /mark pack lunch complete/i }));
    await waitFor(() => {
      expect(setTodoCompletionMock).toHaveBeenCalledWith({ db: { __db: true } }, 't-1', true);
    });
  });

  it('calls deleteTodo when the per-row delete is tapped', async () => {
    mockFeed = {
      todos: [
        {
          id: 't-1',
          familyId: memberUser.familyId,
          createdBy: memberUser.id,
          title: 'Pack lunch',
          isCompleted: false,
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    renderRoute();
    fireEvent.click(screen.getByRole('button', { name: /delete pack lunch/i }));
    await waitFor(() => {
      expect(deleteTodoMock).toHaveBeenCalledWith({ db: { __db: true } }, 't-1');
    });
  });
});

describe('TasksRoute — wired Routines actions', () => {
  it('calls startInstance with familyId + userId bound to the viewer when Start is tapped', async () => {
    mockTemplatesFeed = {
      templates: [
        {
          id: 'tpl-1',
          familyId: memberUser.familyId,
          createdBy: memberUser.id,
          title: 'Morning',
          isSharedWithFamily: true,
          items: [{ id: 'i1', text: 'Brush' }],
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    renderRoute();
    fireEvent.click(screen.getByRole('tab', { name: /routine checklists/i }));
    fireEvent.click(screen.getByRole('button', { name: /start a run of morning/i }));
    await waitFor(() => {
      expect(startInstanceMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = startInstanceMock.mock.calls[0] as [unknown, {
      familyId: string;
      templateId: string;
      userId: string;
      date: string;
    }];
    expect(payload.familyId).toBe(memberUser.familyId);
    expect(payload.templateId).toBe('tpl-1');
    expect(payload.userId).toBe(memberUser.id);
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('calls setInstanceItemProgress with the dot-path-style (id, itemId, checked) tuple', async () => {
    mockTemplatesFeed = {
      templates: [
        {
          id: 'tpl-1',
          familyId: memberUser.familyId,
          createdBy: memberUser.id,
          title: 'Morning',
          isSharedWithFamily: true,
          items: [{ id: 'i1', text: 'Brush' }],
          createdAt: 1000,
          updatedAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    mockInstancesFeed = {
      instances: [
        {
          id: 'inst-1',
          familyId: memberUser.familyId,
          templateId: 'tpl-1',
          userId: memberUser.id,
          date: '2026-06-05',
          isCompleted: false,
          itemsProgress: {},
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    renderRoute();
    fireEvent.click(screen.getByRole('tab', { name: /routine checklists/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /check off brush/i }));
    await waitFor(() => {
      expect(setInstanceItemProgressMock).toHaveBeenCalledWith(
        { db: { __db: true } },
        'inst-1',
        'i1',
        true,
      );
    });
  });
});
