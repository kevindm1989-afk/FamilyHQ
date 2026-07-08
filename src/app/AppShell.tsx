import { Suspense, lazy, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AccessibilityStatementScreen } from '../features/accessibility/AccessibilityStatementScreen';
import { LegalScreen } from '../features/legal/LegalScreen';
import { JoinAuthedHandoff } from '../features/family/JoinAuthedHandoff';
import { resetTour } from '../features/onboarding/tourStorage';
import {
  AvatarChip,
  BottomNav,
  Button,
  IosPwaHintBanner,
  LanguageToggle,
  Skeleton,
  TopBar,
} from '../components';
import type { NavTab } from '../components';
import { isPushNotificationsEnabled } from '../features/notifications/featureFlag';
import { useAuth } from '../hooks/useAuth';
import { useFamily } from '../hooks/useFamily';
import { useToast } from '../hooks/useToast';
import { applyTheme } from '../lib/applyTheme';
import { ROUTES, canAccess, hidesBottomNav, type RouteMeta, type ScreenId } from './routes';

const MAIN_CONTENT_ID = 'main-content';

// Each feature route is its own lazy chunk so visiting one screen doesn't
// download the others. Members never touch FamilyManagement; a parent who
// stays on the dashboard never pays for Calendar / Board / Chores / Allowance
// until they navigate. Each Route is wrapped in its OWN Suspense boundary
// with a shape-matching skeleton (DashboardRouteSkeleton, etc.) so the
// chunk swap is perceptually invisible — no more generic "Loading…" pill.
//
// All six route modules ship a default export specifically so React.lazy can
// consume them; the screens themselves keep their named exports. The
// skeleton modules are tiny (<1 KB each), have no feature deps, and are
// imported eagerly so they ship in the AuthedApp chunk and render the
// instant the user lands on a route.
const DashboardRoute = lazy(() => import('../features/dashboard/DashboardRoute'));
const CalendarRoute = lazy(() => import('../features/calendar/CalendarRoute'));
const BoardRoute = lazy(() => import('../features/board/BoardRoute'));
const ChoresRoute = lazy(() => import('../features/chores/ChoresRoute'));
const AllowanceRoute = lazy(() => import('../features/allowance/AllowanceRoute'));
const FamilyManagementRoute = lazy(() => import('../features/family/FamilyManagementRoute'));
const SavingsGoalsRoute = lazy(() => import('../features/savings/SavingsGoalsRoute'));
const TasksRoute = lazy(() => import('../features/tasks/TasksRoute'));
const BirthdaysRoute = lazy(() => import('../features/birthdays/BirthdaysRoute'));
const ShoppingListRoute = lazy(() => import('../features/shopping/ShoppingListRoute'));
const WishlistRoute = lazy(() => import('../features/wishlist/WishlistRoute'));
const NotificationsRoute = lazy(() => import('../features/notifications/NotificationsRoute'));

import { DashboardRouteSkeleton } from '../features/dashboard/DashboardRouteSkeleton';
import { CalendarRouteSkeleton } from '../features/calendar/CalendarRouteSkeleton';
import { BoardRouteSkeleton } from '../features/board/BoardRouteSkeleton';
import { ChoresRouteSkeleton } from '../features/chores/ChoresRouteSkeleton';
import { AllowanceRouteSkeleton } from '../features/allowance/AllowanceRouteSkeleton';
import { FamilyManagementRouteSkeleton } from '../features/family/FamilyManagementRouteSkeleton';
import { SavingsGoalsRouteSkeleton } from '../features/savings/SavingsGoalsRouteSkeleton';
import { TasksRouteSkeleton } from '../features/tasks/TasksRouteSkeleton';
import { BirthdaysRouteSkeleton } from '../features/birthdays/BirthdaysRouteSkeleton';
import { ShoppingListRouteSkeleton } from '../features/shopping/ShoppingListRouteSkeleton';
import { WishlistRouteSkeleton } from '../features/wishlist/WishlistRouteSkeleton';

/**
 * Wraps a lazy Route in its own Suspense + the matching skeleton. One-liner
 * helper so each <Route element=…/> stays a single expression.
 */
