/**
 * Wishlist route — wires WishlistScreen to live data + the wishlist service.
 *
 * Default-exported for React.lazy in AppShell. firestore.rules is the
 * authority; the route just dispatches viewer actions to the service.
 */
import type { ReactElement } from 'react';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { useTranslation } from 'react-i18next';
import { WishlistScreen } from './WishlistScreen';
import { useFamilyWishlistItems } from './useFamilyWishlistItems';
import {
  approveRedemption,
  cancelRedemption,
  createWishlistItem,
  deleteWishlistItem,
  denyRedemption,
  requestRedemption,
  updateWishlistItem,
} from './wishlistService';

async function resolveDb(): Promise<import('firebase/firestore').Firestore | null> {
  try {
    const { db } = await import('../../firebase/config');
    return db;
  } catch {
    return null;
  }
}

export default function WishlistRoute(): ReactElement {
  const { t } = useTranslation();
  const { familyId, currentUser, members } = useFamily();
  const feed = useFamilyWishlistItems(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title={t('wishlist.title')} />;
  }

  const viewer = {
    uid: currentUser.id,
    name: currentUser.name,
    role: currentUser.role,
  };

  const handleCreate = async (input: { title: string; costCents: number }): Promise<void> => {
    const db = await resolveDb();
    if (db === null) return;
    await createWishlistItem(
      { db },
      {
        familyId,
        ownerUid: viewer.uid,
        title: input.title,
        costCents: input.costCents,
      },
    );
  };

  const handleUpdate = async (
    itemId: string,
    patch: { title?: string; costCents?: number },
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) return;
    await updateWishlistItem({ db }, itemId, patch);
  };

  const handleDelete = async (itemId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) return;
    await deleteWishlistItem({ db }, itemId);
  };

  const handleRequest = async (itemId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) return;
    await requestRedemption({ db }, itemId);
  };

  const handleCancelRequest = async (itemId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) return;
    await cancelRedemption({ db }, itemId);
  };

  const handleApprove = async (itemId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) return;
    await approveRedemption({ db }, itemId);
  };

  const handleDeny = async (itemId: string, reason: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) return;
    await denyRedemption({ db }, itemId, reason);
  };

  const isParent = viewer.role === 'parent';

  return (
    <WishlistScreen
      viewer={viewer}
      members={members}
      feed={feed}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onRequest={handleRequest}
      onCancelRequest={handleCancelRequest}
      {...(isParent ? { onApprove: handleApprove, onDeny: handleDeny } : {})}
    />
  );
}
