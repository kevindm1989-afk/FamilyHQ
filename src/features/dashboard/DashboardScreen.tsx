/**
 * Dashboard home screen (Phase 4, Dashboard feature; the `/` landing route).
 *
 * The screen is a DETERMINISTIC, INJECTED-PROPS composition over the existing
 * feeds — it contains NO Firebase. AppShell wires the real hooks
 * (useMyChores / useFamilyChores / useFamilyEvents / useFamilyPosts /
 * useAllowanceHistory) and passes their `{ items, loading, error }` plus the
 * caller's identity, role, members, and a single `onRefresh` that refreshes
 * ALL feeds.
 *
 * Layout (READ-ONLY composition; ADR-0002 role gating is cosmetic — rules are
 * authoritative):
 *  - MEMBER: greeting, current balance (formatMoney, gated -> indicator),
 *    recent earnings, my chores (soonest 3), upcoming events (future 3),
 *    recent posts (newest 3). Balance and earnings are INDEPENDENT facts —
 *    NEVER present earnings as summing to the balance (ADR-0004 honesty).
 *  - PARENT: greeting, approvals (queue capped 3 + pending count), upcoming
 *    events, recent posts. NO own-balance / own-chores section.
 *  - Every list section: heading, list capped at 3, a "View all <target>"
 *    control deep-linking via onNavigate, and INDEPENDENT loading (Skeleton) /
 *    empty (EmptyState) / error (compact inline, single-channel — never a
 *    toast) states.
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, EmptyState, Skeleton, type BadgeTone } from '../../components';
import type { ChoreStatus, Role, UserWithId } from '../../lib/types';
import type { ChoreWithId } from '../chores/choresMemberService';
import { EVENT_TAG_LABEL, type EventWithId } from '../calendar/calendarService';
import type { PostWithId } from '../board/boardService';
import type { TransactionWithId } from '../allowance/allowanceService';
import type { ScreenId } from '../../app/routes';
import {
  approvalQueue,
  formatMoney,
  isValidMoneyCents,
  MONEY_INVALID_INDICATOR,
  pendingApprovalCount,
} from '../chores/choresParentService';
import { relativeTime } from '../board/relativeTime';
import { selectRecent, selectSoonestChores, selectUpcomingEvents } from './dashboardSelectors';

/**
 * A section feed slice — the screen renders one of three independent states per
 * section from this shape: loading (Skeleton), error (compact inline), else the
 * items list (capped + empty fallback).
 */
export interface SectionFeed<T> {
  items: T[];
  loading: boolean;
  /** User-safe copy only — never raw Firebase text / PII. Null when healthy. */
  error: string | null;
}

export interface DashboardScreenProps {
  /** Cosmetic role gate (ADR-0002): drives MEMBER vs PARENT layout. */
  role: Role;
  /** Personalized greeting target (the viewer's display name). */
  userName: string;
  /**
   * The viewer's allowance balance in INTEGER CENTS (member only). A non-finite
   * / invalid value renders MONEY_INVALID_INDICATOR, never "$0.00".
   */
  balanceCents: number;
  /** Active family members — used to resolve a chore's assignee name (parent). */
  members: UserWithId[];
  /** Deterministic "now" (ms) for relativeTime + the upcoming-events filter. */
  nowMs: number;
  /** Deep-link a section's "View all" to its full screen. */
  onNavigate: (screen: ScreenId) => void;
  /** The SINGLE refresh control — AppShell wires it to refresh ALL feeds. */
  onRefresh: () => void;

  // Per-section injected feeds. Each role reads the subset it renders.
  earnings: SectionFeed<TransactionWithId>; // member
  myChores: SectionFeed<ChoreWithId>; // member
  approvals: SectionFeed<ChoreWithId>; // parent (the full family-chore feed)
  events: SectionFeed<EventWithId>; // both
  posts: SectionFeed<PostWithId>; // both
}

const SECTION_CAP = 3;

/**
 * Status conveyed as TEXT (label), never colour alone (WCAG 1.4.1).
 * Resolved at render via i18n; the i18n keys live under `dashboard.status.*`.
 */
