/**
 * Allowance History route — role-gated read-only ledger view. A MEMBER sees
 * their OWN ledger (no picker): the hook is scoped to their own uid + familyId.
 * A PARENT picks a child (the picker over active members) and the hook re-queries
 * for the selected child's uid + familyId. Each branch issues only the
 * `where('familyId','==',fid) AND where('uid','==',uid)` query its role's rule
 * allows — never a peer-leaking familyId-only query. UI gating is cosmetic;
 * firestore.rules is the authoritative boundary.
 *
 * Default-exported for React.lazy in AppShell.
 */
import { useState, type ReactElement } from 'react';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { AllowanceHistoryScreen } from './AllowanceHistoryScreen';
import { useAllowanceHistory } from './useAllowanceHistory';

export default function AllowanceRoute(): ReactElement {
  const { familyId, currentUser, members, role } = useFamily();
  return role === 'parent' ? (
    <ParentAllowanceRoute familyId={familyId} currentUser={currentUser} members={members} />
  ) : (
    <MemberAllowanceRoute familyId={familyId} currentUser={currentUser} />
  );
}

function MemberAllowanceRoute(props: {
  familyId: string | null;
  currentUser: ReturnType<typeof useFamily>['currentUser'];
}): ReactElement {
  const { familyId, currentUser } = props;
  // A member sees ONLY their own ledger — scope the hook to their own uid.
  const feed = useAllowanceHistory(currentUser?.id ?? null, familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Allowance" />;
  }

  const viewer = { uid: currentUser.id, name: currentUser.name, role: currentUser.role };

  return (
    <AllowanceHistoryScreen
      viewer={viewer}
      selectedMember={{
        uid: currentUser.id,
        name: currentUser.name,
        balanceCents: currentUser.allowanceBalance,
      }}
      members={[]}
      feed={feed}
      onSelectMember={() => undefined}
    />
  );
}

function ParentAllowanceRoute(props: {
  familyId: string | null;
  currentUser: ReturnType<typeof useFamily>['currentUser'];
  members: ReturnType<typeof useFamily>['members'];
}): ReactElement {
  const { familyId, currentUser, members } = props;
  // The parent picks which CHILD's ledger to view. F1: only members with
  // role === 'member' are selectable — never a parent. Default to the first
  // child. F3: resolve the effective uid against the CURRENT child membership,
  // so a removed/deactivated selection falls back to a valid child (never a
  // nameless header still subscribed to a gone uid). The hook re-queries
  // whenever the resolved selection changes.
  const children = members.filter((m) => m.role === 'member');
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const selectedChild = children.find((c) => c.id === selectedUid);
  const effectiveChild = selectedChild ?? children[0];
  const effectiveUid = effectiveChild?.id ?? null;
  // The hook is keyed on the resolved child uid (see key=) so a switch unmounts
  // the prior list — defence-in-depth against a cross-child flash (F2).
  const feed = useAllowanceHistory(effectiveUid, familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Allowance" />;
  }

  const viewer = { uid: currentUser.id, name: currentUser.name, role: currentUser.role };

  // F3: when no child resolves, do not render a nameless header over a NaN
  // balance with a ledger beneath it — show the safe empty/no-member state.
  if (!effectiveChild) {
    return (
      <Placeholder
        title="Allowance"
        note="No child accounts yet. Add a child to track their allowance."
      />
    );
  }

  return (
    <AllowanceHistoryScreen
      key={effectiveChild.id}
      viewer={viewer}
      selectedMember={{
        uid: effectiveChild.id,
        name: effectiveChild.name,
        balanceCents: effectiveChild.allowanceBalance,
      }}
      members={children}
      feed={feed}
      onSelectMember={setSelectedUid}
    />
  );
}
