import { useMemo, useState, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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
  const { currentUser, members, role, loading } = useFamily();
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
          <Route
            path={ROUTES.dashboard.path}
            element={
              <Placeholder
                title={`Welcome${currentUser ? `, ${currentUser.name.split(' ')[0]}` : ''}`}
                note={`${members.length} member${members.length === 1 ? '' : 's'} in your family.`}
              />
            }
          />
          <Route path={ROUTES.calendar.path} element={<CalendarRoute />} />
          <Route path={ROUTES.board.path} element={<BoardRoute />} />
          <Route path={ROUTES.chores.path} element={<Placeholder title="Chores" />} />
          <Route
            path={ROUTES.family.path}
            element={guard('family', <Placeholder title="Family" />)}
          />
          <Route
            path={ROUTES.add_chore.path}
            element={guard('add_chore', <Placeholder title="Add Chore" />)}
          />
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