const STATUS_I18N_KEY: Record<ChoreStatus, string> = {
  pending: 'dashboard.status.pending',
  complete: 'dashboard.status.complete',
  approved: 'dashboard.status.approved',
  rejected: 'dashboard.status.rejected',
};
const STATUS_TONE: Record<ChoreStatus, BadgeTone> = {
  pending: 'mute',
  complete: 'amber',
  approved: 'ok',
  rejected: 'danger',
};

const EVENT_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Render a money amount, GATED by isValidMoneyCents: a non-finite / negative /
 * over-max value renders the distinct indicator, never "$0.00" or "$NaN".
 */
function gatedMoney(cents: number): string {
  return isValidMoneyCents(cents) ? formatMoney(cents) : MONEY_INVALID_INDICATOR;
}

/**
 * Accessible NAME for a money surface (A1). When the value is valid the name is
 * "<prefix> $X.XX"; when invalid it is a real spoken phrase ("<prefix>
 * unavailable") rather than "<prefix> —" — a screen reader voices a bare em-dash
 * as nothing, so the indicator alone is not an accessible name. The "unavailable"
 * fallback uses i18n.t at call sites; this helper takes a fully-localized prefix.
 */
function moneyLabel(prefix: string, cents: number, unavailable: string): string {
  return isValidMoneyCents(cents) ? `${prefix} ${formatMoney(cents)}` : `${prefix} ${unavailable}`;
}

/** Friendly ISO date -> visible text inside a `<time>`; parse at UTC noon. */
function friendlyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return EVENT_DATE_FORMAT.format(date);
}

export function DashboardScreen(props: DashboardScreenProps): ReactElement {
  const { t } = useTranslation();
  const { role, userName, nowMs, onNavigate, onRefresh } = props;
  const isParent = role === 'parent';

  // ONE page-level polite live region (A4, WCAG 4.1.3). Refresh fans out to every
  // feed; we announce the activity honestly ("Refreshing dashboard…") on click —
  // we do not claim "updated" since completion is not observable from here. This
  // is the single status channel; section errors stay inline (no toast spam).
  const [refreshStatus, setRefreshStatus] = useState('');
  const handleRefresh = (): void => {
    setRefreshStatus(t('dashboard.refreshing'));
    onRefresh();
  };

  return (
    <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
      <div className="flex items-center justify-between gap-12">
        <h1 className="text-display font-display font-extrabold text-ink">
          {t('dashboard.welcome', { name: userName })}
        </h1>
        <button
          type="button"
          aria-label={t('dashboard.refresh')}
          onClick={handleRefresh}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          <RefreshIcon />
        </button>
      </div>

      {/* Single polite live region for refresh activity. Visually hidden but in
          the accessibility tree (role=status implies aria-live=polite). */}
      <p role="status" className="sr-only">
        {refreshStatus}
      </p>

      {isParent ? <ParentSections {...props} /> : <MemberSections {...props} />}

      <UpcomingEventsSection feed={props.events} nowMs={nowMs} onNavigate={onNavigate} />
      <RecentPostsSection feed={props.posts} nowMs={nowMs} onNavigate={onNavigate} />
    </section>
  );
}

