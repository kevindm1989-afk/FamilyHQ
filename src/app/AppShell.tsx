import { useMemo, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { Firestore } from 'firebase/firestore';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { AvatarChip, BottomNav, Button, EmptyState, Skeleton, TopBar } from '../components';
import type { NavTab } from '../components';
import { useAuth } from '../hooks/useAuth';
import { useFamily } from '../hooks/useFamily';
import { useToast } from '../hooks/useToast';
import { BoardScreen } from '../features/board/BoardScreen';
import { useFamilyPosts } from '../features/board/useFamilyPosts';
import { createPost, deletePost, type CreatePostInput } from '../features/board/boardService';
import { CalendarScreen } from '../features/calendar/CalendarScreen';
import { useFamilyEvents } from '../features/calendar/useFamilyEvents';
import {
  createEvent,
  deleteEvent,
  type CreateEventInput,
} from '../features/calendar/calendarService';
import { ChoresMemberScreen } from '../features/chores/ChoresMemberScreen';
import { ChoresParentScreen } from '../features/chores/ChoresParentScreen';
import { AddChore, type AddChoreValue } from '../features/chores/AddChore';
import { useMyChores } from '../features/chores/useMyChores';
import { useFamilyChores } from '../features/chores/useFamilyChores';
import { markComplete } from '../features/chores/choresMemberService';
import { AllowanceHistoryScreen } from '../features/allowance/AllowanceHistoryScreen';
import { useAllowanceHistory } from '../features/allowance/useAllowanceHistory';
import {
  addChore,
  approveChore,
  rejectChore,
  type CreateChoreInput,
} from '../features/chores/choresParentService';
import { FamilyManagementScreen } from '../features/family/FamilyManagementScreen';
import { useAllFamilyMembers } from '../features/family/useAllFamilyMembers';
import {
  FamilyManagementError,
  renameMember,
  setMemberActive,
} from '../features/family/familyManagementService';
import type { EventTag } from '../lib/types';
import { ROUTES, canAccess, hidesBottomNav, type RouteMeta, type ScreenId } from './routes';

const MAIN_CONTENT_ID = 'main-content';

/**
 * Authenticated shell (Task 7). Wires the TopBar + BottomNav chrome and routes
 * to Phase-3 feature placeholders. Modal routes hide the BottomNav; the
 * parent-only guard bounces a member back to the dashboard. UI gating here is
 * cosmetic — firestore.rules is the real authority boundary.
 */
export function AppShell(): ReactElement {
  const { currentUser, role, loading } = useFamily();
  const navigate = useNavigate();
  const location = useLocation();

  const activeScreen = useMemo<ScreenId>(
    () => screenForPath(location.pathname),
    [location.pathname],
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-bg">
        <Skeleton label="Loading your family…" />
      </main>
    );
  }

  const showNav = !hidesBottomNav(activeScreen);
  const activeTab = (
    ['dashboard', 'calendar', 'board', 'chores'].includes(activeScreen) ? activeScreen : 'dashboard'
  ) as NavTab;

  const guard = (screen: ScreenId, el: ReactElement): ReactElement =>
    role && !canAccess(screen, role) ? <Navigate to={ROUTES.dashboard.path} replace /> : el;

  return (
    <div className="mx-auto flex min-h-screen max-w-app flex-col bg-surface-bg">
      {/* Skip link (WCAG 2.4.1): first focusable, jumps past the chrome to the
          routed content. Visually hidden until focused. */}
      <a
        href={`#${MAIN_CONTENT_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-16 focus:top-12 focus:z-modal focus:rounded-control focus:bg-brand focus:px-16 focus:py-8 focus:text-brand-on focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
      >
        Skip to main content
      </a>

      <TopBar
        right={
          currentUser ? (
            <AvatarChip
              name={currentUser.name}
              role={currentUser.role}
              onClick={() => navigate(ROUTES.account_switcher.path)}
            />
          ) : undefined
        }
      />

      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex-1 overflow-y-auto focus:outline-none"
      >
        <Routes>
          <Route path={ROUTES.dashboard.path} element={<DashboardRoute />} />
          <Route path={ROUTES.calendar.path} element={<CalendarRoute />} />
          <Route path={ROUTES.board.path} element={<BoardRoute />} />
          <Route path={ROUTES.chores.path} element={<ChoresRoute />} />
          <Route path={ROUTES.allowance.path} element={<AllowanceRoute />} />
          <Route path={ROUTES.family.path} element={guard('family', <FamilyManagementRoute />)} />
          <Route path={ROUTES.add_chore.path} element={guard('add_chore', <ChoresRoute />)} />
          <Route path={ROUTES.add_event.path} element={guard('add_event', <CalendarRoute />)} />
          <Route path={ROUTES.compose.path} element={<Placeholder title="New Post" />} />
          <Route path={ROUTES.account_switcher.path} element={<AccountScreen />} />
          <Route path="*" element={<Navigate to={ROUTES.dashboard.path} replace />} />
        </Routes>
      </main>

      {showNav && <BottomNav active={activeTab} onNavigate={(tab) => navigate(ROUTES[tab].path)} />}
    </div>
  );
}

/**
 * Account screen — the avatar/account menu path (spec's logout location). The
 * only wired control in this phase is Sign out, which routes through
 * useAuth.signOut → signOutAndClearCache (M19: clears the on-device cache so a
 * shared device never retains the prior family's children's PI). On success the
 * auth gate returns the user to the Login screen automatically.
 */
function AccountScreen(): ReactElement {
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = (): void => {
    setSigningOut(true);
    void signOut().catch(() => {
      // Cache is cleared even on failure (see signOutAndClearCache); surface a
      // user-safe toast — never a raw error.
      showToast('We could not fully sign you out. Please try again.');
      setSigningOut(false);
    });
  };

  return (
    <section className="flex flex-col gap-16 px-16 pt-4">
      <h1 className="text-display font-display font-extrabold text-ink">Account</h1>
      <Button variant="danger" loading={signingOut} onClick={handleSignOut}>
        Sign out
      </Button>
    </section>
  );
}

/**
 * Dashboard route — role-gated read-only composition over the existing feeds
 * (Phase 4). A MEMBER wires their OWN per-uid scoped hooks (useMyChores +
 * useAllowanceHistory, both keyed on the member's own uid + familyId) plus the
 * family events/posts; a PARENT wires the family-wide chore feed (-> approval
 * queue) plus events/posts and NEVER the per-member ledger. `onRefresh` fans
 * out to every wired feed; `onNavigate` deep-links to the full screen. Role
 * branching is cosmetic — firestore.rules is the authoritative boundary.
 */
function DashboardRoute(): ReactElement {
  const { currentUser, role } = useFamily();
  return role === 'parent' ? (
    <ParentDashboardRoute />
  ) : (
    <MemberDashboardRoute key={currentUser?.id ?? 'anon'} />
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

  if (!currentUser || !familyId) {
    return <Placeholder title="Dashboard" />;
  }

  const onRefresh = (): void => {
    void choresFeed.refresh();
    void ledgerFeed.refresh();
    void eventsFeed.refresh();
    void postsFeed.refresh();
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

/**
 * Bulletin Board route — wires the screen to live data. The feed comes from
 * useFamilyPosts(familyId) (the only query the rules allow); create/delete are
 * the boardService actions bound to the real Firestore. The screen itself
 * derives the author crown from the live member list and toasts every action.
 */
function BoardRoute(): ReactElement {
  const { familyId, currentUser, members } = useFamily();
  const feed = useFamilyPosts(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Board" />;
  }

  const viewer = {
    uid: currentUser.id,
    name: currentUser.name,
    role: currentUser.role,
  };

  // Firebase config is imported lazily (mirrors useFamily / useFamilyPosts) so
  // the shell module stays SDK-free at the top level.
  const handleDelete = async (postId: string): Promise<void> => {
    const { db } = await import('../firebase/config');
    await deletePost({ db }, postId);
  };
  const handleCreate = async (content: string): Promise<void> => {
    const { db } = await import('../firebase/config');
    const input: CreatePostInput = {
      content,
      authorId: viewer.uid,
      authorName: viewer.name,
      familyId,
    };
    await createPost({ db }, input);
  };

  return (
    <BoardScreen
      familyId={familyId}
      viewer={viewer}
      members={members}
      feed={feed}
      onDeletePost={handleDelete}
      onCreatePost={handleCreate}
    />
  );
}

/**
 * Calendar route — wires the screen to live data. The feed comes from
 * useFamilyEvents(familyId) (the only query the rules allow); create/delete are
 * the calendarService actions bound to the real Firestore. Event CRUD is
 * parent-only: the screen renders the + FAB and edit/delete affordances only for
 * a parent, and firestore.rules is the authoritative boundary.
 */
function CalendarRoute(): ReactElement {
  const { familyId, currentUser, members } = useFamily();
  const feed = useFamilyEvents(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Calendar" />;
  }

  const viewer = {
    uid: currentUser.id,
    name: currentUser.name,
    role: currentUser.role,
  };

  // The reference "today" derived from the real clock (the screen takes it as a
  // prop so its grid/highlight stay deterministic under test).
  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };

  // Firebase config is imported lazily (mirrors useFamily / BoardRoute) so the
  // shell module stays SDK-free at the top level.
  const handleDelete = async (eventId: string): Promise<void> => {
    const { db } = await import('../firebase/config');
    await deleteEvent({ db }, eventId);
  };
  const handleCreate = async (value: {
    title: string;
    description: string;
    date: string;
    tag: EventTag;
  }): Promise<void> => {
    const { db } = await import('../firebase/config');
    const input: CreateEventInput = {
      ...value,
      familyId,
      createdBy: viewer.uid,
    };
    await createEvent({ db }, input);
  };

  return (
    <CalendarScreen
      familyId={familyId}
      viewer={viewer}
      members={members}
      feed={feed}
      today={today}
      onDeleteEvent={handleDelete}
      onCreateEvent={handleCreate}
    />
  );
}

/**
 * Chores route — renders the PARENT view (approval queue + filters + balances +
 * Add Chore) for a parent viewer and the MEMBER view (own chores + mark-complete
 * + redo) for a member. Each view subscribes to the only query its role's rule
 * allows: a member to `familyId + assignedTo == self`, a parent to the
 * family-wide `familyId ==` feed (the parent read branch). The add_chore modal
 * route opens the Add Chore sheet over the parent screen. UI branching is
 * cosmetic — firestore.rules is the authoritative boundary.
 */
function ChoresRoute(): ReactElement {
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
    const { db } = await import('../firebase/config');
    await markComplete({ db }, choreId);
  };

  return (
    <ChoresMemberScreen
      familyId={familyId}
      viewer={viewer}
      feed={feed}
      onMarkComplete={handleMarkComplete}
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
  const feed = useFamilyChores(familyId);
  const addOpen = location.pathname === ROUTES.add_chore.path;

  if (!currentUser || !familyId) {
    return <Placeholder title="Chores" />;
  }

  const viewer = { uid: currentUser.id, name: currentUser.name, role: currentUser.role };

  const handleApprove = async (choreId: string): Promise<void> => {
    const { db } = await import('../firebase/config');
    await approveChore({ db }, choreId);
  };
  const handleReject = async (choreId: string, reason: string): Promise<void> => {
    const { db } = await import('../firebase/config');
    await rejectChore({ db }, choreId, reason);
  };
  const handleAdd = async (value: AddChoreValue): Promise<void> => {
    const { db } = await import('../firebase/config');
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

  const now = new Date();
  const today = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };

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
      />
      <AddChore
        open={addOpen}
        onClose={() => navigate(ROUTES.chores.path)}
        author={viewer}
        members={members}
        onAdd={handleAdd}
        today={today}
      />
    </>
  );
}

/**
 * Allowance History route — role-gated read-only ledger view. A MEMBER sees
 * their OWN ledger (no picker): the hook is scoped to their own uid + familyId.
 * A PARENT picks a child (the picker over active members) and the hook re-queries
 * for the selected child's uid + familyId. Each branch issues only the
 * `where('familyId','==',fid) AND where('uid','==',uid)` query its role's rule
 * allows — never a peer-leaking familyId-only query. UI gating is cosmetic;
 * firestore.rules is the authoritative boundary.
 */
function AllowanceRoute(): ReactElement {
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

/**
 * Family Management route — parent-only (the `guard('family', ...)` wrapper at
 * the Routes layer already bounces a member to the dashboard). Wires the screen
 * to live data: viewer = currentUser; members = the all-status feed (active +
 * inactive) from useAllFamilyMembers(familyId); the rename / activate actions
 * route through familyManagementService and surface a single toast per result.
 * Firebase config is imported lazily (mirrors the other routes) so the shell
 * module stays SDK-free at the top level.
 */
function FamilyManagementRoute(): ReactElement {
  const { familyId, currentUser } = useFamily();
  const feed = useAllFamilyMembers(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Family" />;
  }

  // The Firestore handle is resolved at action time (lazy import keeps the
  // shell module SDK-free at top level — mirrors BoardRoute / ChoresRoute). A
  // failing dynamic import (e.g. config missing in a test harness) returns
  // null — Sec1: the handler must SHORT-CIRCUIT in that case (raise a
  // FamilyManagementError so the screen toasts the generic copy) and MUST NOT
  // call the service with a `db as Firestore` null-lie cast.
  const resolveDb = async (): Promise<Firestore | null> => {
    try {
      const { db } = await import('../firebase/config');
      return db;
    } catch {
      return null;
    }
  };

  const handleRename = async (uid: string, name: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      // Sec1 — no service call, no null cast. The screen's .catch surfaces
      // the generic toast.
      throw new FamilyManagementError();
    }
    await renameMember({ db }, uid, name);
  };

  const handleSetActive = async (uid: string, isActive: boolean): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      throw new FamilyManagementError();
    }
    await setMemberActive({ db }, uid, isActive);
  };

  return (
    <FamilyManagementScreen
      viewer={currentUser}
      members={feed.members}
      loading={feed.loading}
      error={feed.error}
      onRename={handleRename}
      onSetActive={handleSetActive}
      onRefresh={() => void feed.refresh()}
    />
  );
}

function Placeholder(props: { title: string; note?: string }): ReactElement {
  return (
    <section className="px-16 pt-4">
      <h1 className="text-display font-display font-extrabold text-ink">{props.title}</h1>
      {props.note ? (
        <p className="mt-8 text-meta text-ink-mute">{props.note}</p>
      ) : (
        <EmptyState message="Coming soon — this section lands in the next phase." />
      )}
    </section>
  );
}

function screenForPath(pathname: string): ScreenId {
  const all: RouteMeta[] = Object.values(ROUTES);
  const match = all.find((r) => r.path === pathname);
  return match?.id ?? 'dashboard';
}
