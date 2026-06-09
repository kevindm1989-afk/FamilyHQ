/**
 * Unit-level contract for the shopping list service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addDocMock = vi.fn();
const updateDocMock = vi.fn();
const deleteDocMock = vi.fn();
const deleteFieldSentinel = { __sentinel: 'deleteField' };

vi.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => addDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  collection: (_db: unknown, name: string) => ({
    __ref: `col:${name}`,
    withConverter: () => ({ __ref: `col:${name}` }),
  }),
  doc: (_db: unknown, name: string, id: string) => ({ __ref: `doc:${name}/${id}` }),
  deleteField: () => deleteFieldSentinel,
}));

vi.mock('../../lib/converters', () => ({
  shoppingItemConverter: { __converter: 'shoppingItem' },
}));

import {
  SHOPPING_NAME_EMPTY,
  ShoppingActionError,
  clearCheckedShoppingItems,
  createShoppingItem,
  deleteShoppingItem,
  setShoppingItemChecked,
  updateShoppingItem,
} from './shoppingListService';

const db = { __db: true } as unknown as import('firebase/firestore').Firestore;

beforeEach(() => {
  addDocMock.mockReset();
  updateDocMock.mockReset();
  deleteDocMock.mockReset();
  addDocMock.mockResolvedValue({ id: 'gen' });
  updateDocMock.mockResolvedValue(undefined);
  deleteDocMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createShoppingItem — validation', () => {
  it('rejects empty name without writing', async () => {
    await expect(
      createShoppingItem({ db }, { familyId: 'fam-A', addedBy: 'uid-a', name: '   ' }),
    ).rejects.toMatchObject({ message: SHOPPING_NAME_EMPTY });
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects oversized name without writing', async () => {
    await expect(
      createShoppingItem(
        { db },
        { familyId: 'fam-A', addedBy: 'uid-a', name: 'a'.repeat(201) },
      ),
    ).rejects.toBeInstanceOf(ShoppingActionError);
  });
});

describe('createShoppingItem — body shape', () => {
  it('writes the closed key set with isChecked=false', async () => {
    await createShoppingItem(
      { db },
      { familyId: 'fam-A', addedBy: 'uid-a', name: '  Milk  ' },
    );
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(Object.keys(body).sort()).toEqual(
      ['addedBy', 'createdAt', 'familyId', 'isChecked', 'name'].sort(),
    );
    expect(body.name).toBe('Milk');
    expect(body.isChecked).toBe(false);
  });

  it('includes optional quantity + category when supplied', async () => {
    await createShoppingItem(
      { db },
      {
        familyId: 'fam-A',
        addedBy: 'uid-a',
        name: 'Milk',
        quantity: '2 gallons',
        category: 'dairy',
      },
    );
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(body.quantity).toBe('2 gallons');
    expect(body.category).toBe('dairy');
  });

  it('omits empty-trimmed quantity/category from the body', async () => {
    await createShoppingItem(
      { db },
      { familyId: 'fam-A', addedBy: 'uid-a', name: 'Milk', quantity: '  ', category: '  ' },
    );
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect('quantity' in body).toBe(false);
    expect('category' in body).toBe(false);
  });

  it('maps Firestore failure to ShoppingActionError', async () => {
    addDocMock.mockRejectedValueOnce(new Error('FIRESTORE/permission-denied'));
    await expect(
      createShoppingItem({ db }, { familyId: 'fam-A', addedBy: 'uid-a', name: 'x' }),
    ).rejects.toBeInstanceOf(ShoppingActionError);
  });
});

describe('updateShoppingItem', () => {
  it('writes a trimmed name patch', async () => {
    await updateShoppingItem({ db }, 'i-1', { name: '  Renamed  ' });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:shoppingItems/i-1' }, {
      name: 'Renamed',
    });
  });

  it('rejects empty-trimmed name', async () => {
    await expect(updateShoppingItem({ db }, 'i-1', { name: '   ' })).rejects.toBeInstanceOf(
      ShoppingActionError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('clears quantity with deleteField() when null', async () => {
    await updateShoppingItem({ db }, 'i-1', { quantity: null });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:shoppingItems/i-1' }, {
      quantity: deleteFieldSentinel,
    });
  });

  it('clears category with deleteField() when null', async () => {
    await updateShoppingItem({ db }, 'i-1', { category: null });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:shoppingItems/i-1' }, {
      category: deleteFieldSentinel,
    });
  });

  it('does NOT write if there is no patch', async () => {
    await updateShoppingItem({ db }, 'i-1', {});
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('setShoppingItemChecked', () => {
  it('writes isChecked=true paired with checkedAt + checkedBy', async () => {
    await setShoppingItemChecked({ db }, 'i-1', true, 'uid-a');
    const call = updateDocMock.mock.calls[0];
    if (call === undefined) throw new Error('updateDoc not called');
    const [, patch] = call as [unknown, Record<string, unknown>];
    expect(patch.isChecked).toBe(true);
    expect(typeof patch.checkedAt).toBe('number');
    expect(patch.checkedBy).toBe('uid-a');
  });

  it('clears checkedAt + checkedBy with deleteField() on un-check', async () => {
    await setShoppingItemChecked({ db }, 'i-1', false, 'uid-a');
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:shoppingItems/i-1' },
      {
        isChecked: false,
        checkedAt: deleteFieldSentinel,
        checkedBy: deleteFieldSentinel,
      },
    );
  });
});

describe('deleteShoppingItem', () => {
  it('calls deleteDoc on the matching ref', async () => {
    await deleteShoppingItem({ db }, 'i-1');
    expect(deleteDocMock).toHaveBeenCalledWith({ __ref: 'doc:shoppingItems/i-1' });
  });
});

describe('clearCheckedShoppingItems', () => {
  it('deletes every id passed in (no-op on empty array)', async () => {
    await clearCheckedShoppingItems({ db }, []);
    expect(deleteDocMock).not.toHaveBeenCalled();
    await clearCheckedShoppingItems({ db }, ['a', 'b', 'c']);
    expect(deleteDocMock).toHaveBeenCalledTimes(3);
  });

  it('maps Firestore failure to ShoppingActionError', async () => {
    deleteDocMock.mockRejectedValueOnce(new Error('boom'));
    await expect(clearCheckedShoppingItems({ db }, ['a'])).rejects.toBeInstanceOf(
      ShoppingActionError,
    );
  });
});
