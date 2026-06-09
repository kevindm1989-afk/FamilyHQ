/**
 * Birthdays route — wires the BirthdaysScreen to live data + service.
 *
 * Default-exported for React.lazy in AppShell.
 */
import type { ReactElement } from 'react';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { useToast } from '../../hooks/useToast';
import { useTranslation } from 'react-i18next';
import { BirthdaysScreen } from './BirthdaysScreen';
import { useFamilyBirthdays } from './useFamilyBirthdays';
import { createBirthday, deleteBirthday, updateBirthday } from './birthdaysService';
import type { BirthdayType } from '../../lib/types';

async function resolveDb(): Promise<import('firebase/firestore').Firestore | null> {
  try {
    const { db } = await import('../../firebase/config');
    return db;
  } catch {
    return null;
  }
}

export default function BirthdaysRoute(): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { familyId, currentUser } = useFamily();
  const feed = useFamilyBirthdays(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title={t('birthdays.title')} />;
  }

  const handleCreate = async (input: {
    name: string;
    monthDay: string;
    type: BirthdayType;
    birthYear?: number;
    note?: string;
  }): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('birthdays.toast.generic'));
      return;
    }
    try {
      await createBirthday(
        { db },
        {
          familyId,
          createdBy: currentUser.id,
          name: input.name,
          monthDay: input.monthDay,
          type: input.type,
          ...(input.birthYear !== undefined ? { birthYear: input.birthYear } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      );
      showToast(t('birthdays.toast.created'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('birthdays.toast.generic'));
    }
  };

  const handleEdit = async (
    id: string,
    patch: {
      name?: string;
      monthDay?: string;
      type?: BirthdayType;
      birthYear?: number | null;
      note?: string | null;
    },
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('birthdays.toast.generic'));
      return;
    }
    try {
      await updateBirthday({ db }, id, patch);
      showToast(t('birthdays.toast.updated'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('birthdays.toast.generic'));
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('birthdays.toast.generic'));
      return;
    }
    try {
      await deleteBirthday({ db }, id);
      showToast(t('birthdays.toast.deleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('birthdays.toast.generic'));
    }
  };

  return (
    <BirthdaysScreen
      feed={feed}
      onCreate={handleCreate}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  );
}
