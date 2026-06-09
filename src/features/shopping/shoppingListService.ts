/**
 * Shopping list service — shared family list.
 *
 * Thin client-side wrapper over `shoppingItems/{itemId}`. Authority: ANY
 * active same-family caller has full CRUD (firestore.rules — see
 * test/rules/shoppingItems.test.ts).
 *
 * Item id = a Firestore-generated doc id. We use `addDoc` (auto-id) rather
 * than `setDoc` (caller-named id) so the checkout-time concurrency of
 * "two members add 'Milk' at the same moment" produces two distinct
 * docs rather than overwriting each other.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { shoppingItemConverter } from '../../lib/converters';
import type { ShoppingItem } from '../../lib/types';

const COLLECTION = 'shoppingItems';

export const SHOPPING_NAME_MAX = 200;
export const SHOPPING_QUANTITY_MAX = 80;
export const SHOPPING_CATEGORY_MAX = 40;

export const SHOPPING_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const SHOPPING_NAME_EMPTY = 'Please enter an item name.';
export const SHOPPING_NAME_TOO_LONG = `Keep the item name under ${SHOPPING_NAME_MAX} characters.`;
export const SHOPPING_QUANTITY_TOO_LONG = `Keep the quantity under ${SHOPPING_QUANTITY_MAX} characters.`;
export const SHOPPING_CATEGORY_TOO_LONG = `Keep the category under ${SHOPPING_CATEGORY_MAX} characters.`;

export class ShoppingActionError extends Error {
  constructor(message: string = SHOPPING_GENERIC_ERROR) {
    super(message);
    this.name = 'ShoppingActionError';
  }
}

export interface ShoppingItemWithId extends ShoppingItem {
  id: string;
}

export interface CreateShoppingItemInput {
  familyId: string;
  addedBy: string;
  name: string;
  quantity?: string;
  category?: string;
}

export async function createShoppingItem(
  deps: { db: Firestore },
  input: CreateShoppingItemInput,
): Promise<string> {
  const name = input.name.trim();
  if (name.length === 0) throw new ShoppingActionError(SHOPPING_NAME_EMPTY);
  if (name.length > SHOPPING_NAME_MAX) throw new ShoppingActionError(SHOPPING_NAME_TOO_LONG);
  let quantity: string | undefined;
  if (typeof input.quantity === 'string') {
    const trimmed = input.quantity.trim();
    if (trimmed.length > SHOPPING_QUANTITY_MAX) {
      throw new ShoppingActionError(SHOPPING_QUANTITY_TOO_LONG);
    }
    if (trimmed.length > 0) quantity = trimmed;
  }
  let category: string | undefined;
  if (typeof input.category === 'string') {
    const trimmed = input.category.trim();
    if (trimmed.length > SHOPPING_CATEGORY_MAX) {
      throw new ShoppingActionError(SHOPPING_CATEGORY_TOO_LONG);
    }
    if (trimmed.length > 0) category = trimmed;
  }

  const body = {
    familyId: input.familyId,
    addedBy: input.addedBy,
    name,
    isChecked: false,
    createdAt: Date.now(),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(category !== undefined ? { category } : {}),
  };
  try {
    const ref = await addDoc(
      collection(deps.db, COLLECTION).withConverter(shoppingItemConverter),
      body as unknown as ShoppingItem,
    );
    return ref.id;
  } catch {
    throw new ShoppingActionError();
  }
}

export interface UpdateShoppingItemInput {
  name?: string;
  quantity?: string | null;
  category?: string | null;
}

export async function updateShoppingItem(
  deps: { db: Firestore },
  itemId: string,
  input: UpdateShoppingItemInput,
): Promise<void> {
  const patch: { [k: string]: unknown } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) throw new ShoppingActionError(SHOPPING_NAME_EMPTY);
    if (name.length > SHOPPING_NAME_MAX) throw new ShoppingActionError(SHOPPING_NAME_TOO_LONG);
    patch.name = name;
  }
  if (input.quantity === null || input.quantity === '') {
    patch.quantity = deleteField();
  } else if (typeof input.quantity === 'string') {
    const trimmed = input.quantity.trim();
    if (trimmed.length > SHOPPING_QUANTITY_MAX) {
      throw new ShoppingActionError(SHOPPING_QUANTITY_TOO_LONG);
    }
    patch.quantity = trimmed;
  }
  if (input.category === null || input.category === '') {
    patch.category = deleteField();
  } else if (typeof input.category === 'string') {
    const trimmed = input.category.trim();
    if (trimmed.length > SHOPPING_CATEGORY_MAX) {
      throw new ShoppingActionError(SHOPPING_CATEGORY_TOO_LONG);
    }
    patch.category = trimmed;
  }
  if (Object.keys(patch).length === 0) return;
  try {
    await updateDoc(
      doc(deps.db, COLLECTION, itemId),
      patch as unknown as { [k: string]: string | number },
    );
  } catch {
    throw new ShoppingActionError();
  }
}

/**
 * Toggle `isChecked` + pair with `checkedAt` + `checkedBy`. When unchecking
 * both are cleared with `deleteField()` so the UI never shows stale
 * "checked by Maya 3 days ago" text on an item someone re-opened.
 */
export async function setShoppingItemChecked(
  deps: { db: Firestore },
  itemId: string,
  checked: boolean,
  by: string,
): Promise<void> {
  try {
    await updateDoc(doc(deps.db, COLLECTION, itemId), {
      isChecked: checked,
      ...(checked
        ? { checkedAt: Date.now(), checkedBy: by }
        : { checkedAt: deleteField(), checkedBy: deleteField() }),
    } as unknown as { [k: string]: number | boolean | string });
  } catch {
    throw new ShoppingActionError();
  }
}

export async function deleteShoppingItem(deps: { db: Firestore }, itemId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, COLLECTION, itemId));
  } catch {
    throw new ShoppingActionError();
  }
}

/**
 * Sweep all checked items off the list — the "Clear checked" affordance
 * at the bottom of the screen. Deletes one-at-a-time client-side; if any
 * delete fails we throw the first error but the others may have already
 * landed (that's OK — the next refresh resyncs the list).
 */
export async function clearCheckedShoppingItems(
  deps: { db: Firestore },
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  try {
    await Promise.all(ids.map((id) => deleteDoc(doc(deps.db, COLLECTION, id))));
  } catch {
    throw new ShoppingActionError();
  }
}
