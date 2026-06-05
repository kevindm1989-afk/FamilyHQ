/**
 * Todo list panel — Task Management feature (PR B).
 *
 * Renders the To-Do tab content: four buckets (Overdue, Upcoming, Someday,
 * Completed) over a flat `todos` list. Pure props-injection — no Firebase
 * imports here (services + the hook live in the route wrapper). The shape
 * mirrors SavingsGoalsScreen so the same a11y patterns (aria-labelled
 * sections, role=alert error, EmptyState per group) apply.
 *
 * Authority model: ANY active same-family member can create / toggle / edit
 * / delete a Todo (firestore.rules is authoritative — see
 * `test/rules/todos.test.ts`). UI affordances are NOT gated by role.
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, BottomSheet, Button, EmptyState, Fab, Skeleton, TextField } from '../../components';
import type { Role, UserWithId } from '../../lib/types';
import { bucketTodos, todayISOInLocalTZ } from './todosBuckets';
import {
  TODO_DESCRIPTION_MAX,
  TODO_TITLE_MAX,
  isValidISODate,
  type TodoWithId,
} from './todosService';

export interface TodoListPanelProps {
  viewer: { uid: string; name: string; role: Role };
  members: UserWithId[];
  feed: {
    todos: TodoWithId[];
    loading: boolean;
    error: string | null;
  };
  /** Optional clock injection for deterministic tests. */
  now?: Date;
  onCreate?: (input: {
    title: string;
    description?: string;
    assignedTo?: string;
    dueDate?: string;
  }) => Promise<void>;
  onToggle?: (todoId: string, isCompleted: boolean) => Promise<void>;
  onEdit?: (
    todoId: string,
    patch: {
      title?: string;
      description?: string | null;
      assignedTo?: string | null;
      dueDate?: string | null;
    },
  ) => Promise<void>;
  onDelete?: (todoId: string) => Promise<void>;
}

