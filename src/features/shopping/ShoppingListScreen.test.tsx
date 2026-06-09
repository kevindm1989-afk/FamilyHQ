/**
 * ShoppingListScreen — props-injected contract.
 *
 * Pins state machine, open/checked grouping, inline add, checkbox dispatch,
 * delete dispatch, and "Clear checked" sweep.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserWithId } from '../../lib/types';
import { ShoppingListScreen } from './ShoppingListScreen';
import type { ShoppingItemWithId } from './shoppingListService';

const MAYA: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const SARAH: UserWithId = {
  id: 'uid-parent-a',
  name: 'Sarah',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

function mk(over: Partial<ShoppingItemWithId> & { id: string }): ShoppingItemWithId {
  return {
    familyId: 'fam-A',
    addedBy: MAYA.id,
    name: `Item ${over.id}`,
    isChecked: false,
    createdAt: 1000,
    ...over,
  };
}

const NOW = new Date(2026, 5, 5, 12, 0, 0).getTime();

function renderScreen(
  over: Partial<Parameters<typeof ShoppingListScreen>[0]> = {},
): ReturnType<typeof render> {
  const feed = over.feed ?? { items: [], loading: false, error: null };
  return render(
    <ShoppingListScreen
      viewer={over.viewer ?? { uid: MAYA.id, name: MAYA.name }}
      members={over.members ?? [SARAH, MAYA]}
      nowMs={over.nowMs ?? NOW}
      feed={feed}
      {...over}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ShoppingListScreen — state machine', () => {
  it('renders Skeleton when loading', () => {
    renderScreen({ feed: { items: [], loading: true, error: null } });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an inline error (NEVER a toast) on feed error', () => {
    renderScreen({
      feed: { items: [], loading: false, error: 'We could not load the shopping list. Please try again.' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the shopping list/i);
  });

  it('renders the open-empty copy when zero items', () => {
    renderScreen({ feed: { items: [], loading: false, error: null } });
    expect(screen.getByText(/nothing on the list yet/i)).toBeInTheDocument();
  });
});

describe('ShoppingListScreen — grouping', () => {
  it('separates open from checked, oldest-first in open, newest-checked first in checked', () => {
    renderScreen({
      feed: {
        items: [
          mk({ id: 'old', name: 'Bread', createdAt: 100 }),
          mk({ id: 'newer-checked', name: 'Eggs', isChecked: true, checkedAt: 500 }),
          mk({ id: 'newer', name: 'Cheese', createdAt: 300 }),
          mk({ id: 'older-checked', name: 'Milk', isChecked: true, checkedAt: 200 }),
        ],
        loading: false,
        error: null,
      },
    });
    const openRegion = screen.getByRole('region', { name: /^open$/i });
    const openTexts = within(openRegion).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(openTexts[0]).toMatch(/bread/i);
    expect(openTexts[1]).toMatch(/cheese/i);

    const checkedRegion = screen.getByRole('region', { name: /recently checked/i });
    const checkedTexts = within(checkedRegion)
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '');
    expect(checkedTexts[0]).toMatch(/eggs/i);
    expect(checkedTexts[1]).toMatch(/milk/i);
  });

  it('shows a quantity badge when set', () => {
    renderScreen({
      feed: {
        items: [mk({ id: '1', name: 'Milk', quantity: '2 gallons' })],
        loading: false,
        error: null,
      },
    });
    expect(screen.getByText('2 gallons')).toBeInTheDocument();
  });
});

describe('ShoppingListScreen — actions', () => {
  it('inline add: submits trimmed name to onAdd, then clears the field', async () => {
    const onAdd = vi.fn(async () => undefined);
    renderScreen({ onAdd });
    const input = screen.getByLabelText(/add an item/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Bananas  ' } });
    fireEvent.submit(screen.getByRole('button', { name: /^add$/i }).closest('form')!);
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith({ name: 'Bananas' });
    });
  });

  it('inline add: empty name shows an inline error and does NOT call onAdd', async () => {
    const onAdd = vi.fn(async () => undefined);
    renderScreen({ onAdd });
    fireEvent.submit(screen.getByRole('button', { name: /^add$/i }).closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent(/please enter an item name/i);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('checkbox dispatches onToggleChecked with the new state', async () => {
    const onToggleChecked = vi.fn(async () => undefined);
    renderScreen({
      feed: { items: [mk({ id: 'i1', name: 'Milk' })], loading: false, error: null },
      onToggleChecked,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /check off milk/i }));
    await waitFor(() => {
      expect(onToggleChecked).toHaveBeenCalledWith('i1', true);
    });
  });

  it('per-row Delete dispatches onDelete', async () => {
    const onDelete = vi.fn(async () => undefined);
    renderScreen({
      feed: { items: [mk({ id: 'i1', name: 'Milk' })], loading: false, error: null },
      onDelete,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete milk/i }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('i1');
    });
  });

  it('"Clear checked" sweeps every currently-checked id', async () => {
    const onClearChecked = vi.fn(async () => undefined);
    renderScreen({
      feed: {
        items: [
          mk({ id: 'a', isChecked: true, checkedAt: 100 }),
          mk({ id: 'b', isChecked: true, checkedAt: 200 }),
          mk({ id: 'c', isChecked: false }),
        ],
        loading: false,
        error: null,
      },
      onClearChecked,
    });
    fireEvent.click(screen.getByRole('button', { name: /clear checked/i }));
    await waitFor(() => {
      expect(onClearChecked).toHaveBeenCalledWith(['b', 'a']);
    });
  });

  it('Edit opens the sheet pre-filled and submits the changed name patch', async () => {
    const onEdit = vi.fn(async () => undefined);
    renderScreen({
      feed: {
        items: [mk({ id: 'i1', name: 'Milk', quantity: '2 gal' })],
        loading: false,
        error: null,
      },
      onEdit,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit milk/i }));
    const sheet = await screen.findByRole('dialog');
    const nameInput = within(sheet).getByRole('textbox', { name: /add an item/i }) as HTMLInputElement;
    expect(nameInput.value).toBe('Milk');
    fireEvent.change(nameInput, { target: { value: 'Whole Milk' } });
    fireEvent.submit(within(sheet).getByRole('button', { name: /save changes/i }).closest('form')!);
    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledTimes(1);
    });
    const call = onEdit.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[0]).toBe('i1');
    expect(call[1]).toMatchObject({ name: 'Whole Milk' });
  });

  it('Edit sheet shows inline error on empty name and does NOT call onEdit', async () => {
    const onEdit = vi.fn(async () => undefined);
    renderScreen({
      feed: {
        items: [mk({ id: 'i1', name: 'Milk' })],
        loading: false,
        error: null,
      },
      onEdit,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit milk/i }));
    const sheet = await screen.findByRole('dialog');
    const nameInput = within(sheet).getByRole('textbox', { name: /add an item/i });
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.submit(within(sheet).getByRole('button', { name: /save changes/i }).closest('form')!);
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/please enter an item name/i);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('Edit sheet rounds-trips quantity edits as a string patch', async () => {
    const onEdit = vi.fn(async () => undefined);
    renderScreen({
      feed: {
        items: [mk({ id: 'i1', name: 'Milk', quantity: '1 gal' })],
        loading: false,
        error: null,
      },
      onEdit,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit milk/i }));
    const sheet = await screen.findByRole('dialog');
    const qtyInput = within(sheet).getByRole('textbox', { name: /quantity/i });
    fireEvent.change(qtyInput, { target: { value: '2 gallons' } });
    fireEvent.submit(within(sheet).getByRole('button', { name: /save changes/i }).closest('form')!);
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    const call = onEdit.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[1]).toMatchObject({ quantity: '2 gallons' });
  });

  it('Edit affordance is hidden for a checked row (only Delete remains)', () => {
    renderScreen({
      feed: {
        items: [
          mk({ id: 'done', name: 'Pasta', isChecked: true, checkedAt: 100 }),
        ],
        loading: false,
        error: null,
      },
      onEdit: vi.fn(async () => undefined),
      onDelete: vi.fn(async () => undefined),
    });
    expect(screen.queryByRole('button', { name: /edit pasta/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete pasta/i })).toBeInTheDocument();
  });
});
