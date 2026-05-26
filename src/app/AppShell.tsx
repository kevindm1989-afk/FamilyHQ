import { useMemo, type ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AvatarChip, BottomNav, EmptyState, Skeleton, TopBar } from '../components';
import type { NavTab } from '../components';
import { useFamily } from '../hooks/useFamily';
import { ROUTES, canAccess, hidesBottomNav, type RouteMeta, type ScreenId } from './routes';

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

      <div className="flex-1 overflow-y-auto">
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
          <Route path={ROUTES.calendar.path} element={<Placeholder title="Calendar" />} />
          <Route path={ROUTES.board.path} element={<Placeholder title="Board" />} />
          <Route path={ROUTES.chores.path} element={<Placeholder title="Chores" />} />
          <Route
            path={ROUTES.family.path}
            element={guard('family', <Placeholder title="Family" />)}
          />
          <Route
            path={ROUTES.add_chore.path}
            element={guard('add_chore', <Placeholder title="Add Chore" />)}
          />
          <Route path={ROUTES.add_event.path} element={<Placeholder title="Add Event" />} />
          <Route path={ROUTES.compose.path} element={<Placeholder title="New Post" />} />
          <Route
            path={ROUTES.account_switcher.path}
            element={<Placeholder title="Switch Account" />}
          />
          <Route path="*" element={<Navigate to={ROUTES.dashboard.path} replace />} />
        </Routes>
      </div>

      {showNav && <BottomNav active={activeTab} onNavigate={(tab) => navigate(ROUTES[tab].path)} />}
    </div>
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