export function TodoListPanel(props: TodoListPanelProps): ReactElement {
  const { t } = useTranslation();
  const { viewer, members, feed, now, onCreate, onToggle, onEdit, onDelete } = props;
  const todayISO = useMemo(() => todayISOInLocalTZ(now ?? new Date()), [now]);
  const buckets = useMemo(() => bucketTodos(feed.todos, todayISO), [feed.todos, todayISO]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<TodoWithId | null>(null);

  const nameFor = (uid: string): string =>
    members.find((m) => m.id === uid)?.name ?? t('tasks.unknownMember');

  return (
    <section
      aria-label={t('tasks.todo.panelLabel')}
      className="flex flex-col gap-16 px-16 pt-4 pb-24"
    >
      {feed.loading && <Skeleton label={t('tasks.todo.loading')} />}
      {feed.error !== null && !feed.loading && (
        <p role="alert" className="text-meta text-status-danger-text">
          {feed.error}
        </p>
      )}

      {!feed.loading && feed.error === null && (
        <>
          <BucketGroup
            heading={t('tasks.todo.section.overdue')}
            empty=""
            tone="danger"
            todos={buckets.overdue}
            viewerUid={viewer.uid}
            nameFor={nameFor}
            {...(onToggle !== undefined ? { onToggle } : {})}
            {...(onEdit !== undefined ? { onEdit: (todo: TodoWithId) => setEditing(todo) } : {})}
            {...(onDelete !== undefined ? { onDelete } : {})}
          />
          <BucketGroup
            heading={t('tasks.todo.section.upcoming')}
            empty={t('tasks.todo.section.upcomingEmpty')}
            todos={buckets.upcoming}
            viewerUid={viewer.uid}
            nameFor={nameFor}
            {...(onToggle !== undefined ? { onToggle } : {})}
            {...(onEdit !== undefined ? { onEdit: (todo: TodoWithId) => setEditing(todo) } : {})}
            {...(onDelete !== undefined ? { onDelete } : {})}
          />
          <BucketGroup
            heading={t('tasks.todo.section.someday')}
            empty={t('tasks.todo.section.somedayEmpty')}
            todos={buckets.someday}
            viewerUid={viewer.uid}
            nameFor={nameFor}
            {...(onToggle !== undefined ? { onToggle } : {})}
            {...(onEdit !== undefined ? { onEdit: (todo: TodoWithId) => setEditing(todo) } : {})}
            {...(onDelete !== undefined ? { onDelete } : {})}
          />
          {buckets.completed.length > 0 && (
            <BucketGroup
              heading={t('tasks.todo.section.completed')}
              empty=""
              todos={buckets.completed}
              viewerUid={viewer.uid}
              nameFor={nameFor}
              {...(onToggle !== undefined ? { onToggle } : {})}
              {...(onDelete !== undefined ? { onDelete } : {})}
            />
          )}
          {buckets.overdue.length === 0 &&
            buckets.upcoming.length === 0 &&
            buckets.someday.length === 0 &&
            buckets.completed.length === 0 && <EmptyState message={t('tasks.todo.allEmpty')} />}
        </>
      )}

      {onCreate !== undefined && (
        <Fab label={t('tasks.todo.action.create')} onClick={() => setCreateOpen(true)} />
      )}

      <CreateTodoSheet
        open={createOpen}
        members={members}
        onClose={() => setCreateOpen(false)}
        {...(onCreate !== undefined ? { onCreate } : {})}
      />
      {editing !== null && onEdit !== undefined && (
        <EditTodoSheet
          todo={editing}
          members={members}
          onClose={() => setEditing(null)}
          onEdit={onEdit}
        />
      )}
    </section>
  );
}

interface BucketGroupProps {
  heading: string;
  empty: string;
  tone?: 'danger' | 'default';
  todos: TodoWithId[];
  viewerUid: string;
  nameFor: (uid: string) => string;
  onToggle?: (todoId: string, isCompleted: boolean) => Promise<void>;
  onEdit?: (todo: TodoWithId) => void;
  onDelete?: (todoId: string) => Promise<void>;
}

function BucketGroup(props: BucketGroupProps): ReactElement {
  const headingId = useId();
  const toneClass = props.tone === 'danger' ? 'text-status-danger-text' : 'text-ink';
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-8">
      <h2 id={headingId} className={`text-title font-semibold ${toneClass}`}>
        {props.heading}
      </h2>
      {props.todos.length === 0 ? (
        props.empty === '' ? null : (
          <EmptyState message={props.empty} />
        )
      ) : (
        <ul className="flex flex-col gap-8" aria-label={props.heading}>
          {props.todos.map((todo) => (
            <li key={todo.id}>
              <TodoRow
                todo={todo}
                isOverdue={props.tone === 'danger'}
                ownerName={props.nameFor(todo.createdBy)}
                assigneeName={todo.assignedTo !== undefined ? props.nameFor(todo.assignedTo) : null}
                {...(props.onToggle !== undefined ? { onToggle: props.onToggle } : {})}
                {...(props.onEdit !== undefined ? { onEdit: props.onEdit } : {})}
                {...(props.onDelete !== undefined ? { onDelete: props.onDelete } : {})}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface TodoRowProps {
  todo: TodoWithId;
  isOverdue: boolean;
  ownerName: string;
  assigneeName: string | null;
  onToggle?: (todoId: string, isCompleted: boolean) => Promise<void>;
  onEdit?: (todo: TodoWithId) => void;
  onDelete?: (todoId: string) => Promise<void>;
}

function TodoRow(props: TodoRowProps): ReactElement {
  const { t } = useTranslation();
  const { todo, isOverdue, ownerName, assigneeName, onToggle, onEdit, onDelete } = props;
  return (
    <article
      className={`flex flex-col gap-8 rounded-card border border-surface-line bg-surface-card p-12 ${todo.isCompleted ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-12">
        {onToggle !== undefined && (
          <input
            type="checkbox"
            className="mt-4 h-20 w-20 cursor-pointer rounded border-surface-line text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            checked={todo.isCompleted}
            onChange={(e) => void onToggle(todo.id, e.target.checked)}
            aria-label={
              todo.isCompleted
                ? t('tasks.todo.action.markIncompleteLabel', { title: todo.title })
                : t('tasks.todo.action.markCompleteLabel', { title: todo.title })
            }
          />
        )}
        <div className="flex flex-1 flex-col gap-4">
          <p
            className={`text-body font-semibold ${todo.isCompleted ? 'text-ink-mute line-through' : 'text-ink'}`}
          >
            {todo.title}
          </p>
          {todo.description !== undefined && todo.description !== '' && (
            <p className="text-meta text-ink-mute">{todo.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-8">
            {todo.dueDate !== undefined && todo.dueDate !== '' && (
              <Badge tone={isOverdue ? 'danger' : 'mute'} size="sm">
                {t('tasks.todo.dueLabel', { date: todo.dueDate })}
              </Badge>
            )}
            {assigneeName !== null && (
              <Badge tone="info" size="sm">
                {t('tasks.todo.forLabel', { name: assigneeName })}
              </Badge>
            )}
            <span className="text-caption text-ink-mute2">
              {t('tasks.todo.addedBy', { name: ownerName })}
            </span>
          </div>
        </div>
      </div>
      {(onEdit !== undefined || onDelete !== undefined) && (
        <div className="flex flex-wrap justify-end gap-8">
          {onEdit !== undefined && !todo.isCompleted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(todo)}
              aria-label={t('tasks.todo.action.editLabel', { title: todo.title })}
            >
              {t('tasks.todo.action.edit')}
            </Button>
          )}
          {onDelete !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDelete(todo.id)}
              aria-label={t('tasks.todo.action.deleteLabel', { title: todo.title })}
            >
              {t('tasks.todo.action.delete')}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

interface CreateTodoSheetProps {
  open: boolean;
  members: UserWithId[];
  onClose: () => void;
  onCreate?: (input: {
    title: string;
    description?: string;
    assignedTo?: string;
    dueDate?: string;
  }) => Promise<void>;
}

function CreateTodoSheet(props: CreateTodoSheetProps): ReactElement | null {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!props.open || props.onCreate === undefined) return null;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('tasks.todo.error.titleRequired'));
      return;
    }
    if (trimmed.length > TODO_TITLE_MAX) {
      setError(t('tasks.todo.error.titleTooLong'));
      return;
    }
    if (dueDate !== '' && !isValidISODate(dueDate)) {
      setError(t('tasks.todo.error.dueDateInvalid'));
      return;
    }
    setBusy(true);
    try {
      await props.onCreate?.({
        title: trimmed,
        ...(description.trim() !== '' ? { description: description.trim() } : {}),
        ...(assignedTo !== '' ? { assignedTo } : {}),
        ...(dueDate !== '' ? { dueDate } : {}),
      });
      setTitle('');
      setDescription('');
      setAssignedTo('');
      setDueDate('');
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tasks.todo.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={props.onClose} title={t('tasks.todo.create.title')}>
      <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
        <TextField
          label={t('tasks.todo.create.titleLabel')}
          value={title}
          onChange={setTitle}
          required
        />
        <TextField
          label={t('tasks.todo.create.descriptionLabel')}
          value={description}
          onChange={setDescription}
        />
        <MemberPicker
          label={t('tasks.todo.create.assigneeLabel')}
          members={props.members}
          value={assignedTo}
          onChange={setAssignedTo}
          noneLabel={t('tasks.todo.create.assigneeNone')}
        />
        <DateInput
          label={t('tasks.todo.create.dueDateLabel')}
          value={dueDate}
          onChange={setDueDate}
        />
        {error !== null && (
          <p role="alert" className="text-meta text-status-danger-text">
            {error}
          </p>
        )}
        <p className="text-caption text-ink-mute2">
          {t('tasks.todo.create.descriptionMaxHint', { max: TODO_DESCRIPTION_MAX })}
        </p>
        <div className="flex justify-end gap-8">
          <Button variant="ghost" onClick={props.onClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('tasks.todo.create.submit')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}

interface EditTodoSheetProps {
  todo: TodoWithId;
  members: UserWithId[];
  onClose: () => void;
  onEdit: (
    todoId: string,
    patch: {
      title?: string;
      description?: string | null;
      assignedTo?: string | null;
      dueDate?: string | null;
    },
  ) => Promise<void>;
}

function EditTodoSheet(props: EditTodoSheetProps): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState(props.todo.title);
  const [description, setDescription] = useState(props.todo.description ?? '');
  const [assignedTo, setAssignedTo] = useState(props.todo.assignedTo ?? '');
  const [dueDate, setDueDate] = useState(props.todo.dueDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('tasks.todo.error.titleRequired'));
      return;
    }
    if (trimmed.length > TODO_TITLE_MAX) {
      setError(t('tasks.todo.error.titleTooLong'));
      return;
    }
    if (dueDate !== '' && !isValidISODate(dueDate)) {
      setError(t('tasks.todo.error.dueDateInvalid'));
      return;
    }
    setBusy(true);
    try {
      const patch: Parameters<typeof props.onEdit>[1] = {};
      if (trimmed !== props.todo.title) patch.title = trimmed;
      const trimmedDesc = description.trim();
      const prevDesc = props.todo.description ?? '';
      if (trimmedDesc !== prevDesc) patch.description = trimmedDesc === '' ? null : trimmedDesc;
      const prevAssignee = props.todo.assignedTo ?? '';
      if (assignedTo !== prevAssignee) patch.assignedTo = assignedTo === '' ? null : assignedTo;
      const prevDue = props.todo.dueDate ?? '';
      if (dueDate !== prevDue) patch.dueDate = dueDate === '' ? null : dueDate;
      await props.onEdit(props.todo.id, patch);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tasks.todo.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={props.onClose} title={t('tasks.todo.edit.title')}>
      <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
        <TextField
          label={t('tasks.todo.create.titleLabel')}
          value={title}
          onChange={setTitle}
          required
        />
        <TextField
          label={t('tasks.todo.create.descriptionLabel')}
          value={description}
          onChange={setDescription}
        />
        <MemberPicker
          label={t('tasks.todo.create.assigneeLabel')}
          members={props.members}
          value={assignedTo}
          onChange={setAssignedTo}
          noneLabel={t('tasks.todo.create.assigneeNone')}
        />
        <DateInput
          label={t('tasks.todo.create.dueDateLabel')}
          value={dueDate}
          onChange={setDueDate}
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
            {t('tasks.todo.edit.submit')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}

interface DateInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function DateInput(props: DateInputProps): ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-6">
      <label htmlFor={id} className="text-label font-semibold text-ink-2">
        {props.label}
      </label>
      <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
        <input
          id={id}
          type="date"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="w-full bg-transparent text-body text-ink focus:outline-none"
        />
      </div>
    </div>
  );
}

interface MemberPickerProps {
  label: string;
  members: UserWithId[];
  value: string;
  onChange: (uid: string) => void;
  noneLabel: string;
}

function MemberPicker(props: MemberPickerProps): ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={id} className="text-meta font-semibold text-ink">
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="min-h-tap rounded-control border border-surface-line bg-surface-card px-12 text-body text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
      >
        <option value="">{props.noneLabel}</option>
        {props.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