function L(node: ReactElement, fallback: ReactElement): ReactElement {
  return <Suspense fallback={fallback}>{node}</Suspense>;
}

/**
 * Authenticated shell (Task 7). Wires the TopBar + BottomNav chrome and routes
 * to Phase-3 feature placeholders. Modal routes hide the BottomNav; the
 * parent-only guard bounces a member back to the dashboard. UI gating here is
 * cosmetic — firestore.rules is the real authority boundary.
 */
export function AppShell(): ReactElement {
  const { t } = useTranslation();
  const { currentUser, role, loading } = useFamily();
  const navigate = useNavigate();
  const location = useLocation();

  const activeScreen = useMemo<ScreenId>(
    () => screenForPath(location.pathname),
    [location.pathname],
  );

  // Apply the signed-in user's theme to <html> on load and whenever it changes
  // (e.g. the Account toggle persists → the users-doc snapshot updates → this
  // re-stamps data-theme). On sign-out the app hard-reloads (signOutAndClear-
  // Cache), which drops the attribute and returns the login screen to the OS
  // prefers-color-scheme default — so no explicit teardown is needed here.
  const currentTheme = currentUser?.theme;
  useEffect(() => {
    applyTheme(currentTheme ?? null);
  }, [currentTheme]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-bg">
        <Skeleton label={t('common.loadingFamily')} />
      </main>
    );
  }

  const showNav = !hidesBottomNav(activeScreen);
  const activeTab = (
    ['dashboard', 'calendar', 'board', 'chores', 'tasks'].includes(activeScreen)
      ? activeScreen
      : 'dashboard'
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
        {/* F15: iOS-PWA hint banner. Self-suppresses on every non-iOS UA, when
            the app is already installed (navigator.standalone), or when the
            user dismissed within the last 30 days — so the unconditional mount
            here renders nothing for the overwhelming majority of sessions and
            no per-route gating is required. Sits inside main so the sticky
            position is relative to the scrollable content area, not the OS
            chrome. */}
        <IosPwaHintBanner />
        <Routes>
          <Route
            path={ROUTES.dashboard.path}
            element={L(<DashboardRoute />, <DashboardRouteSkeleton />)}
          />
          <Route
            path={ROUTES.calendar.path}
            element={L(<CalendarRoute />, <CalendarRouteSkeleton />)}
          />
          <Route path={ROUTES.board.path} element={L(<BoardRoute />, <BoardRouteSkeleton />)} />
          <Route path={ROUTES.chores.path} element={L(<ChoresRoute />, <ChoresRouteSkeleton />)} />
          <Route path={ROUTES.tasks.path} element={L(<TasksRoute />, <TasksRouteSkeleton />)} />
          <Route
            path={ROUTES.allowance.path}
            element={L(<AllowanceRoute />, <AllowanceRouteSkeleton />)}
          />
          <Route
            path={ROUTES.family.path}
            element={guard(
              'family',
              L(<FamilyManagementRoute />, <FamilyManagementRouteSkeleton />),
            )}
          />
          <Route
            path={ROUTES.goals.path}
            element={L(<SavingsGoalsRoute />, <SavingsGoalsRouteSkeleton />)}
          />
          <Route
            path={ROUTES.birthdays.path}
            element={L(<BirthdaysRoute />, <BirthdaysRouteSkeleton />)}
          />
          <Route
            path={ROUTES.shopping.path}
            element={L(<ShoppingListRoute />, <ShoppingListRouteSkeleton />)}
          />
          <Route
            path={ROUTES.wishlist.path}
            element={L(<WishlistRoute />, <WishlistRouteSkeleton />)}
          />
          <Route
            path={ROUTES.notifications.path}
            element={
              <Suspense fallback={<RouteFallback />}>
                <NotificationsRoute />
              </Suspense>
            }
          />
          <Route
            path={ROUTES.accessibility.path}
            element={
              <Suspense fallback={<RouteFallback />}>
                <AccessibilityStatementScreen mode="in-app" />
              </Suspense>
            }
          />
          <Route
            path={ROUTES.privacy.path}
            element={
              <Suspense fallback={<RouteFallback />}>
                <LegalScreen variant="privacy" mode="in-app" />
              </Suspense>
            }
          />
          <Route
            path={ROUTES.terms.path}
            element={
              <Suspense fallback={<RouteFallback />}>
                <LegalScreen variant="terms" mode="in-app" />
              </Suspense>
            }
          />
          <Route
            path={ROUTES.add_chore.path}
            element={guard('add_chore', L(<ChoresRoute />, <ChoresRouteSkeleton />))}
          />
          <Route
            path={ROUTES.add_event.path}
            element={guard('add_event', L(<CalendarRoute />, <CalendarRouteSkeleton />))}
          />
          <Route path={ROUTES.compose.path} element={L(<BoardRoute />, <BoardRouteSkeleton />)} />
          <Route path={ROUTES.account_switcher.path} element={<AccountScreen />} />
          {/* /join/:inviteId — the public JoinScreen handles the unauth case
              (App.tsx). When an already-signed-in visitor opens the link, we
              land them on a small handoff that explains the conflict and
              offers a sign-out so they can redeem from the same URL. */}
          <Route path={ROUTES.join.path} element={<JoinAuthedHandoff />} />
          <Route path="*" element={<Navigate to={ROUTES.dashboard.path} replace />} />
        </Routes>
      </main>

      {showNav && <BottomNav active={activeTab} onNavigate={(tab) => navigate(ROUTES[tab].path)} />}
    </div>
  );
}

