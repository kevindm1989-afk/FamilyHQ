/**
 * Savings Goals screen — Feature 1 (Savings Goals & Jars).
 *
 * Layout (deterministic, INJECTED PROPS — no Firebase):
 *  - LOADING -> Skeleton
 *  - ERROR -> compact inline error (single channel; never a toast)
 *  - ACTIVE LIST -> heading + list of <GoalCard>s, soonest-created first.
 *  - COMPLETED + ARCHIVED lists are collapsed beneath the active list as
 *    secondary sections.
 *  - MEMBER (own goals): "+ New goal" CTA opens the create sheet.
 *  - PARENT: sees every family goal; per-row Contribute + Complete +
 *    Archive + Delete affordances.
 *
 * UI gating is cosmetic — firestore.rules is authoritative (see
 * `test/rules/savings-goals.test.ts`).
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, BottomSheet, Button, EmptyState, Fab, Skeleton, TextField } from '../../components';
import { formatMoney, isValidMoneyCents } from '../chores/choresParentService';
import type { Role, UserWithId } from '../../lib/types';
import type { SavingsGoalWithId } from './savingsGoalsService';
import { savingsGoalProgressPercent } from './savingsGoalsService';

export interface SavingsGoalsScreenProps {
  viewer: { uid: string; name: string; role: Role };
  members: UserWithId[];
  feed: {
    goals: SavingsGoalWithId[];
    loading: boolean;
    error: string | null;
  };
  onCreate?: (input: { title: string; targetAmountCents: number }) => Promise<void>;
  onContribute?: (goalId: string, centsToAdd: number) => Promise<void>;
  /** Parent-only. Flip an active goal to its terminal state. */
  onComplete?: (goalId: string) => Promise<void>;
  onArchive?: (goalId: string) => Promise<void>;
  onDelete?: (goalId: string) => Promise<void>;
}

const GOAL_TITLE_MAX = 80;

export function SavingsGoalsScreen(props: SavingsGoalsScreenProps): ReactElement {
  const { t } = useTranslation();
  const { viewer, members, feed, onCreate, onContribute, onComplete, onArchive, onDelete } = props;
  const isParent = viewer.role === 'parent';

  const [createOpen, setCreateOpen] = useState(false);
  const [contributing, setContributing] = useState<{ goalId: string } | null>(null);

  const grouped = useMemo(() => {
    const active: SavingsGoalWithId[] = [];
    const completed: SavingsGoalWithId[] = [];
    const archived: SavingsGoalWithId[] = [];
    for (const goal of feed.goals) {
      if (goal.status === 'active') active.push(goal);
      else if (goal.status === 'completed') completed.push(goal);
      else archived.push(goal);
    }
    return { active, completed, archived };
  }, [feed.goals]);

  const nameFor = (uid: string): string =>
    members.find((m) => m.id === uid)?.name ?? t('savings.unknownMember');

  return (
    <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
      <h1 className="text-display font-display font-extrabold text-ink">{t('savings.title')}</h1>

      {feed.loading && <Skeleton label={t('savings.loading')} />}
      {feed.error !== null && !feed.loading && (
        <p role="alert" className="text-meta text-status-danger-text">
          {feed.error}
        </p>
      )}

      {!feed.loading && feed.error === null && (
        <>
          <GoalGroup
            heading={t('savings.section.active')}
            empty={
              isParent
                ? t('savings.section.activeEmptyParent')
                : t('savings.section.activeEmptyMember')
            }
            goals={grouped.active}
            isParent={isParent}
            nameFor={nameFor}
            {...(onContribute !== undefined
              ? { onContribute: (goalId: string) => setContributing({ goalId }) }
              : {})}
            {...(onComplete !== undefined ? { onComplete } : {})}
            {...(onArchive !== undefined ? { onArchive } : {})}
            {...(onDelete !== undefined ? { onDelete } : {})}
          />
          {grouped.completed.length > 0 && (
            <GoalGroup
              heading={t('savings.section.completed')}
              empty=""
              goals={grouped.completed}
              isParent={isParent}
              nameFor={nameFor}
              {...(onDelete !== undefined ? { onDelete } : {})}
            />
          )}
          {grouped.archived.length > 0 && (
            <GoalGroup
              heading={t('savings.section.archived')}
              empty=""
              goals={grouped.archived}
              isParent={isParent}
              nameFor={nameFor}
              {...(onDelete !== undefined ? { onDelete } : {})}
            />
          )}
        </>
      )}

      {/* "+ New goal" — every signed-in viewer can create one (rules limit
          ownerUid to self / a parent on behalf of a member). Live as a
          floating button so the action is reachable from anywhere in the
          screen, mirroring the Calendar's Add Event affordance. */}
      {onCreate !== undefined && (
        <Fab label={t('savings.action.create')} onClick={() => setCreateOpen(true)} />
      )}

      <CreateGoalSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        {...(onCreate !== undefined ? { onCreate } : {})}
      />
      {contributing !== null && (
        <ContributeSheet
          goal={feed.goals.find((g) => g.id === contributing.goalId) ?? null}
          onClose={() => setContributing(null)}
          {...(onContribute !== undefined ? { onContribute } : {})}
        />
      )}
    </section>
  );
}

