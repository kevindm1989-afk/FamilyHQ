/**
 * Savings Goals route — Feature 1.
 *
 * Wires the screen to live data. Members see only their own goals; parents
 * see every family goal (the hook owns the scope). All actions resolve
 * Firestore lazily — the route chunk stays Firebase-free at the top level.
 *
 * Default-exported for React.lazy in AppShell.
 */
import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../app/Placeholder';
import { useToast } from '../../hooks/useToast';
import { useFamily } from '../../hooks/useFamily';
import { SavingsGoalsScreen } from './SavingsGoalsScreen';
import { useFamilySavingsGoals } from './useFamilySavingsGoals';

async function resolveDb(): Promise<import('firebase/firestore').Firestore | null> {
  try {
    const { db } = await import('../../firebase/config');
    return db;
  } catch {
    return null;
  }
}

export default function SavingsGoalsRoute(): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { familyId, currentUser, members, role } = useFamily();
  const scope = useMemo(
    () => (currentUser !== null && role !== null ? { role, uid: currentUser.id } : null),
    [currentUser, role],
  );
  const feed = useFamilySavingsGoals(familyId, scope);

  if (!currentUser || !familyId || role === null) {
    return <Placeholder title="Savings" />;
  }

  const isParent = role === 'parent';

  const handleCreate = async (input: {
    title: string;
    targetAmountCents: number;
  }): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('savings.toast.generic'));
      return;
    }
    try {
      const { createSavingsGoal } = await import('./savingsGoalsService');
      await createSavingsGoal(
        { db },
        {
          title: input.title,
          targetAmount: input.targetAmountCents,
          ownerUid: currentUser.id,
          familyId,
        },
      );
      showToast(t('savings.toast.created'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('savings.toast.generic'));
    }
  };

  const handleContribute = async (goalId: string, cents: number): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('savings.toast.generic'));
      return;
    }
    try {
      const { contributeToSavingsGoal } = await import('./savingsGoalsService');
      await contributeToSavingsGoal({ db }, goalId, cents);
      showToast(t('savings.toast.contributed'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('savings.toast.generic'));
    }
  };

  const handleSetStatus = async (
    goalId: string,
    status: 'completed' | 'archived',
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('savings.toast.generic'));
      return;
    }
    try {
      const { setSavingsGoalStatus } = await import('./savingsGoalsService');
      await setSavingsGoalStatus({ db }, goalId, status);
      showToast(
        status === 'completed' ? t('savings.toast.completed') : t('savings.toast.archived'),
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('savings.toast.generic'));
    }
  };

  const handleDelete = async (goalId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('savings.toast.generic'));
      return;
    }
    try {
      const { deleteSavingsGoal } = await import('./savingsGoalsService');
      await deleteSavingsGoal({ db }, goalId);
      showToast(t('savings.toast.deleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('savings.toast.generic'));
    }
  };

  return (
    <SavingsGoalsScreen
      viewer={{ uid: currentUser.id, name: currentUser.name, role }}
      members={members}
      feed={feed}
      onCreate={handleCreate}
      onContribute={handleContribute}
      {...(isParent
        ? {
            onComplete: (id: string) => handleSetStatus(id, 'completed'),
            onArchive: (id: string) => handleSetStatus(id, 'archived'),
            onDelete: handleDelete,
          }
        : {})}
    />
  );
}