/**
 * Inline fallback for first-time route chunk loads. Held inside the main
 * content area so the TopBar + BottomNav stay rendered during the swap — the
 * user never sees the whole app blank out, just the screen body shimmer
 * briefly. Skeleton's aria-live announces the transition to assistive tech.
 *
 * The Skeleton's label MUST come from i18n's common.loading key — tests
 * (AppShell.<feature>.test.tsx) wait for this exact string to disappear to
 * gate on the route having mounted. If the label changes, those tests'
 * waitFor predicates must change in lockstep.
 */
function RouteFallback(): ReactElement {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col items-center justify-center px-16 pt-32">
      <Skeleton label={t('common.loading')} />
    </section>
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
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const { role, currentUser } = useFamily();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const isParent = role === 'parent';

  // Theme toggle. Applies instantly (optimistic) for zero-lag feedback, then
  // persists to users/{uid}.theme; on a persist failure we revert the DOM to
  // the last-known theme and toast. The AppShell effect keeps <html> in sync
  // with the snapshot, so a successful write is idempotent with the optimistic
  // apply. Defaults to 'light' when the user doc hasn't loaded yet.
  const theme = currentUser?.theme ?? 'light';
  const [themeBusy, setThemeBusy] = useState(false);
  const handleToggleTheme = (): void => {
    if (themeBusy || !currentUser) return;
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeBusy(true);
    // applyTheme is pure DOM and already statically imported — apply the
    // optimistic flip SYNCHRONOUSLY (instant visual feedback) rather than
    // behind a redundant dynamic import. Only the Firebase persist path is
    // deferred (keeps the SDK out of the AppShell chunk until the toggle fires).
    applyTheme(next); // optimistic
    void (async () => {
      try {
        const [{ db }, { setUserTheme }] = await Promise.all([
          import('../firebase/config'),
          import('../features/settings/themeService'),
        ]);
        await setUserTheme({ db }, currentUser.id, next);
      } catch {
        applyTheme(theme); // revert on failure
        showToast(t('account.themeError'));
      } finally {
        setThemeBusy(false);
      }
    })();
  };

  const handleSignOut = (): void => {
    setSigningOut(true);
    void signOut().catch(() => {
      // Cache is cleared even on failure (see signOutAndClearCache); surface a
      // user-safe toast — never a raw error.
      showToast(t('account.signOutError'));
      setSigningOut(false);
    });
  };

  return (
    <section className="flex flex-col gap-16 px-16 pt-4">
      {/* Done / Home button — Account is a modal route that deliberately hides
          the BottomNav, which means the user has no in-app affordance to
          return to the dashboard otherwise (real-deploy UX report). A clearly
          labelled top-of-screen button is the modal-pattern norm. Uses
          'ghost' variant so it doesn't compete visually with Sign out below. */}
      <Button variant="ghost" onClick={() => navigate(ROUTES.dashboard.path)}>
        {t('account.done')}
      </Button>
      <h1 className="text-display font-display font-extrabold text-ink">{t('account.title')}</h1>
      {/* Parent-only navigation to /family. Without this, the family-management
          surface (incl. the new Invite flow) is reachable only by typing the
          URL — a real-deploy UX gap the founding-parent reported the moment
          they tried to invite their first member. Member role hides this
          entirely (the route guard would bounce a member anyway). */}
      {isParent && (
        <Button variant="soft" onClick={() => navigate(ROUTES.family.path)}>
          {t('account.manageFamily')}
        </Button>
      )}
      {/* Birthdays + anniversaries — open to any active same-family
          member per firestore.rules, so the link is unconditional. */}
      <Button variant="soft" onClick={() => navigate(ROUTES.birthdays.path)}>
        {t('account.manageBirthdays')}
      </Button>
      {/* Shared family shopping list — open to any active same-family member. */}
      <Button variant="soft" onClick={() => navigate(ROUTES.shopping.path)}>
        {t('account.shoppingList')}
      </Button>
      {/* Wishlist + redemption queue. Members curate, parents approve. */}
      <Button variant="soft" onClick={() => navigate(ROUTES.wishlist.path)}>
        {t('account.wishlist')}
      </Button>
      {/* Push notification preferences — open to every active member.
          Per-subject toggles + the per-device sign-out list. Gated on
          VITE_FCM_ENABLED so a Spark-tier deploy without notify-callables
          doesn't expose a settings screen that can't actually register
          tokens. The route itself still redirects when the flag is off
          (defense in depth). */}
      {isPushNotificationsEnabled() && (
        <Button variant="soft" onClick={() => navigate(ROUTES.notifications.path)}>
          {t('account.notifications')}
        </Button>
      )}
      <Button variant="danger" loading={signingOut} onClick={handleSignOut}>
        {t('account.signOut')}
      </Button>
      {/* Appearance — light/dark theme toggle. `aria-pressed` conveys the
          on(dark)/off(light) state to AT; the colour swap itself is handled by
          the CSS-variable layer once data-theme flips on <html>. */}
      <button
        type="button"
        onClick={handleToggleTheme}
        disabled={themeBusy}
        aria-pressed={theme === 'dark'}
        className="inline-flex min-h-tap items-center justify-between gap-8 rounded-control border border-surface-line bg-surface-card px-16 text-body font-semibold text-ink disabled:opacity-60 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
      >
        <span>{t('account.theme.label')}</span>
        <span className="text-ink-mute">
          {theme === 'dark' ? t('account.theme.dark') : t('account.theme.light')}
        </span>
      </button>
      {/* AODA: the accessibility statement + feedback path must be reachable
          from within the app, not only from the signed-out screen. The
          language toggle sits in the same Account surface so a signed-in
          user can switch language without having to sign out. */}
      <LanguageToggle />
      <nav aria-label={t('account.resourcesLabel')} className="mt-8 flex flex-col gap-8">
        <Link
          to={ROUTES.accessibility.path}
          className="text-body text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('account.accessibilityLink')}
        </Link>
        <Link
          to={ROUTES.privacy.path}
          className="text-body text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('login.footer.privacy')}
        </Link>
        <Link
          to={ROUTES.terms.path}
          className="text-body text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('login.footer.terms')}
        </Link>
        {/* Replay welcome tour — clears the storage flag and bounces to the
            dashboard where the tour re-mounts on first render. Honours the
            user's intent (they asked for it) without a flag dance. */}
        <button
          type="button"
          onClick={() => {
            resetTour();
            navigate(ROUTES.dashboard.path);
          }}
          className="self-start text-body text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('onboarding.replay')}
        </button>
      </nav>
    </section>
  );
}

function screenForPath(pathname: string): ScreenId {
  const all: RouteMeta[] = Object.values(ROUTES);
  const match = all.find((r) => r.path === pathname);
  return match?.id ?? 'dashboard';
}
