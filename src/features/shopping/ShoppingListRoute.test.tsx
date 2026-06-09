/**
 * ShoppingListRoute — integration contract.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

let mockFeed: { items: unknown[]; loading: boolean; error: string | null } = {
  items: [],
  loading: false,
  error: null,
};
vi.mock('./useFamilyShoppingList', () => ({
  useFamilyShoppingList: () => mockFeed,
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

const createMock = vi.fn(async (..._args: unknown[]) => 'new-id');
const setCheckedMock = vi.fn(async (..._args: unknown[]) => undefined);
const updateMock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteMock = vi.fn(async (..._args: unknown[]) => undefined);
const clearMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('./shoppingListService', async () => {
  const actual = await vi.importActual<typeof import('./shoppingListService')>(
    './shoppingListService',
  );
  return {
    ...actual,
    createShoppingItem: (a: unknown, b: unknown) => createMock(a, b),
    setShoppingItemChecked: (a: unknown, b: unknown, c: unknown, d: unknown) =>
      setCheckedMock(a, b, c, d),
    updateShoppingItem: (a: unknown, b: unknown, c: unknown) => updateMock(a, b, c),
    deleteShoppingItem: (a: unknown, b: unknown) => deleteMock(a, b),
    clearCheckedShoppingItems: (a: unknown, b: unknown) => clearMock(a, b),
  };
});

import ShoppingListRoute from './ShoppingListRoute';

afterEach(() => {
  vi.clearAllMocks();
  mockFeed = { items: [], loading: false, error: null };
});

describe('ShoppingListRoute', () => {
  it('renders the heading', () => {
    render(<ShoppingListRoute />);
    expect(screen.getByRole('heading', { level: 1, name: /shopping list/i })).toBeInTheDocument();
  });

  it('falls back to Placeholder when family is not loaded', () => {
    familyState = { familyId: null, role: null, currentUser: null, members: [], loading: false };
    render(<ShoppingListRoute />);
    expect(screen.getByRole('heading', { level: 1, name: /shopping list/i })).toBeInTheDocument();
    familyState = {
      familyId: memberUser.familyId,
      role: memberUser.role,
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
  });

  it('inline-add calls createShoppingItem with familyId + addedBy bound to viewer', async () => {
    render(<ShoppingListRoute />);
    fireEvent.change(screen.getByLabelText(/add an item/i), { target: { value: 'Bananas' } });
    fireEvent.submit(screen.getByRole('button', { name: /^add$/i }).closest('form')!);
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = createMock.mock.calls[0] as [
      unknown,
      { familyId: string; addedBy: string; name: string },
    ];
    expect(payload.familyId).toBe(memberUser.familyId);
    expect(payload.addedBy).toBe(memberUser.id);
    expect(payload.name).toBe('Bananas');
  });

  it('checkbox toggle calls setShoppingItemChecked with the viewer uid', async () => {
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: memberUser.familyId,
          addedBy: memberUser.id,
          name: 'Milk',
          isChecked: false,
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<ShoppingListRoute />);
    fireEvent.click(screen.getByRole('checkbox', { name: /check off milk/i }));
    await waitFor(() => {
      expect(setCheckedMock).toHaveBeenCalledWith(
        { db: { __db: true } },
        'i-1',
        true,
        memberUser.id,
      );
    });
  });

  it('per-row Delete calls deleteShoppingItem', async () => {
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: memberUser.familyId,
          addedBy: memberUser.id,
          name: 'Milk',
          isChecked: false,
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<ShoppingListRoute />);
    fireEvent.click(screen.getByRole('button', { name: /delete milk/i }));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith({ db: { __db: true } }, 'i-1');
    });
  });

  it('Clear checked dispatches clearCheckedShoppingItems with every checked id', async () => {
    mockFeed = {
      items: [
        {
          id: 'a',
          familyId: memberUser.familyId,
          addedBy: memberUser.id,
          name: 'A',
          isChecked: true,
          checkedAt: 100,
          createdAt: 1000,
        },
        {
          id: 'b',
          familyId: memberUser.familyId,
          addedBy: memberUser.id,
          name: 'B',
          isChecked: true,
          checkedAt: 200,
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<ShoppingListRoute />);
    fireEvent.click(screen.getByRole('button', { name: /clear checked/i }));
    await waitFor(() => {
      expect(clearMock).toHaveBeenCalledTimes(1);
    });
    const [, ids] = clearMock.mock.calls[0] as [unknown, string[]];
    expect(new Set(ids)).toEqual(new Set(['a', 'b']));
  });
});
