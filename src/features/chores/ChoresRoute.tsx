/**
 * Chores route — renders the PARENT view (approval queue + filters + balances +
 * Add Chore) for a parent viewer and the MEMBER view (own chores + mark-complete
 * + redo) for a member. Each view subscribes to the only query its role's rule
 * allows: a member to `familyId + assignedTo == self`, a parent to the
 * family-wide `familyId ==` feed (the parent read branch). The add_chore modal
 * route opens the Add Chore sheet over the parent screen. UI branching is
 * cosmetic — firestore.rules is the authoritative boundary.
 *
 * Default-exported for React.lazy in AppShell.
 */
import { useState, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Placeholder } from '../../app/Placeholder';
import { ROUTES } from '../../app/routes';
import { useFamily } from '../../hooks/useFamily';
import { useToast } from '../../hooks/useToast';
import { useTranslation } from 'react-i18next';
import { AddChore, type AddChoreValue } from './AddChore';
import { ChoresMemberScreen } from './ChoresMemberScreen';
import { ChoresParentScreen } from './ChoresParentScreen';
import { useFamilyChores } from './useFamilyChores';
import { useMyChores } from './useMyChores';
import { markComplete, type ChoreWithId } from './choresMemberService';
import {
  addChore,
  approveChore,
  deleteChore,
  editChore,
  rejectChore,
  type CreateChoreInput,
  type EditChoreInput,
} from './choresParentService';

export default function ChoresRoute(): ReactElement {
  const { familyId, currentUser, members, role } = useFamily();
  return role === 'parent' ? (
    <ParentChoresRoute familyId={familyId} currentUser={currentUser} members={members} />
  ) : (
    <MemberChoresRoute familyId={familyId} currentUser={currentUser} />
  );
}

function MemberChoresRoute(props: {
  familyId: string | null;
  currentUser: ReturnType<typeof useFamily>['currentUser'];
}): ReactElement {
  const { familyId, currentUser } = props;
  const navigate = useNavigate();
  const feed = useMyChores(currentUser?.id ?? null, familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Chores" />;
  }

  const viewer = {
    uid: currentUser.id,
    name: currentUser.name,
    role: currentUser.role,
    allowanceBalance: currentUser.allowanceBalance,
  };

  const handleMarkComplete = async (choreId: string): Promise<void> => {
    const { db } = await import('../../firebase/config');
    await markComplete({ db }, choreId);
  };

  const handleMarkCompleteWithProof = async (choreId: string, file: File): Promise<void> => {
    if (familyId === null) return;
    const { db, storage } = await import('../../firebase/config');
    const { markCompleteWithProof } = await import('./chorePhotoService');
    await markCompleteWithProof({ db, storage }, { familyId, choreId, file });
  };

  return (
    <ChoresMemberScreen
      familyId={familyId}
      viewer={viewer}
      feed={feed}
      onMarkComplete={handleMarkComplete}
      onMarkCompleteWithProof={handleMarkCompleteWithProof}
      onViewHistory={() => navigate(ROUTES.allowance.path)}
    />
  );
}

function ParentChoresRoute(props: {
  familyId: string | null;
  currentUser: ReturnType<typeof useFamily>['currentUser'];
  members: ReturnType<typeof useFamily>['members'];
}): ReactElement {
  const { familyId, currentUser, members } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const feed = useFamilyChores(familyId);
  const addOpen = location.pathname === ROUTES.add_chore.path;
  // Edit mode is a local concern (not URL-routed): the parent taps Edit on a
  // chore row, the sheet opens with that chore's values pre-filled, closes
  // on submit or cancel.
  const [editingChore, setEditingChore] = useState<ChoreWithId | null>(null);

  if (!currentUser || !familyId) {
    return <Placeholder title="Chores" />;
  }

  const viewer = { uid: currentUser.id, name: currentUser.name, role: currentUser.role };

  const handleApprove = async (choreId: string): Promise<void> => {
    const { db } = await import('../../firebase/config');
    await approveChore({ db }, choreId, viewer.uid);
  };
  const handleReject = async (choreId: string, reason: string): Promise<void> => {
    const { db } = await import('../../firebase/config');
    await rejectChore({ db }, choreId, reason);
  };
  const handleAdd = async (value: AddChoreValue): Promise<void> => {
    const { db } = await import('../../firebase/config');
    const input: CreateChoreInput = {
      title: value.title,
      assignedTo: value.assignedTo,
      dueDate: value.date,
      pointValue: value.pointValue,
      dollarValue: value.dollarValue,
      isRecurring: value.isRecurring,
      recurrenceFrequency: value.recurrenceFrequency,
      familyId,
      createdBy: viewer.uid,
    };
    await addChore({ db }, input);
  };
  const handleUpdate = async (id: string, value: AddChoreValue): Promise<void> => {
    const { db } = await import('../../firebase/config');
    const input: EditChoreInput = {
      title: value.title,
      assignedTo: value.assignedTo,
      dueDate: value.date,
      pointValue: value.pointValue,
      dollarValue: value.dollarValue,
      isRecurring: value.isRecurring,
      recurrenceFrequency: value.recurrenceFrequency,
    };
    await editChore({ db }, id, input);
  };
  const handleDelete = async (choreId: string): Promise<void> => {
    const { db } = await import('../../firebase/config');
    try {
      await deleteChore({ db }, choreId);
      showToast(t('chores.deleteSuccess'));
    } catch {
      showToast(t('chores.toast.generic'));
    }
  };

  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };

  // The sheet is a single instance whether we are in add mode (URL-driven)
  // or edit mode (state-driven). The `initial`+`onUpdate` props switch the
  // sheet into edit mode without a separate component.
  const sheetOpen = addOpen || editingChore !== null;
  const closeSheet = (): void => {
    if (editingChore !== null) {
      setEditingChore(null);
      return;
    }
    navigate(ROUTES.chores.path);
  };

  // exactOptionalPropertyTypes: only spread `initial` when we have one (the
  // prop's type does not accept `undefined`; an absent key satisfies the
  // optional contract).
  const editProps = editingChore
    ? {
        initial: {
          id: editingChore.id,
          value: {
            title: editingChore.title,
            assignedTo: editingChore.assignedTo,
            date: editingChore.dueDate,
            pointValue: editingChore.pointValue,
            dollarValue: editingChore.dollarValue,
            isRecurring: editingChore.isRecurring,
            recurrenceFrequency: editingChore.recurrenceFrequency,
          },
        },
        onUpdate: handleUpdate,
      }
    : {};

  return (
    <>
      <ChoresParentScreen
        familyId={familyId}
        viewer={viewer}
        members={members}
        feed={feed}
        onApprove={handleApprove}
        onReject={handleReject}
        onAddChore={() => navigate(ROUTES.add_chore.path)}
        onEditChore={(chore) => setEditingChore(chore)}
        onDeleteChore={handleDelete}
      />
      <AddChore
        open={sheetOpen}
        onClose={closeSheet}
        author={viewer}
        members={members}
        onAdd={handleAdd}
        today={today}
        {...editProps}
      />
    </>
  );
}
