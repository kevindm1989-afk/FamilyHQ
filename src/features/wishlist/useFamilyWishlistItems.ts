/**
 * Live family wishlist — `wishlistItems` scoped by familyId.
 *
 * Same shape as useFamilyShoppingList / useFamilyTodos: onSnapshot,
 * normalises Timestamp → epoch ms, exposes `{items, loading, error}`.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { wishlistItemConverter } from '../../lib/converters';
import type { WishlistItem } from '../../lib/types';
import type { WishlistItemWithId } from './wishlistService';

export interface UseFamilyWishlistItemsResult {
  items: WishlistItemWithId[];
  loading: boolean;
  error: string | null;
}

const LOAD_ERROR = 'We could not load the wishlist. Please try again.';

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'number') return value;
  return Date.now();
}

function toItem(snap: QueryDocumentSnapshot<WishlistItem>): WishlistItemWithId {
  const data = snap.data() as WishlistItem & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

function buildQuery(db: Firestore, familyId: string) {
  return query(
    collection(db, 'wishlistItems').withConverter(wishlistItemConverter),
    where('familyId', '==', familyId),
  );
}

export function useFamilyWishlistItems(familyId: string | null): UseFamilyWishlistItemsResult {
  const [items, setItems] = useState<WishlistItemWithId[]>([]);
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems([]);
    if (familyId === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        unsub = onSnapshot(
          buildQuery(db, familyId),
          (snap) => {
            setItems(snap.docs.map(toItem));
            setLoading(false);
            setError(null);
          },
          () => {
            setItems([]);
            setLoading(false);
            setError(LOAD_ERROR);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(LOAD_ERROR);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  return { items, loading, error };
}
