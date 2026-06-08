/**
 * Routines panel — Task Management feature (PR C).
 *
 * Renders the Routine Checklists tab content. Two sections:
 *  - "My runs today" — every live (non-completed) instance owned by the
 *    viewer. Per-item checkboxes, "Done" button, "Remove run".
 *  - "Routines" — every template the viewer can see (shared + own
 *    drafts). Each row has a "Start" button (creates a new instance
 *    for today, owner=self) and, when the viewer is the creator OR a
 *    parent, Edit + Delete.
 *
 * The component is props-injected: services + hooks live in the route
 * wrapper. UI affordances are gated by the AUTHOR/PARENT predicate to
 * match the firestore.rules read of Q-A (creator+parents edit/delete);
 * the rule layer is the safety net.
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, BottomSheet, Button, EmptyState, Fab, Skeleton, TextField } from '../../components';
import type { Role, UserWithId } from '../../lib/types';
import {
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_TITLE_MAX,
  instanceProgress,
  newItemId,
  type ChecklistInstanceWithId,
  type ChecklistTemplateWithId,
} from './checklistsService';

export interface RoutinesPanelProps {
  viewer: { uid: string; name: string; role: Role };
  members: UserWithId[];
  templatesFeed: {
    templates: ChecklistTemplateWithId[];
    loading: boolean;
    error: string | null;
  };
  instancesFeed: {
    instances: ChecklistInstanceWithId[];
    loading: boolean;
    error: string | null;
  };
  onCreateTemplate?: (input: {
    title: string;
    isSharedWithFamily: boolean;
    items: { id?: string; text: string }[];
  }) => Promise<void>;
  onEditTemplate?: (
    templateId: string,
    input: {
      title?: string;
      isSharedWithFamily?: boolean;
      items?: { id?: string; text: string }[];
    },
  ) => Promise<void>;
  onDeleteTemplate?: (templateId: string) => Promise<void>;
  onStartInstance?: (templateId: string) => Promise<void>;
  onToggleItem?: (instanceId: string, itemId: string, checked: boolean) => Promise<void>;
  onCompleteInstance?: (instanceId: string, isCompleted: boolean) => Promise<void>;
  onDeleteInstance?: (instanceId: string) => Promise<void>;
}

export function RoutinesPanel(props: RoutinesPanelProps): ReactElement {
  const { t } = useTranslation();
  const {
    viewer,
    members,
    templatesFeed,
    instancesFeed,
    onCreateTemplate,
    onEditTemplate,
    onDeleteTemplate,
    onStartInstance,
    onToggleItem,
    onCompleteInstance,
    onDeleteInstance,
  } = props;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplateWithId | null>(null);

  const isParent = viewer.role === 'parent';

  const templateById = useMemo(() => {
    const m = new Map<string, ChecklistTemplateWithId>();
    for (const tpl of templatesFeed.templates) m.set(tpl.id, tpl);
    return m;
  }, [templatesFeed.templates]);

  // My RUNNING instances live in the top section so the kid sees what
  // they're in the middle of right away. Completed runs collapse into a
  // secondary section at the bottom of the panel.
  const myRunning = useMemo(
    () => instancesFeed.instances.filter((i) => i.userId === viewer.uid && !i.isCompleted),
    [instancesFeed.instances, viewer.uid],
  );
  const myCompleted = useMemo(
    () =>
      instancesFeed.instances
        .filter((i) => i.userId === viewer.uid && i.isCompleted)
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    [instancesFeed.instances, viewer.uid],
  );

  const nameFor = (uid: string): string =>
    members.find((m) => m.id === uid)?.name ?? t('tasks.unknownMember');

  const loading = templatesFeed.loading || instancesFeed.loading;
  const error = templatesFeed.error ?? instancesFeed.error;

  return (
    <section
      aria-label={t('tasks.routines.panelLabel')}
      className="flex flex-col gap-16 px-16 pt-4 pb-24"
    >
      {loading && <Skeleton label={t('tasks.routines.loading')} />}
      {error !== null && !loading && (
        <p role="alert" className="text-meta text-status-danger-text">
          {error}
        </p>
      )}

      {!loading && error === null && (
        <>
          <section aria-labelledby="my-running-runs" className="flex flex-col gap-8">
            <h2 id="my-running-runs" className="text-title font-semibold text-ink">
              {t('tasks.routines.section.myRuns')}
            </h2>
            {myRunning.length === 0 ? (
              <EmptyState message={t('tasks.routines.section.myRunsEmpty')} />
            ) : (
              <ul className="flex flex-col gap-12" aria-label={t('tasks.routines.section.myRuns')}>
                {myRunning.map((instance) => {
                  const template = templateById.get(instance.templateId) ?? null;
                  return (
                    <li key={instance.id}>
                      <InstanceCard
                        instance={instance}
                        template={template}
                        {...(onToggleItem !== undefined ? { onToggleItem } : {})}
                        {...(onCompleteInstance !== undefined ? { onCompleteInstance } : {})}
                        {...(onDeleteInstance !== undefined ? { onDeleteInstance } : {})}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="all-templates" className="flex flex-col gap-8">
            <h2 id="all-templates" className="text-title font-semibold text-ink">
              {t('tasks.routines.section.templates')}
            </h2>
            {templatesFeed.templates.length === 0 ? (
              <EmptyState message={t('tasks.routines.section.templatesEmpty')} />
            ) : (
              <ul
                className="flex flex-col gap-12"
                aria-label={t('tasks.routines.section.templates')}
              >
                {templatesFeed.templates.map((template) => {
                  const canEdit = template.createdBy === viewer.uid || isParent;
                  const creatorName = nameFor(template.createdBy);
                  return (
                    <li key={template.id}>
                      <TemplateCard
                        template={template}
                        canEdit={canEdit}
                        creatorName={creatorName}
                        {...(onStartInstance !== undefined ? { onStartInstance } : {})}
                        {...(canEdit && onEditTemplate !== undefined
                          ? { onEdit: () => setEditing(template) }
                          : {})}
                        {...(canEdit && onDeleteTemplate !== undefined
                          ? { onDelete: onDeleteTemplate }
                          : {})}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {myCompleted.length > 0 && (
            <section aria-labelledby="my-completed-runs" className="flex flex-col gap-8">
              <h2 id="my-completed-runs" className="text-title font-semibold text-ink">
                {t('tasks.routines.section.completed')}
              </h2>
              <ul
                className="flex flex-col gap-8"
                aria-label={t('tasks.routines.section.completed')}
              >
                {myCompleted.slice(0, 10).map((instance) => {
                  const template = templateById.get(instance.templateId) ?? null;
                  const progress = instanceProgress(template, instance);
                  return (
                    <li
                      key={instance.id}
                      className="flex items-center justify-between rounded-card border border-surface-line bg-surface-card p-12"
                    >
                      <div>
                        <p className="text-body font-semibold text-ink">
                          {template?.title ?? t('tasks.routines.deletedTemplate')}
                        </p>
                        <p className="text-meta text-ink-mute">
                          {t('tasks.routines.progressLabel', {
                            checked: progress.checked,
                            total: progress.total,
                          })}{' '}
                          · {instance.date}
                        </p>
                      </div>
                      {onDeleteInstance !== undefined && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void onDeleteInstance(instance.id)}
                          aria-label={t('tasks.routines.action.removeRunLabel', {
                            title: template?.title ?? '',
                          })}
                        >
                          {t('tasks.routines.action.removeRun')}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {onCreateTemplate !== undefined && (
        <Fab label={t('tasks.routines.action.create')} onClick={() => setCreateOpen(true)} />
      )}

      <CreateTemplateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        {...(onCreateTemplate !== undefined ? { onCreate: onCreateTemplate } : {})}
      />
      {editing !== null && onEditTemplate !== undefined && (
        <EditTemplateSheet
          template={editing}
          onClose={() => setEditing(null)}
          onEdit={onEditTemplate}
        />
      )}
    </section>
  );
}

interface InstanceCardProps {
  instance: ChecklistInstanceWithId;
  template: ChecklistTemplateWithId | null;
  onToggleItem?: (instanceId: string, itemId: string, checked: boolean) => Promise<void>;
  onCompleteInstance?: (instanceId: string, isCompleted: boolean) => Promise<void>;
  onDeleteInstance?: (instanceId: string) => Promise<void>;
}

function InstanceCard(props: InstanceCardProps): ReactElement {
  const { t } = useTranslation();
  const { instance, template, onToggleItem, onCompleteInstance, onDeleteInstance } = props;
  const progress = instanceProgress(template, instance);
  const items = template?.items ?? [];

  return (
    <article className="flex flex-col gap-8 rounded-card border border-surface-line bg-surface-card p-12">
      <div className="flex items-center justify-between gap-8">
        <div>
          <h3 className="text-body font-bold text-ink">
            {template?.title ?? t('tasks.routines.deletedTemplate')}
          </h3>
          <p className="text-meta text-ink-mute">
            {t('tasks.routines.progressLabel', {
              checked: progress.checked,
              total: progress.total,
            })}{' '}
            · {instance.date}
          </p>
        </div>
        {progress.total > 0 && progress.checked === progress.total && (
          <Badge tone="ok" size="sm">
            {t('tasks.routines.allDoneBadge')}
          </Badge>
        )}
      </div>
      {items.length > 0 && onToggleItem !== undefined && (
        <ul className="flex flex-col gap-4">
          {items.map((item) => {
            const checked = instance.itemsProgress[item.id] === true;
            return (
              <li key={item.id} className="flex items-start gap-8">
                <input
                  type="checkbox"
                  className="mt-4 h-20 w-20 cursor-pointer rounded border-surface-line text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                  checked={checked}
                  onChange={(e) => void onToggleItem(instance.id, item.id, e.target.checked)}
                  aria-label={
                    checked
                      ? t('tasks.routines.action.uncheckItemLabel', { text: item.text })
                      : t('tasks.routines.action.checkItemLabel', { text: item.text })
                  }
                />
                <span
                  className={`text-body ${checked ? 'text-ink-mute line-through' : 'text-ink'}`}
                >
                  {item.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-8">
        {onCompleteInstance !== undefined && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onCompleteInstance(instance.id, true)}
            aria-label={t('tasks.routines.action.doneLabel', {
              title: template?.title ?? '',
            })}
          >
            {t('tasks.routines.action.done')}
          </Button>
        )}
        {onDeleteInstance !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onDeleteInstance(instance.id)}
            aria-label={t('tasks.routines.action.removeRunLabel', {
              title: template?.title ?? '',
            })}
          >
            {t('tasks.routines.action.removeRun')}
          </Button>
        )}
      </div>
    </article>
  );
}

interface TemplateCardProps {
  template: ChecklistTemplateWithId;
  canEdit: boolean;
  creatorName: string;
  onStartInstance?: (templateId: string) => Promise<void>;
  onEdit?: () => void;
  onDelete?: (templateId: string) => Promise<void>;
}

function TemplateCard(props: TemplateCardProps): ReactElement {
  const { t } = useTranslation();
  const { template, creatorName, onStartInstance, onEdit, onDelete } = props;
  return (
    <article className="flex flex-col gap-8 rounded-card border border-surface-line bg-surface-card p-12">
      <div className="flex flex-wrap items-center gap-8">
        <h3 className="flex-1 text-body font-bold text-ink">{template.title}</h3>
        {!template.isSharedWithFamily && (
          <Badge tone="mute" size="sm">
            {t('tasks.routines.draftBadge')}
          </Badge>
        )}
      </div>
      <p className="text-meta text-ink-mute">
        {t('tasks.routines.itemsLabel', { count: template.items.length })} ·{' '}
        {t('tasks.routines.createdBy', { name: creatorName })}
      </p>
      <div className="flex flex-wrap justify-end gap-8">
        {onStartInstance !== undefined && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onStartInstance(template.id)}
            aria-label={t('tasks.routines.action.startLabel', { title: template.title })}
          >
            {t('tasks.routines.action.start')}
          </Button>
        )}
        {onEdit !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={t('tasks.routines.action.editLabel', { title: template.title })}
          >
            {t('tasks.routines.action.edit')}
          </Button>
        )}
        {onDelete !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onDelete(template.id)}
            aria-label={t('tasks.routines.action.deleteLabel', { title: template.title })}
          >
            {t('tasks.routines.action.delete')}
          </Button>
        )}
      </div>
    </article>
  );
}

interface DraftItem {
  id?: string;
  text: string;
}

interface TemplateFormProps {
  initialTitle: string;
  initialShared: boolean;
  initialItems: DraftItem[];
  submitLabel: string;
  onSubmit: (input: {
    title: string;
    isSharedWithFamily: boolean;
    items: DraftItem[];
  }) => Promise<void>;
  onClose: () => void;
}

function TemplateForm(props: TemplateFormProps): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState(props.initialTitle);
  const [isShared, setIsShared] = useState(props.initialShared);
  const [items, setItems] = useState<DraftItem[]>(
    props.initialItems.length > 0 ? props.initialItems : [{ text: '' }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sharedId = useId();

  const handleAddItem = (): void => {
    if (items.length >= CHECKLIST_MAX_ITEMS) return;
    setItems((prev) => [...prev, { text: '' }]);
  };

  const handleItemChange = (index: number, text: string): void => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, text } : it)));
  };

  const handleRemoveItem = (index: number): void => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('tasks.routines.error.titleRequired'));
      return;
    }
    if (trimmed.length > CHECKLIST_TITLE_MAX) {
      setError(t('tasks.routines.error.titleTooLong'));
      return;
    }
    const nonEmpty = items.filter((it) => it.text.trim().length > 0);
    if (nonEmpty.length === 0) {
      setError(t('tasks.routines.error.itemsRequired'));
      return;
    }
    setBusy(true);
    try {
      await props.onSubmit({
        title: trimmed,
        isSharedWithFamily: isShared,
        items: nonEmpty,
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tasks.routines.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
      <TextField
        label={t('tasks.routines.create.titleLabel')}
        value={title}
        onChange={setTitle}
        required
      />
      <div className="flex items-center gap-8">
        <input
          id={sharedId}
          type="checkbox"
          checked={isShared}
          onChange={(e) => setIsShared(e.target.checked)}
          className="h-20 w-20 cursor-pointer rounded border-surface-line text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        />
        <label htmlFor={sharedId} className="text-body text-ink">
          {t('tasks.routines.create.shareLabel')}
        </label>
      </div>
      <fieldset className="flex flex-col gap-8">
        <legend className="text-label font-semibold text-ink-2">
          {t('tasks.routines.create.itemsLabel')}
        </legend>
        {items.map((item, i) => (
          <div key={item.id ?? `new-${i}`} className="flex items-center gap-8">
            <input
              type="text"
              value={item.text}
              onChange={(e) => handleItemChange(i, e.target.value)}
              placeholder={t('tasks.routines.create.itemPlaceholder')}
              aria-label={t('tasks.routines.create.itemAria', { n: i + 1 })}
              className="min-h-tap flex-1 rounded-control border border-surface-line bg-surface-card px-12 text-body text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            />
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => handleRemoveItem(i)}
              aria-label={t('tasks.routines.create.removeItemAria', { n: i + 1 })}
            >
              {t('tasks.routines.create.removeItem')}
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={handleAddItem}
          disabled={items.length >= CHECKLIST_MAX_ITEMS}
        >
          {t('tasks.routines.create.addItem')}
        </Button>
      </fieldset>
      {error !== null && (
        <p role="alert" className="text-meta text-status-danger-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-8">
        <Button variant="ghost" type="button" onClick={props.onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={busy}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

interface CreateTemplateSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate?: (input: {
    title: string;
    isSharedWithFamily: boolean;
    items: DraftItem[];
  }) => Promise<void>;
}

function CreateTemplateSheet(props: CreateTemplateSheetProps): ReactElement | null {
  const { t } = useTranslation();
  if (!props.open || props.onCreate === undefined) return null;
  return (
    <BottomSheet open onClose={props.onClose} title={t('tasks.routines.create.title')}>
      <TemplateForm
        initialTitle=""
        initialShared
        initialItems={[{ id: newItemId(), text: '' }]}
        submitLabel={t('tasks.routines.create.submit')}
        onSubmit={props.onCreate}
        onClose={props.onClose}
      />
    </BottomSheet>
  );
}

interface EditTemplateSheetProps {
  template: ChecklistTemplateWithId;
  onClose: () => void;
  onEdit: (
    templateId: string,
    input: {
      title?: string;
      isSharedWithFamily?: boolean;
      items?: DraftItem[];
    },
  ) => Promise<void>;
}

function EditTemplateSheet(props: EditTemplateSheetProps): ReactElement {
  const { t } = useTranslation();
  return (
    <BottomSheet open onClose={props.onClose} title={t('tasks.routines.edit.title')}>
      <TemplateForm
        initialTitle={props.template.title}
        initialShared={props.template.isSharedWithFamily}
        initialItems={props.template.items.map((it) => ({ id: it.id, text: it.text }))}
        submitLabel={t('tasks.routines.edit.submit')}
        onSubmit={async (input) => {
          await props.onEdit(props.template.id, input);
        }}
        onClose={props.onClose}
      />
    </BottomSheet>
  );
}