function GoalGroup(props: {
  heading: string;
  empty: string;
  goals: SavingsGoalWithId[];
  isParent: boolean;
  nameFor: (uid: string) => string;
  onContribute?: (goalId: string) => void;
  onComplete?: (goalId: string) => Promise<void>;
  onArchive?: (goalId: string) => Promise<void>;
  onDelete?: (goalId: string) => Promise<void>;
}): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-12">
      <h2 id={headingId} className="text-title font-semibold text-ink">
        {props.heading}
      </h2>
      {props.goals.length === 0 ? (
        props.empty === '' ? null : (
          <EmptyState message={props.empty} />
        )
      ) : (
        <ul className="flex flex-col gap-12" aria-label={props.heading}>
          {props.goals.map((goal) => (
            <li key={goal.id}>
              <GoalCard
                goal={goal}
                isParent={props.isParent}
                ownerName={props.nameFor(goal.ownerUid)}
                {...(props.onContribute !== undefined ? { onContribute: props.onContribute } : {})}
                {...(props.onComplete !== undefined ? { onComplete: props.onComplete } : {})}
                {...(props.onArchive !== undefined ? { onArchive: props.onArchive } : {})}
                {...(props.onDelete !== undefined ? { onDelete: props.onDelete } : {})}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GoalCard(props: {
  goal: SavingsGoalWithId;
  isParent: boolean;
  ownerName: string;
  onContribute?: (goalId: string) => void;
  onComplete?: (goalId: string) => Promise<void>;
  onArchive?: (goalId: string) => Promise<void>;
  onDelete?: (goalId: string) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const { goal, isParent, ownerName, onContribute, onComplete, onArchive, onDelete } = props;
  const pct = savingsGoalProgressPercent(goal.currentAmount, goal.targetAmount);
  const moneyOk = isValidMoneyCents(goal.currentAmount) && isValidMoneyCents(goal.targetAmount);
  const currentLabel = moneyOk ? formatMoney(goal.currentAmount) : t('common.unavailable');
  const targetLabel = moneyOk ? formatMoney(goal.targetAmount) : t('common.unavailable');
  const progressLabel = t('savings.progressLabel', {
    current: currentLabel,
    target: targetLabel,
    percent: pct,
  });

  const isActive = goal.status === 'active';

  return (
    <article className="flex flex-col gap-12 rounded-card border border-surface-line bg-surface-card p-16">
      <div className="flex flex-wrap items-center gap-8">
        <h3 className="flex-1 text-body font-bold text-ink">{goal.title}</h3>
        {goal.status === 'completed' && (
          <Badge tone="ok" size="sm">
            {t('savings.badge.completed')}
          </Badge>
        )}
        {goal.status === 'archived' && (
          <Badge tone="mute" size="sm">
            {t('savings.badge.archived')}
          </Badge>
        )}
      </div>
      {isParent && (
        <p className="text-meta text-ink-mute">{t('savings.ownedBy', { name: ownerName })}</p>
      )}
      <div
        className="flex flex-col gap-4"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={progressLabel}
      >
        <div className="h-8 w-full overflow-hidden rounded-pill bg-surface-line">
          <div
            className="h-full rounded-pill bg-brand"
            style={{ width: `${pct}%` }}
            data-testid="savings-progress-fill"
          />
        </div>
        <p className="text-meta text-ink-mute">
          {currentLabel} / {targetLabel} ({pct}%)
        </p>
      </div>
      {goal.targetDate !== undefined && goal.targetDate !== '' && (
        <p className="text-meta text-ink-mute">
          {t('savings.targetDate', { date: goal.targetDate })}
        </p>
      )}
      {isActive && (
        <div className="flex flex-wrap gap-8">
          {onContribute !== undefined && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onContribute(goal.id)}
              aria-label={t('savings.action.contributeLabel', { title: goal.title })}
            >
              {t('savings.action.contribute')}
            </Button>
          )}
          {isParent && onComplete !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onComplete(goal.id)}
              aria-label={t('savings.action.completeLabel', { title: goal.title })}
            >
              {t('savings.action.complete')}
            </Button>
          )}
          {isParent && onArchive !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onArchive(goal.id)}
              aria-label={t('savings.action.archiveLabel', { title: goal.title })}
            >
              {t('savings.action.archive')}
            </Button>
          )}
        </div>
      )}
      {!isActive && isParent && onDelete !== undefined && (
        <div className="flex flex-wrap gap-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onDelete(goal.id)}
            aria-label={t('savings.action.deleteLabel', { title: goal.title })}
          >
            {t('savings.action.delete')}
          </Button>
        </div>
      )}
    </article>
  );
}