function MemberSections(props: DashboardScreenProps): ReactElement {
  const { t } = useTranslation();
  const { balanceCents, earnings, myChores, nowMs, onNavigate } = props;
  const unavailable = t('common.unavailable');

  return (
    <>
      <SectionShell
        heading={t('dashboard.section.earnings.heading')}
        viewAllLabel={t('dashboard.section.earnings.viewAll')}
        onViewAll={() => onNavigate('allowance')}
      >
        {/* Balance is an INDEPENDENT fact — never framed as the sum of the
            earnings list below it (ADR-0004 honesty: no "sums to balance"). */}
        <p
          className="text-title font-bold text-ink"
          aria-label={moneyLabel(t('dashboard.currentBalance'), balanceCents, unavailable)}
        >
          {t('dashboard.currentBalanceLine', { amount: gatedMoney(balanceCents) })}
        </p>
        <SectionBody
          feed={earnings}
          loadingLabel={t('dashboard.section.earnings.loading')}
          emptyMessage={t('dashboard.section.earnings.empty')}
          renderItems={(items) =>
            selectRecent(items, SECTION_CAP).map((txn) => (
              <ListRow key={txn.id}>
                <span className="flex-1 text-body font-semibold text-ink">{txn.choreTitle}</span>
                <time
                  dateTime={new Date(txn.createdAt).toISOString()}
                  className="text-meta text-ink-mute"
                >
                  {relativeTime(txn.createdAt, nowMs)}
                </time>
                {/* Each earning is a credit (+); gated so a non-finite / negative
                    / over-max amount renders the indicator, never "$NaN"/"-$x". */}
                <span className="text-body font-semibold text-status-ok-text">
                  {isValidMoneyCents(txn.amount)
                    ? `+${formatMoney(txn.amount)}`
                    : MONEY_INVALID_INDICATOR}
                </span>
              </ListRow>
            ))
          }
        />
      </SectionShell>

      <SectionShell
        heading={t('dashboard.section.myChores.heading')}
        viewAllLabel={t('dashboard.section.myChores.viewAll')}
        onViewAll={() => onNavigate('chores')}
      >
        <SectionBody
          feed={myChores}
          loadingLabel={t('dashboard.section.myChores.loading')}
          emptyMessage={t('dashboard.section.myChores.empty')}
          renderItems={(items) =>
            selectSoonestChores(items, SECTION_CAP).map((chore) => (
              <ListRow key={chore.id}>
                <span className="flex-1 text-body font-semibold text-ink">{chore.title}</span>
                <Badge tone={STATUS_TONE[chore.status]} size="sm">
                  {t(STATUS_I18N_KEY[chore.status])}
                </Badge>
                <span
                  className="text-meta font-semibold text-ink-mute"
                  aria-label={moneyLabel(
                    t('dashboard.worthPrefix'),
                    chore.dollarValue,
                    unavailable,
                  )}
                >
                  {gatedMoney(chore.dollarValue)}
                </span>
              </ListRow>
            ))
          }
        />
      </SectionShell>
    </>
  );
}

function ParentSections(props: DashboardScreenProps): ReactElement {
  const { t } = useTranslation();
  const { approvals, members, onNavigate } = props;
  const unavailable = t('common.unavailable');
  const fallbackName = t('dashboard.fallbackMemberName');

  const nameFor = (uid: string): string => members.find((m) => m.id === uid)?.name ?? fallbackName;

  const queue = approvalQueue(approvals.items);
  const pending = pendingApprovalCount(approvals.items);

  return (
    <SectionShell
      heading={t('dashboard.section.approvals.heading')}
      viewAllLabel={t('dashboard.section.approvals.viewAll')}
      onViewAll={() => onNavigate('chores')}
    >
      {!approvals.loading && approvals.error === null && (
        <p className="text-meta text-ink-mute">
          {t('dashboard.section.approvals.pendingCount', { count: pending })}
        </p>
      )}
      <SectionBody
        feed={approvals}
        loadingLabel={t('dashboard.section.approvals.loading')}
        emptyMessage={t('dashboard.section.approvals.empty')}
        isEmpty={() => queue.length === 0}
        renderItems={() =>
          queue.slice(0, SECTION_CAP).map((chore) => (
            <ListRow key={chore.id}>
              <span className="flex-1 text-body font-semibold text-ink">{chore.title}</span>
              <span className="text-meta text-ink-mute">{nameFor(chore.assignedTo)}</span>
              <span
                className="text-meta font-semibold text-ink-mute"
                aria-label={moneyLabel(t('dashboard.worthPrefix'), chore.dollarValue, unavailable)}
              >
                {gatedMoney(chore.dollarValue)}
              </span>
            </ListRow>
          ))
        }
      />
    </SectionShell>
  );
}

