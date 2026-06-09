/**
 * Shopping list route — wires the screen to live data + service.
 * Default-exported for React.lazy in AppShell.
 */
import type { ReactElement } from 'react';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { useToast } from '../../hooks/useToast';
import { useTranslation } from 'react-i18next';
import { ShoppingListScreen } from './ShoppingListScreen';
import { useFamilyShoppingList } from './useFamilyShoppingList';
import {
  clearCheckedShoppingItems,
  createShoppingItem,
  deleteShoppingItem,
  setShoppingItemChecked,
  updateShoppingItem,
} from './shoppingListService';

async function resolveDb(): Promise<import('firebase/firestore').Firestore | null> {
  try {
    const { db } = await import('../../firebase/config');
    return db;
  } catch {
    return null;
  }
}

export default function ShoppingListRoute(): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { familyId, currentUser, members } = useFamily();
  const feed = useFamilyShoppingList(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title={t('shopping.title')} />;
  }

  const handleAdd = async (input: { name: string; quantity?: string }): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('shopping.toast.generic'));
      return;
    }
    try {
      await createShoppingItem(
        { db },
        {
          familyId,
          addedBy: currentUser.id,
          name: input.name,
          ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        },
      );
      showToast(t('shopping.toast.added'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('shopping.toast.generic'));
    }
  };

  const handleToggleChecked = async (itemId: string, checked: boolean): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('shopping.toast.generic'));
      return;
    }
    try {
      await setShoppingItemChecked({ db }, itemId, checked, currentUser.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('shopping.toast.generic'));
    }
  };

  const handleEdit = async (
    itemId: string,
    patch: { name?: string; quantity?: string | null; category?: string | null },
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('shopping.toast.generic'));
      return;
    }
    try {
      await updateShoppingItem({ db }, itemId, patch);
      showToast(t('shopping.toast.updated'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('shopping.toast.generic'));
    }
  };

  const handleDelete = async (itemId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('shopping.toast.generic'));
      return;
    }
    try {
      await deleteShoppingItem({ db }, itemId);
      showToast(t('shopping.toast.deleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('shopping.toast.generic'));
    }
  };

  const handleClearChecked = async (ids: string[]): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('shopping.toast.generic'));
      return;
    }
    try {
      await clearCheckedShoppingItems({ db }, ids);
      showToast(t('shopping.toast.cleared'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('shopping.toast.generic'));
    }
  };

  return (
    <ShoppingListScreen
      viewer={{ uid: currentUser.id, name: currentUser.name }}
      members={members}
      nowMs={Date.now()}
      feed={feed}
      onAdd={handleAdd}
      onToggleChecked={handleToggleChecked}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onClearChecked={handleClearChecked}
    />
  );
}