function CreateGoalSheet(props: {
  open: boolean;
  onClose: () => void;
  onCreate?: (input: { title: string; targetAmountCents: number }) => Promise<void>;
}): ReactElement | null {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [targetDollars, setTargetDollars] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open || props.onCreate === undefined) return null;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('savings.error.titleRequired'));
      return;
    }
    if (trimmed.length > GOAL_TITLE_MAX) {
      setError(t('savings.error.titleTooLong'));
      return;
    }
    const dollars = Number.parseFloat(targetDollars);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError(t('savings.error.targetRequired'));
      return;
    }
    setBusy(true);
    try {
      await props.onCreate?.({
        title: trimmed,
        targetAmountCents: Math.round(dollars * 100),
      });
      setTitle('');
      setTargetDollars('');
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={props.onClose} title={t('savings.create.title')}>
      <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
        <TextField
          label={t('savings.create.titleLabel')}
          value={title}
          onChange={setTitle}
          required
        />
        <TextField
          label={t('savings.create.targetLabel')}
          value={targetDollars}
          onChange={setTargetDollars}
          placeholder="0.00"
          required
        />
        {error !== null && (
          <p role="alert" className="text-meta text-status-danger-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-8">
          <Button variant="ghost" onClick={props.onClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('savings.create.submit')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}

function ContributeSheet(props: {
  goal: SavingsGoalWithId | null;
  onClose: () => void;
  onContribute?: (goalId: string, cents: number) => Promise<void>;
}): ReactElement | null {
  const { t } = useTranslation();
  const [dollars, setDollars] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (props.goal === null || props.onContribute === undefined) return null;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const amount = Number.parseFloat(dollars);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('savings.error.contributeRequired'));
      return;
    }
    setBusy(true);
    try {
      await props.onContribute?.(props.goal!.id, Math.round(amount * 100));
      setDollars('');
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savings.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={props.onClose} title={t('savings.contribute.title')}>
      <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
        <p className="text-body text-ink-mute">
          {t('savings.contribute.body', { title: props.goal.title })}
        </p>
        <TextField
          label={t('savings.contribute.amountLabel')}
          value={dollars}
          onChange={setDollars}
          placeholder="0.00"
          required
        />
        {error !== null && (
          <p role="alert" className="text-meta text-status-danger-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-8">
          <Button variant="ghost" onClick={props.onClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('savings.contribute.submit')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