function UpcomingEventsSection(props: {
  feed: SectionFeed<EventWithId>;
  nowMs: number;
  onNavigate: (screen: ScreenId) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { feed, nowMs, onNavigate } = props;
  const upcoming = selectUpcomingEvents(feed.items, nowMs, SECTION_CAP);
  return (
    <SectionShell
      heading={t('dashboard.section.events.heading')}
      viewAllLabel={t('dashboard.section.events.viewAll')}
      onViewAll={() => onNavigate('calendar')}
    >
      <SectionBody
        feed={feed}
        loadingLabel={t('dashboard.section.events.loading')}
        emptyMessage={t('dashboard.section.events.empty')}
        isEmpty={() => upcoming.length === 0}
        renderItems={() =>
          upcoming.map((event) => (
            <ListRow key={event.id}>
              <span className="flex-1 text-body font-semibold text-ink">{event.title}</span>
              <time dateTime={event.date} className="text-meta text-ink-mute">
                {friendlyDate(event.date)}
              </time>
              <Badge tone={event.tag} size="sm">
                {EVENT_TAG_LABEL[event.tag]}
              </Badge>
            </ListRow>
          ))
        }
      />
    </SectionShell>
  );
}

function RecentPostsSection(props: {
  feed: SectionFeed<PostWithId>;
  nowMs: number;
  onNavigate: (screen: ScreenId) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { feed, nowMs, onNavigate } = props;
  return (
    <SectionShell
      heading={t('dashboard.section.posts.heading')}
      viewAllLabel={t('dashboard.section.posts.viewAll')}
      onViewAll={() => onNavigate('board')}
    >
      <SectionBody
        feed={feed}
        loadingLabel={t('dashboard.section.posts.loading')}
        emptyMessage={t('dashboard.section.posts.empty')}
        renderItems={(items) => {
          const recent = selectRecent(items, SECTION_CAP);
          return recent.map((post) => {
            return (
              <ListRow key={post.id}>
                <div className="flex flex-1 flex-col gap-4">
                  <span className="text-body font-semibold text-ink">{post.authorName}</span>
                  <span className="text-meta text-ink-mute">{post.content}</span>
                </div>
                <time
                  dateTime={new Date(post.createdAt).toISOString()}
                  className="text-meta text-ink-mute"
                >
                  {relativeTime(post.createdAt, nowMs)}
                </time>
              </ListRow>
            );
          });
        }}
      />
    </SectionShell>
  );
}

/**
 * A section landmark: a `<section>` labelled by its `<h2>` (so it exposes a
 * region role with that accessible name), plus a target-specific "View all"
 * button. The button names its target so its accessible name is never the bare
 * ambiguous "View all".
 */
function SectionShell(props: {
  heading: string;
  viewAllLabel: string;
  onViewAll: () => void;
  children: ReactNode;
}): ReactElement {
  const { heading, viewAllLabel, onViewAll, children } = props;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-12">
      <div className="flex items-center justify-between gap-12">
        <h2 id={headingId} className="text-title font-bold text-ink">
          {heading}
        </h2>
        <button
          type="button"
          aria-label={viewAllLabel}
          onClick={onViewAll}
          className="inline-flex min-h-tap items-center rounded-control px-12 text-meta font-semibold text-brand underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          View all
        </button>
      </div>
      <Card>{children}</Card>
    </section>
  );
}

/**
 * Per-section state machine: loading -> Skeleton (role=status); error -> a
 * COMPACT INLINE message within this section only (never a toast/alert role);
 * empty -> friendly EmptyState; else the capped `<ul>/<li>` list. A sibling
 * feed's error never blanks this section.
 */
function SectionBody<T>(props: {
  feed: SectionFeed<T>;
  loadingLabel: string;
  emptyMessage: string;
  renderItems: (items: T[]) => ReactNode[];
  /** Optional override for "is this section empty" (e.g. a filtered queue). */
  isEmpty?: (items: T[]) => boolean;
}): ReactElement {
  const { feed, loadingLabel, emptyMessage, renderItems, isEmpty } = props;

  if (feed.loading) {
    return <Skeleton label={loadingLabel} />;
  }
  if (feed.error !== null) {
    // Single-channel, compact, INLINE error — never role=alert / toast. The copy
    // is the injected user-safe string (AppShell maps any raw provider text to a
    // PII-free message before it reaches the screen).
    return <p className="text-meta text-status-danger-text">{feed.error}</p>;
  }

  const empty = isEmpty ? isEmpty(feed.items) : feed.items.length === 0;
  if (empty) {
    return <EmptyState message={emptyMessage} />;
  }

  return <ul className="flex flex-col gap-8">{renderItems(feed.items)}</ul>;
}

function ListRow(props: { children: ReactNode }): ReactElement {
  return (
    <li className="flex items-center gap-12 rounded-control border border-surface-line bg-surface-card px-14 py-12">
      {props.children}
    </li>
  );
}

function RefreshIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-24 w-24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        d="M20 11a8 8 0 10-2.3 5.7M20 11V5m0 6h-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
