/**
 * Dashboard route — role-gated read-only composition over the existing feeds
 * (Phase 4). A MEMBER wires their OWN per-uid scoped hooks (useMyChores +
 * useAllowanceHistory, both keyed on the member's own uid + familyId) plus the
 * family events/posts; a PARENT wires the family-wide chore feed (-> approval
 * queue) plus events/posts and NEVER the per-member ledger. `onRefresh` fans
 * out to every wired feed; `onNavigate` deep-links to the full screen. Role
 * branching is cosmetic — firestore.rules is the authoritative boundary.
 *
 * Default-exported because React.lazy in AppShell consumes it. Pulls
 * dashboard + chores + allowance + events + posts hooks together — this is
 * the largest authed chunk, so isolating it from the other routes is the
 * biggest per-route bundle win.
 */
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Placeholder } from '../../app/Placeholder';
import { ROUTES } from '../../app/routes';
import { useFamily } from '../../hooks/useFamily';
import { useAllowanceHistory } from '../allowance/useAllowanceHistory';
import { useFamilyChores } from '../chores/useFamilyChores';
import { useMyChores } from '../chores/useMyChores';
import { useFamilyEvents } from '../calendar/useFamilyEvents';
import { useFamilyPosts } from '../board/useFamilyPosts';
import { useFamilyTodos } from '../tasks/useFamilyTodos';
import { DashboardScreen } from './DashboardScreen';
import { OnboardingTour } from '../onboarding/OnboardingTour';
import { hasSeenTour, markTourSeen } from '../onboarding/tourStorage';

export default function DashboardRoute(): ReactElement {
  const { currentUser, role } = useFamily();
  // First-run onboarding tour: shown on the FIRST dashboard mount per device
  // (the storage key gates re-show). The role is known here so we can hand
  // the role-scoped step list to the tour without a flicker. If role is
  // momentarily null while useFamily is settling, the tour stays closed —
  // it'll mount on the next render when role lands.
  const [showTour, setShowTour] = useState(() => !hasSeenTour());
  const closeTour = (): void => {
    markTourSeen();
    setShowTour(false);
  };
  return (
    <>
      {role === 'parent' ? (
        <ParentDashboardRoute />
      ) : (
        <MemberDashboardRoute key={currentUser?.id ?? 'anon'} />
      )}
      {showTour && role !== null && <OnboardingTour role={role} onClose={closeTour} />}
    </>
  );
}

function MemberDashboardRoute(): ReactElement {
  const { familyId, currentUser, members } = useFamily();
  const navigate = useNavigate();
  const ownUid = currentUser?.id ?? null;

  // Personal feeds scoped to the member's OWN uid — never a family-wide leak.
  const choresFeed = useMyChores(ownUid, familyId);
  const ledgerFeed = useAllowanceHistory(ownUid, familyId);
  const eventsFeed = useFamilyEvents(familyId);
  const postsFeed = useFamilyPosts(familyId);
  // Todos are family-wide by design (Task Management spec: anyone in the
  // family can CRUD any todo). Dashboard widget filters/prioritises in
  // selectTopOpenTodos — no new query is needed.
  const todosFeed = useFamilyTodos(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Dashboard" />;
  }

  const onRefresh = (): void => {
    void choresFeed.refresh();
    void ledgerFeed.refresh();
    void eventsFeed.refresh();
    void postsFeed.refresh();
    // useFamilyTodos has no `refresh` — its onSnapshot already auto-refreshes.
  };

  return (
    <DashboardScreen
      role="member"
      userName={currentUser.name}
      balanceCents={currentUser.allowanceBalance}
      members={members}
      nowMs={Date.now()}
      onNavigate={(screen) => navigate(ROUTES[screen].path)}
      onRefresh={onRefresh}
      earnings={{
        items: ledgerFeed.transactions,
        loading: ledgerFeed.loading,
        error: ledgerFeed.error,
      }}
      myChores={{
        items: choresFeed.chores,
        loading: choresFeed.loading,
        error: choresFeed.error,
      }}
      todos={{ items: todosFeed.todos, loading: todosFeed.loading, error: todosFeed.error }}
      approvals={{ items: [], loading: false, error: null }}
      events={{ items: eventsFeed.events, loading: eventsFeed.loading, error: eventsFeed.error }}
      posts={{ items: postsFeed.posts, loading: postsFeed.loading, error: postsFeed.error }}
    />
  );
}

function ParentDashboardRoute(): ReactElement {
  const { familyId, currentUser, members } = useFamily();
  const navigate = useNavigate();

  // Approvals come from the family-wide chore feed; NO per-member ledger.
  const choresFeed = useFamilyChores(familyId);
  const eventsFeed = useFamilyEvents(familyId);
  const postsFeed = useFamilyPosts(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Dashboard" />;
  }

  const onRefresh = (): void => {
    void choresFeed.refresh();
    void eventsFeed.refresh();
    void postsFeed.refresh();
  };

  return (
    <DashboardScreen
      role="parent"
      userName={currentUser.name}
      balanceCents={currentUser.allowanceBalance}
      members={members}
      nowMs={Date.now()}
      onNavigate={(screen) => navigate(ROUTES[screen].path)}
      onRefresh={onRefresh}
      earnings={{ items: [], loading: false, error: null }}
      myChores={{ items: [], loading: false, error: null }}
      todos={{ items: [], loading: false, error: null }}
      approvals={{
        items: choresFeed.chores,
        loading: choresFeed.loading,
        error: choresFeed.error,
      }}
      events={{ items: eventsFeed.events, loading: eventsFeed.loading, error: eventsFeed.error }}
      posts={{ items: postsFeed.posts, loading: postsFeed.loading, error: postsFeed.error }}
    />
  );
}
