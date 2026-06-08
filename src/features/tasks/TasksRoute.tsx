/**
 * Tasks route — Task Management feature (PRs B + C).
 *
 * Owns the two-tab shell ("To-Do List" + "Routine Checklists") that lives on
 * `/tasks`. PR B shipped the To-Do tab; PR C lights up the Routines tab
 * (templates + running instances). Tabs are pure client-side state — no URL
 * fragment yet (the feature is small enough that `useState` is honest; we'll
 * graduate to a route param if deep-linking is ever asked for).
 *
 * Authority model:
 *  - Todos: ANY active same-family member has full CRUD
 *    (firestore.rules — see `test/rules/todos.test.ts`).
 *  - Checklist templates: ANY active same-family member creates; creator
 *    OR same-family parent edits / deletes (per Q-A — stricter than the
 *    literal spec to stop sibling-pranks).
 *  - Checklist instances: ANY active same-family member creates with
 *    `userId=self` (parents don't impersonate); UPDATE is owner-only;
 *    DELETE is owner OR same-family parent.
 *
 * UI affordances mirror these where useful (the Routines edit/delete
 * buttons only render for the creator + a parent) but the rules-test
 * suite is the safety net.
 *
 * Default-exported for React.lazy in AppShell.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { useToast } from '../../hooks/useToast';
import { RoutinesPanel } from './RoutinesPanel';
import { TodoListPanel } from './TodoListPanel';
import { useFamilyChecklistInstances } from './useFamilyChecklistInstances';
import { useFamilyChecklistTemplates } from './useFamilyChecklistTemplates';
import { useFamilyTodos } from './useFamilyTodos';
import {
  createTemplate,
  deleteInstance,
  deleteTemplate,
  setInstanceCompletion,
  setInstanceItemProgress,
  startInstance,
  updateTemplate,
} from './checklistsService';
import { createTodo, deleteTodo, setTodoCompletion, updateTodo } from './todosService';
import { todayISOInLocalTZ } from './todosBuckets';

type TabId = 'todos' | 'routines';

async function resolveDb(): Promise<import('firebase/firestore').Firestore | null> {
  try {
    const { db } = await import('../../firebase/config');
    return db;
  } catch {
    return null;
  }
}

export default function TasksRoute(): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { familyId, currentUser, members, role } = useFamily();
  const feed = useFamilyTodos(familyId);
  const templatesFeed = useFamilyChecklistTemplates(familyId, currentUser?.id ?? null);
  const instancesFeed = useFamilyChecklistInstances(familyId);
  const [tab, setTab] = useState<TabId>('todos');

  if (!currentUser || !familyId || role === null) {
    return <Placeholder title={t('tasks.title')} />;
  }

  const viewer = { uid: currentUser.id, name: currentUser.name, role };

  const handleCreate = async (input: {
    title: string;
    description?: string;
    assignedTo?: string;
    dueDate?: string;
  }): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await createTodo(
        { db },
        {
          familyId,
          createdBy: currentUser.id,
          title: input.title,
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        },
      );
      showToast(t('tasks.toast.created'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleToggle = async (todoId: string, isCompleted: boolean): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await setTodoCompletion({ db }, todoId, isCompleted);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleEdit = async (
    todoId: string,
    patch: {
      title?: string;
      description?: string | null;
      assignedTo?: string | null;
      dueDate?: string | null;
    },
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await updateTodo({ db }, todoId, patch);
      showToast(t('tasks.toast.updated'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleDelete = async (todoId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await deleteTodo({ db }, todoId);
      showToast(t('tasks.toast.deleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  // ---- Routines: templates ------------------------------------------------

  const handleCreateTemplate = async (input: {
    title: string;
    isSharedWithFamily: boolean;
    items: { id?: string; text: string }[];
  }): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await createTemplate(
        { db },
        {
          familyId,
          createdBy: currentUser.id,
          title: input.title,
          isSharedWithFamily: input.isSharedWithFamily,
          items: input.items,
        },
      );
      showToast(t('tasks.routines.toast.templateCreated'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleEditTemplate = async (
    templateId: string,
    input: {
      title?: string;
      isSharedWithFamily?: boolean;
      items?: { id?: string; text: string }[];
    },
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await updateTemplate({ db }, templateId, input);
      showToast(t('tasks.routines.toast.templateUpdated'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleDeleteTemplate = async (templateId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await deleteTemplate({ db }, templateId);
      showToast(t('tasks.routines.toast.templateDeleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  // ---- Routines: instances ------------------------------------------------

  const handleStartInstance = async (templateId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await startInstance(
        { db },
        {
          familyId,
          templateId,
          userId: currentUser.id,
          date: todayISOInLocalTZ(),
        },
      );
      showToast(t('tasks.routines.toast.runStarted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleToggleItem = async (
    instanceId: string,
    itemId: string,
    checked: boolean,
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await setInstanceItemProgress({ db }, instanceId, itemId, checked);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleCompleteInstance = async (
    instanceId: string,
    isCompleted: boolean,
  ): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await setInstanceCompletion({ db }, instanceId, isCompleted);
      showToast(t('tasks.routines.toast.runCompleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  const handleDeleteInstance = async (instanceId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      showToast(t('tasks.toast.generic'));
      return;
    }
    try {
      await deleteInstance({ db }, instanceId);
      showToast(t('tasks.routines.toast.runDeleted'));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('tasks.toast.generic'));
    }
  };

  return (
    <section className="flex flex-col gap-12 pt-4">
      <header className="px-16">
        <h1 className="text-display font-display font-extrabold text-ink">{t('tasks.title')}</h1>
      </header>
      <TabsBar tab={tab} onChange={setTab} />
      {tab === 'todos' ? (
        <TodoListPanel
          viewer={viewer}
          members={members}
          feed={feed}
          onCreate={handleCreate}
          onToggle={handleToggle}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ) : (
        <RoutinesPanel
          viewer={viewer}
          members={members}
          templatesFeed={templatesFeed}
          instancesFeed={instancesFeed}
          onCreateTemplate={handleCreateTemplate}
          onEditTemplate={handleEditTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onStartInstance={handleStartInstance}
          onToggleItem={handleToggleItem}
          onCompleteInstance={handleCompleteInstance}
          onDeleteInstance={handleDeleteInstance}
        />
      )}
    </section>
  );
}

interface TabsBarProps {
  tab: TabId;
  onChange: (tab: TabId) => void;
}

function TabsBar(props: TabsBarProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div
      role="tablist"
      aria-label={t('tasks.tabs.label')}
      className="mx-16 flex gap-4 rounded-control bg-surface-line2 p-4"
    >
      <TabButton
        id="todos"
        active={props.tab === 'todos'}
        label={t('tasks.tabs.todos')}
        onClick={() => props.onChange('todos')}
      />
      <TabButton
        id="routines"
        active={props.tab === 'routines'}
        label={t('tasks.tabs.routines')}
        onClick={() => props.onChange('routines')}
      />
    </div>
  );
}

function TabButton(props: {
  id: TabId;
  active: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      aria-controls={`tasks-panel-${props.id}`}
      onClick={props.onClick}
      className={`min-h-tap flex-1 rounded-control px-12 text-body font-semibold transition-colors focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus ${props.active ? 'bg-surface-card text-brand shadow-sheet' : 'text-ink-mute'}`}
    >
      {props.label}
    </button>
  );
}
